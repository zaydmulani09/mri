import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkspaceAnalysisStore } from "./cache";
import { findEnclosingSymbol, toPosix } from "./parse";
import { resolveCliTarget, runBlastRadiusFlat } from "./mriCli";

export function registerShowBlastRadius(
  context: vscode.ExtensionContext,
  store: WorkspaceAnalysisStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mri.showBlastRadius",
      async (nodeId?: string) => {
        const editor = vscode.window.activeTextEditor;
        let root: string | undefined;
        let id = nodeId;

        if (!id) {
          if (!editor) {
            void vscode.window.showErrorMessage("MRI: open a source file first.");
            return;
          }
          root = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
          if (!root) {
            void vscode.window.showErrorMessage("MRI: file is not inside a workspace folder.");
            return;
          }
          const resolved = resolveSymbolAtCursor(editor, store, root);
          if (!resolved.ok) {
            void vscode.window.showInformationMessage(`MRI: ${resolved.reason}`);
            return;
          }
          id = resolved.id;
        }

        if (!root) {
          const found = findRootForNodeId(store, id);
          if (!found) {
            void vscode.window.showErrorMessage(
              `MRI: no analyzed workspace found for '${id}'. Run "MRI: Refresh analysis" first.`,
            );
            return;
          }
          root = found;
        }

        await showBlastRadiusPanel(store, root, id);
      },
    ),
  );
}

type ResolveResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: string };

function resolveSymbolAtCursor(
  editor: vscode.TextEditor,
  store: WorkspaceAnalysisStore,
  root: string,
): ResolveResult {
  const snapshot = store.snapshotForRoot(root);
  const analysis = snapshot?.analysis ?? null;
  if (!analysis) {
    return { ok: false, reason: "analysis not ready yet — run 'MRI: Refresh analysis'." };
  }

  const relativePath = toPosixPath(path.relative(root, editor.document.uri.fsPath));
  const entries = analysis.entriesByFile.get(relativePath) ?? [];
  if (entries.length === 0) {
    return { ok: false, reason: `no MRI symbols found in ${relativePath} — save the file and refresh.` };
  }

  const enclosing = findEnclosingSymbol(entries, editor.selection.active.line);
  if (!enclosing) {
    return { ok: false, reason: "place the cursor inside a function or class." };
  }
  return { ok: true, id: enclosing.id, name: enclosing.name };
}

function findRootForNodeId(store: WorkspaceAnalysisStore, nodeId: string): string | null {
  for (const snapshot of store.snapshotsForAll()) {
    if (snapshot.analysis?.dependentsById.has(nodeId)) return snapshot.root;
    for (const entries of snapshot.analysis?.entriesByFile.values() ?? []) {
      if (entries.some((entry) => entry.id === nodeId)) return snapshot.root;
    }
  }
  return null;
}

async function showBlastRadiusPanel(
  store: WorkspaceAnalysisStore,
  root: string,
  nodeId: string,
): Promise<void> {
  const target = await resolveCliTarget(root);
  if (!target) {
    void vscode.window.showErrorMessage("MRI: CLI not found. Check the mri.entryPoint setting.");
    return;
  }

  let flat;
  try {
    flat = await runBlastRadiusFlat(target, nodeId, root);
  } catch (error) {
    void vscode.window.showErrorMessage(`MRI: ${(error as Error).message}`);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "mri.blastRadius",
    `MRI blast radius — ${nodeId}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );

  const rows = flat.dependents
    .map((dependent) => {
      const marker = dependent.confirmed ? "&#10003;" : "?";
      const location = dependent.path ? `<code>${escapeHtml(dependent.path)}</code>` : "";
      const revealButton =
        dependent.path && hasEntryForId(store, root, dependent.id)
          ? `<button data-path="${attr(dependent.path)}" data-line="${lineOfId(store, root, dependent.id)}" class="reveal">reveal</button>`
          : "";
      return (
        `<tr class="${dependent.confirmed ? "confirmed" : "ambiguous"}">` +
        `<td>d${dependent.depth}</td>` +
        `<td>${marker}</td>` +
        `<td><code>${escapeHtml(dependent.id)}</code></td>` +
        `<td>${escapeHtml(dependent.relation)}</td>` +
        `<td>${location}</td>` +
        `<td>${revealButton}</td>` +
        "</tr>"
      );
    })
    .join("\n");

  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h2 { font-weight: normal; margin-top: 0; }
  .summary { margin-bottom: 10px; color: var(--vscode-descriptionForeground); }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  tr.ambiguous td { opacity: 0.65; }
  button.reveal {
    font-family: inherit; color: var(--vscode-button-foreground);
    background: var(--vscode-button-background); border: none; padding: 2px 8px; cursor: pointer;
  }
</style>
</head>
<body>
<h2>Blast radius of <code>${escapeHtml(nodeId)}</code></h2>
<div class="summary">${flat.total} dependent(s): ${flat.confirmed} confirmed, ${flat.ambiguousOnly} ambiguous-only.
"?" rows are name-only references the graph refused to confirm.</div>
<table>
<tr><th>depth</th><th>conf</th><th>node</th><th>relation</th><th>file</th><th></th></tr>
${rows || "<tr><td colspan=6>no dependents found</td></tr>"}
</table>
<script>
const vsapi = acquireVsCodeApi();
document.querySelectorAll("button.reveal").forEach((b) => {
  b.addEventListener("click", () => {
    vsapi.postMessage({ type: "reveal", path: b.dataset.path, line: Number(b.dataset.line) });
  });
});
</script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage((message: unknown) => {
    const msg = message as { type?: string; path?: string; line?: number };
    if (msg.type !== "reveal" || !msg.path) return;
    void (async () => {
      const uri = vscode.Uri.file(path.join(root, msg.path as string));
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const line = Math.max(0, (msg.line ?? 1) - 1);
      const range = new vscode.Range(line, 0, line, 0);
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    })();
  });
}

function hasEntryForId(
  store: WorkspaceAnalysisStore,
  root: string,
  id: string,
): boolean {
  const analysis = store.snapshotForRoot(root)?.analysis ?? null;
  if (!analysis) return false;
  for (const entries of analysis.entriesByFile.values()) {
    for (const entry of entries) {
      if (entry.id === id) return true;
    }
  }
  return false;
}

function lineOfId(store: WorkspaceAnalysisStore, root: string, id: string): number {
  const analysis = store.snapshotForRoot(root)?.analysis ?? null;
  if (analysis) {
    for (const entries of analysis.entriesByFile.values()) {
      for (const entry of entries) {
        if (entry.id === id) return entry.startLine;
      }
    }
  }
  return 1;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(text: string): string {
  return escapeHtml(toPosixPath(text));
}

function toPosixPath(p: string): string {
  return p.split("\\").join("/");
}
