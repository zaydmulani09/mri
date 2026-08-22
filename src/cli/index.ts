#!/usr/bin/env node
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { extractRepo, type RepoExtraction } from "../extraction/index.js";
import { buildRepoGraph, openGraph, type BuildSummary } from "../graph/index.js";
import {
  computeBlastRadius,
  runAnalysis,
  type AnalysisReport,
  type BlastRadiusNode as BlastRadiusDependent,
} from "../analysis/index.js";

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

function runBlastRadius(args: { nodeId: string | null; db: string | null; format: string | null }): number {
  if (!args.nodeId) {
    process.stderr.write(`mri blast-radius requires a node id\n\n${USAGE}`);
    return 1;
  }
  const dbPath = args.db ?? path.join(".mri", "graph.sqlite");
  if (!existsSync(dbPath)) {
    process.stderr.write(`error: graph database not found at ${dbPath}\nRun \`mri build\` first.\n`);
    return 1;
  }

  let result;
  try {
    const store = openGraph(dbPath);
    try {
      result = computeBlastRadius(store, args.nodeId);
    } finally {
      store.db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  const format = args.format ?? "flat";
  if (format === "tree") {
    process.stdout.write(renderBlastRadiusTree(result) + "\n");
  } else {
    process.stdout.write(formatBlastRadius(result) + "\n");
  }
  return 0;
}

function renderBlastRadiusTree(result: ReturnType<typeof computeBlastRadius>): string {
  const lines: string[] = [`${result.root.id}  (${result.root.type})`];

  const childrenOf = new Map<string, BlastRadiusDependent[]>();
  const orphans: BlastRadiusDependent[] = [];
  for (const dep of result.dependents) {
    if (dep.parentId === null || dep.parentId === undefined) {
      orphans.push(dep);
      continue;
    }
    const list = childrenOf.get(dep.parentId) ?? [];
    list.push(dep);
    childrenOf.set(dep.parentId, list);
  }

  const walk = (parentId: string, indent: string): void => {
    const children = childrenOf.get(parentId) ?? [];
    for (const child of children) {
      const marker = child.via === "confirmed" ? "✓" : "?";
      lines.push(
        `${indent}├─ ${marker} ${child.id}   d${child.depth} · ${child.relation}`,
      );
      walk(child.id, indent + "│  ");
    }
  };
  walk(result.root.id, "");

  if (orphans.length > 0) {
    lines.push("");
    lines.push("? ambiguous-name references (not confirmed to point here):");
    for (const dep of orphans) {
      lines.push(`   ? ${dep.id}   ${dep.relation}`);
    }
  }
  return lines.join("\n");
}

interface BlastArgs {
  nodeId: string | null;
  db: string | null;
  format: string | null;
}

function parseBlastArgs(argv: string[]): BlastArgs | null {
  const args: BlastArgs = { nodeId: null, db: null, format: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case "--db":
      case "-d":
        args.db = argv[++i] ?? null;
        break;
      case "--format": {
        const value = argv[++i];
        if (value !== "tree" && value !== "flat") return null;
        args.format = value;
        break;
      }
      default:
        if (arg.startsWith("-")) return null;
        if (args.nodeId === null) args.nodeId = arg;
        else return null;
    }
  }
  return args;
}

function renderAnalysisReport(report: AnalysisReport): string {
  const lines: string[] = [];
  const c = report.summary.counts;
  const sum = (record: Record<string, number>): number =>
    Object.values(record).reduce((a, b) => a + b, 0);
  const calls = c.edgesByType["calls"] ?? 0;
  const resolvedCalls = calls - (c.edgesByConfidence["ambiguous"] ?? 0);

  lines.push("=".repeat(52));
  lines.push("mri codebase report");
  lines.push("=".repeat(52));
  lines.push(`repo:  ${report.root}`);
  lines.push(`built: ${report.generatedAt}   churn window: ${report.windowDays}d`);

  const langText = Object.entries(report.architecture.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, n]) => `${lang} ${n}`)
    .join(", ");
  lines.push("");
  lines.push("ARCHITECTURE");
  lines.push(`  files             ${report.summary.fileCount}${langText ? `   (${langText})` : ""}`);
  lines.push(
    `  symbols           functions ${(c.nodesByType["function"] ?? 0)} | classes ${
      c.nodesByType["class"] ?? 0
    } | methods ${c.nodesByType["method"] ?? 0}`,
  );
  lines.push(
    `  edges             defines ${c.edgesByType["defines"] ?? 0} | imports ${
      c.edgesByType["imports"] ?? 0
    } | calls ${calls} (${resolvedCalls} resolved / ${calls - resolvedCalls} ambiguous) | inherits ${
      c.edgesByType["inherits"] ?? 0
    }`,
  );
  if (report.architecture.externalModules.length > 0) {
    lines.push(
      `  external modules  ${report.architecture.externalModules.length}   [${report.architecture.externalModules.join(", ")}]`,
    );
  }
  if (report.architecture.mostImportedFiles.length > 0) {
    lines.push(
      `  most depended on  ${report.architecture.mostImportedFiles
        .map((f) => `${f.path} (${f.importers})`)
        .join(", ")}`,
    );
  }
  lines.push("");

  lines.push("TECH DEBT");
  lines.push(
    `  dead code candidates ${report.deadCode.length}   (detail under DEAD CODE)`,
  );
  lines.push("");
  lines.push(
    `  risk scores (top ${report.topRisks.length} of ${report.risks.length} files, window ${report.windowDays}d)`,
  );
  report.topRisks.forEach((risk, index) => {
    const parts = [
      `churn ${risk.components.churnCommits} commits (+${risk.churnPoints}pts)`,
      risk.components.hasTests
        ? "tested (+0pts)"
        : "no tests found (+30pts)",
    ];
    if (risk.components.untracked) parts.unshift("untracked in git");
    else if (risk.components.lastModifiedIso)
      parts.push(`last modified ${risk.components.lastModifiedIso.slice(0, 10)}`);
    lines.push(
      `    ${String(index + 1).padStart(2)}. ${risk.path.padEnd(28)} score ${String(risk.score).padStart(3)}   [${parts.join(" | ")}]`,
    );
  });
  lines.push("");

  lines.push("SECURITY-RELEVANT SIGNALS (gaps in knowledge, not findings)");
  const refs = report.security.unresolvedReferences
    .map((r) => `"${r.reference}" x${r.count}`)
    .join(", ");
  lines.push(`  unresolved references   ${report.security.unresolvedReferenceCount}   ${refs || "-"}`);
  lines.push(
    `  untested & churning     ${report.security.untestedChurningFiles.length}${
      report.security.untestedChurningFiles.length > 0
        ? `   -> ${report.security.untestedChurningFiles.join(", ")}`
        : ""
    }`,
  );
  lines.push(
    `  external dependencies   ${report.security.externalDependencies.length}${
      report.security.externalDependencies.length > 0
        ? `   -> ${report.security.externalDependencies.join(", ")}`
        : ""
    }`,
  );
  lines.push(`  files with parse errors ${report.security.parseErrorFileCount}`);
  lines.push("");

  const confirmed = report.deadCode.filter(
    (cand) => cand.confidence === "confirmed-unreferenced",
  ).length;
  lines.push("DEAD CODE");
  lines.push(
    `  candidates ${report.deadCode.length}: ${confirmed} confirmed-unreferenced, ${
      report.deadCode.length - confirmed
    } no-resolved-references`,
  );
  for (const candidate of report.deadCode) {
    lines.push(
      `    [${candidate.confidence}]  ${candidate.id}  [${candidate.path}]${
        candidate.note ? ` (${candidate.note})` : ""
      }`,
    );
  }
  if (report.deadCode.length === 0) lines.push("    none found (within the conservative rules above)");
  lines.push("");

  lines.push("TEST COVERAGE");
  const pct =
    report.coverage.sourceFiles.length === 0
      ? "n/a"
      : `${(report.coverage.coverageRatio * 100).toFixed(1)}%`;
  lines.push(
    `  estimated coverage ${pct} (${report.coverage.coveredFiles.length}/${report.coverage.sourceFiles.length} source files, import-based approximation)`,
  );
  for (const exercise of report.coverage.exercises) {
    lines.push(`    covered by ${exercise.testFile} -> ${exercise.covers.join(", ") || "(nothing internal)"}`);
  }
  const uncoveredSample = report.coverage.uncoveredFiles.slice(0, 8);
  if (uncoveredSample.length > 0) {
    const more =
      report.coverage.uncoveredFiles.length - uncoveredSample.length > 0
        ? `, +${report.coverage.uncoveredFiles.length - uncoveredSample.length} more`
        : "";
    lines.push(`    not covered: ${uncoveredSample.join(", ")}${more}`);
  }

  return lines.join("\n");
}

