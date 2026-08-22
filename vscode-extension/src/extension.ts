import * as vscode from "vscode";
import { WorkspaceAnalysisStore } from "./cache";
import { registerCodeLens } from "./codeLens";
import { registerShowBlastRadius } from "./blastRadius";
import { registerGuardCheck } from "./guardDiagnostics";

export function activate(context: vscode.ExtensionContext): void {
  const store = new WorkspaceAnalysisStore();
  const lensesChanged = new vscode.EventEmitter<void>();

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  const refreshStatusBar = (): void => {
    switch (store.overallState()) {
      case "running":
        statusItem.text = "$(sync~spin) MRI analyzing";
        statusItem.tooltip = "MRI is rebuilding the workspace graph and analysis.";
        break;
      case "ready": {
        statusItem.text = "$(shield) MRI ready";
        break;
      }
      case "error": {
        statusItem.text = "$(error) MRI failed";
        statusItem.tooltip = store.lastErrorMessage() ?? "MRI analysis failed.";
        statusItem.command = "mri.refreshAnalysis";
        break;
      }
      default:
        statusItem.text = "$(circle-slash) MRI idle";
        statusItem.tooltip = "MRI has not analyzed this workspace yet.";
        statusItem.command = "mri.refreshAnalysis";
    }
    if (store.overallState() === "ready") {
      statusItem.tooltip = new vscode.MarkdownString(
        `MRI analysis up to date. Last refresh: ${new Date(latestUpdatedAt(store)).toLocaleTimeString()}`,
      );
    }
    statusItem.show();
  };

  function latestUpdatedAt(s: WorkspaceAnalysisStore): number {
    let newest = 0;
    for (const snapshot of s.snapshotsForAll()) newest = Math.max(newest, snapshot.updatedAt);
    return newest;
  }

  context.subscriptions.push(
    store,
    lensesChanged,
    statusItem,
    store.onStateChange(refreshStatusBar),
    vscode.workspace.onDidSaveTextDocument((document) => {
      store.scheduleSaveRefresh(document);
    }),
    vscode.commands.registerCommand("mri.refreshAnalysis", async () => {
      await vscode.window.withProgress(
        { location: { viewId: "workbench.view.explorer" } },
        async () => {
          await store.refreshAll();
        },
      );
    }),
  );

  registerCodeLens(context, store, lensesChanged);
  registerShowBlastRadius(context, store);
  registerGuardCheck(context);

  void store.refreshAll().then(() => lensesChanged.fire());
}

export function deactivate(): void {}
