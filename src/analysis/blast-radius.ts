import type { GraphStore } from "../graph/store.js";

export type BlastConfidence = "confirmed" | "ambiguous-only";

export interface BlastRadiusNode {
  id: string;
  type: string;
  name: string;
  path: string | null;
  depth: number;
  via: BlastConfidence;
  relation: string;
}

export interface BlastRadiusResult {
  root: { id: string; type: string; name: string; path: string | null };
  dependents: BlastRadiusNode[];
}

const TRAVERSED_TYPES_SQL = "('calls', 'imports', 'inherits')";

export function computeBlastRadius(
  store: GraphStore,
  rootId: string,
): BlastRadiusResult {
  const rootNode = store.getNode(rootId);
  if (!rootNode) throw new Error(`Unknown node id: ${rootId}`);

  const discovered = new Map<string, BlastRadiusNode>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

  const incomingStatement = store.db.prepare(
    `SELECT e.src AS srcId, e.type AS relation, n.type AS type, n.name AS name, n.path AS path
     FROM edges e JOIN nodes n ON n.id = e.src
     WHERE e.dst = ? AND e.confidence = 'resolved'
       AND e.type IN ${TRAVERSED_TYPES_SQL}`,
  );

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; depth: number };
    const rows = incomingStatement.all(current.id) as unknown as Array<{
      srcId: string;
      relation: string;
      type: string;
      name: string;
      path: string | null;
    }>;

    for (const row of rows) {
      const existing = discovered.get(row.srcId);
      if (existing) {
        const nextDepth = current.depth + 1;
        if (nextDepth < existing.depth) existing.depth = nextDepth;
        continue;
      }
      discovered.set(row.srcId, {
        id: row.srcId,
        type: row.type,
        name: row.name,
        path: row.path,
        depth: current.depth + 1,
        via: "confirmed",
        relation: row.relation,
      });
      queue.push({ id: row.srcId, depth: current.depth + 1 });
    }
  }

  const rootName = rootNode.name;
  const ambiguousRows = store.db
    .prepare(
      `SELECT e.src AS srcId, e.callee_text AS calleeText,
              n.type AS type, n.name AS name, n.path AS path
       FROM edges e JOIN nodes n ON n.id = e.src
       WHERE e.confidence = 'ambiguous' AND e.callee_text IS NOT NULL`,
    )
    .all() as unknown as Array<{
    srcId: string;
    calleeText: string;
    type: string;
    name: string;
    path: string | null;
  }>;

  for (const row of ambiguousRows) {
    if (discovered.has(row.srcId)) continue;
    const referencedName = row.calleeText.split(".").pop();
    if (referencedName !== rootName) continue;
    discovered.set(row.srcId, {
      id: row.srcId,
      type: row.type,
      name: row.name,
      path: row.path,
      depth: 1,
      via: "ambiguous-only",
      relation: "ambiguous-reference",
    });
  }

  const dependents = [...discovered.values()].sort((a, b) =>
    a.depth !== b.depth ? a.depth - b.depth : a.id.localeCompare(b.id),
  );

  return {
    root: {
      id: rootNode.id,
      type: rootNode.type,
      name: rootNode.name,
      path: rootNode.path,
    },
    dependents,
  };
}
