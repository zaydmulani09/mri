import type { GraphStore, NodeRow } from "../graph/store.js";
import { EdgeType } from "../graph/schema.js";
import { File as fileId } from "../graph/ids.js";
import type {
  Allowlist,
  FileGrant,
  ScopedResourceConfig,
  ResourceGrants,
  ScopeInfo,
  SymbolGrant,
  UnresolvedReference,
} from "./types.js";
import { ALLOWLIST_POLICY } from "./types.js";
import {
  emptyResourceGrants,
  normalizeResourceGrants,
  parseResourceConfig,
} from "./resources.js";

// ---------------------------------------------------------------------------
// Ambiguous-edge policy: FAIL CLOSED.
//
// Outgoing edges with confidence='ambiguous' carry no resolved destination
// (dst IS NULL), so there is nothing provable to allowlist. We deliberately do
// NOT guess a target from callee_text: an enforcement tool must never silently
// grant permission for something merely because the analysis could not
// determine what it was. A guessed allowlist entry would let code reach an
// unintended symbol (e.g. a same-named helper in another module) under a
// legitimate-looking permission. Instead, unresolved references are surfaced
// on the allowlist's `unresolved` list so reviewers or a later pipeline can
// resolve them explicitly and re-generate.
//
// Consequence: a scope containing ambiguous calls gets an allowlist that is
// too small to run correctly. That is intentional - it forces the ambiguity
// to be fixed in the graph rather than papered over at enforcement time.
// ---------------------------------------------------------------------------

const REACHABLE_EDGE_TYPES_SQL = `'${EdgeType.Calls}', '${EdgeType.Imports}', '${EdgeType.Inherits}'`;

export interface GenerateAllowlistOptions {
  resources?: ResourceGrants;
  resourceConfig?: ScopedResourceConfig;
}

interface EdgeTargetRow {
  dst: string | null;
  type: string;
}

export function generateAllowlist(
  scopeNodeId: string,
  graphDb: GraphStore,
  options: GenerateAllowlistOptions = {},
): Allowlist {
  const scopeNode = graphDb.getNode(scopeNodeId);
  if (!scopeNode) {
    throw new Error(`Unknown scope node id: ${scopeNodeId}`);
  }

  const seedIds = collectSeedNodes(graphDb, scopeNodeId);

  const symbols = new Map<string, SymbolGrant>();
  const files = new Map<string, FileGrant>();

  for (const seedId of seedIds) {
    const node = requireNode(graphDb, seedId);
    // The scope's own container file is always allowed: the scope is defined
    // in it, so it is provably loaded whenever the scope runs.
    addContainingFile(graphDb, node, files);
    if (seedId === scopeNodeId) continue;
    symbols.set(node.id, {
      nodeId: node.id,
      name: node.name,
      kind: node.type,
      path: node.path,
      external: node.external === 1,
      via: EdgeType.Defines,
    });
  }

  const targetsStmt = graphDb.db.prepare(
    `SELECT dst AS dst, type AS type FROM edges
     WHERE src = ? AND confidence = 'resolved' AND type IN (${REACHABLE_EDGE_TYPES_SQL})`,
  );
  const unresolvedStmt = graphDb.db.prepare(
    `SELECT callee_text AS calleeText, line AS line FROM edges
     WHERE src = ? AND confidence = 'ambiguous'`,
  );

  const unresolved: UnresolvedReference[] = [];
  for (const seedId of seedIds) {
    for (const row of targetsStmt.all(seedId) as unknown as EdgeTargetRow[]) {
      if (row.dst === null) continue;
      const target = requireNode(graphDb, row.dst);
      if (target.type === "file") {
        files.set(target.id, { nodeId: target.id, path: target.path ?? target.id });
        continue;
      }
      symbols.set(target.id, {
        nodeId: target.id,
        name: target.name,
        kind: target.type,
        path: target.path,
        external: target.external === 1,
        via: row.type as SymbolGrant["via"],
      });
      addContainingFile(graphDb, target, files);
    }

    // Ambiguous edges are excluded per the fail-closed policy above; they are
    // recorded here for visibility only.
    for (const row of unresolvedStmt.all(seedId) as unknown as Array<{
      calleeText: string | null;
      line: number | null;
    }>) {
      if (row.calleeText === null) continue;
      unresolved.push({ sourceId: seedId, calleeText: row.calleeText, line: row.line });
    }
  }

  return {
    policy: ALLOWLIST_POLICY,
    scope: scopeInfo(scopeNode),
    symbols: [...symbols.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    resources: resolveResources(scopeNodeId, options),
    unresolved: unresolved.sort(
      (a, b) =>
        a.sourceId.localeCompare(b.sourceId) || a.calleeText.localeCompare(b.calleeText),
    ),
  };
}

function collectSeedNodes(graphDb: GraphStore, scopeNodeId: string): string[] {
  const seen = new Set<string>([scopeNodeId]);
  const queue = [scopeNodeId];
  const definesStmt = graphDb.db.prepare(
    `SELECT dst AS dst FROM edges WHERE src = ? AND type = '${EdgeType.Defines}' AND confidence = 'resolved'`,
  );
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const row of definesStmt.all(current) as unknown as Array<{ dst: string | null }>) {
      if (row.dst === null || seen.has(row.dst)) continue;
      seen.add(row.dst);
      queue.push(row.dst);
    }
  }
  return [...seen];
}

function addContainingFile(graphDb: GraphStore, node: NodeRow, files: Map<string, FileGrant>): void {
  if (!node.path || node.external === 1) return;
  const fileNode = graphDb.getNode(fileId.build(node.path));
  if (!fileNode) return;
  files.set(fileNode.id, { nodeId: fileNode.id, path: fileNode.path ?? fileNode.id });
}

function requireNode(graphDb: GraphStore, nodeId: string): NodeRow {
  const node = graphDb.getNode(nodeId);
  if (!node) {
    throw new Error(`Graph is missing node referenced by an edge: ${nodeId}`);
  }
  return node;
}

function scopeInfo(node: NodeRow): ScopeInfo {
  return { id: node.id, type: node.type, name: node.name, path: node.path };
}

function resolveResources(scopeNodeId: string, options: GenerateAllowlistOptions): ResourceGrants {
  if (options.resources !== undefined && options.resourceConfig !== undefined) {
    throw new Error("Pass either 'resources' or 'resourceConfig', not both");
  }
  if (options.resources !== undefined) {
    return normalizeResourceGrants(options.resources, "inline resources");
  }
  if (options.resourceConfig !== undefined) {
    return options.resourceConfig.scopes[scopeNodeId] ?? emptyResourceGrants();
  }
  return emptyResourceGrants();
}
