import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, type BuildSummary } from "../src/graph/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "graph_repo",
);

interface Row {
  [key: string]: string | number | null;
}

describe("graph construction", () => {
  const dbPath = path.join(
    os.tmpdir(),
    `mri-graph-test-${process.pid}-${Date.now()}.sqlite`,
  );
  let summary: BuildSummary;
  let db: DatabaseSync;

  beforeAll(async () => {
    summary = await buildRepoGraph(fixtureRoot, dbPath);
    db = new DatabaseSync(dbPath);
  });

  function query(sql: string): Row[] {
    return db.prepare(sql).all() as Row[];
  }

  function nodeExists(id: string, expectedExternal = false): boolean {
    const rows = query(`SELECT external FROM nodes WHERE id = '${id}'`);
    return rows.length === 1 && (rows[0]?.external === 1) === expectedExternal;
  }

  function edgeExists(src: string, dst: string, type: string): boolean {
    return (
      query(
        `SELECT id FROM edges WHERE src = '${src}' AND dst = '${dst}' AND type = '${type}' AND confidence = 'resolved'`,
      ).length > 0
    );
  }

  it("creates nodes for files, symbols and external targets", () => {
    expect(nodeExists("f:src/api.js")).toBe(true);
    expect(nodeExists("f:py/tool.py")).toBe(true);
    expect(nodeExists("fn:src/api.js#fetchUser")).toBe(true);
    expect(nodeExists("fn:src/api.js#helper")).toBe(true);
    expect(nodeExists("fn:src/format.js#pad")).toBe(true);
    expect(nodeExists("fn:src/format.js#money")).toBe(true);
    expect(nodeExists("fn:src/log.js#log")).toBe(true);
    expect(nodeExists("fn:src/index.js#main")).toBe(true);
    expect(nodeExists("fn:py/tool.py#run")).toBe(true);
    expect(nodeExists("fn:py/helpers.py#shrink")).toBe(true);
    expect(nodeExists("cls:src/user.js#User")).toBe(true);
    expect(nodeExists("m:src/user.js#User.describe")).toBe(true);
    expect(nodeExists("cls:src/widget.js#Widget")).toBe(true);
    expect(nodeExists("cls:py/klass.py#Dog")).toBe(true);
    expect(nodeExists("m:py/klass.py#Dog.speak")).toBe(true);
    expect(nodeExists("xm:extlib", true)).toBe(true);
    expect(nodeExists("xf:extlib#validate", true)).toBe(true);
  });

  it("writes defines edges for functions, classes and methods", () => {
    expect(edgeExists("f:src/api.js", "fn:src/api.js#fetchUser", "defines")).toBe(true);
    expect(edgeExists("cls:src/user.js#User", "m:src/user.js#User.describe", "defines")).toBe(true);
    expect(edgeExists("cls:py/klass.py#Animal", "m:py/klass.py#Animal.sound", "defines")).toBe(true);
  });

  it("resolves imports to internal files and external modules", () => {
    expect(edgeExists("f:src/api.js", "f:src/log.js", "imports")).toBe(true);
    expect(edgeExists("f:src/api.js", "f:src/format.js", "imports")).toBe(true);
    expect(edgeExists("f:src/api.js", "xm:extlib", "imports")).toBe(true);
    expect(edgeExists("f:src/index.js", "f:src/api.js", "imports")).toBe(true);
    expect(edgeExists("f:py/tool.py", "f:py/helpers.py", "imports")).toBe(true);
  });

  it("resolves cross-file calls through import bindings", () => {
    expect(edgeExists("fn:src/index.js#main", "fn:src/api.js#fetchUser", "calls")).toBe(true);
    expect(edgeExists("fn:src/api.js#fetchUser", "fn:src/log.js#log", "calls")).toBe(true);
    expect(edgeExists("fn:src/api.js#fetchUser", "xf:extlib#validate", "calls")).toBe(true);
    expect(edgeExists("fn:src/api.js#fetchUser", "fn:src/format.js#pad", "calls")).toBe(true);
    expect(edgeExists("fn:src/api.js#fetchUser", "fn:src/api.js#helper", "calls")).toBe(true);
    expect(edgeExists("fn:src/format.js#money", "fn:src/format.js#pad", "calls")).toBe(true);
  });

  it("resolves python cross-module calls via relative imports", () => {
    expect(edgeExists("fn:py/tool.py#run", "fn:py/helpers.py#shrink", "calls")).toBe(true);
  });

  it("resolves inheritance including python super() through the ancestor chain", () => {
    expect(edgeExists("cls:src/user.js#AdminUser", "cls:src/user.js#User", "inherits")).toBe(true);
    expect(edgeExists("cls:py/klass.py#Dog", "cls:py/klass.py#Animal", "inherits")).toBe(true);
    expect(edgeExists("m:py/klass.py#Animal.speak", "m:py/klass.py#Animal.sound", "calls")).toBe(true);
    expect(edgeExists("m:py/klass.py#Dog.speak", "m:py/klass.py#Animal.sound", "calls")).toBe(true);
  });

  it("marks genuinely ambiguous references as ambiguous instead of guessing", () => {
    const ambiguous = query(
      "SELECT src, callee_text FROM edges WHERE confidence = 'ambiguous'",
    ).map((row) => ({ src: row.src, calleeText: row.callee_text }));
    ambiguous.sort((a, b) =>
      `${a.src}|${a.calleeText}`.localeCompare(`${b.src}|${b.calleeText}`),
    );

    expect(ambiguous).toEqual([
      { src: "cls:src/widget.js#Widget", calleeText: "MissingBase" },
      { src: "fn:src/api.js#fetchUser", calleeText: "process" },
      { src: "fn:src/format.js#pad", calleeText: '" ".repeat' },
    ]);
  });

  it("never guesses a resolved target for the ambiguous process() call", () => {
    const guessed = query(
      `SELECT e.id FROM edges e
       JOIN nodes n ON n.id = e.dst
       WHERE e.type = 'calls' AND n.name = 'process'`,
    );
    expect(guessed).toHaveLength(0);
  });

  it("reports consistent summary counts", () => {
    const sqlAmbiguous = query(
      "SELECT COUNT(*) AS n FROM edges WHERE confidence = 'ambiguous'",
    )[0]?.n as number;

    expect(summary.fileCount).toBe(11);
    expect(summary.counts.nodesByType["file"]).toBe(11);
    expect(summary.counts.nodesByType["module"]).toBe(1);
    expect(summary.counts.edgesByType["inherits"]).toBe(3);
    expect(summary.counts.edgesByConfidence["ambiguous"]).toBe(sqlAmbiguous);
    expect(summary.callsResolved).toBeGreaterThan(0);
  });
});
