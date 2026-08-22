import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRepoGraph,
  openGraph,
} from "../src/graph/index.js";
import {
  findDeadCode,
  computeBlastRadius,
  mapTestCoverage,
  collectGitHistory,
  scoreFileRisks,
} from "../src/analysis/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "analysis_repo",
);

function git(cwd: string, args: string[], dateIso?: string): void {
  const env = dateIso
    ? { ...process.env, GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso }
    : { ...process.env };
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86400000).toISOString();

describe("analysis passes", () => {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), "mri-analysis-"));
  const dbPath = path.join(tmpRepo, ".mri", "graph.sqlite");
  let store: ReturnType<typeof openGraph>;

  beforeAll(async () => {
    await fs.cp(fixtureRoot, tmpRepo, { recursive: true });
    git(tmpRepo, ["init"]);
    git(tmpRepo, ["config", "user.email", "zaydmulani@gmail.com"]);
    git(tmpRepo, ["config", "user.name", "Zayd Mulani"]);
    git(tmpRepo, ["add", "-A"]);
    git(tmpRepo, ["commit", "-m", "initial"], daysAgo(400));
    await fs.writeFile(
      path.join(tmpRepo, "src", "hot.js"),
      'export function hot(value) {\n  return value + 1;\n}\n',
      "utf8",
    );
    git(tmpRepo, ["add", "-A"]);
    git(tmpRepo, ["commit", "-m", "hot change 1"], daysAgo(30));
    await fs.writeFile(
      path.join(tmpRepo, "src", "hot.js"),
      'export function hot(value) {\n  return value + 2;\n}\n',
      "utf8",
    );
    git(tmpRepo, ["add", "-A"]);
    git(tmpRepo, ["commit", "-m", "hot change 2"], daysAgo(1));

    await buildRepoGraph(tmpRepo, dbPath);
    store = openGraph(dbPath);
  });

  it("flags dead functions and classes with honest confidence labels", () => {
    const dead = findDeadCode(store);
    const byId = new Map(dead.map((c) => [c.id, c.confidence]));

    expect(byId.get("fn:src/api.js#ghost")).toBe("confirmed-unreferenced");
    expect(byId.get("fn:src/format.js#formatter")).toBe("no-resolved-references");
    expect(byId.get("cls:src/widget.js#Widget")).toBe("confirmed-unreferenced");
    expect(dead).toHaveLength(3);
  });

  it("never flags entry points or exported API as dead", () => {
    const ids = findDeadCode(store).map((c) => c.id);
    expect(ids).not.toContain("fn:src/index.js#main");
    expect(ids).not.toContain("fn:src/api.js#fetchUser");
    expect(ids).not.toContain("cls:src/user.js#User");
  });

  it("computes blast radius with depth over resolved edges only", () => {
    const result = computeBlastRadius(store, "fn:src/format.js#pad");
    const byId = new Map(result.dependents.map((d) => [d.id, d]));

    expect(byId.get("fn:src/format.js#money")).toMatchObject({
      depth: 1,
      via: "confirmed",
    });
    expect(byId.get("fn:src/api.js#fetchUser")).toMatchObject({
      depth: 1,
      via: "confirmed",
    });
    expect(byId.get("fn:src/index.js#main")).toMatchObject({
      depth: 2,
      via: "confirmed",
    });
    expect(result.dependents.every((d) => d.via === "confirmed")).toBe(true);
  });

  it("reports ambiguous name references without pretending they are confirmed", () => {
    const result = computeBlastRadius(store, "fn:src/process_a.js#process");
    const ambiguous = result.dependents.filter((d) => d.via === "ambiguous-only");

    expect(ambiguous.map((d) => d.id)).toContain("fn:src/api.js#fetchUser");
    for (const dep of ambiguous) {
      expect(dep.relation).toBe("ambiguous-reference");
    }
  });

  it("maps test coverage through the import graph", () => {
    const coverage = mapTestCoverage(store);

    expect(coverage.testFiles.sort()).toEqual([
      "py/test_tool.py",
      "src/api.test.js",
    ]);
    expect(coverage.coveredFiles.sort()).toEqual([
      "py/helpers.py",
      "py/tool.py",
      "src/api.js",
      "src/format.js",
      "src/log.js",
    ]);
    expect(coverage.uncoveredFiles).toContain("src/user.js");
    expect(coverage.uncoveredFiles).toContain("src/hot.js");

    const apiExercise = coverage.exercises.find(
      (e) => e.testFile === "src/api.test.js",
    );
    expect(apiExercise?.covers.sort()).toEqual([
      "src/api.js",
      "src/format.js",
      "src/log.js",
    ]);
    expect(coverage.coverageRatio).toBeCloseTo(5 / 13, 4);
  });

  it("collects per-file churn from git history", () => {
    const history = collectGitHistory(tmpRepo, 90);

    const hot = history.get("src/hot.js");
    expect(hot?.commitsTotal).toBe(3);
    expect(hot?.commitsInWindow).toBe(2);
    expect(hot?.lastModifiedIso).toBeTruthy();

    const cold = history.get("src/cold.js");
    expect(cold?.commitsTotal).toBe(1);
    expect(cold?.commitsInWindow).toBe(0);
  });

  it("scores risk from churn and coverage components", () => {
    const history = collectGitHistory(tmpRepo, 90);
    const coverage = mapTestCoverage(store);
    const risks = scoreFileRisks(history, coverage, 90);

    const hot = risks.find((r) => r.path === "src/hot.js");
    expect(hot?.score).toBe(14 + 30);
    expect(hot?.components.hasTests).toBe(false);
    expect(hot?.components.churnCommits).toBe(2);

    const api = risks.find((r) => r.path === "src/api.js");
    expect(api?.components.hasTests).toBe(true);
    expect(api?.components.coveringTests).toEqual(["src/api.test.js"]);
    expect(api?.score).toBe(0);

    expect(risks[0]?.path).toBe("src/hot.js");
  });
});
