// Pure parsing/mapping helpers for MRI CLI output. No vscode imports here so
// the logic stays unit-testable.

export interface ExtractFunction {
  name: string;
  exported: boolean;
  startLine: number;
  endLine: number;
}

export interface ExtractMethod {
  name: string;
  startLine: number;
  endLine: number;
}

export interface ExtractClass {
  name: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  methods: ExtractMethod[];
}

export interface ExtractFileSymbols {
  path: string;
  language: string;
  hasParseErrors: boolean;
  functions: ExtractFunction[];
  classes: ExtractClass[];
}

export interface RepoExtraction {
  root: string;
  generatedAt: string;
  files: ExtractFileSymbols[];
}

export interface FileRisk {
  path: string;
  score: number;
  churnPoints: number;
  components: {
    churnCommits: number;
    hasTests: boolean;
    untracked?: boolean;
    lastModifiedIso?: string;
  };
}

export interface AnalysisReport {
  root: string;
  generatedAt: string;
  windowDays: number;
  summary: { fileCount: number };
  risks: FileRisk[];
  topRisks: FileRisk[];
  deadCode?: DeadCodeCandidateRow[];
  coverage?: {
    testFiles: string[];
    sourceFiles: string[];
    coveredFiles: string[];
    uncoveredFiles: string[];
    exercises?: Array<{ testFile: string; covers: string[] }>;
    coverageRatio: number;
  };
}

export interface SymbolEntry {
  id: string;
  name: string;
  kind: "function" | "class" | "method";
  path: string;
  startLine: number;
  endLine: number;
}

/** Graph node ids use forward slashes and are relative to the repo root. */
export function toPosix(p: string): string {
  return p.split("\\").join("/");
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeHtmlAttr(text: string): string {
  return escapeHtmlText(toPosix(text));
}

export function functionId(path: string, name: string): string {
  return `fn:${toPosix(path)}#${name}`;
}

export function classId(path: string, name: string): string {
  return `cls:${toPosix(path)}#${name}`;
}

export function methodId(path: string, className: string, methodName: string): string {
  return `m:${toPosix(path)}#${className}.${methodName}`;
}

export function fileId(path: string): string {
  return `f:${toPosix(path)}`;
}

/** Flatten an extracted file into lensable symbol entries with graph node ids. */
export function symbolEntriesFromFile(file: ExtractFileSymbols): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (const fn of file.functions) {
    entries.push({
      id: functionId(file.path, fn.name),
      name: fn.name,
      kind: "function",
      path: file.path,
      startLine: fn.startLine,
      endLine: fn.endLine,
    });
  }
  for (const cls of file.classes) {
    entries.push({
      id: classId(file.path, cls.name),
      name: cls.name,
      kind: "class",
      path: file.path,
      startLine: cls.startLine,
      endLine: cls.endLine,
    });
    for (const method of cls.methods) {
      entries.push({
        id: methodId(file.path, cls.name, method.name),
        name: `${cls.name}.${method.name}`,
        kind: "method",
        path: file.path,
        startLine: method.startLine,
        endLine: method.endLine,
      });
    }
  }
  return entries;
}

/**
 * Find the innermost symbol whose line span contains `zeroBasedLine`.
 * Methods win over their class when both contain the position.
 */
export function findEnclosingSymbol(
  entries: SymbolEntry[],
  zeroBasedLine: number,
): SymbolEntry | null {
  const target = zeroBasedLine + 1;
  let best: SymbolEntry | null = null;
  for (const entry of entries) {
    if (entry.startLine > target || entry.endLine < target) continue;
    if (
      best === null ||
      entry.endLine - entry.startLine < best.endLine - best.startLine ||
      (entry.endLine - entry.startLine === best.endLine - best.startLine &&
        entry.kind === "method" &&
        best.kind !== "method")
    ) {
      best = entry;
    }
  }
  return best;
}

export interface BlastRadiusDependent {
  id: string;
  depth: number;
  via: string;
  relation: string;
  path: string | null;
  confirmed: boolean;
}

export interface BlastRadiusFlat {
  rootId: string | null;
  total: number;
  confirmed: number;
  ambiguousOnly: number;
  dependents: BlastRadiusDependent[];
}

/**
 * Parse `mri blast-radius <id>` default ("flat") output:
 *
 *   blast radius of fn:x#y (function)
 *   dependents: 3 total (2 confirmed, 1 ambiguous-only)
 *     d1  confirmed     calls                m:a#B.c [src/a.ts]
 */
export function parseBlastRadiusFlat(text: string): BlastRadiusFlat {
  const out: BlastRadiusFlat = {
    rootId: null,
    total: 0,
    confirmed: 0,
    ambiguousOnly: 0,
    dependents: [],
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const rootMatch = /^blast radius of (\S+)/.exec(line);
    if (rootMatch) {
      out.rootId = rootMatch[1] ?? null;
      continue;
    }
    const headerMatch =
      /^dependents:\s*(\d+)\s*total\s*\((\d+)\s*confirmed,\s*(\d+)\s*ambiguous-only\)/.exec(
        line,
      );
    if (headerMatch) {
      out.total = Number(headerMatch[1]);
      out.confirmed = Number(headerMatch[2]);
      out.ambiguousOnly = Number(headerMatch[3]);
      continue;
    }
    const rowMatch = /^\s+d(\d+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\[(.+)\])?\s*$/.exec(line);
    if (rowMatch) {
      const via = rowMatch[2] ?? "";
      out.dependents.push({
        depth: Number(rowMatch[1]),
        via,
        relation: rowMatch[3] ?? "",
        id: rowMatch[4] ?? "",
        path: rowMatch[5] ?? null,
        confirmed: via === "confirmed",
      });
    }
  }
  return out;
}

