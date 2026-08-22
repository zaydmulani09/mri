export interface GraphNode {
  id: string;
  type: string;
  name: string;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  external: boolean;
  exported: boolean;
  language: string | null;
}

export interface GraphEdge {
  src: string;
  dst: string;
  type: string;
  line: number | null;
  calleeText: string | null;
  confidence: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MetaPayload {
  root: string;
  generatedAt: string;
  fileCount: number;
  parseErrorFiles?: number;
  counts: Record<string, number>;
  windowDays?: number;
}

export interface DeadCodeCandidate {
  id: string;
  type: "function" | "class" | "method";
  name: string;
  path: string;
  confidence: "confirmed-unreferenced" | "referenced-but-uncalled" | "no-resolved-references";
  note?: string;
}

export interface CoverageSummary {
  testFiles: string[];
  sourceFiles: string[];
  coveredFiles: string[];
  uncoveredFiles: string[];
  exercises: Array<{ testFile: string; covers: string[] }>;
  coverageRatio: number;
}

export interface RiskRow {
  path: string;
  score: number;
  churnPoints: number;
  coveragePenalty: number;
  components: {
    churnCommits: number;
    commitsTotal: number;
    windowDays: number;
    lastModifiedIso: string | null;
    untracked: boolean;
    hasTests: boolean;
    coveringTests: string[];
  };
}

export interface AnalysisPayload {
  deadCode: DeadCodeCandidate[];
  coverage: CoverageSummary;
  risks: RiskRow[];
}

export interface BlastRadiusDependent {
  id: string;
  type: string;
  name: string;
  path: string | null;
  depth: number;
  via: "confirmed" | "ambiguous-only";
  relation: string;
  parentId?: string | null;
}

export interface BlastRadiusResult {
  root: { id: string; type: string; name: string; path: string | null };
  dependents: BlastRadiusDependent[];
}
