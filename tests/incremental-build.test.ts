import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  buildRepoGraph,
  openGraph,
  type BuildSummary,
} from "../src/graph/index.js";

async function makeFixtureRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mri-incremental-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "a.ts"),
    [
      "export function helperA(value: number): number {",
      "  return value * 2;",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "b.ts"),
    [
      'import { helperA } from "./a.js";',
      "",
      "export function middle(value: number): number {",
      "  return helperA(value) + 1;",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "c.ts"),
    [
      'import { middle } from "./b.js";',
      "",
      "export function top(value: number): number {",
      "  return middle(value);",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "d.py"),
    ["def standalone(x):", "    return x + 1", ""].join("\n"),
  );
  return root;
}

interface NodeDumpRow {
  id: string;
  type: string;
  name: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
  external: number;
  exported: number;
  language: string | null;
}

interface EdgeDumpRow {
  src: string;
  dst: string | null;
  type: string;
  line: number | null;
  callee_text: string | null;
  confidence: string;
}

function canonicalGraph(dbPath: string): {
  nodes: NodeDumpRow[];
  edges: EdgeDumpRow[];
} {
  const db = new DatabaseSync(dbPath);
  try {
    const nodes = db
      .prepare(
        `SELECT id, type, name, path, start_line, end_line, external, exported, language
         FROM nodes ORDER BY id`,
      )
      .all() as NodeDumpRow[];
    const edges = db
      .prepare(
        `SELECT src, dst, type, line, callee_text, confidence
         FROM edges ORDER BY src, dst, type, line, callee_text, confidence`,
      )
      .all() as EdgeDumpRow[];
    return { nodes, edges };
  } finally {
    db.close();
  }
}

