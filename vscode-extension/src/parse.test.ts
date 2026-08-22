import { describe, expect, it } from "vitest";
import {
  buildAnalyzeSummary,
  classId,
  findEnclosingSymbol,
  functionId,
  guardBreachesFromJson,
  methodId,
  parseBlastRadiusFlat,
  renderSummaryText,
  symbolEntriesFromFile,
  type AnalysisReport,
  type ExtractFileSymbols,
  type GuardJson,
} from "./parse";

describe("symbol ids and entries", () => {
  it("builds ids with posix paths", () => {
    expect(functionId("src/a.ts", "f")).toBe("fn:src/a.ts#f");
    expect(classId("src\\a.ts", "C")).toBe("cls:src/a.ts#C");
    expect(methodId("src/a.ts", "C", "m")).toBe("m:src/a.ts#C.m");
  });

  const file: ExtractFileSymbols = {
    path: "src/api.js",
    language: "javascript",
    hasParseErrors: false,
    functions: [{ name: "helper", exported: false, startLine: 5, endLine: 8 }],
    classes: [
      {
        name: "Widget",
        exported: true,
        startLine: 10,
        endLine: 20,
        methods: [
          { name: "draw", startLine: 11, endLine: 14 },
          { name: "hide", startLine: 15, endLine: 19 },
        ],
      },
    ],
  };

  it("flattens extraction into lensable entries", () => {
    const entries = symbolEntriesFromFile(file);
    expect(entries.map((e) => e.id)).toEqual([
      "fn:src/api.js#helper",
      "cls:src/api.js#Widget",
      "m:src/api.js#Widget.draw",
      "m:src/api.js#Widget.hide",
    ]);
  });

  it("resolves the innermost enclosing symbol (method beats class)", () => {
    const entries = symbolEntriesFromFile(file);
    expect(findEnclosingSymbol(entries, 4)?.id).toBe("fn:src/api.js#helper");
    expect(findEnclosingSymbol(entries, 9)?.id).toBe("cls:src/api.js#Widget");
    expect(findEnclosingSymbol(entries, 12)?.id).toBe("m:src/api.js#Widget.draw");
    expect(findEnclosingSymbol(entries, 21)).toBeNull();
  });
});

describe("blast-radius flat parser", () => {
  it("parses the CLI's default output shape", () => {
    const text = [
      "blast radius of fn:src/core/x.ts#assertAny (function)",
      "dependents: 3 total (2 confirmed, 1 ambiguous-only)",
      "  d1  confirmed     calls                cls:src/core/options.ts#Options [src/core/options.ts]",
      "  d1  confirmed     calls                fn:src/create.ts#create",
      "   ? ambiguous-reference (not confirmed)",
      "",
    ].join("\n");
    const parsed = parseBlastRadiusFlat(text);
    expect(parsed.rootId).toBe("fn:src/core/x.ts#assertAny");
    expect(parsed.total).toBe(3);
    expect(parsed.confirmed).toBe(2);
    expect(parsed.ambiguousOnly).toBe(1);
    expect(parsed.dependents).toEqual([
      {
        depth: 1,
        via: "confirmed",
        relation: "calls",
        id: "cls:src/core/options.ts#Options",
        path: "src/core/options.ts",
        confirmed: true,
      },
      {
        depth: 1,
        via: "confirmed",
        relation: "calls",
        id: "fn:src/create.ts#create",
        path: null,
        confirmed: true,
      },
    ]);
  });

  it("returns empty structure for unparseable text", () => {
    const parsed = parseBlastRadiusFlat("");
    expect(parsed.total).toBe(0);
    expect(parsed.dependents).toEqual([]);
  });
});