export interface GuardBreach {
  kind: string;
  line: number;
  attempted: string;
  message: string;
  ruleArea: string | null;
  ruleExpected: string | null;
}

export interface GuardJson {
  outcome: "blocked" | "executed";
  scopeId?: string;
  breaches?: GuardBreachInput[];
  value?: unknown;
  allowlist?: { symbols: number; files: number; unresolved: number };
}

interface GuardBreachInput {
  kind?: string;
  line?: number;
  attempted?: string;
  message?: string;
  rule?: { area?: string; expected?: string } | null;
}

/** Map a guard --json payload onto diagnostics-shaped rows (1-based lines). */
export function guardBreachesFromJson(payload: GuardJson): {
  breaches: GuardBreach[];
  executed: boolean;
  allowlistSummary: string;
} {
  const allowlist = payload.allowlist;
  const allowlistSummary = allowlist
    ? `${allowlist.symbols} symbol(s), ${allowlist.files} file(s); ${allowlist.unresolved} unresolved reference(s)`
    : "unknown allowlist";
  const breaches: GuardBreach[] = (payload.breaches ?? []).map((breach) => ({
    kind: breach.kind ?? "unknown",
    line: typeof breach.line === "number" ? breach.line : 1,
    attempted: breach.attempted ?? "",
    message: breach.message ?? "",
    ruleArea: breach.rule?.area ?? null,
    ruleExpected: breach.rule?.expected ?? null,
  }));
  return { breaches, executed: payload.outcome !== "blocked", allowlistSummary };
}

// ---------------------------------------------------------------------------
// Analyze-workspace overview model
// ---------------------------------------------------------------------------

export interface DeadCodeCandidateRow {
  id: string;
  name: string;
  path: string;
  confidence: string;
  note?: string;
  type?: string;
}

export interface AnalyzeSummary {
  fileCount: number;
  generatedAt: string;
  windowDays: number;
  riskHotspots: Array<{ path: string; score: number; churnCommits: number; hasTests: boolean }>;
  deadCodeByConfidence: Record<string, DeadCodeCandidateRow[]>;
  coverage: {
    ratioPercent: string;
    coveredCount: number;
    sourceCount: number;
    uncoveredFiles: string[];
  };
}

/**
 * Reduce an AnalysisReport to the sections the overview panel renders.
 * Pure so the mapping stays unit-testable.
 */
export function buildAnalyzeSummary(report: AnalysisReport): AnalyzeSummary {
  const riskHotspots = (report.topRisks ?? []).map((risk) => ({
    path: risk.path,
    score: risk.score,
    churnCommits: risk.components?.churnCommits ?? 0,
    hasTests: Boolean(risk.components?.hasTests),
  }));

  const deadCodeByConfidence: Record<string, DeadCodeCandidateRow[]> = {};
  for (const candidate of report.deadCode ?? []) {
    const bucket = (deadCodeByConfidence[candidate.confidence] ??= []);
    bucket.push({
      id: candidate.id,
      name: candidate.name,
      path: candidate.path,
      confidence: candidate.confidence,
      note: candidate.note,
    });
  }

  const coverage = report.coverage;
  return {
    fileCount: report.summary?.fileCount ?? 0,
    generatedAt: report.generatedAt ?? "",
    windowDays: report.windowDays ?? 90,
    riskHotspots,
    deadCodeByConfidence,
    coverage: {
      ratioPercent:
        coverage && coverage.sourceFiles.length > 0
          ? (coverage.coverageRatio * 100).toFixed(1)
          : "n/a",
      coveredCount: coverage?.coveredFiles.length ?? 0,
      sourceCount: coverage?.sourceFiles.length ?? 0,
      uncoveredFiles: coverage?.uncoveredFiles ?? [],
    },
  };
}

/** Plain-text digest of the summary, rendered into the MRI output channel. */
export function renderSummaryText(summary: AnalyzeSummary): string {
  const lines: string[] = [];
  lines.push(
    `${summary.fileCount} files | coverage ${summary.coverage.ratioPercent}% (${summary.coverage.coveredCount}/${summary.coverage.sourceCount} source files)`,
  );
  lines.push("");
  lines.push(`RISK HOTSPOTS (top ${summary.riskHotspots.length}, churn window ${summary.windowDays}d)`);
  summary.riskHotspots.forEach((risk, i) => {
    lines.push(
      `  ${String(i + 1).padStart(2)}. ${risk.path.padEnd(44)} score ${String(risk.score).padStart(3)}   [churn ${risk.churnCommits} commits | ${risk.hasTests ? "tested" : "no tests found"}]`,
    );
  });
  lines.push("");
  lines.push("DEAD CODE");
  const confidences = Object.keys(summary.deadCodeByConfidence).sort();
  if (confidences.length === 0) {
    lines.push("  none found");
  } else {
    for (const confidence of confidences) {
      for (const candidate of summary.deadCodeByConfidence[confidence] ?? []) {
        lines.push(`  [${confidence}] ${candidate.id}`);
      }
    }
  }
  lines.push("");
  lines.push("NOT COVERED");
  for (const file of summary.coverage.uncoveredFiles.slice(0, 10)) {
    lines.push(`  ${file}`);
  }
  return lines.join("\n");
}
