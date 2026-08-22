import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile } from "../src/extraction/index.js";
import { buildRepoGraph, type BuildSummary } from "../src/graph/index.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function fixture(...segments: string[]): string {
  return path.join(fixturesDir, ...segments);
}

describe("extractFile (rust)", () => {
  it("extracts functions, impl methods, traits, use statements and visibility", async () => {
    const result = await extractFile(fixture("rust", "service.rs"));

    expect(result.language).toBe("rust");
    expect(result.hasParseErrors).toBe(false);

    expect(result.functions).toEqual([
      { name: "reset", exported: false, startLine: 25, endLine: 28 },
      { name: "shutdown", exported: true, startLine: 30, endLine: 32 },
      { name: "runner", exported: true, startLine: 34, endLine: 36 },
    ]);

    expect(result.classes).toEqual([
      {
        name: "Handler",
        exported: true,
        methods: [
          { name: "process", startLine: 15, endLine: 18 },
          { name: "store", startLine: 20, endLine: 22 },
        ],
        extends: [],
        startLine: 6,
        endLine: 8,
      },
      {
        name: "Storage",
        exported: true,
        methods: [{ name: "fetch", startLine: 11, endLine: 11 }],
        extends: [],
        startLine: 10,
        endLine: 12,
      },
    ]);

    // Impl methods land after the top-level pass because they attach to
    // their types in a second pass.
    expect(result.calls).toEqual([
      {
        kind: "member",
        object: "HashMap",
        name: "new",
        line: 26,
        container: "reset",
      },
      {
        kind: "plain",
        object: null,
        name: "reset",
        line: 31,
        container: "shutdown",
      },
      {
        kind: "member",
        object: "storage",
        name: "fetch",
        line: 16,
        container: "Handler.process",
      },
      {
        kind: "self",
        object: null,
        name: "store",
        line: 17,
        container: "Handler.process",
      },
      {
        kind: "member",
        object: "data",
        name: "clone",
        line: 17,
        container: "Handler.process",
      },
    ]);

    expect(result.imports).toEqual([
      {
        specifier: "std::collections::HashMap",
        defaultImport: null,
        namespaceImport: "HashMap",
        namedImports: [],
        line: 1,
      },
      {
        specifier: "crate::storage::Repo",
        defaultImport: null,
        namespaceImport: "Repo",
        namedImports: [],
        line: 2,
      },
    ]);

    expect(result.exports).toEqual([]);

    const referenceNames = result.references.map((reference) => reference.name);
    expect(referenceNames).toContain("reset");
    expect(referenceNames).toContain("Handler");
  }, 30000);
});

describe("graph construction (rust_repo)", () => {
  const fixtureRoot = fixture("rust_repo");
  const dbPath = path.join(
    os.tmpdir(),
    `mri-rust-graph-test-${process.pid}-${Date.now()}.sqlite`,
  );
  let summary: BuildSummary;
  let db: DatabaseSync;

  beforeAll(async () => {
    summary = await buildRepoGraph(fixtureRoot, dbPath);
    db = new DatabaseSync(dbPath);
  });

  function query(sql: string): Array<Record<string, string | number | null>> {
    return db.prepare(sql).all() as Array<
      Record<string, string | number | null>
    >;
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

  it("builds the rust repo graph without parse errors", () => {
    expect(summary.parseErrorFiles).toBe(0);
    expect(summary.fileCount).toBe(2);
  });

  it("creates nodes for rust files, types and impl methods", () => {
    expect(nodeExists("f:src/lib.rs")).toBe(true);
    expect(nodeExists("f:src/geom.rs")).toBe(true);

    expect(nodeExists("cls:src/geom.rs#Shape")).toBe(true);
    expect(nodeExists("cls:src/geom.rs#Circle")).toBe(true);
    expect(nodeExists("m:src/geom.rs#Circle.area")).toBe(true);
    expect(nodeExists("m:src/geom.rs#Circle.new")).toBe(true);
    expect(nodeExists("fn:src/geom.rs#default_radius")).toBe(true);
    expect(nodeExists("fn:src/lib.rs#circle_area")).toBe(true);
    expect(nodeExists("fn:src/lib.rs#describe_default")).toBe(true);
  });

  it("resolves trait impls as inheritance and same-file plain calls", () => {
    expect(edgeExists("cls:src/geom.rs#Circle", "cls:src/geom.rs#Shape", "inherits")).toBe(
      true,
    );
    expect(
      edgeExists("m:src/geom.rs#Circle.area", "fn:src/geom.rs#scale_factor", "calls"),
    ).toBe(true);
  });

  it("resolves cross-module calls via crate-path imports", () => {
    expect(edgeExists("f:src/lib.rs", "f:src/geom.rs", "imports")).toBe(true);
    expect(
      edgeExists(
        "fn:src/lib.rs#describe_default",
        "fn:src/geom.rs#default_radius",
        "calls",
      ),
    ).toBe(true);
  });

  it("resolves external crate calls to explicit external stubs", () => {
    expect(nodeExists("xf:std::collections::HashMap#new", true)).toBe(true);
    expect(
      edgeExists("fn:src/lib.rs#circle_area", "xf:std::collections::HashMap#new", "calls"),
    ).toBe(true);
  });

  it("marks dyn trait dispatch as ambiguous instead of guessing", () => {
    const ambiguous = query(
      `SELECT src, callee_text FROM edges
       WHERE confidence = 'ambiguous' AND dst IS NULL AND type = 'calls'
       ORDER BY src`,
    );
    const dispatchEdge = ambiguous.find(
      (row) =>
        row["src"] === "fn:src/lib.rs#describe" && row["callee_text"] === "s.area",
    );
    expect(dispatchEdge).toBeDefined();

    const resolvedFromDescribe = query(
      `SELECT id FROM edges
       WHERE confidence = 'resolved' AND type = 'calls'
         AND src = 'fn:src/lib.rs#describe'`,
    );
    expect(resolvedFromDescribe).toHaveLength(0);

    // Associated-function calls through a binding stay honest too: the
    // target is an impl method, which the exported-symbol lookup cannot
    // prove, so Circle::new(r) must not resolve to anything.
    const resolvedNewCalls = query(
      `SELECT id FROM edges
       WHERE confidence = 'resolved' AND type = 'calls' AND callee_text LIKE '%new%'
         AND src = 'fn:src/lib.rs#circle_area'`,
    );
    expect(resolvedNewCalls).toHaveLength(0);
  });
});