describe("guard json mapping", () => {
  it("maps breaches with rule details onto diagnostics rows", () => {
    const payload: GuardJson = {
      outcome: "blocked",
      allowlist: { symbols: 2, files: 2, unresolved: 1 },
      breaches: [
        {
          kind: "ungranted-resource",
          line: 3,
          attempted: 'require-call require("node:fs")',
          message: "'node:fs' provides filesystem access but no grants",
          rule: { area: "resources.filesystem", expected: "at least one grant" },
        },
        {
          kind: "denied-unclassifiable",
          line: 0,
          attempted: "sandbox execution",
          message: "execution could not complete inside the sandbox",
          rule: null,
        },
      ],
    };
    const mapped = guardBreachesFromJson(payload);
    expect(mapped.executed).toBe(false);
    expect(mapped.allowlistSummary).toContain("2 symbol(s)");
    expect(mapped.breaches).toHaveLength(2);
    expect(mapped.breaches[0]?.ruleArea).toBe("resources.filesystem");
    expect(mapped.breaches[1]?.line).toBe(0);
  });

  it("treats clean runs as executed with no breaches", () => {
    const mapped = guardBreachesFromJson({
      outcome: "executed",
      allowlist: { symbols: 1, files: 1, unresolved: 0 },
    });
    expect(mapped.executed).toBe(true);
    expect(mapped.breaches).toEqual([]);
  });
});

describe("analyze summary model", () => {
  const report: AnalysisReport = {
    root: "/repo",
    generatedAt: "2026-08-22T00:00:00.000Z",
    windowDays: 90,
    summary: { fileCount: 12 },
    risks: [],
    topRisks: [
      {
        path: "src/core/options.ts",
        score: 42,
        churnPoints: 42,
        components: { churnCommits: 6, hasTests: true },
      },
      {
        path: "docs/h2c.js",
        score: 37,
        churnPoints: 7,
        components: { churnCommits: 1, hasTests: false },
      },
    ],
    deadCode: [
      {
        id: "fn:src/x.ts#noop",
        type: "function",
        name: "noop",
        path: "src/x.ts",
        confidence: "referenced-but-uncalled",
        note: "referenced but never called",
      },
      {
        id: "cls:docs/a.js#Agent",
        type: "class",
        name: "Agent",
        path: "docs/a.js",
        confidence: "confirmed-unreferenced",
      },
    ],
    coverage: {
      testFiles: ["test/a.ts"],
      sourceFiles: ["src/a.ts", "src/b.ts"],
      coveredFiles: ["src/a.ts"],
      uncoveredFiles: ["src/b.ts"],
      coverageRatio: 0.5,
    },
  };

  it("reduces the report into panel sections grouped by dead-code confidence", () => {
    const summary = buildAnalyzeSummary(report);
    expect(summary.fileCount).toBe(12);
    expect(summary.riskHotspots[0]).toEqual({
      path: "src/core/options.ts",
      score: 42,
      churnCommits: 6,
      hasTests: true,
    });
    expect(Object.keys(summary.deadCodeByConfidence).sort()).toEqual([
      "confirmed-unreferenced",
      "referenced-but-uncalled",
    ]);
    expect(summary.deadCodeByConfidence["referenced-but-uncalled"]?.[0]?.note).toBe(
      "referenced but never called",
    );
    expect(summary.coverage.ratioPercent).toBe("50.0");
    expect(summary.coverage.uncoveredFiles).toEqual(["src/b.ts"]);
  });

  it("renders a stable plain-text digest for the output channel", () => {
    const text = renderSummaryText(buildAnalyzeSummary(report));
    expect(text).toContain("12 files | coverage 50.0% (1/2 source files)");
    expect(text).toContain("RISK HOTSPOTS (top 2, churn window 90d)");
    expect(text).toContain("score  42   [churn 6 commits | tested]");
    expect(text).toContain("[confirmed-unreferenced] cls:docs/a.js#Agent");
    expect(text).toContain("NOT COVERED");
  });

  it("handles empty reports without dividing by zero", () => {
    const empty = buildAnalyzeSummary({
      ...report,
      topRisks: [],
      risks: [],
      deadCode: [],
      summary: { fileCount: 0 },
      coverage: { ...report.coverage!, sourceFiles: [], coveredFiles: [], uncoveredFiles: [], coverageRatio: 0 },
    });
    expect(empty.coverage.ratioPercent).toBe("n/a");
    expect(renderSummaryText(empty)).toContain("coverage n/a%");
  });
});
