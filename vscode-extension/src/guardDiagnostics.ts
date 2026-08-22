import * as path from "node:path";
import * as vscode from "vscode";
import { resolveCliTarget, runGuardCheck } from "./mriCli";
import { toPosix } from "./parse";

export function registerGuardCheck(
  context: vscode.ExtensionContext,
): void {
  const collection = vscode.languages.createDiagnosticCollection("mri-guard");
  context.subscriptions.push(collection);

  context.subscriptions.push(
    vscode.commands.registerCommand("mri.runGuardCheck", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showErrorMessage("MRI: open a source file first.");
        return;
      }
      const document = editor.document;
      if (document.isUntitled) {
        void vscode.window.showErrorMessage("MRI: save the file before running a guard check.");
        return;
      }
      const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
      if (!root) {
        void vscode.window.showErrorMessage("MRI: file is not inside a workspace folder.");
        return;
      }

      const relativePath = toPosix(path.relative(root, document.uri.fsPath));
      const scopeId = `f:${relativePath}`;
      const code =
        editor.selection && !editor.selection.isEmpty
          ? document.getText(editor.selection)
          : document.getText();

      const target = await resolveCliTarget(root);
      if (!target) {
        void vscode.window.showErrorMessage(
          "MRI: CLI not found. Set mri.entryPoint or install `mri` on PATH.",
        );
        return;
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `MRI guard: ${scopeId}` },
        async () => {
          let outcome;
          try {
            outcome = await runGuardCheck(target, scopeId, code, root);
          } catch (error) {
            void vscode.window.showErrorMessage(`MRI guard failed: ${(error as Error).message}`);
            return;
          }

          collection.set(document.uri, breachesToDiagnostics(document, outcome));

          if (outcome.blocked) {
            void vscode.window.showWarningMessage(
              `MRI guard: BLOCKED for ${scopeId} — ${outcome.breaches.length} breach(es). See Problems.`,
            );
          } else {
            void vscode.window.showInformationMessage(
              `MRI guard: executed cleanly within the allowlist (${outcome.allowlistSummary}).`,
            );
          }
        },
      );
    }),
  );
}

function breachesToDiagnostics(
  document: vscode.TextDocument,
  outcome: {
    blocked: boolean;
    breaches: Array<{
      kind: string;
      line: number;
      attempted: string;
      message: string;
      ruleArea: string | null;
      ruleExpected: string | null;
    }>;
  },
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const breach of outcome.breaches) {
    const range = breachRange(document, breach.line);
    const parts = [breach.message];
    if (breach.ruleArea && breach.ruleExpected) {
      parts.unshift(`violated rule ${breach.ruleArea} → expected ${breach.ruleExpected}`);
    }
    const diagnostic = new vscode.Diagnostic(
      range,
      `[${breach.kind}] ${parts.join(" — ")} (attempted: ${breach.attempted})`,
      vscode.DiagnosticSeverity.Error,
    );
    diagnostic.source = "mri guard";
    diagnostic.code = breach.kind;
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

/**
 * Breach lines are 1-based against the checked payload. A line of 0 means the
 * violation was detected outside any source line (e.g. runtime guard), which
 * we surface on the whole document.
 */
function breachRange(document: vscode.TextDocument, oneBasedLine: number): vscode.Range {
  if (oneBasedLine <= 0 || oneBasedLine > document.lineCount) {
    return new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0);
  }
  const lineIndex = oneBasedLine - 1;
  const textLine = document.lineAt(lineIndex);
  return new vscode.Range(lineIndex, 0, lineIndex, textLine.text.length);
}
