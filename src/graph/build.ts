import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractFile, walkSourceFiles, type FileSymbols } from "../extraction/index.js";
import { classId, functionId, methodId, File as fileId } from "./ids.js";
import { EdgeType, NodeType } from "./schema.js";
import { createImportResolver, type ResolvedImport } from "./import-resolver.js";
import { ensureExternalModule, buildSymbolIndex } from "./symbols-index.js";
import { resolveInheritance } from "./hierarchy-resolver.js";
import { resolveCalls } from "./call-resolver.js";
import { openGraph, type GraphCounts, type GraphStore } from "./store.js";

export interface BuildSummary {
  root: string;
  dbPath: string;
  fileCount: number;
  parseErrorFiles: number;
  counts: GraphCounts;
  callsResolved: number;
  callsAmbiguous: number;
  inheritsResolved: number;
  inheritsAmbiguous: number;
  stats: IncrementalStats;
}

export interface IncrementalStats {
  mode: "full" | "incremental";
  /** Files whose cached extraction was reused (content hash unchanged). */
  cachedFiles: number;
  /** Files re-parsed this run: changed + added + reverse-dependents + cache fallbacks. */
  reextractedFiles: number;
  changedFiles: number;
  addedFiles: number;
  removedFiles: number;
  /** Subset of re-extracted files pulled in only because they import a dirty file. */
  dependentFiles: number;
}

export interface BuildOptions {
  /**
   * Reuse cached per-file extractions for files whose content hash is
   * unchanged since the previous build of the same repo into the same
   * database. Resolution still runs over the complete merged symbol set,
   * so the resulting graph is identical to a full rebuild by construction.
   */
  incremental?: boolean;
}

interface CurrentFile {
  posixPath: string;
  absolutePath: string;
  hash: string;
}

