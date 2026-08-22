import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "./config";
import type { WorkspaceAnalysisStore } from "./cache";
import { toPosix } from "./parse";
import { isSupportedSourceDocument } from "./mriCli";

export function registerCodeLens(
  context: vscode.ExtensionContext,
  store: WorkspaceAnalysisStore,
  lensesChanged: vscode.EventEmitter<void>,
): void {
  const provider = new MriCodeLensProvider(store, lensesChanged);

  context.subscriptions.push(
    lensesChanged,
    vscode.languages.registerCodeLensProvider(SUPPORTED_SELECTORS, provider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("mri.codeLensEnabled")) {
        lensesChanged.fire();
      }
    }),
  );
}

const SUPPORTED_SELECTORS: vscode.DocumentSelector = [
  { scheme: "file", language: "javascript" },
  { scheme: "file", language: "typescript" },
  { scheme: "file", language: "javascriptreact" },
  { scheme: "file", language: "typescriptreact" },
  { scheme: "file", language: "python" },
  { scheme: "file", language: "go" },
  { scheme: "file", language: "rust" },
];

class MriCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private readonly store: WorkspaceAnalysisStore,
    private readonly lensesChanged: vscode.EventEmitter<void>,
  ) {}

  onDidChangeCodeLenses = this.lensesChanged.event;

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!getConfig().codeLensEnabled) return [];
    if (!isSupportedSourceDocument(document.uri)) return [];

    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    if (!root) return [];
    const snapshot = this.store.snapshotForRoot(root);
    const analysis = snapshot?.analysis ?? null;
    if (!analysis) return [];

    const relativePath = toPosix(path.relative(root, document.uri.fsPath));
    const entries = analysis.entriesByFile.get(relativePath) ?? [];
    if (entries.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    for (const entry of entries) {
      const range = lineRange(document, entry.startLine);
      const risk = analysis.riskByPath.get(relativePath);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(shield) MRI risk ${risk !== undefined ? risk : "?"} · churn-based`,
          command: "mri.refreshAnalysis",
          arguments: [],
        }),
      );
      const dependents = analysis.dependentsById.get(entry.id) ?? 0;
      lenses.push(
        new vscode.CodeLens(range, {
          title:
            dependents === 1
              ? "$(radio-tower) blast radius: 1 dependent"
              : `$(radio-tower) blast radius: ${dependents} dependents`,
          command: "mri.showBlastRadius",
          arguments: [entry.id],
        }),
      );
    }
    return lenses;
  }
}

function lineRange(document: vscode.TextDocument, oneBasedLine: number): vscode.Range {
  const line = Math.max(0, Math.min(oneBasedLine - 1, document.lineCount - 1));
  return new vscode.Range(line, 0, line, 0);
}
