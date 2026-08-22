import { EventEmitter, workspace, type Disposable, type TextDocument } from "vscode";
import { getConfig } from "./config";
import {
  analyzeWorkspace,
  isSupportedSourceDocument,
  resolveCliTarget,
  type CliTarget,
  type WorkspaceAnalysis,
} from "./mriCli";

export type AnalysisState = "idle" | "running" | "ready" | "error";

export interface Snapshot {
  root: string;
  analysis: WorkspaceAnalysis | null;
  error: string | null;
  updatedAt: number;
}

/**
 * Holds one cached WorkspaceAnalysis per workspace folder. Refreshes happen
 * on activation, on manual command, or debounced on file save - never on
 * keystrokes.
 */
export class WorkspaceAnalysisStore implements Disposable {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly running = new Set<string>();
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly pendingRoots = new Set<string>();

  private readonly stateEmitter = new EventEmitter<void>();
  readonly onStateChange = this.stateEmitter.event;

  constructor() {}

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.stateEmitter.dispose();
  }

  snapshotForRoot(root: string | null): Snapshot | null {
    return root ? this.snapshots.get(root) ?? null : null;
  }

  snapshotsForAll(): Snapshot[] {
    return [...this.snapshots.values()];
  }

  overallState(): AnalysisState {
    for (const root of this.snapshots.keys()) {
      if (this.running.has(root)) return "running";
    }
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.error) return "error";
    }
    return this.snapshots.size > 0 ? "ready" : "idle";
  }

  async refreshAll(): Promise<void> {
    const folders = workspace.workspaceFolders ?? [];
    const roots = folders.map((folder) => folder.uri.fsPath);
    for (const root of roots) {
      await this.refreshFolder(root);
    }
  }

  async refreshFolder(root: string): Promise<Snapshot> {
    const snapshot: Snapshot =
      this.snapshots.get(root) ?? { root, analysis: null, error: null, updatedAt: 0 };
    this.snapshots.set(root, snapshot);
    this.running.add(root);
    this.stateEmitter.fire();

    try {
      const target = await resolveCliTarget(root);
      if (!target) {
        throw new Error(
          "MRI CLI not found. Set mri.entryPoint to MRI's dist/cli/index.js or install `mri` on PATH.",
        );
      }
      snapshot.analysis = await analyzeWorkspace(root, target);
      snapshot.error = null;
      snapshot.updatedAt = Date.now();
    } catch (error) {
      snapshot.error = (error as Error).message;
    } finally {
      this.running.delete(root);
      this.stateEmitter.fire();
    }
    return snapshot;
  }

  /** Coalesce rapid saves into one debounced refresh per affected root. */
  scheduleSaveRefresh(document: TextDocument): void {
    const config = getConfig();
    if (!config.autoRefreshOnSave) return;
    const root = workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    if (!root || !isSupportedSourceDocument(document.uri)) return;

    this.pendingRoots.add(root);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const roots = [...this.pendingRoots];
      this.pendingRoots.clear();
      void (async () => {
        for (const r of roots) await this.refreshFolder(r);
      })();
    }, config.saveDebounceMs);
  }

  lastErrorMessage(): string | null {
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.error) return snapshot.error;
    }
    return null;
  }
}
