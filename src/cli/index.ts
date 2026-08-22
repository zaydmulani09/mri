#!/usr/bin/env node
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { extractRepo, type RepoExtraction } from "../extraction/index.js";
import { buildRepoGraph, openGraph, type BuildSummary } from "../graph/index.js";
import { computeBlastRadius, runAnalysis, type AnalysisReport } from "../analysis/index.js";

const USAGE = `mri - code intelligence engine

Usage:
  mri extract <path> [--out <file>]
  mri build <path> [--db <file>]
  mri blast-radius <node-id> [--db <file>]
  mri analyze <path> [--top <n>] [--window <days>] [--db <file>]

Commands:
  extract       Walk the repository and write per-file symbol data as JSON.
  build         Extract, resolve imports/calls/inheritance, store a graph in
                SQLite. Prints node/edge counts including how many call edges
                resolved vs stayed ambiguous.
  blast-radius  Everything that depends on <node-id>, by depth, with confirmed
                vs ambiguous-only reachability kept separate.
  analyze       Build the graph and run analysis passes: dead code candidates,
                test coverage estimate, per-file risk scores.

Options:
  -o, --out <file>    extract: write JSON dump to <file> instead of stdout
  -d, --db <file>     SQLite database path for build/blast-radius/analyze
                      (default: <path>/.mri/graph.sqlite; blast-radius:
                      ./.mri/graph.sqlite)
      --top <n>       analyze: how many top-risk files to show (default 5)
      --window <d>    analyze: git churn window in days (default 90)
  -h, --help          Show this help
`;

interface CliOptions {
  target: string | null;
  out: string | null;
}

function parseArgs(argv: string[], flagAliases: Record<string, "out" | "db">): CliOptions | null {
  let target: string | null = null;
  let value: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    const alias = flagAliases[arg];
    if (alias) {
      value = argv[i + 1] ?? null;
      if (value === null) return null;
      i++;
    } else if (arg.startsWith("-")) {
      return null;
    } else if (target === null) {
      target = arg;
    } else {
      return null;
    }
  }
  return { target, out: value };
}

function summarize(result: RepoExtraction): string {
  let functions = 0;
  let classes = 0;
  let methods = 0;
  let imports = 0;
  let exports = 0;
  let filesWithErrors = 0;
  for (const file of result.files) {
    functions += file.functions.length;
    classes += file.classes.length;
    for (const cls of file.classes) methods += cls.methods.length;
    imports += file.imports.length;
    exports += file.exports.length;
    if (file.hasParseErrors) filesWithErrors++;
  }
  const lines = [
    `${result.files.length} files parsed`,
    `${functions} functions found`,
    `${classes} classes found (${methods} methods)`,
    `${imports} import statements`,
    `${exports} export statements`,
  ];
  if (filesWithErrors > 0) lines.push(`${filesWithErrors} files with parse errors`);
  return lines.join("\n");
}

function summarizeBuild(result: BuildSummary): string {
  const n = result.counts.nodesByType;
  const e = result.counts.edgesByType;
  const lines = [
    `${result.fileCount} files parsed`,
    `nodes: ${n["file"] ?? 0} files, ${n["function"] ?? 0} functions, ${
      n["class"] ?? 0
    } classes, ${n["method"] ?? 0} methods, ${n["module"] ?? 0} external modules`,
    `edges: ${e["defines"] ?? 0} defines, ${e["imports"] ?? 0} imports, ${
      e["calls"] ?? 0
    } calls (${result.callsResolved} resolved / ${result.callsAmbiguous} ambiguous), ${
      e["inherits"] ?? 0
    } inherits (${result.inheritsResolved} resolved / ${result.inheritsAmbiguous} ambiguous)`,
  ];
  return lines.join("\n");
}

