#!/usr/bin/env node
// mri guard CI runner: checks each listed file against a scope's allowlist by
// invoking the built CLI, emits one ::error annotation per containment breach,
// writes a decision summary, and fails the step if anything was blocked.
// A file that cannot be read or whose decision cannot be parsed is itself a
// failure — an unverifiable check must not pass silently.
//
// The procedural body lives inside main() so same-file calls resolve in the
// code graph like any other function's calls.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

function envList(name) {
  return String(process.env[name] ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function escapeAnnotation(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  // Payload console output precedes the decision JSON on stdout; scan
  // candidate line starts from the end and take the trailing parseable object.
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      return JSON.parse(lines.slice(i).join("\n"));
    } catch {}
  }
  return null;
}

function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, markdown, "utf8");
  else process.stdout.write(markdown);
}

function writeOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${key}=${value}\n`, "utf8");
}

function guardOneFile(cli, repoPath, relFile) {
  const absFile = path.resolve(repoPath, relFile);
  if (!existsSync(absFile)) {
    console.log(
      `::error file=${relFile}::file listed for guarding does not exist under ${process.env.REPO_PATH}`,
    );
    return { file: relFile, outcome: "missing" };
  }

  const args = ["guard", process.env.SCOPE ?? "", absFile, "--path", repoPath, "--json"];
  const resources = String(process.env.RESOURCES_CONFIG ?? "").trim();
  if (resources) args.push("--resources", path.resolve(repoPath, resources));
  const timeout = Number(process.env.TIMEOUT_MS);
  if (Number.isFinite(timeout) && timeout > 0) args.push("--timeout-ms", String(timeout));

  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const decision = extractJson(run.stdout ?? "");

  if (run.error || !decision || !decision.outcome) {
    const detail = String(run.stderr ?? run.error)
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-3)
      .join(" | ");
    console.log(
      `::error file=${relFile}::mri guard did not produce a decision${detail ? ` :: ${escapeAnnotation(detail)}` : ""}`,
    );
    return { file: relFile, outcome: "error", detail };
  }

  const record = {
    file: relFile,
    outcome: decision.outcome,
    breaches: Array.isArray(decision.breaches) ? decision.breaches : [],
    symbols: decision.allowlist?.symbols,
    unresolved: decision.allowlist?.unresolved,
    policy: decision.policy,
  };
  for (const breach of record.breaches) {
    const title = `mri guard · ${breach.kind}`;
    const message = breach.rule
      ? `${breach.message} [attempted: ${breach.attempted}; rule: ${breach.rule.area} -> expected ${breach.rule.expected}]`
      : `${breach.message} [attempted: ${breach.attempted}]`;
    console.log(
      `::error file=${relFile},line=${breach.line ?? 1},title=${escapeAnnotation(title)}::${escapeAnnotation(message)}`,
    );
  }
  return record;
}

function renderSummary(decisions, blockedCount, errorCount) {
  const lines = [
    "## mri guard",
    "",
    `Scope \`${process.env.SCOPE}\` · policy \`${decisions[0]?.policy ?? "fail-closed"}\` · ${decisions.length} file(s) checked · **${blockedCount} blocked**, ${errorCount} error(s)`,
    "",
    "| file | outcome | granted symbols | unresolved refs excluded | breaches |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const d of decisions) {
    const breachText =
      d.breaches && d.breaches.length > 0
        ? d.breaches.map((b) => `\`L${b.line} ${b.kind}\``).join("<br>")
        : "—";
    lines.push(
      `| \`${d.file}\` | ${d.outcome} | ${d.symbols ?? "—"} | ${d.unresolved ?? "—"} | ${breachText} |`,
    );
  }
  lines.push("");
  if (blockedCount === 0 && errorCount === 0) {
    lines.push(
      "Every checked file stayed inside the scope's allowlist. Grants come only from resolved graph edges; ambiguous references were excluded fail-closed.",
    );
  } else {
    lines.push(
      "Blocked means pre-execution: nothing ran against the allowlist's gaps. Grants come only from resolved graph edges; ambiguous references are excluded fail-closed.",
    );
  }
  lines.push("");
  writeSummary(lines.join("\n"));
}

function main() {
  const mriDir = process.env.MRI_DIR ?? "";
  const cli = path.join(mriDir, "dist", "cli", "index.js");
  const scope = process.env.SCOPE ?? "";
  if (!scope || !existsSync(cli)) {
    console.log(
      `::error::mri guard action misconfigured: scope=${scope ? "set" : "missing"}, cli=${cli}`,
    );
    process.exit(1);
  }
  const repoPath = path.resolve(process.env.REPO_PATH ?? ".");

  const files = [...new Set([...envList("CODE_PATH"), ...envList("CHANGED_FILES")])];
  if (files.length === 0) {
    console.log("::error::no files to guard — set the code-path or changed-files input");
    process.exit(1);
  }

  let blockedCount = 0;
  let errorCount = 0;
  const decisions = [];
  for (const relFile of files) {
    const record = guardOneFile(cli, repoPath, relFile);
    decisions.push(record);
    if (record.outcome === "blocked") blockedCount++;
    if (record.outcome === "missing" || record.outcome === "error") errorCount++;
  }

  renderSummary(decisions, blockedCount, errorCount);

  const failed = blockedCount + errorCount > 0;
  writeOutput("verdict", failed ? "blocked" : "clean");
  writeOutput("checked", String(files.length));
  writeOutput("blocked", String(blockedCount));
  console.log(
    `mri guard: ${files.length} checked, ${blockedCount} blocked, ${errorCount} error(s), scope ${scope}`,
  );
  process.exit(failed ? 1 : 0);
}

main();
