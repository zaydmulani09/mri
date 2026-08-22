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

describe("extractFile (go)", () => {
  it("extracts functions, structs with receiver methods, interfaces and imports", async () => {
    const result = await extractFile(fixture("go", "service.go"));

    expect(result.language).toBe("go");
    expect(result.hasParseErrors).toBe(false);

    expect(result.functions).toEqual([
      { name: "reset", exported: false, startLine: 44, endLine: 46 },
      { name: "Shutdown", exported: true, startLine: 48, endLine: 50 },
      { name: "Run", exported: true, startLine: 52, endLine: 54 },
    ]);

    expect(result.classes).toEqual([
      {
        name: "Base",
        exported: true,
        methods: [],
        extends: [],
        startLine: 15,
        endLine: 17,
      },
      {
        name: "Handler",
        exported: true,
        methods: [
          { name: "Process", startLine: 30, endLine: 37 },
          { name: "store", startLine: 39, endLine: 42 },
        ],
        extends: ["Base"],
        startLine: 20,
        endLine: 23,
      },
      {
        name: "Repo",
        exported: true,
        methods: [{ name: "Fetch", startLine: 27, endLine: 27 }],
        extends: [],
        startLine: 26,
        endLine: 28,
      },
    ]);

    // Method calls land after the top-level pass because receiver methods
    // attach to their types in a second pass.
    expect(result.calls).toEqual([
      {
        kind: "plain",
        object: null,
        name: "reset",
        line: 49,
        container: "Shutdown",
      },
      {
        kind: "member",
        object: "r",
        name: "Fetch",
        line: 31,
        container: "Handler.Process",
      },
      {
        kind: "member",
        object: "fmt",
        name: "Errorf",
        line: 33,
        container: "Handler.Process",
      },
      {
        kind: "self",
        object: null,
        name: "store",
        line: 35,
        container: "Handler.Process",
      },
      {
        kind: "member",
        object: "api",
        name: "Save",
        line: 41,
        container: "Handler.store",
      },
    ]);

    expect(result.imports).toEqual([
      {
        specifier: "fmt",
        defaultImport: null,
        namespaceImport: "fmt",
        namedImports: [],
        line: 4,
      },
      {
        specifier: "example.com/other/api",
        defaultImport: null,
        namespaceImport: "api",
        namedImports: [],
        line: 6,
      },
      {
        specifier: "embed",
        defaultImport: null,
        namespaceImport: null,
        namedImports: [],
        line: 7,
      },
    ]);

    // Go has no export syntax; visibility is the capitalization convention,
    // so there is nothing for an exports list to carry.
    expect(result.exports).toEqual([]);

    const referenceNames = result.references.map((reference) => reference.name);
    expect(referenceNames).toContain("Base");
    expect(referenceNames).toContain("reset");
  }, 30000);
});

describe("graph construction (go_repo)", () => {
  const fixtureRoot = fixture("go_repo");
  const dbPath = path.join(
    os.tmpdir(),
    `mri-go-graph-test-${process.pid}-${Date.now()}.sqlite`,
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

  it("builds the go repo graph without parse errors", () => {
    expect(summary.parseErrorFiles).toBe(0);
    expect(summary.fileCount).toBe(2);
  });

  it("creates nodes for go files, package types and receiver methods", () => {
    expect(nodeExists("f:geom/shape.go")).toBe(true);
    expect(nodeExists("f:app/main.go")).toBe(true);

    expect(nodeExists("cls:geom/shape.go#Shape")).toBe(true);
    expect(nodeExists("cls:geom/shape.go#Circle")).toBe(true);
    expect(nodeExists("cls:geom/shape.go#Rect")).toBe(true);
    expect(nodeExists("m:geom/shape.go#Shape.Area")).toBe(true);
    expect(nodeExists("m:geom/shape.go#Circle.Area")).toBe(true);
    expect(nodeExists("m:geom/shape.go#Rect.Area")).toBe(true);
    expect(nodeExists("fn:geom/shape.go#Describe")).toBe(true);
    expect(nodeExists("fn:geom/shape.go#describeKind")).toBe(true);
    expect(nodeExists("fn:app/main.go#main")).toBe(true);
    expect(nodeExists("fn:app/main.go#Greeting")).toBe(true);
  });

  it("resolves same-file plain calls and receiver-self calls", () => {
    expect(
      edgeExists(
        "m:geom/shape.go#Circle.Name",
        "fn:geom/shape.go#describeKind",
        "calls",
      ),
    ).toBe(true);
    expect(
      edgeExists(
        "m:geom/shape.go#Circle.Perimeter",
        "m:geom/shape.go#Circle.Area",
        "calls",
      ),
    ).toBe(true);
  });

  it("resolves cross-package calls via module-path imports", () => {
    expect(edgeExists("f:app/main.go", "f:geom/shape.go", "imports")).toBe(
      true,
    );
    expect(
      edgeExists(
        "fn:app/main.go#Greeting",
        "fn:geom/shape.go#Describe",
        "calls",
      ),
    ).toBe(true);
    expect(
      edgeExists("fn:app/main.go#main", "fn:geom/shape.go#Describe", "calls"),
    ).toBe(true);
    expect(
      edgeExists("fn:app/main.go#main", "fn:app/main.go#Greeting", "calls"),
    ).toBe(true);
  });

  it("resolves external package calls to explicit external stubs", () => {
    expect(nodeExists("xm:fmt", true)).toBe(true);
    expect(nodeExists("xf:fmt#Println", true)).toBe(true);
    expect(nodeExists("xf:strings#ToUpper", true)).toBe(true);
    expect(
      edgeExists("fn:app/main.go#main", "xf:fmt#Println", "calls"),
    ).toBe(true);
    expect(
      edgeExists("fn:app/main.go#main", "xf:strings#ToUpper", "calls"),
    ).toBe(true);
  });

  it("marks interface dispatch as ambiguous instead of guessing", () => {
    const ambiguous = query(
      `SELECT src, callee_text FROM edges
       WHERE confidence = 'ambiguous' AND dst IS NULL AND type = 'calls'
       ORDER BY src`,
    );
    const describeEdge = ambiguous.find(
      (row) =>
        row["src"] === "fn:geom/shape.go#Describe" &&
        row["callee_text"] === "s.Name",
    );
    const greetingEdge = ambiguous.find(
      (row) =>
        row["src"] === "fn:app/main.go#Greeting" &&
        row["callee_text"] === "s.Area",
    );

    expect(describeEdge).toBeDefined();
    expect(greetingEdge).toBeDefined();

    // No resolved edge may exist for those call sites.
    const resolvedToName = query(
      `SELECT id FROM edges
       WHERE confidence = 'resolved' AND type = 'calls'
         AND src = 'fn:geom/shape.go#Describe'`,
    );
    expect(resolvedToName).toHaveLength(0);
  });
});
