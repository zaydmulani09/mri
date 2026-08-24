import { describe, expect, it } from "vitest";
import { analyzeCode } from "../src/guardrail/code-scan.js";

// Scanner-precision regressions from the adversarial benchmark Suite A
// (examples/benchmark/ADVERSARIAL_REPORT.md): ordinary legitimate code must
// not produce unknown-reference false positives.

describe("code-scan local binding precision", () => {
  it("binds function_declaration parameters (not just the name)", () => {
    const scan = analyzeCode(
      "function helper(items, percent) {\n  return items.length * percent;\n}\nhelper([], 2);",
    );
    expect(scan.identifiers).toEqual([]);
  });

  it("binds generator params and for-of loop-head declarations", () => {
    const scan = analyzeCode(
      "function* pages(items) {\n  yield items.length;\n}\nfor (const p of pages) p;",
    );
    // `pages` (the local generator) and `p` (the loop head) are both
    // bound; nothing else appears in the snippet.
    expect(scan.identifiers).toEqual([]);
  });

  it("binds catch-clause parameters", () => {
    const scan = analyzeCode(
      "try {\n  computeTotal([]);\n} catch (error) {\n  console.log(error);\n}",
    );
    // Scan-level: computeTotal and console are references (grant/safe-global
    // filtering happens in the interceptor). `error` must NOT appear.
    expect(scan.identifiers.map((i) => i.name).sort()).toEqual([
      "computeTotal",
      "console",
    ]);
  });

  it("binds catch destructuring; body refs still need grants", () => {
    const scan = analyzeCode(
      "try {\n  run();\n} catch ({ message, code }) {\n  console.log(message, code);\n}",
    );
    expect(scan.identifiers.map((i) => i.name).sort()).toEqual(["console", "run"]);
  });

  it("still flags genuinely unknown identifiers inside function bodies", () => {
    const scan = analyzeCode("function helper(items) {\n  return mystery(items);\n}");
    expect(scan.identifiers.map((i) => i.name)).toEqual(["mystery"]);
  });

  it("still flags unknown identifiers inside try/catch bodies", () => {
    const scan = analyzeCode("try {\n  run();\n} catch (error) {\n  logError(error);\n}");
    expect(scan.identifiers.map((i) => i.name).sort()).toEqual(["logError", "run"]);
  });
});
