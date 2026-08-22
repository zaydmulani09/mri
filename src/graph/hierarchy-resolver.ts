import { classId } from "./ids.js";
import type { SymbolIndex } from "./symbols-index.js";
import {
  bindingsFor,
  ensureExternalSymbol,
  findExportedSymbol,
} from "./symbols-index.js";
import type { GraphStore } from "./store.js";

export interface HierarchySummary {
  resolved: number;
  ambiguous: number;
}

export function resolveInheritance(store: GraphStore, index: SymbolIndex): HierarchySummary {
  let resolved = 0;
  let ambiguous = 0;

  for (const [filePath, symbols] of index.files) {
    for (const cls of symbols.classes) {
      const childId = classId(filePath, cls.name);
      for (const baseText of cls.extends) {
        const target = resolveBase(store, index, filePath, baseText);
        if (target.kind === "resolved") {
          store.addEdge({
            src: childId,
            dst: target.id,
            type: "inherits",
            line: cls.startLine,
            confidence: "resolved",
          });
          if (target.internal) {
            const parents = index.parents.get(childId) ?? [];
            parents.push(target.id);
            index.parents.set(childId, parents);
          }
          resolved++;
        } else {
          store.addEdge({
            src: childId,
            dst: null,
            type: "inherits",
            line: cls.startLine,
            calleeText: baseText,
            confidence: "ambiguous",
          });
          ambiguous++;
        }
      }
    }
  }

  return { resolved, ambiguous };
}

type BaseResolution =
  | { kind: "resolved"; id: string; internal: boolean }
  | { kind: "ambiguous" };

function resolveBase(
  store: GraphStore,
  index: SymbolIndex,
  filePath: string,
  baseText: string,
): BaseResolution {
  const hasDot = baseText.includes(".");
  const head = baseText.split(".")[0] ?? baseText;

  if (!hasDot) {
    const local = index.localClasses.get(filePath)?.get(baseText);
    if (local) return { kind: "resolved", id: local, internal: true };
  }

  for (const binding of bindingsFor(index, filePath, head)) {
    if (binding.resolved.status === "external") {
      const id = ensureExternalSymbol(store, {
        owner: binding.resolved.specifier,
        name: baseText,
        kind: "class",
      });
      return { kind: "resolved", id, internal: false };
    }
    const targetPath = binding.resolved.path;
    if (!targetPath || hasDot) continue;
    const exported = findExportedSymbol(index, targetPath, baseText);
    if (exported && exported.kind === "class") {
      return { kind: "resolved", id: exported.id, internal: true };
    }
  }

  if (!hasDot) {
    const candidates = index.globalClassIdsByName.get(baseText) ?? [];
    const first = candidates[0];
    if (candidates.length === 1 && first && first !== classId(filePath, baseText)) {
      return { kind: "resolved", id: first, internal: true };
    }
  }

  return { kind: "ambiguous" };
}
