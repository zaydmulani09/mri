import * as vscode from "vscode";

export interface MriConfig {
  entryPoint: string;
  churnWindowDays: number;
  codeLensEnabled: boolean;
  autoRefreshOnSave: boolean;
  guardResourcesPath: string;
}

export function getConfig(): MriConfig {
  const section = vscode.workspace.getConfiguration("mri");
  return {
    entryPoint: section.get<string>("entryPoint", "").trim(),
    churnWindowDays: section.get<number>("churnWindowDays", 90),
    codeLensEnabled: section.get<boolean>("codeLensEnabled", true),
    autoRefreshOnSave: section.get<boolean>("autoRefreshOnSave", true),
    guardResourcesPath: section.get<string>("guardResourcesPath", "").trim(),
  };
}
