#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractRepo, type RepoExtraction } from "../extraction/index.js";
import { buildRepoGraph, type BuildSummary } from "../graph/index.js";

const USAGE = `mri - code intelligence engine

Usage:
  mri extract <path> [--out <file>]
  mri build <path> [--db <file>]

Commands:
  extract   Walk the repository and write per-file symbol data as JSON.
  build     Extract, resolve imports/calls/inheritance, store a graph in
            SQLite. Prints node/edge counts including how many call edges
            resolved vs stayed ambiguous.

Options:
  -o, --out <file>    extract: write JSON dump to <file> instead of stdout
  -d, --db <file>     build: SQLite database path
                      (default: <path>/.mri/graph.sqlite)
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

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command !== "extract" && command !== "build") {
    process.stderr.write(`Unknown command: ${command ?? "<none>"}\n\n${USAGE}`);
    return 1;
  }

  const rest = argv.slice(1);
  const options =
    command === "extract"
      ? parseArgs(rest, { "--out": "out", "-o": "out" })
      : parseArgs(rest, { "--db": "out", "-d": "out" });
  if (!options) {
    process.stderr.write(`Invalid arguments\n\n${USAGE}`);
    return 1;
  }

  return command === "extract" ? runExtract(options) : runBuild(options);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
