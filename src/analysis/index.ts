export { findDeadCode } from "./dead-code.js";
export type {
  DeadCodeCandidate,
  DeadCodeConfidence,
  DeadCodeOptions,
} from "./dead-code.js";
export { computeBlastRadius } from "./blast-radius.js";
export type {
  BlastRadiusNode,
  BlastRadiusResult,
  BlastConfidence,
} from "./blast-radius.js";
export { collectGitHistory } from "./git-history.js";
export type { FileHistory, GitHistory } from "./git-history.js";
export { mapTestCoverage } from "./test-coverage.js";
export type {
  TestCoverageResult,
  TestCoverageOptions,
} from "./test-coverage.js";
export {
  scoreFileRisks,
  CHURN_WEIGHT_POINTS,
  COVERAGE_PENALTY_POINTS,
  CHURN_CAP_COMMITS,
} from "./risk.js";
export type { RiskComponents, FileRisk } from "./risk.js";
export { runAnalysis, type AnalysisReport, type AnalysisOptions } from "./analyze.js";
export {
  DEFAULT_TEST_FILE_PATTERNS,
  isEntryFile,
  isTestFile,
} from "./file-kinds.js";
