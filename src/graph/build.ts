import { promises as fs } from "node:fs";
import path from "node:path";
import { extractRepo, type FileSymbols } from "../extraction/index.js";
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
}

export async function buildRepoGraph(
  repoPath: string,
  dbPath: string,
): Promise<BuildSummary> {
  const root = path.resolve(repoPath);
  const extraction = await extractRepo(root);

  await fs.mkdir(path.dirname(path.resolve(dbPath)), { recursive: true });
  await fs.rm(path.resolve(dbPath), { force: true });

  const store = openGraph(dbPath);
  try {
    store.db.exec("BEGIN");
    try {
      writeSymbolNodes(store, extraction.files);
      writeReferenceEdges(store, extraction.files);

      const resolvedImportsByFile = await resolveAndWriteImports(
        store,
        root,
        extraction.files,
      );

      const index = buildSymbolIndex(extraction.files, resolvedImportsByFile);
      const hierarchy = resolveInheritance(store, index);
      const calls = resolveCalls(store, index);

      store.setMeta("root", toPosix(root));
      store.setMeta("generated_at", new Date().toISOString());
      store.setMeta("file_count", String(extraction.files.length));
      store.setMeta(
        "parse_error_files",
        String(extraction.files.filter((f) => f.hasParseErrors).length),
      );
      store.db.exec("COMMIT");

      return {
        root: toPosix(root),
        dbPath: path.resolve(dbPath),
        fileCount: extraction.files.length,
        parseErrorFiles: extraction.files.filter((f) => f.hasParseErrors).length,
        counts: store.counts(),
        callsResolved: calls.resolved,
        callsAmbiguous: calls.ambiguous,
        inheritsResolved: hierarchy.resolved,
        inheritsAmbiguous: hierarchy.ambiguous,
      };
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    store.db.close();
  }
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
