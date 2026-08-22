import { spawnSync } from "node:child_process";
import path from "node:path";

export interface FileHistory {
  commitsTotal: number;
  commitsInWindow: number;
  lastModifiedIso: string | null;
}

export type GitHistory = Map<string, FileHistory>;

const RECORD_SEPARATOR = "\u0001";

export function collectGitHistory(
  repoPath: string,
  windowDays: number,
): GitHistory {
  const history: GitHistory = new Map();

  const inside = spawnSync(
    "git",
    ["-C", repoPath, "rev-parse", "--is-inside-work-tree"],
    { encoding: "utf8" },
  );
  if (inside.status !== 0 || !inside.stdout?.trim().includes("true")) {
    return history;
  }

  let prefixToStrip = "";
  const topLevel = spawnSync(
    "git",
    ["-C", repoPath, "rev-parse", "--show-toplevel"],
    { encoding: "utf8" },
  );
  if (topLevel.status === 0 && typeof topLevel.stdout === "string") {
    const relativePrefix = path
      .relative(path.resolve(topLevel.stdout.trim()), path.resolve(repoPath))
      .split(path.sep)
      .join("/");
    if (relativePrefix.length > 0 && relativePrefix !== ".") {
      prefixToStrip = relativePrefix + "/";
    }
  }

  const log = spawnSync(
    "git",
    ["-C", repoPath, "log", "--pretty=format:%x01%aI", "--name-only"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (log.status !== 0 || typeof log.stdout !== "string") {
    return history;
  }

  const windowStartMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  for (const chunk of log.stdout.split(RECORD_SEPARATOR)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    const dateIso = lines[0] as string;
    const timestamp = Date.parse(dateIso);
    if (!Number.isFinite(timestamp)) continue;

    for (const filePath of lines.slice(1)) {
      const rawPosix = filePath.split("\\").join("/");
      let posixPath = rawPosix;
      if (prefixToStrip) {
        if (!rawPosix.startsWith(prefixToStrip)) continue;
        posixPath = rawPosix.slice(prefixToStrip.length);
        if (posixPath.length === 0) continue;
      }
      let entry = history.get(posixPath);
      if (!entry) {
        entry = { commitsTotal: 0, commitsInWindow: 0, lastModifiedIso: null };
        history.set(posixPath, entry);
      }
      entry.commitsTotal += 1;
      if (timestamp >= windowStartMs) entry.commitsInWindow += 1;
      if (
        !entry.lastModifiedIso ||
        timestamp > (Date.parse(entry.lastModifiedIso) || 0)
      ) {
        entry.lastModifiedIso = dateIso;
      }
    }
  }

  return history;
}