interface AnalyzeArgs {
  target: string | null;
  db: string | null;
  json: boolean;
  top: number | null;
  window: number | null;
}

function parseAnalyzeArgs(argv: string[]): AnalyzeArgs | null {
  const args: AnalyzeArgs = { target: null, db: null, json: false, top: null, window: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case "--db":
      case "-d":
        args.db = argv[++i] ?? null;
        break;
      case "--json":
        args.json = true;
        break;
      case "--top": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 1) return null;
        args.top = n;
        break;
      }
      case "--window": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 1) return null;
        args.window = n;
        break;
      }
      default:
        if (arg.startsWith("-")) return null;
        if (args.target === null) args.target = arg;
        else return null;
    }
  }
  return args;
}

async function runAnalyze(args: AnalyzeArgs): Promise<number> {
  if (!args.target) {
    process.stderr.write(`mri analyze requires a target path\n\n${USAGE}`);
    return 1;
  }
  const dbPath =
    args.db ?? path.join(path.resolve(args.target), ".mri", "graph.sqlite");

  let report: AnalysisReport;
  try {
    report = await runAnalysis(args.target, {
      dbPath,
      topN: args.top ?? 10,
      windowDays: args.window ?? 90,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  process.stdout.write(
    (args.json ? JSON.stringify(report, null, 2) : renderAnalysisReport(report)) + "\n",
  );
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
    const args = parseAnalyzeArgs(rest);
    if (!args) {
      process.stderr.write(`Invalid arguments\n\n${USAGE}`);
      return 1;
    }
    return runAnalyze(args);
  }

  if (command === "blast-radius") {
    const args = parseBlastArgs(rest);
    if (!args) {
      process.stderr.write(`Invalid arguments\n\n${USAGE}`);
      return 1;
    }
    return runBlastRadius(args);
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
  return runBuild(options);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
