import type { GitHistory } from "./git-history.js";
import type { TestCoverageResult } from "./test-coverage.js";

export const CHURN_WEIGHT_POINTS = 70;
export const COVERAGE_PENALTY_POINTS = 30;
export const CHURN_CAP_COMMITS = 10;
export const COMPLEXITY_WEIGHT_POINTS = 30;
export const COMPLEXITY_CAP = 15;

export interface RiskComponents {
  churnCommits: number;
  commitsTotal: number;
  windowDays: number;
  lastModifiedIso: string | null;
  untracked: boolean;
  hasTests: boolean;
  coveringTests: string[];
  maxComplexity: number;
}

export interface FileRisk {
  path: string;
  score: number;
  churnPoints: number;
  coveragePenalty: number;
  complexityPoints: number;
  components: RiskComponents;
}

export function scoreFileRisks(
  history: GitHistory,
  coverage: TestCoverageResult,
  windowDays: number,
  maxComplexityByPath?: ReadonlyMap<string, number>,
): FileRisk[] {
  const coveringTests = new Map<string, string[]>();
  for (const exercise of coverage.exercises) {
    for (const sourcePath of exercise.covers) {
      const list = coveringTests.get(sourcePath) ?? [];
      list.push(exercise.testFile);
      coveringTests.set(sourcePath, list);
    }
  }

  const risks: FileRisk[] = [];
  for (const path of coverage.sourceFiles) {
    const fileHistory = history.get(path);
    const churnCommits = fileHistory?.commitsInWindow ?? 0;
    const churnPoints = Math.round(
      (Math.min(churnCommits, CHURN_CAP_COMMITS) / CHURN_CAP_COMMITS) *
        CHURN_WEIGHT_POINTS,
    );
    const tests = coveringTests.get(path) ?? [];
    const hasTests = tests.length > 0;
    const coveragePenalty = hasTests ? 0 : COVERAGE_PENALTY_POINTS;
    const maxComplexity = maxComplexityByPath?.get(path) ?? 0;
    const complexityPoints =
      maxComplexity <= 0
        ? 0
        : Math.round(
            (Math.min(maxComplexity, COMPLEXITY_CAP) / COMPLEXITY_CAP) *
              COMPLEXITY_WEIGHT_POINTS,
          );

    risks.push({
      path,
      score: churnPoints + coveragePenalty + complexityPoints,
      churnPoints,
      coveragePenalty,
      complexityPoints,
      components: {
        churnCommits,
        commitsTotal: fileHistory?.commitsTotal ?? 0,
        windowDays,
        lastModifiedIso: fileHistory?.lastModifiedIso ?? null,
        untracked: !fileHistory,
        hasTests,
        coveringTests: tests.sort(),
        maxComplexity,
      },
    });
  }

  return risks.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path),
  );
}
