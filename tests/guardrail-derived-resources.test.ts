import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph } from "../src/graph/index.js";
import type { GraphStore } from "../src/graph/index.js";
import {
  emptyResourceGrants,
  generateAllowlist,
} from "../src/guardrail/index.js";
import { checkAndRun } from "../src/guardrail/interceptor.js";

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("graph-derived resource grants", () => {
  const dbPath = path.join(
    os.tmpdir(),
    `mri-derived-resources-${process.pid}-${Date.now()}.sqlite`,
  );
  const fixtureDbPath = path.join(
    os.tmpdir(),
    `mri-derived-resources-fixture-${process.pid}-${Date.now()}.sqlite`,
  );
  let store: GraphStore;
  let fixtureStore: GraphStore;

  beforeAll(async () => {
    await buildRepoGraph(path.join(fixturesRoot, "guardrail_repo"), dbPath);
    store = openGraph(dbPath);
    await buildRepoGraph(path.join(fixturesRoot, "graph_repo"), fixtureDbPath);
    fixtureStore = openGraph(fixtureDbPath);
  });

  afterAll(() => {
    store.db.close();
    fixtureStore.db.close();
  });

  it(``, async () => {
    const allowlist = generateAllowlist("fn:src/storage.js#loadSettings", store);
    expect(allowlist.derivedResources).toEqual([
      { category: "filesystem", viaModule: "node:fs", origin: "graph-import" },
    ]);
    expect(allowlist.resources.categoryLevel).toEqual(allowlist.derivedResources);
    expect(allowlist.resources.filesystem).toEqual([]);
  });

  it(``, async () => {
    const allowlist = generateAllowlist("f:src/storage.js", store);
    expect(allowlist.derivedResources).toEqual([
      { category: "filesystem", viaModule: "node:fs", origin: "graph-import" },
    ]);
  });

  it("derives network and subprocess grants from builtin imports", async () => {
    const net = generateAllowlist("fn:src/net.js#ping", store);
    expect(net.derivedResources).toEqual([
      { category: "network", viaModule: "https", origin: "graph-import" },
    ]);

    const jobs = generateAllowlist("fn:src/jobs.js#runJob", store);
    expect(jobs.derivedResources).toEqual([
      { category: "subprocess", viaModule: "child_process", origin: "graph-import" },
    ]);
  });

  it("does not derive anything for scopes without resource-touching imports", async () => {
    const pure = generateAllowlist("fn:src/pure.js#pure", store);
    expect(pure.derivedResources).toEqual([]);
    expect(pure.resources).toEqual(emptyResourceGrants());
  });

  it(``, async () => {
    const allowlist = generateAllowlist("fn:src/sneaky.js#sneaky", store);
    expect(allowlist.derivedResources).toEqual([]);
    expect(allowlist.unresolved.map((u) => u.calleeText)).toContain("require");
  });

  it(``, async () => {
    const allowlist = generateAllowlist("fn:py/osuser.py#home_dir", store);
    expect(allowlist.derivedResources).toEqual([]);
  });

  it(``, async () => {
    const allowlist = generateAllowlist("fn:src/storage.js#loadSettings", store, {
      resources: {
        ...emptyResourceGrants(),
        environment: [{ name: "STORAGE_ROOT", access: "read" }],
      },
    });

    expect(allowlist.resources.environment).toEqual([
      { name: "STORAGE_ROOT", access: "read" },
    ]);
    expect(allowlist.resources.categoryLevel).toEqual([
      { category: "filesystem", viaModule: "node:fs", origin: "graph-import" },
    ]);
    expect(allowlist.derivedResources).toEqual([
      { category: "filesystem", viaModule: "node:fs", origin: "graph-import" },
    ]);
  });

  it(``, async () => {
    const allowlist = generateAllowlist("fn:src/api.js#fetchUser", fixtureStore);
    expect(allowlist.derivedResources).toEqual([]);
    expect(allowlist.resources).toEqual(emptyResourceGrants());
  });

  it("lets derived grants through the interceptor gate and keeps others closed", async () => {
    const storage = generateAllowlist("fn:src/storage.js#loadSettings", store);
    const allowed = await checkAndRun("require('node:fs')", storage);
    expect(allowed.outcome).toBe("executed");

    const sneaky = generateAllowlist("fn:src/sneaky.js#sneaky", store);
    const blocked = await checkAndRun("require('dns')", sneaky);
    if (blocked.outcome !== "blocked") throw new Error("expected block");
    expect(blocked.breaches[0]).toMatchObject({
      kind: "ungranted-resource",
      rule: { area: "resources.network", expected: "at least one resources.network grant" },
    });
  });
});
