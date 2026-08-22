#!/usr/bin/env node
// mri analyze CI runner: invokes the built CLI with --json and renders the
// report as a GitHub Actions job summary. Findings keep their confidence
// labels end to end — confirmed and speculative results never blend.
//
// The procedural body lives inside main() so same-file calls resolve in the
// code graph like any other function's calls.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, markdown, "utf8");
  else process.stdout.write(markdown);
}

function writeOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${key}=${value}\n`, "utf8");
}

function runAnalyze(cli, repoPath, top, windowDays) {
  const args = ["analyze", repoPath, "--json"];
  if (Number.isFinite(top) && top > 0) args.push("--top", String(top));
  if (Number.isFinite(windowDays) && windowDays > 0) args.push("--window", String(windowDays));
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  let report = null;
  try {
    report = JSON.parse(run.stdout ?? "");
  } catch {}
  if (!report || run.status !== 0) {
    const detail = String(run.stderr ?? "")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-3)
      .join(" | ");
    console.log(`::error::mri analyze failed to produce a report${detail ? ` :: ${detail}` : ""}`);
    process.exit(1);
  }
  return report;
}

function renderReport(report) {
  const n = report.summary?.counts?.nodesByType ?? {};
  const e = report.summary?.counts?.edgesByType ?? {};
  const ambiguousCalls = report.summary?.counts?.edgesByConfidence?.ambiguous ?? 0;
  const calls = e["calls"] ?? 0;
  const coveragePct =
    report.coverage.sourceFiles.length === 0
      ? "n/a"
      : `${(report.coverage.coverageRatio * 100).toFixed(1)}%`;

  const lines = [
    "## mri codebase report",
    "",
    `Analyzed \`${path.basename(report.root)}\` at \`${report.generatedAt}\` · churn window ${report.windowDays}d`,
    "",
    `**Architecture** — ${report.summary.fileCount} files · ${n["function"] ?? 0} functions, ${n["class"] ?? 0} classes, ${n["method"] ?? 0} methods · ${calls} call edges (${calls - ambiguousCalls} resolved / ${ambiguousCalls} ambiguous — ambiguous means unproven, not guessed)`,
    "",
    "### Risk hotspots",
    "",
    "| # | file | score | churn | tests | components |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  report.topRisks.forEach((risk, index) => {
    const tested = risk.components.hasTests ? "yes" : "**no**";
    const parts = [`churn +${risk.churnPoints}`];
    if (risk.components.untracked) parts.unshift("untracked");
    if (!risk.components.hasTests) parts.push("no tests +30");
    lines.push(
      `| ${index + 1} | \`${risk.path}\` | **${risk.score}** | ${risk.components.churnCommits} commits | ${tested} | ${parts.join(", ")} |`,
    );
  });
  if (report.topRisks.length === 0) lines.push("| – | no scored files | – | – | – | – |");

  renderDeadCode(lines, report.deadCode);
  renderCoverage(lines, report.coverage, coveragePct);
  renderKnowledgeGaps(lines, report.security);

  lines.push(
    "",
    "_Fully local: extraction, resolution and scoring ran inside this runner. No source code left the machine._",
    "",
  );
  writeSummary(lines.join("\n"));
  return coveragePct;
}

function renderDeadCode(lines, deadCode) {
  lines.push("", "### Dead code candidates", "");
  const byConfidence = new Map();
  for (const candidate of deadCode) {
    byConfidence.set(candidate.confidence, (byConfidence.get(candidate.confidence) ?? 0) + 1);
  }
  lines.push(
    `${deadCode.length} candidate(s): ` +
      [...byConfidence.entries()]
        .sort()
        .map(([confidence, count]) => `${count} \`${confidence}\``)
        .join(", "),
  );
  if (deadCode.length > 0) {
    lines.push("");
    lines.push("| confidence | symbol | path |");
    lines.push("| --- | --- | --- |");
    for (const candidate of deadCode.slice(0, 15)) {
      lines.push(
        `| \`${candidate.confidence}\` | \`${candidate.id.replace(/^(fn|cls|m):/, "")}\` | \`${candidate.path}\` |`,
      );
    }
    if (deadCode.length > 15) lines.push(`… and ${deadCode.length - 15} more`);
  }
  lines.push(
    "",
    "> `confirmed-unreferenced`: nothing resolved points at it and its name appears nowhere in ambiguous references. Other labels: kept alive only by unproven references — dead-code refuses to declare death under uncertainty.",
  );
}

function renderCoverage(lines, coverage, coveragePct) {
  lines.push("", "### Test coverage (import-based estimate)", "");
  lines.push(
    `**${coveragePct}** (${coverage.coveredFiles.length}/${coverage.sourceFiles.length} source files reachable from test imports)`,
  );
  const uncoveredSample = coverage.uncoveredFiles.slice(0, 10);
  if (uncoveredSample.length > 0) {
    lines.push("");
    lines.push("Not covered:");
    for (const uncovered of uncoveredSample) lines.push(`- \`${uncovered}\``);
    const rest = coverage.uncoveredFiles.length - uncoveredSample.length;
    if (rest > 0) lines.push(`… and ${rest} more`);
  }
}

function renderKnowledgeGaps(lines, security) {
  const gaps =
    security ?? { unresolvedReferenceCount: 0, unresolvedReferences: [], externalDependencies: [] };
  lines.push(
    "",
    "### Knowledge gaps (not findings)",
    "",
    `- unresolved references: **${gaps.unresolvedReferenceCount}**${gaps.unresolvedReferences?.length ? ` (top: ${gaps.unresolvedReferences.slice(0, 4).map((r) => `\`${r.reference}\` ×${r.count}`).join(", ")})` : ""}`,
    `- external dependencies: ${gaps.externalDependencies?.length ?? 0}`,
    `- files with parse errors: ${gaps.parseErrorFileCount ?? 0}`,
  );
}

function main() {
  const cli = path.join(process.env.MRI_DIR ?? "", "dist", "cli", "index.js");
  if (!existsSync(cli)) {
    console.log(`::error::mri analyze action misconfigured: built CLI not found at ${cli}`);
    process.exit(1);
  }
  const repoPath = path.resolve(process.env.REPO_PATH ?? ".");
  const top = Number(process.env.TOP ?? "10");
  const windowDays = Number(process.env.WINDOW_DAYS ?? "90");

  const report = runAnalyze(cli, repoPath, top, windowDays);
  const coveragePct = renderReport(report);

  writeOutput("coverage-ratio", String(report.coverage.coverageRatio));
  writeOutput("dead-code-count", String(report.deadCode.length));
  writeOutput("top-risk-file", report.topRisks[0]?.path ?? "");
  writeOutput("top-risk-score", String(report.topRisks[0]?.score ?? ""));
  console.log(
    `mri analyze: summary written (${report.deadCode.length} dead-code candidates, coverage ${coveragePct})`,
  );
}

main();
