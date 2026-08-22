export const NodeType = {
  File: "file",
  Function: "function",
  Class: "class",
  Method: "method",
} as const;
export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType];

export const EdgeType = {
  Imports: "imports",
  Defines: "defines",
  Calls: "calls",
  Inherits: "inherits",
} as const;
export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType];

export const Resolution = {
  Resolved: "resolved",
  Ambiguous: "ambiguous",
} as const;
export type ResolutionValue = (typeof Resolution)[keyof typeof Resolution];

export const NODE_KINDS: readonly string[] = Object.values(NodeType);

export const EDGE_TYPES: readonly string[] = Object.values(EdgeType);

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  external INTEGER NOT NULL DEFAULT 0,
  language TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src TEXT NOT NULL,
  dst TEXT,
  type TEXT NOT NULL,
  line INTEGER,
  callee_text TEXT,
  confidence TEXT NOT NULL DEFAULT 'resolved',
  CHECK (
    (confidence = 'resolved' AND dst IS NOT NULL)
    OR confidence = 'ambiguous'
  )
);

CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
