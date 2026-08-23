#!/usr/bin/env node
import { existsSync, promises as fs, watch as fsWatch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { extractRepo, SOURCE_EXTENSIONS, type RepoExtraction } from "../extraction/index.js";
import {
  buildRepoGraph,
  openGraph,
  type BuildOptions,
  type BuildSummary,
} from "../graph/index.js";
import {
  computeBlastRadius,
  runAnalysis,
  type AnalysisReport,
  type BlastRadiusNode as BlastRadiusDependent,
} from "../analysis/index.js";
import {
  buildReasoningContext,
  createDefaultLlmClient,
  executeQuery,
  narrateAnswer,
  parseQuestion,
  renderAnswer,
} from "../reasoning/index.js";
import { runGuardCommand } from "./guard-command.js";
import { checkRuntime } from "./env-check.js";
import { createMcpServer, mcpContextFromReasoning } from "../mcp/index.js";
import {
  createGraphServer,
  openBrowser,
  prepareServeContext,
} from "./serve-command.js";

const USAGE = `mri - code intelligence engine

Usage:
  mri extract <path> [--out <file>]
  mri build <path> [--db <file>] [--incremental] [--watch]
  mri blast-radius <node-id> [--format tree] [--db <file>]
  mri analyze <path> [--top <n>] [--window <days>] [--db <file>] [--json]
  mri ask "<question>" <path> [--window <days>]
  mri guard <scope-node-id> <code-file | -> [--path <repo>] [--resources <config.json>]
            [--json] [--timeout-ms <n>]
  mri serve <path> [--port <n>] [--no-open]
  mri mcp <path>

Commands:
  extract       Walk the repository and write per-file symbol data as JSON.
  build         Extract, resolve imports/calls/inheritance, store a graph in
                SQLite. Prints node/edge counts including how many call edges
                resolved vs stayed ambiguous.
                --incremental  reuse cached extractions for files whose
                               content hash is unchanged; resolution still
                               runs over the full merged symbol set, so the
                               result is identical to a full rebuild.
                --watch        keep running and incrementally rebuild on file
                               save (implies --incremental). Ctrl+C stops.
  blast-radius  Everything that depends on <node-id>, by depth, with confirmed
                vs ambiguous-only reachability kept separate.
  analyze       Build the graph and run analysis passes: dead code candidates,
                test coverage estimate, per-file risk scores, cyclomatic
                complexity.
  ask           Ask a natural-language question about the repo. The question
                is mapped onto one of the supported graph queries, executed
                against the real graph, and narrated from that result only.
  guard         Check a snippet of code against the allowlist generated for a
                scope node. Blocked code prints every containment breach and
                exits non-zero; clean runs print the return value.
  serve         Build the graph, serve the dashboard from dashboard/dist, and
                open it in a browser. Binds 127.0.0.1 only.
  mcp           Start an MCP (Model Context Protocol) server over stdio that
                exposes graph and analysis queries as tools for AI coding
                agents. See docs/MCP_SERVER.md.

Options:
  -o, --out <file>    extract: write JSON dump to <file> instead of stdout
  -d, --db <file>     SQLite database path for build/blast-radius/analyze
                      (default: <path>/.mri/graph.sqlite; blast-radius:
                      ./.mri/graph.sqlite)
      --format tree   blast-radius: indented tree with confidence markers
      --json          analyze/guard: machine-readable output
      --top <n>       analyze: how many top-risk files to show (default 10)
      --window <d>    analyze/ask: git churn window in days (default 90)
  -p, --path <dir>    guard: repository to build the scope's graph from
                      (default: current directory)
      --resources <f> guard: JSON resource-grant config keyed by scope id
      --timeout-ms <n> guard: sandbox execution timeout (default 1000)
      --port <n>      serve: local port to bind (default 6473)
      --no-open       serve: do not launch a browser
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
  if (result.parseErrorFiles > 0) {
    lines.push(
      `${result.parseErrorFiles} file(s) had parse errors — the graph is missing structure for them`,
    );
  }
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

interface BuildArgs {
  target: string | null;
  db: string | null;
  incremental: boolean;
  watch: boolean;
}

function parseBuildArgs(argv: string[]): BuildArgs | null {
  const args: BuildArgs = { target: null, db: null, incremental: false, watch: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case "--db":
      case "-d":
        args.db = argv[++i] ?? null;
        if (args.db === null) return null;
        break;
      case "--incremental":
        args.incremental = true;
        break;
      case "--watch":
        args.watch = true;
        args.incremental = true;
        break;
      default:
        if (arg.startsWith("-")) return null;
        if (args.target === null) args.target = arg;
        else return null;
    }
  }
  return args.target !== null ? args : null;
}

function describeStats(stats: {
  mode: "full" | "incremental";
  cachedFiles: number;
  reextractedFiles: number;
  changedFiles: number;
  addedFiles: number;
  removedFiles: number;
  dependentFiles: number;
}): string {
  if (stats.mode === "full") return "full build";
  return (
    `incremental: ${stats.reextractedFiles} re-extracted` +
    ` (${stats.changedFiles} changed, ${stats.addedFiles} added, ${stats.dependentFiles} dependents)` +
    `, ${stats.cachedFiles} cached, ${stats.removedFiles} removed`
  );
}

async function runBuild(args: BuildArgs): Promise<number> {
  if (!args.target) {
    process.stderr.write(`mri build requires a target path\n\n${USAGE}`);
    return 1;
  }

  const dbPath =
    args.db ?? path.join(path.resolve(args.target), ".mri", "graph.sqlite");
  await fs.mkdir(path.dirname(path.resolve(dbPath)), { recursive: true });

  let result;
  try {
    result = await timedBuild(args.target, dbPath, { incremental: args.incremental });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  process.stderr.write(summarizeBuild(result.summary) + "\n");
  process.stderr.write(
    `${describeStats(result.summary.stats)} in ${result.elapsedMs} ms\n`,
  );
  process.stderr.write(`Graph written to ${dbPath}\n`);

  if (!args.watch) return 0;

  await watchRepoForBuilds(args.target, dbPath);
  return 0;
}

async function timedBuild(
  target: string,
  dbPath: string,
  options: BuildOptions,
): Promise<{ summary: BuildSummary; elapsedMs: number }> {
  const startedAt = performance.now();
  const summary = await buildRepoGraph(target, dbPath, options);
  return { summary, elapsedMs: Math.round(performance.now() - startedAt) };
}

const WATCH_DEBOUNCE_MS = 120;
const WATCH_IGNORED_SEGMENTS = new Set([".mri", ".git"]);

async function watchRepoForBuilds(target: string, dbPath: string): Promise<void> {
  const rootAbs = path.resolve(target);
  process.stderr.write(
    `watching ${rootAbs} — incrementally rebuilding on save (Ctrl+C to stop)\n`,
  );

  let rebuildQueued = false;
  let rebuilding = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const runRebuild = async (): Promise<void> => {
    rebuilding = true;
    try {
      const result = await timedBuild(target, dbPath, { incremental: true });
      process.stderr.write(
        `[watch] rebuilt in ${result.elapsedMs} ms — ${describeStats(result.summary.stats)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[watch] rebuild failed: ${message}\n`);
    }
    rebuilding = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      void runRebuild();
    }
  };

  const scheduleRebuild = (): void => {
    if (rebuilding) {
      // A change landed mid-rebuild; run one trailing pass so the final
      // state is always reflected.
      rebuildQueued = true;
      return;
    }
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runRebuild();
    }, WATCH_DEBOUNCE_MS);
  };

  const watcher = fsWatch(rootAbs, { recursive: true }, (_eventType, filename) => {
    if (typeof filename === "string") {
      const posixName = filename.split(path.sep).join("/");
      const segments = posixName.split("/");
      if (segments.some((segment) => WATCH_IGNORED_SEGMENTS.has(segment))) return;
      if (!SOURCE_EXTENSIONS.has(path.extname(posixName))) return;
    }
    scheduleRebuild();
  });

  watcher.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: watcher failed: ${message}\n`);
    watcher.close();
    process.exitCode = 1;
  });

  // Keep the process alive for as long as the watcher does; resolve never
  // resolves under normal operation (Ctrl+C terminates the process).
  await new Promise<never>(() => {});
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
  lines.push(
    `  circular dependency groups ${report.cycles.importCycles.length}   (detail under CIRCULAR DEPENDENCIES)`,
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
      `max CC ${risk.components.maxComplexity} (+${risk.complexityPoints}pts)`,
    ];
    if (risk.components.untracked) parts.unshift("untracked in git");
    else if (risk.components.lastModifiedIso)
      parts.push(`last modified ${risk.components.lastModifiedIso.slice(0, 10)}`);
    lines.push(
      `    ${String(index + 1).padStart(2)}. ${risk.path.padEnd(28)} score ${String(risk.score).padStart(3)}   [${parts.join(" | ")}]`,
    );
  });
  if (report.complexity.topFunctions.length > 0) {
    lines.push(
      `  highest-complexity functions (top ${report.complexity.topFunctions.length} of ${report.complexity.totalFunctions})`,
    );
    for (const fn of report.complexity.topFunctions) {
      lines.push(
        `    CC ${String(fn.complexity).padStart(3)}  ${fn.path}:${fn.startLine}  ${fn.name}`,
      );
    }
  }
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

  lines.push("DEAD CODE");
  const confirmed = report.deadCode.filter(
    (cand) => cand.confidence === "confirmed-unreferenced",
  ).length;
  const referencedButUncalled = report.deadCode.filter(
    (cand) => cand.confidence === "referenced-but-uncalled",
  ).length;
  lines.push(
    `  candidates ${report.deadCode.length}: ${confirmed} confirmed-unreferenced, ${referencedButUncalled} referenced-but-uncalled, ${
      report.deadCode.length - confirmed - referencedButUncalled
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

  lines.push("CIRCULAR DEPENDENCIES (resolved edges only)");
  const filesInCycles = new Set<string>();
  for (const cycle of report.cycles.importCycles) {
    for (const node of cycle.path) filesInCycles.add(node);
  }
  lines.push(
    `  import cycles ${report.cycles.importCycles.length}   (files involved ${filesInCycles.size})`,
  );
  for (const cycle of report.cycles.importCycles.slice(0, 5)) {
    lines.push(`    ${cycle.path.join(" -> ")} -> ${cycle.path[0]}   [${cycle.length} files]`);
  }
  if (report.cycles.importCycles.length > 5) {
    lines.push(
      `    +${report.cycles.importCycles.length - 5} more strongly-connected groups`,
    );
  }
  lines.push(`  call cycles ${report.cycles.callCycles.length}`);
  for (const cycle of report.cycles.callCycles.slice(0, 5)) {
    lines.push(`    ${cycle.path.join(" -> ")} -> ${cycle.path[0]}   [${cycle.length} calls]`);
  }
  if (report.cycles.callCycles.length > 5) {
    lines.push(
      `    +${report.cycles.callCycles.length - 5} more strongly-connected groups`,
    );
  }
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

interface AskArgs {
  question: string | null;
  target: string | null;
  window: number | null;
  db: string | null;
}

function parseAskArgs(argv: string[]): AskArgs | null {
  const args: AskArgs = { question: null, target: null, window: null, db: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case "--window": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 1) return null;
        args.window = n;
        break;
      }
      case "--db":
      case "-d":
        args.db = argv[++i] ?? null;
        break;
      default:
        if (arg.startsWith("-")) return null;
        if (args.question === null) args.question = arg;
        else if (args.target === null) args.target = arg;
        else return null;
    }
  }
  return args.question !== null && args.target !== null ? args : args;
}

async function runAsk(args: AskArgs): Promise<number> {
  if (!args.target || !args.question) {
    process.stderr.write(`mri ask requires a quoted question and a target path\n\n${USAGE}`);
    return 1;
  }

  const windowDays = args.window ?? 90;
  const dbPath =
    args.db ?? path.join(path.resolve(args.target), ".mri", "graph.sqlite");

  let answer;
  try {
    await runAnalysis(args.target, { dbPath, windowDays });
    const store = openGraph(dbPath);
    try {
      const context = buildReasoningContext(store, args.target, windowDays);
      const parsed = parseQuestion(args.question);
      if (!parsed.ok) {
        process.stderr.write(`${parsed.reason}\n`);
        return 1;
      }
      answer = executeQuery(context, parsed.query);
    } finally {
      store.db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  const client = createDefaultLlmClient();
  const modelAvailable = client.isAvailable ? await client.isAvailable() : false;
  if (!modelAvailable) {
    process.stdout.write(
      "(local model not available — showing raw result)\n\n" + renderAnswer(answer) + "\n",
    );
    return 0;
  }
  process.stdout.write((await narrateAnswer(answer, client)) + "\n");
  return 0;
}

interface GuardCliArgs {
  scopeId: string | null;
  source: string | null;
  path: string | null;
  resources: string | null;
  json: boolean;
  timeoutMs: number | null;
}

function parseGuardArgs(argv: string[]): GuardCliArgs | null {
  const args: GuardCliArgs = {
    scopeId: null,
    source: null,
    path: null,
    resources: null,
    json: false,
    timeoutMs: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case "--path":
      case "-p":
        args.path = argv[++i] ?? null;
        break;
      case "--resources":
        args.resources = argv[++i] ?? null;
        break;
      case "--json":
        args.json = true;
        break;
      case "--timeout-ms": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 1) return null;
        args.timeoutMs = n;
        break;
      }
      default:
        if (arg.startsWith("-")) return null;
        if (args.scopeId === null) args.scopeId = arg;
        else if (args.source === null) args.source = arg;
        else return null;
    }
  }
  return args;
}

interface ServeCliArgs {
  target: string | null;
  port: number | null;
  noOpen: boolean;
}

function parseServeArgs(argv: string[]): ServeCliArgs | null {
  const args: ServeCliArgs = { target: null, port: null, noOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case "--port": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
        args.port = n;
        break;
      }
      case "--no-open":
        args.noOpen = true;
        break;
      default:
        if (arg.startsWith("-")) return null;
        if (args.target === null) args.target = arg;
        else return null;
    }
  }
  return args;
}

async function runServe(args: ServeCliArgs): Promise<number> {
  if (!args.target) {
    process.stderr.write(`mri serve requires a repository path\n\n${USAGE}`);
    return 1;
  }

  process.stderr.write("building graph…\n");
  let ctx;
  try {
    ctx = await prepareServeContext(args.target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  const dashboardDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "dashboard",
    "dist",
  );

  const port = args.port ?? 6473;
  const server = createGraphServer(ctx, dashboardDist);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  }).catch((error) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return -1;
  });

  if (!server.listening) return 1;

  const url = `http://127.0.0.1:${port}`;
  process.stderr.write(`serving ${ctx.repoRoot}\n${url}  (Ctrl+C to stop)\n`);
  if (!args.noOpen) openBrowser(url);
  return new Promise<number>((resolve) => {
    const shutdown = (): void => {
      server.close(() => resolve(0));
      ctx.store.db.close();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    server.on("close", () => resolve(0));
  });
}

interface McpCliArgs {
  target: string | null;
}

function parseMcpArgs(argv: string[]): McpCliArgs | null {
  const args: McpCliArgs = { target: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg.startsWith("-")) return null;
    if (args.target === null) args.target = arg;
    else return null;
  }
  return args;
}

