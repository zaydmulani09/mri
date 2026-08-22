import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph, type GraphStore } from "../src/graph/index.js";
import { findDeadCode } from "../src/analysis/index.js";
import { extractFile } from "../src/extraction/index.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function fixture(...segments: string[]): string {
  return path.join(fixturesDir, ...segments);
}

describe("pass-by-reference extraction", () => {
  it("records value references for const-arrow symbols exactly like function declarations", async () => {
    const result = await extractFile(fixture("javascript", "pass-by-reference.js"));

    expect(result.hasParseErrors).toBe(false);
    const noopRefs = result.references.filter((r) => r.name === "noop");
    expect(noopRefs.map((r) => r.line).sort((a, b) => a - b)).toEqual([9, 10]);

    const destroyRefs = result.references.filter(
      (r) => r.name === "destroyLateRequestResult",
    );
    expect(destroyRefs.map((r) => r.line).sort((a, b) => a - b)).toEqual([8, 10, 13]);

    const callsToDestroy = result.calls.filter((c) => c.name === "destroyLateRequestResult");
    expect(callsToDestroy).toHaveLength(1);
    expect(callsToDestroy[0]).toMatchObject({ kind: "plain", line: 16 });
  }, 30000);

  it("does not treat binding sites or member properties as references", async () => {
    const result = await extractFile(fixture("javascript", "pass-by-reference.js"));

    const declarationLines = result.references
      .filter((r) => r.name === "noop" || r.name === "destroyLateRequestResult")
      .map((r) => r.line);
    expect(declarationLines).not.toContain(1);
    expect(declarationLines).not.toContain(5);
    expect(result.references.some((r) => r.name === "close")).toBe(false);
    expect(result.references.some((r) => r.name === "cleanup")).toBe(false);
  }, 30000);
});

describe("reference edges in the graph", () => {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), "mri-refedges-"));
  let store: GraphStore;

  beforeAll(async () => {
    await fs.cp(fixture("javascript"), tmpRepo, { recursive: true });
    store = await buildAndOpen();
  });

  async function buildAndOpen(): Promise<GraphStore> {
    const dbPath = path.join(tmpRepo, ".mri", "graph.sqlite");
    await buildRepoGraph(tmpRepo, dbPath);
    return openGraph(dbPath);
  }

  it("materializes reference edges only to real same-file symbol nodes", () => {
    const rows = store.db
      .prepare(`SELECT src, dst FROM edges WHERE type = 'references'`)
      .all() as Array<{ src: string; dst: string }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(store.getNode(row.src)).toBeDefined();
      expect(store.getNode(row.dst)).toBeDefined();
    }
  });

  it("gives top-level references the file node as their source (no dangling ids)", async () => {
    store.db.close();
    await fs.writeFile(
      path.join(tmpRepo, "top-level.js"),
      "function topLevelTarget() {\n  return 1;\n}\n\nconst handlers = [topLevelTarget];\n",
      "utf8",
    );
    store = await buildAndOpen();

    const rows = store.db
      .prepare(
        `SELECT e.src, e.dst FROM edges e
         WHERE e.type = 'references' AND e.dst = 'fn:top-level.js#topLevelTarget'`,
      )
      .all() as Array<{ src: string; dst: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.src).toBe("f:top-level.js");
    expect(store.getNode(rows[0]?.src ?? "")).toBeDefined();
  });

  it("keeps const-arrow pass-by-referenced functions out of confirmed-unreferenced", () => {
    const dead = findDeadCode(store);
    const byId = new Map(dead.map((c) => [c.id, c.confidence]));

    expect(byId.get("fn:pass-by-reference.js#noop")).toBe("referenced-but-uncalled");
    expect(byId.get("fn:pass-by-reference.js#registerLateHandlers")).toBe(
      "confirmed-unreferenced",
    );
  });
});
