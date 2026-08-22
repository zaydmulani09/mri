import { promises as fs } from "node:fs";
import path from "node:path";
import { buildRepoGraph, openGraph, type BuildSummary } from "../graph/index.js";
import { findDeadCode, type DeadCodeCandidate } from "./dead-code.js";
import { collectGitHistory } from "./git-history.js";
import { mapTestCoverage, type TestCoverageResult } from "./test-coverage.js";
import { scoreFileRisks, type FileRisk } from "./risk.js";

export interface AnalysisOptions {
  dbPath?: string;
  topN?: number;
  windowDays?: number;
}

export interface AnalysisReport {
  root: string;
  summary: BuildSummary;
  deadCode: DeadCodeCandidate[];
  coverage: TestCoverageResult;
  risks: FileRisk[];
  topRisks: FileRisk[];
  windowDays: number;
}

export async function runAnalysis(
  repoPath: string,
  options: AnalysisOptions = {},
): Promise<AnalysisReport> {
  const root = path.resolve(repoPath);
  const windowDays = options.windowDays ?? 90;
  const topN = options.topN ?? 5;
  const dbPath =
    options.dbPath ?? path.join(root, ".mri", "graph.sqlite");

  await fs.mkdir(path.dirname(path.resolve(dbPath)), { recursive: true });
  const summary = await buildRepoGraph(root, dbPath);

  const store = openGraph(dbPath);
  try {
    const deadCode = findDeadCode(store);
    const coverage = mapTestCoverage(store);
    const history = collectGitHistory(root, windowDays);
    const risks = scoreFileRisks(history, coverage, windowDays);

    return {
      root,
      summary,
      deadCode,
      coverage,
      risks,
      topRisks: risks.slice(0, topN),
      windowDays,
    };
  } finally {
    store.db.close();
  }
}
