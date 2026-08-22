import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { getConfig } from "./config";
import {
  parseBlastRadiusFlat,
  symbolEntriesFromFile,
  type AnalysisReport,
  type BlastRadiusFlat,
  type RepoExtraction,
  type SymbolEntry,
} from "./parse";

export interface CliTarget {
  /** Command to run: either [node, entryPoint] or a bare binary. */
  command: string;
  argsPrefix: string[];
  /** How the target was resolved, for diagnostics. */
  source: string;
}

const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py"]);

export class MriCliError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "MriCliError";
  }
}

/**
 * Locate MRI's CLI entry point:
 * 1. the mri.entryPoint setting
 * 2. <workspaceRoot>/dist/cli/index.js   (the workspace IS an mri checkout)
 * 3. <workspaceRoot>/../mri/dist/cli/index.js (sibling checkout)
 * 4. bare `mri` binary on PATH
 */
export async function resolveCliTarget(workspaceRoot: string): Promise<CliTarget | null> {
  const config = getConfig();
  if (config.entryPoint) {
    return { command: process.execPath, argsPrefix: [config.entryPoint], source: "setting" };
  }
  const inWorkspace = path.join(workspaceRoot, "dist", "cli", "index.js");
  if (await fileExists(inWorkspace)) {
    return { command: process.execPath, argsPrefix: [inWorkspace], source: "workspace" };
  }
  const sibling = path.join(path.dirname(workspaceRoot), "mri", "dist", "cli", "index.js");
  if (await fileExists(sibling)) {
    return { command: process.execPath, argsPrefix: [sibling], source: "sibling" };
  }
  const onPath = await whichAsync("mri");
  if (onPath) {
    return { command: onPath, argsPrefix: [], source: "path" };
  }
  return null;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runCli(
  target: CliTarget,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(target.command, [...target.argsPrefix, ...args], {
      cwd: options.cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            if (!settled) {
              settled = true;
              child.kill();
              reject(new MriCliError(`MRI CLI timed out after ${options.timeoutMs}ms`, stderr));
            }
          }, options.timeoutMs)
        : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(new MriCliError(`failed to spawn MRI CLI: ${(error as Error).message}`, stderr));
      }
    });
    child.on("close", (exitCode) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ exitCode: exitCode ?? -1, stdout, stderr });
      }
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input, "utf8");
    } else {
      child.stdin.end();
    }
  });
}

export interface WorkspaceAnalysis {
  root: string;
  extraction: RepoExtraction;
  entriesByFile: Map<string, SymbolEntry[]>;
  riskByPath: Map<string, number>;
  dependentsById: Map<string, number>;
}

/** One refresh cycle: extract symbols + analyze risk + count reverse edges. */
export async function analyzeWorkspace(
  workspaceRoot: string,
  target: CliTarget,
): Promise<WorkspaceAnalysis> {
  const windowDays = getConfig().churnWindowDays;

  const extractTmp = path.join(
    os.tmpdir(),
    `mri-vscode-extract-${process.pid}-${Date.now()}.json`,
  );
  const extractRun = await runCli(target, ["extract", workspaceRoot, "--out", extractTmp], {
    cwd: workspaceRoot,
    timeoutMs: 120_000,
  });
  if (extractRun.exitCode !== 0) {
    throw new MriCliError(`mri extract failed (${extractRun.exitCode})`, extractRun.stderr);
  }
  const extraction = JSON.parse(await fs.readFile(extractTmp, "utf8")) as RepoExtraction;
  await fs.rm(extractTmp, { force: true });

  const analyzeRun = await runCli(
    target,
    ["analyze", workspaceRoot, "--json", "--window", String(windowDays)],
    { cwd: workspaceRoot, timeoutMs: 180_000 },
  );
  if (analyzeRun.exitCode !== 0) {
    throw new MriCliError(`mri analyze failed (${analyzeRun.exitCode})`, analyzeRun.stderr);
  }
  const report = JSON.parse(stripJsonPrefix(analyzeRun.stdout)) as AnalysisReport;
  const riskByPath = new Map<string, number>();
  for (const risk of report.risks ?? []) {
    riskByPath.set(risk.path, risk.score);
  }

  const entriesByFile = new Map<string, SymbolEntry[]>();
  for (const file of extraction.files ?? []) {
    entriesByFile.set(file.path, symbolEntriesFromFile(file));
  }

  const dbPath = path.join(workspaceRoot, ".mri", "graph.sqlite");
  const dependentsById = await readDependentCounts(target, dbPath);

  return { root: workspaceRoot, extraction, entriesByFile, riskByPath, dependentsById };
}

