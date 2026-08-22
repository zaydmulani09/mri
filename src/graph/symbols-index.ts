import type { FileSymbols } from "../extraction/types.js";
import type { ResolvedImport } from "./import-resolver.js";
import {
  classId,
  externalModuleId,
  externalSymbolId,
  functionId,
  methodId,
} from "./ids.js";
import type { GraphStore } from "./store.js";

export interface BindingInfo {
  binding: string;
  specifier: string;
  resolved: ResolvedImport;
}

export interface ExportedTarget {
  id: string;
  kind: "function" | "class";
}

export interface ExternalSymbolRef {
  owner: string;
  name: string;
  kind: "function" | "class";
}

export interface SymbolIndex {
  files: Map<string, FileSymbols>;
  localFunctions: Map<string, Map<string, string>>;
  localClasses: Map<string, Map<string, string>>;
  methodsWithClass: Map<string, Map<string, string>>;
  exportedNames: Map<string, Set<string>>;
  bindingsByFile: Map<string, BindingInfo[]>;
  parents: Map<string, string[]>;
  globalClassIdsByName: Map<string, string[]>;
}

export function bindingsFor(
  index: SymbolIndex,
  filePath: string,
  binding: string,
): BindingInfo[] {
  return (index.bindingsByFile.get(filePath) ?? []).filter((b) => b.binding === binding);
}

export function buildSymbolIndex(
  files: FileSymbols[],
  resolvedImportsByFile: Map<string, Map<string, ResolvedImport>>,
): SymbolIndex {
  const index: SymbolIndex = {
    files: new Map(),
    localFunctions: new Map(),
    localClasses: new Map(),
    methodsWithClass: new Map(),
    exportedNames: new Map(),
    bindingsByFile: new Map(),
    parents: new Map(),
    globalClassIdsByName: new Map(),
  };

  for (const symbols of files) {
    const filePath = symbols.path;
    index.files.set(filePath, symbols);

    const fns = new Map<string, string>();
    for (const fn of symbols.functions) {
      fns.set(fn.name, functionId(filePath, fn.name));
    }
    index.localFunctions.set(filePath, fns);

    const classes = new Map<string, string>();
    for (const cls of symbols.classes) {
      const cid = classId(filePath, cls.name);
      classes.set(cls.name, cid);

      const methods = new Map<string, string>();
      for (const method of cls.methods) {
        methods.set(method.name, methodId(filePath, cls.name, method.name));
      }
      index.methodsWithClass.set(cid, methods);
      const known = index.globalClassIdsByName.get(cls.name) ?? [];
      known.push(cid);
      index.globalClassIdsByName.set(cls.name, known);
    }
    index.localClasses.set(filePath, classes);

    const exported = new Set<string>();
    for (const entry of symbols.exports) {
      if (entry.kind === "all") continue;
      for (const name of entry.names) exported.add(name);
    }
    for (const fn of symbols.functions) if (fn.exported) exported.add(fn.name);
    for (const cls of symbols.classes) if (cls.exported) exported.add(cls.name);
    index.exportedNames.set(filePath, exported);

    const resolvedForFile =
      resolvedImportsByFile.get(filePath) ?? new Map<string, ResolvedImport>();
    const bindings: BindingInfo[] = [];
    for (const imp of symbols.imports) {
      const resolved =
        resolvedForFile.get(imp.specifier) ??
        ({ specifier: imp.specifier, status: "external" } as ResolvedImport);
      const names = new Set<string>();
      if (imp.defaultImport) names.add(imp.defaultImport);
      if (imp.namespaceImport) names.add(imp.namespaceImport);
      for (const named of imp.namedImports) names.add(named);
      for (const binding of names) {
        bindings.push({ binding, specifier: imp.specifier, resolved });
      }
    }
    index.bindingsByFile.set(filePath, bindings);
  }

  return index;
}

export function ancestorChain(index: SymbolIndex, classNodeId: string): string[] {
  const seen = new Set<string>();
  const queue = [...(index.parents.get(classNodeId) ?? [])];
  const out: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    queue.push(...(index.parents.get(current) ?? []));
  }
  return out;
}

export function ensureExternalModule(store: GraphStore, specifier: string): string {
  const id = externalModuleId(specifier);
  store.upsertNode({ id, type: "module", name: specifier, path: null, external: true });
  return id;
}

export function ensureExternalSymbol(store: GraphStore, ref: ExternalSymbolRef): string {
  const id = externalSymbolId(ref.kind, ref.owner, ref.name);
  store.upsertNode({
    id,
    type: ref.kind,
    name: ref.name,
    path: null,
    external: true,
  });
  return id;
}

export function findExportedSymbol(
  index: SymbolIndex,
  filePath: string,
  name: string,
): ExportedTarget | null {
  const symbols = index.files.get(filePath);
  if (!symbols) return null;
  const exported = index.exportedNames.get(filePath) ?? new Set<string>();

  for (const fn of symbols.functions) {
    if (fn.name === name && (fn.exported || exported.has(name))) {
      return { id: functionId(filePath, name), kind: "function" };
    }
  }
  for (const cls of symbols.classes) {
    if (cls.name === name && (cls.exported || exported.has(name))) {
      return { id: classId(filePath, name), kind: "class" };
    }
  }
  return null;
}
