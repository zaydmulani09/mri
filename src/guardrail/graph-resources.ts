import type { GraphStore } from "../graph/store.js";
import { EdgeType } from "../graph/schema.js";
import { classifyModuleSpecifier } from "./interceptor.js";
import type { CategoryGrant } from "./types.js";

// ---------------------------------------------------------------------------
// Resource-derivation policy: FAIL CLOSED, graph evidence only.
//
// The only resource signal the current graph schema can prove is a RESOLVED
// `imports` edge to an external module node whose specifier maps to a builtin
// resource category (e.g. `import ... from 'node:fs'` -> filesystem). Such an
// edge is concrete evidence that the scope's module loads that capability.
//
// Everything else stays ungranted:
// - A require() written INSIDE a function body never becomes an imports edge;
//   it surfaces as an ambiguous call on 'require', which identifies no module.
//   Guessing a category from it would silently grant whatever the guess was,
//   so ambiguous edges derive nothing (same policy as unresolved calls).
// - Specific targets (filesystem paths, network hosts, env var names,
//   commands) are not represented in the graph schema yet; they remain
//   config-driven until extraction records them.
//
// Derived grants are additive: config-declared grants always apply, derived
// ones only ever widen the allowlist with what the graph can prove.
// ---------------------------------------------------------------------------

export function deriveResourceGrants(
  store: GraphStore,
  evidenceSourceIds: string[],
): CategoryGrant[] {
  const importsStmt = store.db.prepare(
    `SELECT dst AS dst FROM edges WHERE src = ? AND type = '${EdgeType.Imports}' AND confidence = 'resolved'`,
  );

  const out = new Map<string, CategoryGrant>();
  for (const sourceId of evidenceSourceIds) {
    for (const row of importsStmt.all(sourceId) as unknown as Array<{ dst: string | null }>) {
      if (row.dst === null || !row.dst.startsWith("xm:")) continue;
      const target = store.getNode(row.dst);
      if (!target || target.external !== 1) continue;

      const specifier = row.dst.slice("xm:".length);
      const classification = classifyModuleSpecifier(specifier);
      if (classification.kind !== "builtin" || classification.category === null) continue;

      const key = `${classification.category}|${specifier}`;
      if (!out.has(key)) {
        out.set(key, {
          category: classification.category,
          viaModule: specifier,
          origin: "graph-import",
        });
      }
    }
  }
  return [...out.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.viaModule.localeCompare(b.viaModule),
  );
}
