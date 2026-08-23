import { describe, expect, it } from "vitest";
import vm from "node:vm";
import type { Allowlist } from "../src/guardrail/index.js";
import { emptyResourceGrants } from "../src/guardrail/index.js";
import { checkAndRun, isContainmentViolation } from "../src/guardrail/interceptor.js";

const allowlist: Allowlist = {
  policy: "fail-closed",
  scope: { id: "fn:test#scope", type: "function", name: "scope", path: null },
  symbols: [
    {
      nodeId: "fn:test#computeTotal",
      name: "computeTotal",
      kind: "function",
      path: null,
      external: false,
      via: "defines",
    },
  ],
  files: [],
  resources: emptyResourceGrants(),
  unresolved: [],
};

// Host-side stub matching what mri guard installs: returns a plain marker
// object without swallowing anything thrown while evaluating arguments.
function contextWithStubs(): vm.Context {
  const sandbox: Record<string, unknown> = {
    console: { log: () => {}, error: () => {}, warn: () => {} },
    computeTotal: (...callArgs: unknown[]) => ({
      mri: "granted-symbol-stub",
      args: callArgs,
    }),
  };
  return vm.createContext(sandbox);
}

describe("containment violations crossing the marshaling boundary", () => {
  it("converts delayed getter violations on the RETURNED value into blocked", () => {
    const result = checkAndRun(
      "({ get token() { const p = globalThis.process; return p.env.DEMO_SECRET; } })",
      allowlist,
    );
    expect(result.outcome).toBe("blocked");
    if (result.outcome !== "blocked") return;
    expect(result.breaches[0]?.message).toContain("DEMO_SECRET");
  });

  it("propagates violations fired while marshaling arguments into a stub", () => {
    // Marshaling emulation: mri guard's stubs serialize their arguments, which
    // forces sandbox getters to fire. The getter reaches the sandbox's guarded
    // process proxy, so the violation must cross back as a containment breach.
    const context = vm.createContext({
      computeTotal: (...args: unknown[]) => {
        JSON.stringify(args);
        return args.length;
      },
    });
    const result = checkAndRun(
      `
const sneaky = {
  get priceCents() {
    const p = globalThis.process;
    return p.env.DEMO_SECRET;
  },
};
computeTotal([sneaky]);
`,
      allowlist,
      context,
    );
    expect(result.outcome).toBe("blocked");
    if (result.outcome !== "blocked") return;
    const breach = result.breaches[0];
    expect(breach?.kind).toBe("ungranted-resource");
    expect(breach?.message).toContain("DEMO_SECRET");
  });

  it("keeps direct env access statically blocked (contrast case)", () => {
    const result = checkAndRun("process.env.DEMO_SECRET", allowlist);
    expect(result.outcome).toBe("blocked");
  });

  it("does not over-block values that serialize cleanly", () => {
    const result = checkAndRun(
      "computeTotal([{ priceCents: 100 }, 7])",
      allowlist,
      contextWithStubs(),
    );
    expect(result.outcome).toBe("executed");
    if (result.outcome !== "executed") return;
    expect(result.value).toMatchObject({ mri: "granted-symbol-stub" });
  });

  it("exposes a reliable type guard for host-side marshaling code", () => {
    expect(isContainmentViolation(new Error("plain"))).toBe(false);
    expect(isContainmentViolation(undefined)).toBe(false);
  });
});