export async function buildRepoGraph(
  repoPath: string,
  dbPath: string,
  options: BuildOptions = {},
): Promise<BuildSummary> {
  const root = path.resolve(repoPath);
  const posixRoot = toPosix(root);

  // Walk and hash every current source file. Hashing raw bytes (not mtime)
  // is what makes cache reuse safe across checkouts, branches and clocks.
  const current = new Map<string, CurrentFile>();
  for (const relativeFile of await walkSourceFiles(root)) {
    const absolutePath = path.join(root, relativeFile);
    const bytes = await fs.readFile(absolutePath);
    current.set(toPosix(relativeFile), {
      posixPath: toPosix(relativeFile),
      absolutePath,
      hash: sha256(bytes),
    });
  }

  await fs.mkdir(path.dirname(path.resolve(dbPath)), { recursive: true });

  let store: GraphStore;
  let mode: "full" | "incremental" = "full";
  let previousHashes = new Map<string, string>();

  if (options.incremental === true) {
    store = openGraph(dbPath);
    if (store.getMeta("root") === posixRoot) {
      mode = "incremental";
      previousHashes = store.getFileHashes();
    }
  } else {
    await fs.rm(path.resolve(dbPath), { force: true });
    store = openGraph(dbPath);
  }

  try {
    const added: string[] = [];
    const changed: string[] = [];
    const unchanged: string[] = [];
    for (const [posixPath, file] of current) {
      const previousHash = previousHashes.get(posixPath);
      if (previousHash === undefined) added.push(posixPath);
      else if (previousHash !== file.hash) changed.push(posixPath);
      else unchanged.push(posixPath);
    }
    const removed = [...previousHashes.keys()].filter((p) => !current.has(p));

    // Conservative dirty-set expansion: any surviving file that imported a
    // changed or removed file gets re-parsed too, so its import/call sites
    // are recomputed from a fresh read rather than trusted from cache.
    // Correctness over speed.
    const dependentPaths =
      mode === "incremental"
        ? reverseDependents(store, new Set([...changed, ...removed]), current, changed, added)
        : new Set<string>();

    const reextract = new Set<string>([...changed, ...added, ...dependentPaths]);
    const symbolsByPath = new Map<string, FileSymbols>();
    let cachedFiles = 0;
    for (const [posixPath, file] of current) {
      if (reextract.has(posixPath)) {
        symbolsByPath.set(
          posixPath,
          await extractSafely(file.absolutePath, root, posixPath),
        );
        continue;
      }
      const cachedJson = mode === "incremental" ? store.getCachedSymbolsJson(posixPath) : undefined;
      if (cachedJson !== undefined) {
        try {
          symbolsByPath.set(posixPath, JSON.parse(cachedJson) as FileSymbols);
          cachedFiles++;
          continue;
        } catch {
          // Corrupt cache entry: fall through and parse fresh.
        }
      }
      symbolsByPath.set(posixPath, await extractSafely(file.absolutePath, root, posixPath));
    }

    // Stable ordering keeps downstream writes deterministic regardless of
    // which subset came from cache.
    const extractionFiles = [...symbolsByPath.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );

    store.db.exec("BEGIN");
    try {
      store.clearGraphData();

      writeSymbolNodes(store, extractionFiles);
      writeReferenceEdges(store, extractionFiles);

      const resolvedImportsByFile = await resolveAndWriteImports(
        store,
        root,
        extractionFiles,
      );

      const index = buildSymbolIndex(extractionFiles, resolvedImportsByFile);
      const hierarchy = resolveInheritance(store, index);
      const calls = resolveCalls(store, index);

      for (const [posixPath, file] of current) {
        store.putFileState(posixPath, file.hash, symbolsByPath.get(posixPath)!);
      }
      for (const posixPath of removed) {
        store.deleteFileState(posixPath);
      }

      store.setMeta("root", posixRoot);
      store.setMeta("generated_at", new Date().toISOString());
      store.setMeta("file_count", String(extractionFiles.length));
      store.setMeta("build_mode", mode);
      store.setMeta(
        "parse_error_files",
        String(extractionFiles.filter((f) => f.hasParseErrors).length),
      );
      store.db.exec("COMMIT");

      return {
        root: posixRoot,
        dbPath: path.resolve(dbPath),
        fileCount: extractionFiles.length,
        parseErrorFiles: extractionFiles.filter((f) => f.hasParseErrors).length,
        counts: store.counts(),
        callsResolved: calls.resolved,
        callsAmbiguous: calls.ambiguous,
        inheritsResolved: hierarchy.resolved,
        inheritsAmbiguous: hierarchy.ambiguous,
        stats: {
          mode,
          cachedFiles,
          reextractedFiles: reextract.size,
          changedFiles: changed.length,
          addedFiles: added.length,
          removedFiles: removed.length,
          dependentFiles: dependentPaths.size,
        },
      };
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    store.db.close();
  }
}

/**
 * Files in `current` that import one of the dirty paths, according to the
 * previous graph's imports edges. Removed paths participate via their old
 * file node id so importers of a deleted file are re-extracted too.
 */
function reverseDependents(
  store: GraphStore,
  dirtySeeds: Set<string>,
  current: Map<string, CurrentFile>,
  changed: string[],
  added: string[],
): Set<string> {
  const dependents = new Set<string>();
  if (dirtySeeds.size === 0) return dependents;

  const alreadyDirty = new Set([...changed, ...added]);
  const dirtyFileNodeIds = [...dirtySeeds].map((p) => fileId.build(p));
  const placeholders = dirtyFileNodeIds.map(() => "?").join(", ");
  const rows = store.db
    .prepare(
      `SELECT DISTINCT src FROM edges WHERE type = 'imports' AND dst IN (${placeholders})`,
    )
    .all(...dirtyFileNodeIds) as Array<{ src: string }>;
  for (const row of rows) {
    if (!row.src.startsWith("f:")) continue;
    const importerPath = row.src.slice(2);
    if (!current.has(importerPath)) continue;
    if (!alreadyDirty.has(importerPath)) dependents.add(importerPath);
  }
  return dependents;
}

async function extractSafely(
  absolutePath: string,
  root: string,
  posixPath: string,
): Promise<FileSymbols> {
  try {
    return await extractFile(absolutePath, { root });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`mri: extraction failed for ${posixPath}: ${message}`);
    return {
      path: posixPath,
      language: "javascript",
      hasParseErrors: true,
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      references: [],
    };
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeSymbolNodes(store: GraphStore, files: FileSymbols[]): void {
  for (const symbols of files) {
    const posixPath = symbols.path;
    const baseName = posixPath.split("/").pop() ?? posixPath;

    store.upsertNode({
      id: fileId.build(posixPath),
      type: NodeType.File,
      name: baseName,
      path: posixPath,
      language: symbols.language,
    });

    for (const fn of symbols.functions) {
      const id = functionId(posixPath, fn.name);
      store.upsertNode({
        id,
        type: NodeType.Function,
        name: fn.name,
        path: posixPath,
        startLine: fn.startLine,
        endLine: fn.endLine,
        exported: fn.exported,
        language: symbols.language,
      });
      store.addEdge({
        src: fileId.build(posixPath),
        dst: id,
        type: EdgeType.Defines,
        line: fn.startLine,
      });
    }

    for (const cls of symbols.classes) {
      const cid = classId(posixPath, cls.name);
      store.upsertNode({
        id: cid,
        type: NodeType.Class,
        name: cls.name,
        path: posixPath,
        startLine: cls.startLine,
        endLine: cls.endLine,
        exported: cls.exported,
        language: symbols.language,
      });
      store.addEdge({
        src: fileId.build(posixPath),
        dst: cid,
        type: EdgeType.Defines,
        line: cls.startLine,
      });
      for (const method of cls.methods) {
        const mid = methodId(posixPath, cls.name, method.name);
        store.upsertNode({
          id: mid,
          type: NodeType.Method,
          name: method.name,
          path: posixPath,
          startLine: method.startLine,
          endLine: method.endLine,
          language: symbols.language,
        });
        store.addEdge({
          src: cid,
          dst: mid,
          type: EdgeType.Defines,
          line: method.startLine,
        });
      }
    }
  }
}

function writeReferenceEdges(store: GraphStore, files: FileSymbols[]): void {
  for (const symbols of files) {
    const posixPath = symbols.path;
    const fileNodeId = fileId.build(posixPath);

    const localSymbols = new Map<string, string>();
    for (const fn of symbols.functions) {
      localSymbols.set(fn.name, functionId(posixPath, fn.name));
    }
    for (const cls of symbols.classes) {
      localSymbols.set(cls.name, classId(posixPath, cls.name));
      for (const method of cls.methods) {
        localSymbols.set(method.name, methodId(posixPath, cls.name, method.name));
      }
    }

    const seen = new Set<string>();
    for (const reference of symbols.references) {
      const targetId = localSymbols.get(reference.name);
      if (!targetId) continue;

      const srcId = containerNodeId(store, posixPath, reference.container) ?? fileNodeId;
      const dedupeKey = `${srcId}->${targetId}`;
      if (srcId === targetId || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      store.addEdge({
        src: srcId,
        dst: targetId,
        type: EdgeType.References,
        line: reference.line,
      });
    }
  }
}

function containerNodeId(
  store: GraphStore,
  path: string,
  container: string,
): string | null {
  if (container === "<file>" || container.length === 0) return null;
  const dotIndex = container.indexOf(".");
  let candidate: string;
  if (dotIndex !== -1) {
    const className = container.slice(0, dotIndex);
    const methodName = container.slice(dotIndex + 1);
    candidate = methodId(path, className, methodName);
  } else {
    candidate = functionId(path, container);
  }
  return store.getNode(candidate) ? candidate : fileId.build(path);
}

async function resolveAndWriteImports(
  store: GraphStore,
  root: string,
  files: FileSymbols[],
): Promise<Map<string, Map<string, ResolvedImport>>> {
  const resolver = createImportResolver(root);
  const out = new Map<string, Map<string, ResolvedImport>>();

  for (const symbols of files) {
    const perFile = new Map<string, ResolvedImport>();
    const importerId = fileId.build(symbols.path);

    for (const imp of symbols.imports) {
      let resolved = perFile.get(imp.specifier);
      if (!resolved) {
        resolved = resolver.resolve(symbols.path, imp.specifier, symbols.language);
        perFile.set(imp.specifier, resolved);
      }

      let dstId: string;
      if (resolved.status === "internal" && resolved.path) {
        dstId = fileId.build(resolved.path);
        if (!store.getNode(dstId)) {
          store.upsertNode({
            id: dstId,
            type: NodeType.File,
            name: resolved.path.split("/").pop() ?? resolved.path,
            path: resolved.path,
            language: symbols.language,
          });
        }
      } else {
        dstId = ensureExternalModule(store, imp.specifier);
      }

      store.addEdge({
        src: importerId,
        dst: dstId,
        type: EdgeType.Imports,
        line: imp.line,
      });
    }

    out.set(symbols.path, perFile);
  }

  return out;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
