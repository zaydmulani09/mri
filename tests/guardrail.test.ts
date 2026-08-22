import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph } from "../src/graph/index.js";
import type { GraphStore } from "../src/graph/index.js";
import {
  emptyResourceGrants,
  generateAllowlist,
  loadResourceConfig,
  parseResourceConfig,
} from "../src/guardrail/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "graph_repo",
);

describe("guardrail allowlist generation", () => {
  const dbPath = path.join(
    os.tmpdir(),
    `mri-guardrail-test-${process.pid}-${Date.now()}.sqlite`,
  );
  let store: GraphStore;

  beforeAll(async () => {
    await buildRepoGraph(fixtureRoot, dbPath);
    store = openGraph(dbPath);
  });

  afterAll(() => {
    store.db.close();
  });

  it("generates a minimal allowlist for a simple local function", () => {
    const allowlist = generateAllowlist("fn:src/format.js#money", store);

    expect(allowlist.policy).toBe("fail-closed");
    expect(allowlist.scope).toEqual({
      id: "fn:src/format.js#money",
      type: "function",
      name: "money",
      path: "src/format.js",
    });
    expect(allowlist.symbols.map((s) => s.nodeId)).toEqual(["fn:src/format.js#pad"]);
    expect(allowlist.files).toEqual([{ nodeId: "f:src/format.js", path: "src/format.js" }]);
    expect(allowlist.resources).toEqual(emptyResourceGrants());
    expect(allowlist.unresolved).toEqual([]);
  });

  it("includes inherited and super-chain targets for a class with inheritance", () => {
    const allowlist = generateAllowlist("cls:py/klass.py#Dog", store);

    expect(allowlist.symbols.map((s) => s.nodeId).sort()).toEqual([
      "cls:py/klass.py#Animal",
      "m:py/klass.py#Animal.sound",
      "m:py/klass.py#Dog.speak",
    ]);

    const animal = allowlist.symbols.find((s) => s.nodeId === "cls:py/klass.py#Animal");
    expect(animal?.via).toBe("inherits");
    const sound = allowlist.symbols.find((s) => s.nodeId === "m:py/klass.py#Animal.sound");
    expect(sound?.via).toBe("calls");
    const ownMethod = allowlist.symbols.find((s) => s.nodeId === "m:py/klass.py#Dog.speak");
    expect(ownMethod?.via).toBe("defines");

    expect(allowlist.files).toEqual([{ nodeId: "f:py/klass.py", path: "py/klass.py" }]);
    expect(allowlist.unresolved).toEqual([]);
  });

  it("includes external module symbols reached through imports", () => {
    const allowlist = generateAllowlist("fn:src/api.js#fetchUser", store);

    const validate = allowlist.symbols.find((s) => s.nodeId === "xf:extlib#validate");
    expect(validate).toMatchObject({ name: "validate", kind: "function", external: true });
  });

  it("excludes ambiguous calls instead of guessing them into the allowlist", () => {
    const allowlist = generateAllowlist("fn:src/api.js#fetchUser", store);

    const symbolIds = allowlist.symbols.map((s) => s.nodeId);
    expect(symbolIds).toContain("fn:src/log.js#log");
    expect(symbolIds).toContain("xf:extlib#validate");
    expect(symbolIds).toContain("fn:src/format.js#pad");
    expect(symbolIds).toContain("fn:src/api.js#helper");

    expect(allowlist.symbols.some((s) => s.name === "process")).toBe(false);
    expect(allowlist.files.some((f) => f.path.includes("process"))).toBe(false);

    expect(allowlist.unresolved).toHaveLength(1);
    expect(allowlist.unresolved[0]).toMatchObject({
      sourceId: "fn:src/api.js#fetchUser",
      calleeText: "process",
    });
  });

  it("excludes ambiguous inheritance targets the same way as ambiguous calls", () => {
    const allowlist = generateAllowlist("cls:src/widget.js#Widget", store);

    expect(allowlist.symbols).toEqual([]);
    expect(allowlist.files.map((f) => f.path)).toEqual(["src/widget.js"]);
    expect(allowlist.unresolved).toHaveLength(1);
    expect(allowlist.unresolved[0]).toMatchObject({
      sourceId: "cls:src/widget.js#Widget",
      calleeText: "MissingBase",
    });
  });

  it("expands file scopes through their defines edges", () => {
    const allowlist = generateAllowlist("f:src/api.js", store);

    const symbolIds = allowlist.symbols.map((s) => s.nodeId);
    expect(symbolIds).toContain("fn:src/api.js#fetchUser");
    expect(symbolIds).toContain("fn:src/api.js#helper");
    expect(symbolIds).toContain("fn:src/log.js#log");
    expect(symbolIds).toContain("fn:src/format.js#pad");
    expect(symbolIds).toContain("xf:extlib#validate");
    expect(symbolIds).toContain("xm:extlib");

    const paths = allowlist.files.map((f) => f.path);
    expect(paths).toContain("src/api.js");
    expect(paths).toContain("src/log.js");
    expect(paths).toContain("src/format.js");

    expect(allowlist.unresolved.map((u) => u.calleeText)).toEqual(["process"]);
  });

  it("merges config-driven resource grants for the scope", async () => {
    const configPath = path.join(os.tmpdir(), `mri-guardrail-config-${process.pid}.json`);
    await fs.writeFile(
      configPath,
      JSON.stringify({
        scopes: {
          "fn:src/api.js#fetchUser": {
            filesystem: [{ path: "/var/cache/mri", access: ["read"] }],
            network: [{ host: "api.example.com", port: 443 }],
            environment: [{ name: "API_TOKEN", access: "read" }],
            subprocess: [{ commands: ["git"] }],
          },
        },
      }),
    );

    try {
      const config = await loadResourceConfig(configPath);
      const allowlist = generateAllowlist("fn:src/api.js#fetchUser", store, {
        resourceConfig: config,
      });

      expect(allowlist.resources).toEqual({
        filesystem: [{ path: "/var/cache/mri", access: ["read"] }],
        network: [{ host: "api.example.com", port: 443 }],
        environment: [{ name: "API_TOKEN", access: "read" }],
        subprocess: [{ commands: ["git"] }],
        categoryLevel: [],
      });

      const unlisted = generateAllowlist("fn:src/format.js#money", store, {
        resourceConfig: config,
      });
      expect(unlisted.resources).toEqual(emptyResourceGrants());
    } finally {
      await fs.rm(configPath, { force: true });
    }
  });

  it("normalizes inline resource grants and rejects conflicting sources", () => {
    const grants = parseResourceConfig({
      scopes: {
        "fn:src/api.js#fetchUser": {
          filesystem: [{ path: "/tmp/x", access: ["write", "read"] }],
        },
      },
    }).scopes["fn:src/api.js#fetchUser"];
    expect(grants?.filesystem[0]?.access).toEqual(["read", "write"]);

    const both = () =>
      generateAllowlist("fn:src/api.js#fetchUser", store, {
        resources: emptyResourceGrants(),
        resourceConfig: { scopes: {} },
      });
    expect(both).toThrow(/not both/);
  });

  it("rejects malformed resource configs instead of partially applying them", () => {
    expect(() => parseResourceConfig({})).toThrow(/'scopes'/);
    expect(() =>
      parseResourceConfig({
        scopes: { "f:src/api.js": { filesytem: [{ path: "/x", access: ["read"] }] } },
      }),
    ).toThrow(/unknown resource category 'filesytem'/);
    expect(() =>
      parseResourceConfig({
        scopes: { "f:src/api.js": { subprocess: [{ commands: [] }] } },
      }),
    ).toThrow(/at least one command/);
  });

  it("throws for unknown scope node ids", () => {
    expect(() => generateAllowlist("fn:nowhere.js#nope", store)).toThrow(/Unknown scope node id/);
  });
});