async function runExtract(options: CliOptions): Promise<number> {
  if (!options.target) {
    process.stderr.write(`mri extract requires a target path\n\n${USAGE}`);
    return 1;
  }

  let result: RepoExtraction;
  try {
    result = await extractRepo(options.target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  const json = JSON.stringify(result, null, 2) + "\n";
  if (options.out) {
    await fs.writeFile(path.resolve(options.out), json, "utf8");
    process.stderr.write(`Wrote JSON dump to ${options.out}\n`);
  } else {
    process.stdout.write(json);
  }
  process.stderr.write(summarize(result) + "\n");
  return 0;
}

async function runBuild(options: CliOptions): Promise<number> {
  if (!options.target) {
    process.stderr.write(`mri build requires a target path\n\n${USAGE}`);
    return 1;
  }

  const dbPath =
    options.out ?? path.join(path.resolve(options.target), ".mri", "graph.sqlite");
  await fs.mkdir(path.dirname(path.resolve(dbPath)), { recursive: true });

  let result: BuildSummary;
  try {
    result = await buildRepoGraph(options.target, dbPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  process.stderr.write(summarizeBuild(result) + "\n");
  process.stderr.write(`Graph written to ${dbPath}\n`);
  return 0;
}

function formatBlastRadius(result: ReturnType<typeof computeBlastRadius>): string {
  const confirmed = result.dependents.filter((d) => d.via === "confirmed").length;
  const ambiguousOnly = result.dependents.length - confirmed;
  const lines = [
    `blast radius of ${result.root.id} (${result.root.type})`,
    `dependents: ${result.dependents.length} total (${confirmed} confirmed, ${ambiguousOnly} ambiguous-only)`,
  ];
  for (const dep of result.dependents) {
    const location = dep.path ? ` [${dep.path}]` : "";
    lines.push(
      `  d${dep.depth}  ${dep.via.padEnd(14)}  ${dep.relation.padEnd(20)}  ${dep.id}${location}`,
    );
  }
  return lines.join("\n");
}

function runBlastRadius(options: CliOptions): number {
  if (!options.target) {
    process.stderr.write(`mri blast-radius requires a node id\n\n${USAGE}`);
    return 1;
  }
  const dbPath = options.out ?? path.join(".mri", "graph.sqlite");
  if (!existsSync(dbPath)) {
    process.stderr.write(`error: graph database not found at ${dbPath}\nRun \`mri build\` first.\n`);
    return 1;
  }

  let result;
  try {
    const store = openGraph(dbPath);
    try {
      result = computeBlastRadius(store, options.target);
    } finally {
      store.db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  process.stdout.write(formatBlastRadius(result) + "\n");
  return 0;
}

function extractNumericFlags(
  argv: string[],
): { rest: string[]; values: Record<string, number> } | null {
  const names: Record<string, string> = {
    "--top": "top",
    "--window": "window",
  };
  const rest: string[] = [];
  const values: Record<string, number> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    const key = names[arg];
    if (key) {
      const raw = argv[i + 1];
      const parsed = raw !== undefined ? Number(raw) : NaN;
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      values[key] = parsed;
      i++;
    } else {
      rest.push(arg);
    }
  }
  return { rest, values };
}

function formatAnalysisReport(report: AnalysisReport): string {
  const lines: string[] = [];
  const calls = report.summary.counts.edgesByType["calls"] ?? 0;
  const ambiguousEdges = report.summary.counts.edgesByConfidence["ambiguous"] ?? 0;

  lines.push(`mri analysis: ${report.root}`);
  lines.push(
    `files ${report.summary.fileCount} | nodes ${
      Object.values(report.summary.counts.nodesByType).reduce((a, b) => a + b, 0)
    } | edges ${
      Object.values(report.summary.counts.edgesByType).reduce((a, b) => a + b, 0)
    } (calls ${calls}: ${calls - ambiguousEdges} resolved, ${ambiguousEdges} ambiguous)`,
  );
  lines.push("");

  const confirmed = report.deadCode.filter(
    (c) => c.confidence === "confirmed-unreferenced",
  ).length;
  lines.push(
    `dead code candidates: ${report.deadCode.length} (${confirmed} confirmed-unreferenced, ${
      report.deadCode.length - confirmed
    } no-resolved-references)`,
  );
  for (const candidate of report.deadCode) {
    lines.push(
      `  ${candidate.confidence.padEnd(26)}  ${candidate.id} [${candidate.path}]${
        candidate.note ? ` (${candidate.note})` : ""
      }`,
    );
  }
  lines.push("");

  const pct =
    report.coverage.sourceFiles.length === 0
      ? "n/a"
      : `${(report.coverage.coverageRatio * 100).toFixed(1)}%`;
  lines.push(
    `test coverage (import-based estimate): ${pct} (${
      report.coverage.coveredFiles.length
    }/${report.coverage.sourceFiles.length} source files)`,
  );
  for (const exercise of report.coverage.exercises) {
    lines.push(`  ${exercise.testFile} -> ${exercise.covers.join(", ") || "(nothing internal)"}`);
  }
  lines.push("");

  lines.push(`top risk files (churn window ${report.windowDays}d):`);
  report.topRisks.forEach((risk, index) => {
    const parts = [
      `churn ${risk.components.churnCommits} commits (+${risk.churnPoints}pts)`,
      risk.components.hasTests
        ? `tested by ${risk.components.coveringTests.join(", ")} (+0pts)`
        : "no tests found (+30pts)",
    ];
    if (risk.components.untracked) parts.unshift("untracked in git");
    else if (risk.components.lastModifiedIso)
      parts.push(`last modified ${risk.components.lastModifiedIso.slice(0, 10)}`);
    lines.push(
      `  ${index + 1}. ${risk.path}  score ${risk.score}  [${parts.join(" | ")}]`,
    );
  });

  return lines.join("\n");
}

async function runAnalyze(options: CliOptions, numeric: Record<string, number>): Promise<number> {
  if (!options.target) {
    process.stderr.write(`mri analyze requires a target path\n\n${USAGE}`);
    return 1;
  }
  const dbPath =
    options.out ?? path.join(path.resolve(options.target), ".mri", "graph.sqlite");

  let report: AnalysisReport;
  try {
    report = await runAnalysis(options.target, {
      dbPath,
      topN: numeric["top"] ?? 5,
      windowDays: numeric["window"] ?? 90,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  process.stdout.write(formatAnalysisReport(report) + "\n");
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (
    command !== "extract" &&
    command !== "build" &&
    command !== "blast-radius" &&
    command !== "analyze"
  ) {
    process.stderr.write(`Unknown command: ${command ?? "<none>"}\n\n${USAGE}`);
    return 1;
  }

  const rest = argv.slice(1);

  if (command === "analyze") {
    const numericResult = extractNumericFlags(rest);
    if (!numericResult) {
      process.stderr.write(`Invalid arguments\n\n${USAGE}`);
      return 1;
    }
    const options = parseArgs(numericResult.rest, { "--db": "out", "-d": "out" });
    if (!options) {
      process.stderr.write(`Invalid arguments\n\n${USAGE}`);
      return 1;
    }
    return runAnalyze(options, numericResult.values);
  }

  const options =
    command === "extract"
      ? parseArgs(rest, { "--out": "out", "-o": "out" })
      : parseArgs(rest, { "--db": "out", "-d": "out" });
  if (!options) {
    process.stderr.write(`Invalid arguments\n\n${USAGE}`);
    return 1;
  }

  if (command === "extract") return runExtract(options);
  if (command === "build") return runBuild(options);
  return runBlastRadius(options);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
