import { promises as fs } from "node:fs";
import path from "node:path";
import { buildRepoGraph, openGraph, type BuildSummary } from "../graph/index.js";
import { findDeadCode, type DeadCodeCandidate } from "./dead-code.js";
import { findDependencyCycles, type CycleReport } from "./cycles.js";
import { collectGitHistory } from "./git-history.js";
import { mapTestCoverage, type TestCoverageResult } from "./test-coverage.js";
import {
  analyzeComplexity,
  maxComplexityByPath,
  type ComplexityReport,
} from "./complexity.js";
import { scoreFileRisks, type FileRisk } from "./risk.js";

export interface ArchitectureStats {
  languages: Record<string, number>;
  externalModules: string[];
  ambiguousHotspots: Array<{ reference: string; count: number }>;
  mostImportedFiles: Array<{ path: string; importers: number }>;
}

export interface SecuritySignals {
  unresolvedReferenceCount: number;
  unresolvedReferences: Array<{ reference: string; count: number }>;
  externalDependencies: string[];
  untestedChurningFiles: string[];
  parseErrorFileCount: number;
}

export interface AnalysisOptions {
  dbPath?: string;
  topN?: number;
  windowDays?: number;
}

export interface AnalysisReport {
  root: string;
  generatedAt: string;
  summary: BuildSummary;
  architecture: ArchitectureStats;
  security: SecuritySignals;
  deadCode: DeadCodeCandidate[];
  cycles: CycleReport;
  coverage: TestCoverageResult;
  complexity: ComplexityReport;
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
  const topN = options.topN ?? 10;
  const dbPath =
    options.dbPath ?? path.join(root, ".mri", "graph.sqlite");

  await fs.mkdir(path.dirname(path.resolve(dbPath)), { recursive: true });
  const summary = await buildRepoGraph(root, dbPath);

  const store = openGraph(dbPath);
  try {
    const deadCode = findDeadCode(store);
    const cycles = findDependencyCycles(store);
    const coverage = mapTestCoverage(store);
    const history = collectGitHistory(root, windowDays);
    const complexity = await analyzeComplexity(root);
    const risks = scoreFileRisks(
      history,
      coverage,
      windowDays,
      maxComplexityByPath(complexity),
    );

    const architecture = collectArchitectureStats(store);
    const security: SecuritySignals = {
      unresolvedReferenceCount: architecture.ambiguousHotspots.reduce(
        (sum, h) => sum + h.count,
        0,
      ),
      unresolvedReferences: architecture.ambiguousHotspots,
      externalDependencies: architecture.externalModules,
      untestedChurningFiles: risks
        .filter((r) => !r.components.hasTests && r.components.churnCommits > 0)
        .map((r) => r.path),
      parseErrorFileCount: summary.parseErrorFiles,
    };

    return {
      root,
      generatedAt: new Date().toISOString(),
      summary,
      architecture,
      security,
      deadCode,
      cycles,
      coverage,
      complexity,
      risks,
      topRisks: risks.slice(0, topN),
      windowDays,
    };
  } finally {
    store.db.close();
  }
}

function collectArchitectureStats(store: ReturnType<typeof openGraph>): ArchitectureStats {
  const languages: Record<string, number> = {};
  const langRows = store.db
    .prepare(
      `SELECT language, COUNT(*) AS n FROM nodes
       WHERE type = 'file' AND language IS NOT NULL GROUP BY language`,
    )
    .all() as unknown as Array<{ language: string; n: number }>;
  for (const row of langRows) languages[row.language] = row.n;

  const externalModules = (
    store.db
      .prepare(`SELECT name FROM nodes WHERE type = 'module' ORDER BY name`)
      .all() as unknown as Array<{ name: string }>
  ).map((row) => row.name);

  const ambiguousHotspots = (
    store.db
      .prepare(
        `SELECT callee_text AS reference, COUNT(*) AS n FROM edges
         WHERE confidence = 'ambiguous' AND callee_text IS NOT NULL
         GROUP BY callee_text ORDER BY n DESC LIMIT 6`,
      )
      .all() as unknown as Array<{ reference: string; n: number }>
  ).map((row) => ({ reference: row.reference, count: row.n }));

  const mostImportedFiles = (
    store.db
      .prepare(
        `SELECT dst AS path, COUNT(*) AS n FROM edges
         WHERE type = 'imports' AND confidence = 'resolved' AND dst LIKE 'f:%'
         GROUP BY dst ORDER BY n DESC LIMIT 5`,
      )
      .all() as unknown as Array<{ path: string; n: number }>
  ).map((row) => ({
    path: row.path.slice("f:".length),
    importers: row.n,
  }));

  return {
    languages,
    externalModules,
    ambiguousHotspots,
    mostImportedFiles,
  };
}
