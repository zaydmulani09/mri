import type { GraphStore } from "../graph/store.js";
import {
  computeBlastRadius,
  findDeadCode,
  scoreFileRisks,
  type BlastRadiusResult,
  type DeadCodeCandidate,
} from "../analysis/index.js";
import type { ReasoningContext } from "../reasoning/index.js";

export interface McpContext {
  store: GraphStore;
  repoRoot: string;
  history: Map<string, { commitsTotal: number; commitsInWindow: number; lastModifiedIso: string | null }>;
  coverage: {
    testFiles: string[];
    sourceFiles: string[];
    coveredFiles: string[];
    uncoveredFiles: string[];
    exercises: Array<{ testFile: string; covers: string[] }>;
    coverageRatio: number;
  };
  windowDays: number;
}

export function mcpContextFromReasoning(reasoning: ReasoningContext): McpContext {
  return {
    store: reasoning.store,
    repoRoot: reasoning.repoRoot,
    history: reasoning.history,
    coverage: reasoning.coverage,
    windowDays: reasoning.windowDays,
  };
}

export interface ToolResult {
  structured: unknown;
}

export function runTool(
  ctx: McpContext,
  name: string,
  args: Record<string, unknown>,
): ToolResult {
  switch (name) {
    case "blast-radius":
      return { structured: blastRadius(ctx, args) };
    case "is-dead-code":
      return { structured: isDeadCode(ctx, args) };
    case "riskiest-files":
      return { structured: riskiestFiles(ctx, args) };
    case "whats-not-tested":
      return { structured: whatsNotTested(ctx, args) };
    case "find-symbol":
      return { structured: findSymbol(ctx, args) };
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required string argument: ${key}`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function blastRadius(ctx: McpContext, args: Record<string, unknown>): BlastRadiusResult & {
  note: string;
} {
  const nodeId = requireString(args, "node_id");
  if (!ctx.store.getNode(nodeId)) {
    throw new Error(`unknown node id: ${nodeId}`);
  }
  const result = computeBlastRadius(ctx.store, nodeId);
  const confirmed = result.dependents.filter((d) => d.via === "confirmed").length;
  return {
    ...result,
    note:
      `dependents split: ${confirmed} confirmed, ${result.dependents.length - confirmed} ` +
      "ambiguous-only. Ambiguous entries matched by name through unresolved references.",
  };
}

interface DeadCodeAnswer {
  node_id: string;
  found: boolean;
  verdict: "dead-candidate" | "referenced" | "not-a-candidate" | "not-found";
  confidence?: DeadCodeCandidate["confidence"];
  explanation: string;
}

function isDeadCode(ctx: McpContext, args: Record<string, unknown>): DeadCodeAnswer {
  const nodeId = requireString(args, "node_id");
  const node = ctx.store.getNode(nodeId);
  if (!node || node.external === 1) {
    return {
      node_id: nodeId,
      found: false,
      verdict: "not-found",
      explanation: `no internal node with id ${nodeId} in this graph.`,
    };
  }
  if (node.type !== "function" && node.type !== "class" && node.type !== "method") {
    return {
      node_id: nodeId,
      found: true,
      verdict: "not-a-candidate",
      explanation: `${nodeId} is a ${node.type}; dead-code analysis covers functions, classes and methods.`,
    };
  }

  const candidate = findDeadCode(ctx.store).find((c) => c.id === nodeId);
  if (candidate) {
    const confidenceNote =
      candidate.confidence === "confirmed-unreferenced"
        ? "zero resolved incoming references and zero unresolved references that could point at it"
        : candidate.confidence === "referenced-but-uncalled"
          ? "never called directly, but passed by reference somewhere — evidence of use exists"
          : "no resolved references were found, but unresolved references to that name exist, so it may still be used";
    return {
      node_id: nodeId,
      found: true,
      verdict: "dead-candidate",
      confidence: candidate.confidence,
      explanation: `${nodeId} is a dead-code candidate (${candidate.confidence}): ${confidenceNote}.`,
    };
  }

  const inbound = ctx.store.db
    .prepare(
      `SELECT COUNT(*) AS n FROM edges
       WHERE dst = ? AND confidence = 'resolved' AND type IN ('calls', 'inherits')`,
    )
    .get(nodeId) as { n: number };
  return {
    node_id: nodeId,
    found: true,
    verdict: "referenced",
    explanation:
      `${nodeId} is not flagged dead: it has ${inbound.n} resolved incoming ` +
      "call/inherits edge(s) in the graph.",
  };
}

interface RiskFileRow {
  path: string;
  score: number;
  churnCommits: number;
  hasTests: boolean;
  lastModifiedIso: string | null;
}

function riskiestFiles(
  ctx: McpContext,
  args: Record<string, unknown>,
): { files: RiskFileRow[]; windowDays: number; note: string } {
  const rawLimit = args["limit"];
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.floor(rawLimit)
      : 5;

  const risks = scoreFileRisks(ctx.history, ctx.coverage, ctx.windowDays);
  const files = risks.slice(0, limit).map((r) => ({
    path: r.path,
    score: r.score,
    churnCommits: r.components.churnCommits,
    hasTests: r.components.hasTests,
    lastModifiedIso: r.components.lastModifiedIso,
  }));
  return {
    files,
    windowDays: ctx.windowDays,
    note: "score = git-churn points plus a missing-test penalty; an approximation, not code quality.",
  };
}

function whatsNotTested(ctx: McpContext, args: Record<string, unknown>) {
  const scope = optionalString(args, "scope");
  const uncovered = ctx.coverage.uncoveredFiles.filter(
    (p) => !scope || p.startsWith(scope),
  );
  return {
    scope: scope ?? null,
    uncoveredFiles: uncovered,
    totalUncovered: ctx.coverage.uncoveredFiles.length,
    totalSourceFiles: ctx.coverage.sourceFiles.length,
    note: "import-proximity estimate, not runtime coverage instrumentation.",
  };
}

interface SymbolHit {
  id: string;
  type: string;
  name: string;
  path: string | null;
  exported: boolean;
}

function findSymbol(ctx: McpContext, args: Record<string, unknown>) {
  const name = requireString(args, "name");
  const exact = ctx.store.db
    .prepare(
      `SELECT id, type, name, path, exported FROM nodes
       WHERE name = ? COLLATE NOCASE AND external = 0
         AND type IN ('function', 'class', 'method')
       ORDER BY id LIMIT 20`,
    )
    .all(name) as unknown as SymbolHit[];

  let matches = exact;
  let matchMode: "exact" | "substring" = "exact";
  if (matches.length === 0) {
    matches = ctx.store.db
      .prepare(
        `SELECT id, type, name, path, exported FROM nodes
         WHERE name LIKE ? COLLATE NOCASE AND external = 0
           AND type IN ('function', 'class', 'method')
         ORDER BY id LIMIT 20`,
      )
      .all(`%${name}%`) as unknown as SymbolHit[];
    matchMode = "substring";
  }

  return { query: name, matchMode, count: matches.length, matches };
}