async function runMcp(args: McpCliArgs): Promise<number> {
  if (!args.target) {
    process.stderr.write(`mri mcp requires a repository path\n\n${USAGE}`);
    return 1;
  }

  const repoRoot = path.resolve(args.target);
  process.stderr.write(`building graph for ${repoRoot}…\n`);
  let ctx;
  try {
    await buildRepoGraph(repoRoot, path.join(repoRoot, ".mri", "graph.sqlite"));
    const store = openGraph(path.join(repoRoot, ".mri", "graph.sqlite"));
    const reasoning = buildReasoningContext(store, repoRoot, 90);
    ctx = mcpContextFromReasoning(reasoning);
    var storeRef = store;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  process.stderr.write("mcp server ready on stdio\n");
  await new Promise<void>((resolve) => {
    createMcpServer(process.stdin, process.stdout, ctx, () => resolve());
  });
  storeRef.db.close();
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
    command !== "analyze" &&
    command !== "ask" &&
    command !== "guard" &&
    command !== "serve" &&
    command !== "mcp"
  ) {
    process.stderr.write(`Unknown command: ${command ?? "<none>"}\n\n${USAGE}`);
    return 1;
  }

  const runtime = await checkRuntime(command);
  if (!runtime.ok) {
    process.stderr.write(`error: ${runtime.message}\n`);
    return 1;
  }

  const rest = argv.slice(1);

  if (command === "guard") {
    const args = parseGuardArgs(rest);
    if (!args || !args.scopeId || !args.source) {
      process.stderr.write(
        `mri guard requires a scope node id and a code file ('-' for stdin)\n\n${USAGE}`,
      );
      return 1;
    }
    const result = await runGuardCommand({
      scopeId: args.scopeId,
      source: args.source,
      repoPath: args.path ?? process.cwd(),
      resourcesPath: args.resources,
      json: args.json,
      timeoutMs: args.timeoutMs,
    });
    if (result.stdout) process.stdout.write(result.stdout + "\n");
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  }

  if (command === "ask") {
    const args = parseAskArgs(rest);
    if (!args || !args.question || !args.target) {
      process.stderr.write(`Invalid arguments\n\n${USAGE}`);
      return 1;
    }
    return runAsk(args);
  }

  if (command === "serve") {
    const args = parseServeArgs(rest);
    if (!args) {
      process.stderr.write(`Invalid arguments\n\n${USAGE}`);
      return 1;
    }
    return runServe(args);
  }

  if (command === "mcp") {
    const args = parseMcpArgs(rest);
    if (!args || !args.target) {
      process.stderr.write(
        `mri mcp requires a repository path\n\n${USAGE}`,
      );
      return 1;
    }
    return runMcp(args);
  }

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

  if (command === "build") {
    const args = parseBuildArgs(rest);
    if (!args) {
      process.stderr.write(`Invalid arguments\n\n${USAGE}`);
      return 1;
    }
    return runBuild(args);
  }

  const options = parseArgs(rest, { "--out": "out", "-o": "out" });
  if (!options) {
    process.stderr.write(`Invalid arguments\n\n${USAGE}`);
    return 1;
  }
  return runExtract(options);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