describe("incremental graph rebuilds", () => {
  let fixtureRoot: string;
  let dbPath: string;

  beforeEach(async () => {
    fixtureRoot = await makeFixtureRepo();
    dbPath = path.join(fixtureRoot, ".mri", "graph.sqlite");
  });

  afterEach(async () => {
    await fs.rm(fixtureRoot, { force: true, recursive: true });
  });

  async function freshFullBuild(): Promise<BuildSummary> {
    const scratchDb = path.join(fixtureRoot, ".mri", "full-check.sqlite");
    await fs.rm(scratchDb, { force: true });
    return buildRepoGraph(fixtureRoot, scratchDb);
  }

  function expectGraphsIdentical(a: BuildSummary["dbPath"], b: BuildSummary["dbPath"]): void {
    const left = canonicalGraph(a);
    const right = canonicalGraph(b);
    expect(right.nodes).toEqual(left.nodes);
    expect(right.edges).toEqual(left.edges);
  }

  it("full build then incremental build after modifying one file yields an identical graph", async () => {
    await buildRepoGraph(fixtureRoot, dbPath);

    // Modify b.ts: add an exported function that calls helperA again.
    await fs.writeFile(
      path.join(fixtureRoot, "src", "b.ts"),
      [
        'import { helperA } from "./a.js";',
        "",
        "export function middle(value: number): number {",
        "  return helperA(value) + 1;",
        "}",
        "",
        "export function extra(value: number): number {",
        "  return helperA(value * 3);",
        "}",
        "",
      ].join("\n"),
    );

    const summary = await buildRepoGraph(fixtureRoot, dbPath, { incremental: true });

    expect(summary.stats.mode).toBe("incremental");
    expect(summary.stats.changedFiles).toBe(1);
    expect(summary.stats.addedFiles).toBe(0);
    expect(summary.stats.removedFiles).toBe(0);
    // c.ts imports b.ts, so it is conservatively re-extracted as a dependent.
    expect(summary.stats.dependentFiles).toBe(1);
    expect(summary.stats.reextractedFiles).toBe(2);
    expect(summary.stats.cachedFiles).toBe(2);

    const reference = await freshFullBuild();
    expectGraphsIdentical(reference.dbPath, dbPath);

    // And the modification itself is reflected.
    const store = openGraph(dbPath);
    try {
      expect(store.getNode("fn:src/b.ts#extra")).toBeDefined();
    } finally {
      store.db.close();
    }
  });

  it("deleting a source file drops its symbols and keeps the graph consistent", async () => {
    await buildRepoGraph(fixtureRoot, dbPath);

    await fs.rm(path.join(fixtureRoot, "src", "a.ts"));

    const summary = await buildRepoGraph(fixtureRoot, dbPath, { incremental: true });
    expect(summary.stats.mode).toBe("incremental");
    expect(summary.stats.removedFiles).toBe(1);

    const store = openGraph(dbPath);
    try {
      const stale = store.db
        .prepare("SELECT COUNT(*) AS n FROM nodes WHERE path = 'src/a.ts'")
        .get() as { n: number };
      expect(stale.n).toBe(0);
    } finally {
      store.db.close();
    }

    const reference = await freshFullBuild();
    expectGraphsIdentical(reference.dbPath, dbPath);
  });

  it("adding a file picks it up incrementally", async () => {
    await buildRepoGraph(fixtureRoot, dbPath);

    await fs.writeFile(
      path.join(fixtureRoot, "src", "e.ts"),
      [
        'import { helperA } from "./a.js";',
        "",
        "export function late(value: number): number {",
        "  return helperA(value);",
        "}",
        "",
      ].join("\n"),
    );

    const summary = await buildRepoGraph(fixtureRoot, dbPath, { incremental: true });
    expect(summary.stats.addedFiles).toBe(1);

    const reference = await freshFullBuild();
    expectGraphsIdentical(reference.dbPath, dbPath);
  });

  it("rebuilding with no changes caches everything and changes nothing", async () => {
    await buildRepoGraph(fixtureRoot, dbPath);
    const before = canonicalGraph(dbPath);

    const summary = await buildRepoGraph(fixtureRoot, dbPath, { incremental: true });
    expect(summary.stats.mode).toBe("incremental");
    expect(summary.stats.cachedFiles).toBe(4);
    expect(summary.stats.reextractedFiles).toBe(0);
    expect(summary.stats.changedFiles).toBe(0);
    expect(summary.stats.addedFiles).toBe(0);
    expect(summary.stats.removedFiles).toBe(0);

    const after = canonicalGraph(dbPath);
    expect(after).toEqual(before);
  });

  it("incremental mode falls back to a full-equivalent rebuild against a foreign database", async () => {
    // First build into db A (so hashes exist), then point incremental mode at
    // a database built for a different root: everything must be re-parsed.
    await buildRepoGraph(fixtureRoot, dbPath);

    const foreignDb = path.join(os.tmpdir(), `mri-foreign-${process.pid}.sqlite`);
    await fs.rm(foreignDb, { force: true });
    try {
      const first = await buildRepoGraph(fixtureRoot, foreignDb, { incremental: true });
      expect(first.stats.mode).toBe("full");

      await fs.writeFile(
        path.join(fixtureRoot, "src", "a.ts"),
        [
          "export function helperA(value: number): number {",
          "  return value * 4;",
          "}",
          "",
        ].join("\n"),
      );
      const second = await buildRepoGraph(fixtureRoot, foreignDb, { incremental: true });
      expect(second.stats.mode).toBe("incremental");

      const reference = await freshFullBuild();
      expectGraphsIdentical(reference.dbPath, second.dbPath);
    } finally {
      await fs.rm(foreignDb, { force: true });
    }
  });

  it("default builds stay full-mode and destructive", async () => {
    await buildRepoGraph(fixtureRoot, dbPath);
    const summary = await buildRepoGraph(fixtureRoot, dbPath);
    expect(summary.stats.mode).toBe("full");
    expect(summary.fileCount).toBe(4);
  });
});
