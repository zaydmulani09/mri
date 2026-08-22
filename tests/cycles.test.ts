import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph } from "../src/graph/index.js";
import { findDependencyCycles } from "../src/analysis/cycles.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "cycle_repo",
);

describe("dependency cycle detection (cycle_repo)", () => {
  const dbPath = path.join(
    os.tmpdir(),
    `mri-cycle-test-${process.pid}-${Date.now()}.sqlite`,
  );
  let store: ReturnType<typeof openGraph>;

  beforeAll(async () => {
    await buildRepoGraph(fixtureRoot, dbPath);
    store = openGraph(dbPath);
  });

  afterAll(() => {
    store.db.close();
  });

  it("reports the genuine import cycle with its exact path", () => {
    const { importCycles } = findDependencyCycles(store);

    expect(importCycles).toHaveLength(1);
    expect(importCycles[0]?.path).toEqual([
      "f:src/a.js",
      "f:src/b.js",
      "f:src/c.js",
    ]);
    expect(importCycles[0]?.length).toBe(3);
  });

  it("reports the genuine resolved-call cycle once", () => {
    const { callCycles } = findDependencyCycles(store);

    expect(callCycles).toHaveLength(1);
    expect(callCycles[0]?.path).toEqual([
      "fn:src/a.js#pingA",
      "fn:src/b.js#pingB",
      "fn:src/c.js#pingC",
    ]);
  });

  it("does not treat external-module near-misses as cycles", () => {
    const { importCycles } = findDependencyCycles(store);

    for (const cycle of importCycles) {
      for (const node of cycle.path) {
        // The only reported cycle is a/b/c; nothing may involve the
        // external 'cycle-nearmiss-pkg' module or near.js itself.
        expect(node.startsWith("f:src/near.js")).toBe(false);
        expect(node.startsWith("xm:")).toBe(false);
      }
    }
  });

  it("never assembles call cycles through ambiguous edges", () => {
    const { callCycles } = findDependencyCycles(store);

    for (const cycle of callCycles) {
      for (const node of cycle.path) {
        // landing/hop would only close a loop if the ambiguous obj.hop()
        // edge were speculatively traversed.
        expect(node).not.toBe("fn:src/f.js#landing");
        expect(node).not.toBe("fn:src/g.js#hop");
      }
    }
  });
});
