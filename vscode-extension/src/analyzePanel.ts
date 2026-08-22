import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkspaceAnalysisStore } from "./cache";
import { resolveCliTarget, runAnalysisJson } from "./mriCli";
import {
  buildAnalyzeSummary,
  escapeHtmlText,
  renderSummaryText,
  type AnalyzeSummary,
} from "./parse";

export function registerAnalyzeWorkspace(
  context: vscode.ExtensionContext,
  store: WorkspaceAnalysisStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mri.analyzeWorkspace", async () => {
      const root = await pickWorkspaceRoot(store);
      if (!root) return;

      const target = await resolveCliTarget(root);
      if (!target) {
        void vscode.window.showErrorMessage(
          "MRI: CLI not found. Set mri.entryPoint or install `mri` on PATH.",
        );
        return;
      }

      const outputChannel = getOutputChannel(context);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `MRI: analyzing ${path.basename(root)}` },
        async () => {
          let report;
          try {
            report = await runAnalysisJson(target, root);
          } catch (error) {
            void vscode.window.showErrorMessage(`MRI analyze failed: ${(error as Error).message}`);
            return;
          }

          const summary = buildAnalyzeSummary(report);
          outputChannel.clear();
          outputChannel.appendLine(`MRI analysis — ${root}`);
          outputChannel.appendLine(renderSummaryText(summary));
          outputChannel.show(true);

          showOverviewPanel(context, root, summary);
        },
      );
    }),
  );
}

async function pickWorkspaceRoot(store: WorkspaceAnalysisStore): Promise<string | null> {
  const snapshots = store.snapshotsForAll().filter((s) => s.analysis !== null || s.error === null);
  if (snapshots.length === 1) return snapshots[0]?.root ?? null;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("MRI: no workspace folder open.");
    return null;
  }
  const picked = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, root: f.uri.fsPath })),
    { placeHolder: "Which workspace folder should MRI analyze?" },
  );
  return picked?.root ?? null;
}

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("MRI Analysis");
    context.subscriptions.push(outputChannel);
  }
  return outputChannel;
}

function showOverviewPanel(
  context: vscode.ExtensionContext,
  root: string,
  summary: AnalyzeSummary,
): void {
  const panel = vscode.window.createWebviewPanel(
    "mri.analyzeOverview",
    "MRI — workspace analysis",
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );

  const riskRows = summary.riskHotspots
    .map(
      (risk, i) =>
        `<tr><td>${i + 1}</td>` +
        `<td class="score ${risk.score >= 30 ? "hot" : ""}">${risk.score}</td>` +
        `<td><code>${escapeHtmlText(risk.path)}</code></td>` +
        `<td>${risk.churnCommits} commit(s)</td>` +
        `<td>${risk.hasTests ? "tested" : "no tests"}</td></tr>`,
    )
    .join("\n");

  const deadCodeSections = Object.keys(summary.deadCodeByConfidence)
    .sort()
    .map((confidence) => {
      const rows = (summary.deadCodeByConfidence[confidence] ?? [])
        .map(
          (candidate) =>
            `<li><code>${escapeHtmlText(candidate.id)}</code>${
              candidate.note ? ` <span class="note">${escapeHtmlText(candidate.note)}</span>` : ""
            }</li>`,
        )
        .join("\n");
      return `<h3>${escapeHtmlText(confidence)} (${summary.deadCodeByConfidence[confidence]?.length ?? 0})</h3><ul>${rows}</ul>`;
    })
    .join("\n");

  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; max-width: 980px; margin: 0 auto; }
  h2 { font-weight: normal; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
  h3 { font-weight: normal; margin-bottom: 2px; color: var(--vscode-descriptionForeground); }
  .stats { display: flex; gap: 18px; margin: 12px 0; }
  .stat { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 16px; }
  .stat .value { font-size: 20px; }
  .stat .label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  table { border-collapse: collapse; width: 100%; margin-top: 4px; }
  th, td { text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 13px; }
  td.score.hot { color: var(--vscode-errorForeground); font-weight: bold; }
  ul { margin: 4px 0 12px 18px; padding: 0; }
  li { padding: 2px 0; font-size: 13px; }
  .note { color: var(--vscode-descriptionForeground); }
  code { background: var(--vscode-text-code-block-background); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
</style>
</head>
<body>
<h2>MRI workspace analysis</h2>
<div class="stats">
  <div class="stat"><div class="value">${summary.fileCount}</div><div class="label">files</div></div>
  <div class="stat"><div class="value">${summary.coverage.ratioPercent}%</div><div class="label">est. coverage (${summary.coverage.coveredCount}/${summary.coverage.sourceCount})</div></div>
  <div class="stat"><div class="value">${Object.values(summary.deadCodeByConfidence).reduce((n, list) => n + list.length, 0)}</div><div class="label">dead-code candidates</div></div>
  <div class="stat"><div class="value">${summary.windowDays}d</div><div class="label">churn window</div></div>
</div>

<h2>Risk hotspots</h2>
<table>
<tr><th>#</th><th>score</th><th>file</th><th>churn</th><th>tests</th></tr>
${riskRows || "<tr><td colspan=5>no risks computed</td></tr>"}
</table>

<h2>Dead code candidates</h2>
<p class="note">Confidence labels reflect how much the graph could prove. Nothing here is a finding — it is an absence of evidence.</p>
${deadCodeSections || "<p>none found</p>"}

<h2>Not covered by tests (import-based approximation)</h2>
<ul>
${summary.coverage.uncoveredFiles.map((file) => `<li><code>${escapeHtmlText(file)}</code></li>`).join("\n") || "<li>all source files appear covered</li>"}
</ul>
</body>
</html>`;
}
