#!/usr/bin/env node
// Adversarial benchmark runner for `mri guard`.
//
// Runs every case in cases.json against the fixture repo, classifies the
// outcome, and writes results.json (machine-readable) plus printable
// markdown table rows. Output content is captured verbatim from the real
// CLI; this script only classifies and formats.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "dist", "cli", "index.js");
const manifest = JSON.parse(readFileSync(path.join(here, "cases.json"), "utf8"));

const PER_CASE_TIMEOUT_MS = 30_000;

function runGuard(caseDef) {
  return new Promise((resolve) => {
    const args = [
      cli,
      "guard",
      manifest.scope,
      path.join(here, caseDef.file),
      "--path",
      path.join(repoRoot, manifest.fixture),
      "--json",
      "--timeout-ms",
      "2000",
    ];
    if (caseDef.resources) {
      args.push("--resources", path.join(here, caseDef.resources));
    }
    const childEnv = { ...process.env, ...(caseDef.env ?? {}) };

    const child = spawn("node", args, { cwd: manifest.fixture, env: childEnv });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("kill");
      resolve({ status: "HANG", stdout, stderr: stderr + "\n[killed after 30s]" });
    }, PER_CASE_TIMEOUT_MS);

    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: "EXIT", code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "SPAWN_ERROR", code: -1, stdout, stderr: String(error) });
    });
  });
}

function classify(result) {
  if (result.status === "HANG") {
    return { verdict: "HANG", detail: "no exit within timeout" };
  }
  // --json mode appends the decision record to stdout AFTER any console
  // output the sandboxed program itself printed. Program logs can contain
  // braces, so scan candidate JSON objects from the end.
  let parsed = null;
  let searchFrom = result.stdout.length;
  while ((searchFrom = result.stdout.lastIndexOf("{", searchFrom - 1)) !== -1) {
    try {
      const candidate = JSON.parse(result.stdout.slice(searchFrom));
      if (candidate && typeof candidate === "object" && "outcome" in candidate) {
        parsed = candidate;
        break;
      }
    } catch {
      // keep scanning backwards
    }
  }
  if (parsed) {
    const kinds = (parsed.breaches ?? []).map((b) => b.kind).join(", ");
    if (parsed.outcome === "blocked") {
      const rules = (parsed.breaches ?? [])
        .map((b) => (b.rule ? `${b.rule.area}` : b.kind))
        .join("; ");
      return { verdict: "BLOCKED", detail: `${kinds} [${rules}]` };
    }
    if (parsed.outcome === "executed") {
      return {
        verdict: "EXECUTED",
        detail: `allowlist ${parsed.allowlist?.symbols} symbols / ${parsed.allowlist?.files} files`,
      };
    }
  }
  const errLine = result.stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("error:") || l.includes("Error:"));
  if (errLine || result.code !== 0) {
    return {
      verdict: "RUNTIME_ERROR",
      detail: (errLine ?? result.stderr.split("\n").find((l) => l.trim()) ?? `exit ${result.code}`).slice(0, 110),
    };
  }
  return { verdict: "UNKNOWN", detail: result.stdout.slice(0, 80) };
}

const results = [];
for (const caseDef of manifest.cases) {
  const raw = await runGuard(caseDef);
  const classification = classify(raw);
  results.push({ ...caseDef, ...classification, raw });
  console.log(`[${classification.verdict}] ${caseDef.id} (${caseDef.category}) -> ${classification.detail}`);
}

writeFileSync(path.join(here, "results.json"), JSON.stringify(results, null, 2));

const mdTable = (suite) => {
  const rows = results
    .filter((r) => r.suite === suite)
    .map(
      (r) =>
        `| ${r.id} | ${r.category} | ${r.verdict} | ${r.detail.replace(/\|/g, "\\|")} |`,
    );
  return ["| id | task/attack | outcome | detail |", "| --- | --- | --- | --- |", ...rows].join("\n");
};
writeFileSync(
  path.join(here, "tables.md"),
  `### Suite A\n\n${mdTable("A")}\n\n### Suite B\n\n${mdTable("B")}\n`,
);
console.log("\nwrote results.json and tables.md");
