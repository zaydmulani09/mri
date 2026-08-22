import { promises as fs } from "node:fs";
import path from "node:path";
import ignore from "ignore";

type Ignore = ReturnType<typeof ignore>;

const HARD_SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
]);

interface GitignoreScope {
  baseDir: string;
  matcher: Ignore;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

async function loadGitignore(dir: string): Promise<Ignore | null> {
  try {
    const content = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
    return ignore().add(content);
  } catch {
    return null;
  }
}

function isIgnored(absolutePath: string, scopes: readonly GitignoreScope[]): boolean {
  for (const scope of scopes) {
    const relative = path.relative(scope.baseDir, absolutePath);
    if (relative === "" || relative.startsWith("..")) continue;
    if (scope.matcher.ignores(toPosix(relative))) return true;
  }
  return false;
}

async function walkDirectory(
  dir: string,
  root: string,
  inheritedScopes: readonly GitignoreScope[],
  results: string[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const scopes: GitignoreScope[] = [...inheritedScopes];
  const gitignore = await loadGitignore(dir);
  if (gitignore) scopes.push({ baseDir: dir, matcher: gitignore });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (HARD_SKIPPED_DIRS.has(entry.name)) continue;
      if (isIgnored(entryPath, scopes)) continue;
      await walkDirectory(entryPath, root, scopes, results);
    } else if (entry.isFile()) {
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (isIgnored(entryPath, scopes)) continue;
      results.push(toPosix(path.relative(root, entryPath)));
    }
  }
}

export async function walkSourceFiles(root: string): Promise<string[]> {
  const rootPath = path.resolve(root);
  let rootStat;
  try {
    rootStat = await fs.stat(rootPath);
  } catch {
    throw new Error(`Repository path does not exist or is not readable: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Expected a directory but got a file: ${root}`);
  }

  const results: string[] = [];
  await walkDirectory(rootPath, rootPath, [], results);
  return results.sort();
}
