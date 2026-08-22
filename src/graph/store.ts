import { DatabaseSync, type DatabaseSync as Db, type StatementSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

export interface NodeRow {
  id: string;
  type: string;
  name: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
  external: number;
  language: string | null;
}

export interface EdgeRow {
  id: number;
  src: string;
  dst: string | null;
  type: string;
  line: number | null;
  callee_text: string | null;
  confidence: string;
}

export interface NodeInput {
  id: string;
  type: string;
  name: string;
  path?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  external?: boolean;
  language?: string | null;
}

export interface EdgeInput {
  src: string;
  dst: string | null;
  type: string;
  line?: number | null;
  calleeText?: string | null;
  confidence?: "resolved" | "ambiguous";
}

export interface GraphCounts {
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  edgesByConfidence: Record<string, number>;
}

export class GraphStore {
  readonly db: Db;

  private insertNode: StatementSync;
  private insertEdge: StatementSync;

  constructor(db: Db) {
    this.db = db;
    db.exec(SCHEMA_SQL);
    this.insertNode = db.prepare(
      `INSERT INTO nodes (id, type, name, path, start_line, end_line, external, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type=excluded.type, name=excluded.name, path=excluded.path,
         start_line=excluded.start_line, end_line=excluded.end_line,
         external=excluded.external, language=excluded.language`,
    );
    this.insertEdge = db.prepare(
      `INSERT INTO edges (src, dst, type, line, callee_text, confidence)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
  }

  upsertNode(node: NodeInput): void {
    this.insertNode.run(
      node.id,
      node.type,
      node.name,
      node.path ?? null,
      node.startLine ?? null,
      node.endLine ?? null,
      node.external ? 1 : 0,
      node.language ?? null,
    );
  }

  addEdge(edge: EdgeInput): void {
    const confidence = edge.confidence ?? "resolved";
    if (confidence === "resolved" && edge.dst === null) {
      throw new Error(`Resolved edge requires dst (src=${edge.src}, type=${edge.type})`);
    }
    if (confidence === "ambiguous" && edge.dst !== null) {
      throw new Error(`Ambiguous edge must have null dst (src=${edge.src})`);
    }
    this.insertEdge.run(
      edge.src,
      edge.dst ?? null,
      edge.type,
      edge.line ?? null,
      edge.calleeText ?? null,
      confidence,
    );
  }

  getNode(id: string): NodeRow | undefined {
    return this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
  }

  clear(): void {
    this.db.exec("DELETE FROM edges; DELETE FROM nodes; DELETE FROM meta;");
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, value);
  }

  counts(): GraphCounts {
    const group = (sql: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const row of this.db.prepare(sql).all() as Array<{ k: string; n: number }>) {
        out[row.k] = row.n;
      }
      return out;
    };
    return {
      nodesByType: group("SELECT type AS k, COUNT(*) AS n FROM nodes GROUP BY type"),
      edgesByType: group("SELECT type AS k, COUNT(*) AS n FROM edges GROUP BY type"),
      edgesByConfidence: group("SELECT confidence AS k, COUNT(*) AS n FROM edges GROUP BY confidence"),
    };
  }
}

export function openGraph(dbPath: string): GraphStore {
  return new GraphStore(new DatabaseSync(dbPath));
}

export function openGraphInMemory(): GraphStore {
  return new GraphStore(new DatabaseSync(":memory:"));
}
