// postinstall verification for the mri npm package.
//
// Runs right after `npm install mri` (or `npm install` inside a checkout) and
// verifies the three things every mri command depends on:
//   1. Node >= 22.5        (node:sqlite availability)
//   2. node:sqlite loads   (the graph database backend)
//   3. tree-sitter native bindings load and parse
// A failure exits non-zero with actionable instructions instead of leaving
// the user to discover a cryptic crash on first use.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromPackage = createRequire(path.join(packageRoot, "package.json"));

function fail(messages) {
  console.error("mri postinstall check FAILED:");
  for (const line of messages) console.error("  " + line);
  process.exit(1);
}

function nativeBindingFailure(error, grammarName) {
  const lines = [
    `could not load tree-sitter${grammarName ? ` (${grammarName})` : ""}: ${
      String(error.message).split("\n")[0]
    }`,
    "The native bindings are missing or were built for a different Node/ABI.",
    "Fix with (inside the directory where mri is installed):",
    "  npm rebuild tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-python tree-sitter-go",
    "Or reinstall the package so prebuilt binaries for your platform are fetched:",
    "  npm install mri --force",
  ];
  if (process.env.npm_config_ignore_scripts) {
    lines.push("Note: you installed with --ignore-scripts; native checks were skipped then.");
  }
  return lines;
}

// 1. Node version ------------------------------------------------------------
const versionMatch = /^v(\d+)\.(\d+)/.exec(process.version);
const major = versionMatch ? Number(versionMatch[1]) : 0;
const minor = versionMatch ? Number(versionMatch[2]) : 0;
if (major < 22 || (major === 22 && minor < 5)) {
  fail([
    `Node.js >= 22.5 is required, but this is ${process.version}.`,
    "mri stores its code graph in node:sqlite, which ships with Node from 22.5.",
    "Upgrade Node.js (https://nodejs.org) and reinstall.",
  ]);
}
console.log(`mri: node ${process.version} ok`);

// 2. node:sqlite -------------------------------------------------------------
try {
  const { DatabaseSync } = requireFromPackage("node:sqlite");
  const probe = new DatabaseSync(":memory:");
  probe.exec("CREATE TABLE install_probe (x)");
  probe.close();
} catch (error) {
  fail([
    `node:sqlite could not be loaded: ${String(error.message).split("\n")[0]}`,
    `Node is ${process.version}; a standard Node.js >= 22.5 build includes SQLite.`,
    "If you are using an unusual Node build, switch to an official release.",
  ]);
}
console.log("mri: node:sqlite ok");

// 3. tree-sitter native bindings ----------------------------------------------
let parser;
try {
  parser = new (requireFromPackage("tree-sitter"))();
} catch (error) {
  fail(nativeBindingFailure(error));
}

const GRAMMAR_LANGUAGES = [
  ["tree-sitter-javascript", null],
  ["tree-sitter-typescript", "typescript"],
  ["tree-sitter-python", null],
  ["tree-sitter-go", null],
];

for (const [moduleName, subKey] of GRAMMAR_LANGUAGES) {
  try {
    const grammarModule = requireFromPackage(moduleName);
    const grammar = subKey ? grammarModule[subKey] : grammarModule.default ?? grammarModule;
    parser.setLanguage(grammar);
  } catch (error) {
    fail(nativeBindingFailure(error, moduleName));
  }
}

try {
  const javascript = requireFromPackage("tree-sitter-javascript");
  parser.setLanguage(javascript.default ?? javascript);
  const tree = parser.parse("const mriInstallProbe = 1;");
  if (!tree.rootNode) throw new Error("parser returned no tree");
} catch (error) {
  fail(nativeBindingFailure(error));
}
console.log("mri: tree-sitter native bindings ok");

// 4. isolated-vm (guard execution backend) -----------------------------------
try {
  const ivm = requireFromPackage("isolated-vm");
  const isolate = new ivm.Isolate();
  isolate.dispose();
} catch (error) {
  fail([
    "could not load isolated-vm: " + String(error.message).split("\n")[0],
    "mri guard executes untrusted code inside an isolated-vm V8 isolate.",
    "Reinstall the package so the prebuilt binary for your platform is",
    "fetched, or run: npm rebuild isolated-vm",
  ]);
}
console.log("mri: isolated-vm ok");
console.log("mri: installation verified");
