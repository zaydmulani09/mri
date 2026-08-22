import { classId, functionId, methodId } from "./ids.js";
import type { CallSite, CalleeKind } from "../extraction/types.js";
import type { SymbolIndex } from "./symbols-index.js";
import {
  ancestorChain,
  bindingsFor,
  ensureExternalSymbol,
  findExportedSymbol,
} from "./symbols-index.js";
import type { GraphStore } from "./store.js";

export interface CallsSummary {
  resolved: number;
  ambiguous: number;
}

interface EnclosingScope {
  className: string | null;
  functionName: string | null;
}

export function resolveCalls(store: GraphStore, index: SymbolIndex): CallsSummary {
  let resolved = 0;
  let ambiguous = 0;

  for (const [filePath, symbols] of index.files) {
    for (const site of symbols.calls) {
      const srcId = containerToNodeId(index, filePath, site.container);
      if (!srcId) continue;

      const calleeText = site.object ? `${site.object}.${site.name}` : site.name;
      const dst = resolveCallSite(store, index, filePath, site);

      if (dst) {
        store.addEdge({
          src: srcId,
          dst,
          type: "calls",
          line: site.line,
          confidence: "resolved",
        });
        resolved++;
      } else {
        store.addEdge({
          src: srcId,
          dst: null,
          type: "calls",
          line: site.line,
          calleeText,
          confidence: "ambiguous",
        });
        ambiguous++;
      }
    }
  }

  return { resolved, ambiguous };
}

function containerToNodeId(
  index: SymbolIndex,
  filePath: string,
  container: string,
): string | null {
  if (container.includes(".")) {
    const dotIndex = container.indexOf(".");
    const className = container.slice(0, dotIndex);
    const methodName = container.slice(dotIndex + 1);
    return methodId(filePath, className, methodName);
  }
  const fn = index.localFunctions.get(filePath)?.get(container);
  if (fn) return fn;
  const cls = index.localClasses.get(filePath)?.get(container);
  if (cls) return cls;
  return null;
}

function parseContainer(container: string): EnclosingScope {
  const dotIndex = container.indexOf(".");
  if (dotIndex === -1) {
    return { className: null, functionName: container };
  }
  return {
    className: container.slice(0, dotIndex),
    functionName: container.slice(dotIndex + 1),
  };
}

function resolveCallSite(
  store: GraphStore,
  index: SymbolIndex,
  filePath: string,
  site: CallSite,
): string | null {
  switch (site.kind as CalleeKind) {
    case "plain":
      return resolveNameLike(store, index, filePath, site.name);
    case "this":
    case "self": {
      const scope = parseContainer(site.container);
      const className = scope.className ?? (isClassContainer(index, filePath, site.container) ? site.container : null);
      if (!className) return null;
      return resolveOnClassChain(index, filePath, className, site.name, true);
    }
    case "super": {
      const scope = parseContainer(site.container);
      const className = scope.className ?? (isClassContainer(index, filePath, site.container) ? site.container : null);
      if (!className) return null;
      return resolveOnClassChain(index, filePath, className, site.name, false);
    }
    case "member":
      if (!site.object) return null;
      return resolveThroughBinding(store, index, filePath, site.object, site.name);
    default:
      return null;
  }
}

function isClassContainer(index: SymbolIndex, filePath: string, container: string): boolean {
  return index.localClasses.get(filePath)?.has(container) ?? false;
}

function resolveNameLike(
  store: GraphStore,
  index: SymbolIndex,
  filePath: string,
  name: string,
): string | null {
  const localFn = index.localFunctions.get(filePath)?.get(name);
  if (localFn) return localFn;

  const viaImport = resolveThroughBinding(store, index, filePath, name, name);
  if (viaImport) return viaImport;

  const localCls = index.localClasses.get(filePath)?.get(name);
  if (localCls) return localCls;

  return null;
}

function resolveThroughBinding(
  store: GraphStore,
  index: SymbolIndex,
  filePath: string,
  binding: string,
  memberName: string,
): string | null {
  const matches = bindingsFor(index, filePath, binding);
  for (const match of matches) {
    if (match.resolved.status === "external") {
      return ensureExternalSymbol(store, {
        owner: match.resolved.specifier,
        name: memberName,
        kind: "function",
      });
    }
    const targetPath = match.resolved.path;
    if (!targetPath) continue;
    const exported = findExportedSymbol(index, targetPath, memberName);
    if (exported) return exported.id;
  }
  return null;
}

function resolveOnClassChain(
  index: SymbolIndex,
  filePath: string,
  className: string,
  methodName: string,
  includeOwn: boolean,
): string | null {
  const classNodeId = classId(filePath, className);

  if (includeOwn) {
    const own = index.methodsWithClass.get(classNodeId)?.get(methodName);
    if (own) return own;
  }

  for (const ancestor of ancestorChain(index, classNodeId)) {
    const found = index.methodsWithClass.get(ancestor)?.get(methodName);
    if (found) return found;
  }
  return null;
}
