#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractRepo, type RepoExtraction } from "../extraction/index.js";

const USAGE = `mri - code intelligence engine

Usage:
  mri extract <path> [--out <file>]

Walks the repository at <path>, extracts per-file symbols (functions,
classes, methods, imports, exports), and writes a JSON dump. The JSON goes
to stdout unless --out is given; the human-readable summary always goes to
stderr.

Options:
  -o, --out <file>   Write JSON dump to <file> instead of stdout
  -h, --help         Show this help
`;

interface CliOptions {
  target: string | null;
  out: string | null;
}

function parseArgs(argv: string[]): CliOptions | null {
  let target: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--out" || arg === "-o") {
      out = argv[i + 1] ?? null;
      if (out === null) return null;
      i++;
    } else if (arg.startsWith("-")) {
      return null;
    } else if (target === null) {
      target = arg;
    } else {
      return null;
    }
  }
  return { target, out };
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

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command !== "extract") {
    process.stderr.write(`Unknown command: ${command ?? "<none>"}\n\n${USAGE}`);
    return 1;
  }

  const options = parseArgs(argv.slice(1));
  if (!options || !options.target) {
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

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
