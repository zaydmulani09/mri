import type { GraphStore } from "../graph/store.js";

export interface DependencyCycle {
  /**
   * Node ids along the cycle, starting at the cycle's lexicographically
   * smallest member. The closing edge back to path[0] is implied and not
   * repeated here.
   */
  path: string[];
  /** Number of edges in the cycle (equals path.length). */
  length: number;
}

export interface CycleReport {
  /** File-level cycles over resolved `imports` edges. */
  importCycles: DependencyCycle[];
  /** Symbol-level cycles over resolved `calls` edges. */
  callCycles: DependencyCycle[];
}

// Fail-closed by construction: ambiguous edges carry no destination, so a
// reported cycle can only ever be assembled from proven links.
const RESOLVED_EDGE_GUARD = "confidence = 'resolved' AND dst IS NOT NULL";

export function findDependencyCycles(store: GraphStore): CycleReport {
  return {
    importCycles: detectCycles(
      store,
      "type = 'imports' AND src LIKE 'f:%' AND dst LIKE 'f:%'",
    ),
    callCycles: detectCycles(
      store,
      "type = 'calls' AND src NOT LIKE 'x%' AND dst NOT LIKE 'x%'",
    ),
  };
}

function detectCycles(store: GraphStore, edgeFilter: string): DependencyCycle[] {
  const rows = store.db
    .prepare(
      `SELECT src, dst FROM edges WHERE ${edgeFilter} AND ${RESOLVED_EDGE_GUARD}`,
    )
    .all() as unknown as Array<{ src: string; dst: string }>;

  const adjacency = new Map<string, string[]>();
  for (const row of rows) {
    const list = adjacency.get(row.src);
    if (list) list.push(row.dst);
    else adjacency.set(row.src, [row.dst]);
  }
  for (const list of adjacency.values()) list.sort();

  // A strongly connected component with more than one member is, by
  // definition, a set of nodes that all participate in at least one cycle;
  // reporting one representative path per component avoids the exponential
  // explosion of enumerating every elementary cycle.
  const components = tarjanScc(adjacency)
    .filter((component) => component.length > 1)
    .sort(
      (a, b) =>
        b.length - a.length ||
        (a[0] ?? "").localeCompare(b[0] ?? ""),
    );

  const cycles: DependencyCycle[] = [];
  for (const component of components) {
    const path = representativeCycle(component, adjacency);
    if (path !== null) {
      cycles.push({ path, length: path.length });
    }
  }
  return cycles;
}

/**
 * Deterministically picks one cycle inside the component: a depth-first walk
 * from the component's smallest member, following sorted neighbors, that
 * returns on the first edge reaching back to the start.
 */
function representativeCycle(
  members: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[] | null {
  const memberSet = new Set(members);
  const start = [...members].sort()[0];
  if (!start) return null;

  const path: string[] = [];
  const onPath = new Set<string>();

  const dfs = (node: string): string[] | null => {
    path.push(node);
    onPath.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!memberSet.has(next)) continue;
      if (next === start) return [...path];
      if (!onPath.has(next)) {
        const found = dfs(next);
        if (found !== null) return found;
      }
    }
    path.pop();
    onPath.delete(node);
    return null;
  };

  return dfs(start);
}

/**
 * Iterative Tarjan strongly-connected-components. Iterative on purpose:
 * long dependency chains in large repos would otherwise risk stack depth.
 */
function tarjanScc(adjacency: ReadonlyMap<string, readonly string[]>): string[][] {
  let indexCounter = 0;
  const indexOf = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  for (const root of [...adjacency.keys()].sort()) {
    if (indexOf.has(root)) continue;

    // Each frame: [node, cursor into its neighbor list].
    const callStack: Array<{ node: string; cursor: number }> = [
      { node: root, cursor: 0 },
    ];
    indexOf.set(root, indexCounter);
    lowlink.set(root, indexCounter);
    indexCounter += 1;
    stack.push(root);
    onStack.add(root);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      if (frame === undefined) break;
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.cursor < neighbors.length) {
        const next = neighbors[frame.cursor];
        frame.cursor += 1;
        if (next === undefined) continue;

        if (!indexOf.has(next)) {
          indexOf.set(next, indexCounter);
          lowlink.set(next, indexCounter);
          indexCounter += 1;
          stack.push(next);
          onStack.add(next);
          callStack.push({ node: next, cursor: 0 });
        } else if (onStack.has(next)) {
          const current = lowlink.get(frame.node) ?? 0;
          lowlink.set(frame.node, Math.min(current, indexOf.get(next) ?? 0));
        }
        continue;
      }

      callStack.pop();
      const parent = callStack[callStack.length - 1];
      if (parent !== undefined) {
        const parentLow = lowlink.get(parent.node) ?? 0;
        lowlink.set(
          parent.node,
          Math.min(parentLow, lowlink.get(frame.node) ?? 0),
        );
      }

      if ((lowlink.get(frame.node) ?? 0) === (indexOf.get(frame.node) ?? 0)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        component.sort();
        components.push(component);
      }
    }
  }

  return components;
}
