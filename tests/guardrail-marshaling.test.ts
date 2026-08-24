import { describe, expect, it } from "vitest";
import type { Allowlist } from "../src/guardrail/index.js";
import { emptyResourceGrants } from "../src/guardrail/index.js";
import { checkAndRun } from "../src/guardrail/interceptor.js";

// Adapted from the b15 marshaling regressions (originally written against the
// node:vm backend). The execution backend is now an isolated-vm V8 isolate:
// the completion value is serialized IN-ISULATE before any verdict, stubs are
// in-isolate functions whose argument marshaling fires guest-side, and
// recorded denials always win over generic wrappers. Same intents, new path.

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

describe("containment violations crossing the marshaling boundary", () => {
  it("converts delayed getter violations on the RETURNED value into blocked", async () => {
    const result = await checkAndRun(
      "({ get token() { const p = globalThis.process; return p.env.DEMO_SECRET; } })",
      allowlist,
    );
    expect(result.outcome).toBe("blocked");
    if (result.outcome !== "blocked") return;
    expect(result.breaches[0]?.message).toContain("DEMO_SECRET");
  });

  it("propagates violations fired while marshaling arguments into a stub", async () => {
    // The isolate's granted-symbol stub serializes its arguments, which
    // forces sandbox getters to fire. The getter reaches the guarded process
    // shim, so the violation must cross back as a containment breach.
    const result = await checkAndRun(
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
    );
    expect(result.outcome).toBe("blocked");
    if (result.outcome !== "blocked") return;
    const breach = result.breaches[0];
    expect(breach?.kind).toBe("ungranted-resource");
    expect(breach?.message).toContain("DEMO_SECRET");
  });

  it("keeps direct env access statically blocked (contrast case)", async () => {
    const result = await checkAndRun("process.env.DEMO_SECRET", allowlist);
    expect(result.outcome).toBe("blocked");
  });

  it("does not over-block values that serialize cleanly", async () => {
    const result = await checkAndRun(
      "computeTotal([{ priceCents: 100 }, 7])",
      allowlist,
    );
    expect(result.outcome).toBe("executed");
    if (result.outcome !== "executed") return;
    expect(result.value).toMatchObject({ mri: "granted-symbol-stub" });
  });

  it("never throws across the API boundary - failures are verdicts", async () => {
    // The node:vm backend exposed isContainmentViolation for host-side
    // marshaling code. The isolate backend makes that unnecessary by
    // construction: completion values are serialized in-isolate and every
    // failure mode becomes a structured verdict instead of an exception.
    const hostile = [
      'JSON.parse("{broken")',
      "while (true) {}",
      "process.env.NOPE",
    ];
    for (const code of hostile) {
      let threw = false;
      try {
        const result = await checkAndRun(code, allowlist, { timeoutMs: 400 });
        expect(result.outcome).toBe("blocked");
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    }
  });
});