async function readDependentCounts(target: CliTarget, dbPath: string): Promise<Map<string, number>> {
  if (!(await fileExists(dbPath))) {
    return new Map();
  }
  // The counting script runs under the same Node that runs MRI itself, so
  // node:sqlite availability matches whatever `mri build` already requires.
  const scriptDir = await fs.mkdtemp(path.join(os.tmpdir(), "mri-vscode-"));
  const scriptPath = path.join(scriptDir, "dep-counts.cjs");
  await fs.writeFile(
    scriptPath,
    [
      "const { DatabaseSync } = require('node:sqlite');",
      "const db = new DatabaseSync(process.argv[2]);",
      "const rows = db.prepare(",
      "  \"SELECT dst AS id, COUNT(*) AS n FROM edges \" +",
      "  \"WHERE confidence = 'resolved' AND dst IS NOT NULL \" +",
      "  \"AND type IN ('calls','imports','inherits') GROUP BY dst\"",
      ").all();",
      "process.stdout.write(JSON.stringify(Object.fromEntries(rows.map(r => [r.id, r.n]))));",
      "db.close();",
    ].join("\n"),
    "utf8",
  );
  try {
    const run = await runCli(target, [scriptPath, dbPath], { timeoutMs: 60_000 });
    if (run.exitCode !== 0 || run.stdout.trim().length === 0) {
      return new Map();
    }
    const parsed = JSON.parse(run.stdout) as Record<string, number>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  } finally {
    await fs.rm(scriptDir, { recursive: true, force: true });
  }
}

export async function runBlastRadiusFlat(
  target: CliTarget,
  nodeId: string,
  workspaceRoot: string,
): Promise<BlastRadiusFlat> {
  const dbPath = path.join(workspaceRoot, ".mri", "graph.sqlite");
  const run = await runCli(target, ["blast-radius", nodeId, "--db", dbPath], {
    cwd: workspaceRoot,
    timeoutMs: 120_000,
  });
  if (run.exitCode !== 0) {
    throw new MriCliError(firstMeaningfulLine(run.stderr) || `blast-radius failed (${run.exitCode})`, run.stderr);
  }
  return parseBlastRadiusFlat(run.stdout);
}

export interface GuardOutcome {
  blocked: boolean;
  breaches: Array<{
    kind: string;
    line: number;
    attempted: string;
    message: string;
    ruleArea: string | null;
    ruleExpected: string | null;
  }>;
  allowlistSummary: string;
}

export async function runGuardCheck(
  target: CliTarget,
  scopeId: string,
  code: string,
  workspaceRoot: string,
): Promise<GuardOutcome> {
  // MRI's guard command accepts '-' for stdin per its usage text, but its
  // argument parser rejects any token starting with '-', including '-'
  // itself. Until that is fixed upstream, bridge editor content via a temp
  // payload file.
  const resourcesPath = getConfig().guardResourcesPath;
  const payloadTmp = path.join(
    os.tmpdir(),
    `mri-vscode-guard-${process.pid}-${Date.now()}.js`,
  );
  await fs.writeFile(payloadTmp, code, "utf8");
  const args = ["guard", scopeId, payloadTmp, "--path", workspaceRoot, "--json"];
  if (resourcesPath) args.push("--resources", resourcesPath);

  try {
    const run = await runCli(target, args, {
      cwd: workspaceRoot,
      timeoutMs: 300_000,
    });
    if (run.stdout.trim().length === 0) {
      throw new MriCliError(firstMeaningfulLine(run.stderr) || "mri guard produced no output", run.stderr);
    }
    const payload = JSON.parse(stripJsonPrefix(run.stdout)) as {
      outcome?: string;
      breaches?: Array<{
        kind?: string;
        line?: number;
        attempted?: string;
        message?: string;
        rule?: { area?: string; expected?: string } | null;
      }>;
      allowlist?: { symbols: number; files: number; unresolved: number };
    };
    return {
      blocked: payload.outcome === "blocked",
      breaches: (payload.breaches ?? []).map((breach) => ({
        kind: breach.kind ?? "unknown",
        line: typeof breach.line === "number" ? breach.line : 1,
        attempted: breach.attempted ?? "",
        message: breach.message ?? "",
        ruleArea: breach.rule?.area ?? null,
        ruleExpected: breach.rule?.expected ?? null,
      })),
      allowlistSummary: payload.allowlist
        ? `${payload.allowlist.symbols} symbol(s), ${payload.allowlist.files} file(s); ${payload.allowlist.unresolved} unresolved reference(s)`
        : "unknown allowlist",
    };
  } finally {
    await fs.rm(payloadTmp, { force: true });
  }
}

function stripJsonPrefix(text: string): string {
  const start = text.indexOf("{");
  return start === -1 ? text : text.slice(start);
}

function firstMeaningfulLine(stderr: string): string {
  for (const line of stderr.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("(node:")) return trimmed;
  }
  return "";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function whichAsync(binary: string): Promise<string | null> {
  const paths = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? [".cmd", ".cmd.exe", ".exe", ""] : [""];
  for (const dir of paths) {
    for (const ext of extensions) {
      const candidate = path.join(dir, binary + ext);
      if (await fileExists(candidate)) return candidate;
    }
  }
  return null;
}

export function isSupportedSourceDocument(uri: vscode.Uri): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase());
}
