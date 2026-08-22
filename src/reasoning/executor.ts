import type { GraphStore, NodeRow } from "../graph/store.js";
import {
  computeBlastRadius,
  findDeadCode,
  mapTestCoverage,
  collectGitHistory,
  scoreFileRisks,
  type BlastRadiusResult,
  type DeadCodeCandidate,
  type GitHistory,
  type TestCoverageResult,
} from "../analysis/index.js";
import type { ReasoningQuery } from "./intent.js";

export interface ReasoningContext {
  store: GraphStore;
  repoRoot: string;
  history: GitHistory;
  coverage: TestCoverageResult;
  windowDays: number;
}

export function buildReasoningContext(
  store: GraphStore,
  repoRoot: string,
  windowDays = 90,
): ReasoningContext {
  return {
    store,
    repoRoot,
    history: collectGitHistory(repoRoot, windowDays),
    coverage: mapTestCoverage(store),
    windowDays,
  };
}

export type Answer =
  | { kind: "blast-radius"; target: NodeRow; result: BlastRadiusResult }
  | {
      kind: "dead-code-check";
      target: NodeRow;
      verdict: "dead-candidate" | "referenced" | "not-a-candidate";
      confidence?: DeadCodeCandidate["confidence"];
    }
  | {
      kind: "riskiest-file";
      scope?: string;
      file: FileRiskSummary | null;
    }
  | {
      kind: "untested";
      scope?: string;
      files: string[];
      totalUncovered: number;
      totalSourceFiles: number;
    }
  | { kind: "target-not-found"; target: string }
  | {
      kind: "ambiguous-target";
      target: string;
      candidates: Array<{ id: string; type: string; path: string | null }>;
    };

export interface FileRiskSummary {
  path: string;
  score: number;
  churnCommits: number;
  windowDays: number;
  hasTests: boolean;
  lastModifiedIso: string | null;
}

export function executeQuery(
  ctx: ReasoningContext,
  query: ReasoningQuery,
): Answer {
  switch (query.type) {
    case "blast-radius":
      return executeBlastRadius(ctx, query.target);
    case "dead-code-check":
      return executeDeadCodeCheck(ctx, query.target);
    case "riskiest-file":
      return executeRiskiestFile(ctx, query.scope);
    case "untested":
      return executeUntested(ctx, query.scope);
  }
}

function executeBlastRadius(ctx: ReasoningContext, target: string): Answer {
  const resolution = resolveTarget(ctx.store, target);
  if (resolution.status === "not-found") {
    return { kind: "target-not-found", target };
  }
  if (resolution.status === "multiple") {
    return { kind: "ambiguous-target", target, candidates: resolution.candidates };
  }
  const result = computeBlastRadius(ctx.store, resolution.node.id);
  return { kind: "blast-radius", target: resolution.node, result };
}

function executeDeadCodeCheck(ctx: ReasoningContext, target: string): Answer {
  const resolution = resolveTarget(ctx.store, target);
  if (resolution.status === "not-found") {
    return { kind: "target-not-found", target };
  }
  if (resolution.status === "multiple") {
    return { kind: "ambiguous-target", target, candidates: resolution.candidates };
  }

  const node = resolution.node;
  if (node.type !== "function" && node.type !== "class" && node.type !== "method") {
    return { kind: "dead-code-check", target: node, verdict: "not-a-candidate" };
  }

  const dead = findDeadCode(ctx.store).find((c) => c.id === node.id);
  if (dead) {
    return {
      kind: "dead-code-check",
      target: node,
      verdict: "dead-candidate",
      confidence: dead.confidence,
    };
  }
  return { kind: "dead-code-check", target: node, verdict: "referenced" };
}

function executeRiskiestFile(ctx: ReasoningContext, scope?: string): Answer {
  const risks = scoreFileRisks(ctx.history, ctx.coverage, ctx.windowDays);
  const scoped = risks.filter((r) => !scope || r.path.startsWith(scope));
  const top = scoped[0];
  if (!top) {
    return { kind: "riskiest-file", scope, file: null };
  }
  return {
    kind: "riskiest-file",
    scope,
    file: {
      path: top.path,
      score: top.score,
      churnCommits: top.components.churnCommits,
      windowDays: ctx.windowDays,
      hasTests: top.components.hasTests,
      lastModifiedIso: top.components.lastModifiedIso,
    },
  };
}

function executeUntested(ctx: ReasoningContext, scope?: string): Answer {
  const files = ctx.coverage.uncoveredFiles.filter(
    (p) => !scope || p.startsWith(scope),
  );
  return {
    kind: "untested",
    scope,
    files,
    totalUncovered: ctx.coverage.uncoveredFiles.length,
    totalSourceFiles: ctx.coverage.sourceFiles.length,
  };
}

type TargetResolution =
  | { status: "found"; node: NodeRow }
  | { status: "multiple"; candidates: Array<{ id: string; type: string; path: string | null }> }
  | { status: "not-found" };

const PATH_LIKE = /[/]|\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|py)$/i;

function resolveTarget(store: GraphStore, target: string): TargetResolution {
  if (PATH_LIKE.test(target)) {
    const fileId = `f:${target}`;
    const exact = store.getNode(fileId);
    if (exact) return { status: "found", node: exact };

    const suffixRows = store.db
      .prepare(
        `SELECT * FROM nodes
         WHERE type = 'file' AND path IS NOT NULL AND external = 0 AND path LIKE ?`,
      )
      .all("%/" + target) as unknown as NodeRow[];
    if (suffixRows.length === 1) return { status: "found", node: suffixRows[0] as NodeRow };
    if (suffixRows.length > 1) return { status: "multiple", candidates: summarize(suffixRows) };
    return { status: "not-found" };
  }

  const symbolRows = store.db
    .prepare(
      `SELECT * FROM nodes
       WHERE name = ? COLLATE NOCASE AND external = 0
         AND type IN ('function', 'class', 'method')`,
    )
    .all(target) as unknown as NodeRow[];
  if (symbolRows.length === 1) return { status: "found", node: symbolRows[0] as NodeRow };
  if (symbolRows.length > 1) return { status: "multiple", candidates: summarize(symbolRows) };

  const fileRows = store.db
    .prepare(
      `SELECT * FROM nodes
       WHERE type = 'file' AND external = 0 AND path IS NOT NULL`,
    )
    .all() as unknown as NodeRow[];

  const basenameMatches = fileRows.filter(
    (row) => row.path === target || (row.path ?? "").endsWith("/" + target),
  );
  if (basenameMatches.length === 1) return { status: "found", node: basenameMatches[0] as NodeRow };
  if (basenameMatches.length > 1) return { status: "multiple", candidates: summarize(basenameMatches) };

  return { status: "not-found" };
}

function summarize(rows: NodeRow[]): Array<{ id: string; type: string; path: string | null }> {
  return rows.slice(0, 10).map((row) => ({
    id: row.id,
    type: row.type,
    path: row.path,
  }));
}
