import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeComplexity,
  maxComplexityByPath,
} from "../src/analysis/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "complexity",
);

describe("cyclomatic complexity scoring", () => {
  it("scores javascript functions exactly as hand-counted", async () => {
    const report = await analyzeComplexity(fixtureRoot);
    const js = report.files.find((f) => f.path.endsWith("javascript.js"));
    expect(js?.language).toBe("javascript");

    const cc = (name: string): number | undefined =>
      js?.functions.find((fn) => fn.name === name)?.complexity;

    expect(cc("baseline")).toBe(1);
    expect(cc("branching")).toBe(3);
    expect(cc("loops")).toBe(5);
    expect(cc("dispatch")).toBe(3);
    expect(cc("logic")).toBe(3);
    expect(cc("mixed")).toBe(3);
    expect(cc("render")).toBe(3);
    expect(cc("handler")).toBe(2);

    const anonymous = js?.functions.filter((fn) =>
      fn.name.startsWith("<anonymous>@"),
    );
    expect(anonymous).toHaveLength(1);
    expect(anonymous?.[0]?.complexity).toBe(2);

    expect(js?.functions.some((fn) => fn.name.startsWith("<module>"))).toBe(
      false,
    );
    expect(js?.maxComplexity).toBe(5);
  });

  it("scores python functions exactly as hand-counted", async () => {
    const report = await analyzeComplexity(fixtureRoot);
    const py = report.files.find((f) => f.path.endsWith("python.py"));
    expect(py?.language).toBe("python");

    const cc = (name: string): number | undefined =>
      py?.functions.find((fn) => fn.name === name)?.complexity;

    expect(cc("baseline")).toBe(1);
    expect(cc("branching")).toBe(3);
    expect(cc("loops")).toBe(3);
    expect(cc("logic")).toBe(3);
    expect(cc("mixed")).toBe(4);
    expect(cc("dispatch")).toBe(2);
  });

  it("scores go functions and methods exactly as hand-counted", async () => {
    const report = await analyzeComplexity(fixtureRoot);
    const go = report.files.find((f) => f.path.endsWith("go.go"));
    expect(go?.language).toBe("go");

    const cc = (name: string): number | undefined =>
      go?.functions.find((fn) => fn.name === name)?.complexity;

    expect(cc("Baseline")).toBe(1);
    expect(cc("Branching")).toBe(3);
    expect(cc("Loops")).toBe(3);
    expect(cc("Dispatch")).toBe(3);
    expect(cc("Logic")).toBe(3);
    expect(cc("Watch")).toBe(3);
    expect(cc("Bump")).toBe(2);
  });

  it("scores rust functions and closures exactly as hand-counted", async () => {
    const report = await analyzeComplexity(fixtureRoot);
    const rs = report.files.find((f) => f.path.endsWith("rust.rs"));
    expect(rs?.language).toBe("rust");

    const cc = (name: string): number | undefined =>
      rs?.functions.find((fn) => fn.name === name)?.complexity;

    expect(cc("baseline")).toBe(1);
    expect(cc("branching")).toBe(3);
    expect(cc("loops")).toBe(5);
    expect(cc("dispatch")).toBe(3);
    expect(cc("logic")).toBe(3);
    expect(cc("with_closure")).toBe(2);
    expect(cc("add")).toBe(2);
  });

  it("attributes nested-callback decisions to the innermost function", async () => {
    const report = await analyzeComplexity(fixtureRoot);
    const js = report.files.find((f) => f.path.endsWith("javascript.js"));
    const outer = js?.functions.find((fn) => fn.name === "outer");
    const inner = js?.functions.find((fn) => fn.name.startsWith("<anonymous>@"));

    expect(outer?.complexity).toBe(2);
    expect(inner?.complexity).toBe(2);
    expect(inner!.startLine).toBeGreaterThan(outer!.startLine);
    expect(inner!.endLine).toBeLessThan(outer!.endLine);
  });

  it("aggregates per-file maxima and repo-wide top functions", async () => {
    const report = await analyzeComplexity(fixtureRoot);
    expect(report.files).toHaveLength(4);
    expect(report.totalFunctions).toBe(
      report.files.reduce((sum, f) => sum + f.functions.length, 0),
    );
    expect(report.maxComplexity).toBe(5);
    expect(maxComplexityByPath(report).get("javascript.js")).toBe(5);
    expect(report.topFunctions[0]?.complexity).toBeGreaterThanOrEqual(
      report.topFunctions[report.topFunctions.length - 1]!.complexity,
    );
  });
});
