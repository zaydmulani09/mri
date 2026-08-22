import type { GraphStore } from "../graph/store.js";
import { isEntryFile, isTestFile } from "./file-kinds.js";

export type DeadCodeConfidence =
  | "confirmed-unreferenced"
  | "no-resolved-references";

export interface DeadCodeCandidate {
  id: string;
  type: "function" | "class" | "method";
  name: string;
  path: string;
  confidence: DeadCodeConfidence;
  note?: string;
}

export interface DeadCodeOptions {
  mainNames?: string[];
}

const DEFAULT_MAIN_NAMES = ["main", "__main__"];

interface CandidateNode {
  id: string;
  type: string;
  name: string;
  path: string;
}

export function findDeadCode(
  store: GraphStore,
  options: DeadCodeOptions = {},
): DeadCodeCandidate[] {
  const mainNames = new Set(options.mainNames ?? DEFAULT_MAIN_NAMES);

  const referencedIds = new Set(
    (
      store.db
        .prepare(
          `SELECT DISTINCT dst FROM edges
           WHERE confidence = 'resolved' AND dst IS NOT NULL
             AND type IN ('calls', 'inherits')`,
        )
        .all() as Array<{ dst: string }>
    ).map((row) => row.dst),
  );

  const ambiguousNames = new Set<string>();
  const ambiguousRows = store.db
    .prepare(
      `SELECT callee_text FROM edges
       WHERE confidence = 'ambiguous' AND callee_text IS NOT NULL`,
    )
    .all() as Array<{ callee_text: string }>;
  for (const row of ambiguousRows) {
    const lastSegment = row.callee_text.split(".").pop();
    if (lastSegment) ambiguousNames.add(lastSegment);
  }

  const symbolNodes = store.db
    .prepare(
      `SELECT id, type, name, path FROM nodes
       WHERE external = 0 AND exported = 0 AND path IS NOT NULL
         AND type IN ('function', 'class')`,
    )
    .all() as unknown as CandidateNode[];

  const candidates: DeadCodeCandidate[] = [];
  const confirmedClassIds = new Set<string>();

  for (const node of symbolNodes) {
    if (mainNames.has(node.name)) continue;
    if (isEntryFile(node.path)) continue;
    if (isTestFile(node.path)) continue;
    if (referencedIds.has(node.id)) continue;

    if (ambiguousNames.has(node.name)) {
      candidates.push({
        id: node.id,
        type: node.type as "function" | "class",
        name: node.name,
        path: node.path,
        confidence: "no-resolved-references",
      });
      continue;
    }

    candidates.push({
      id: node.id,
      type: node.type as "function" | "class",
      name: node.name,
      path: node.path,
      confidence: "confirmed-unreferenced",
    });
    if (node.type === "class") confirmedClassIds.add(node.id);
  }

  for (const method of methodsInDeadClasses(store, referencedIds, ambiguousNames)) {
    if (confirmedClassIds.has(method.classId)) {
      candidates.push({
        id: method.id,
        type: "method",
        name: method.name,
        path: method.path,
        confidence: method.ambiguouslyReferenced
          ? "no-resolved-references"
          : "confirmed-unreferenced",
        note: "method of unreferenced class",
      });
    }
  }

  return candidates;
}

interface MethodRow {
  id: string;
  name: string;
  path: string;
  classId: string;
}

function methodsInDeadClasses(
  store: GraphStore,
  referencedIds: Set<string>,
  ambiguousNames: Set<string>,
): Array<MethodRow & { ambiguouslyReferenced: boolean }> {
  const rows = store.db
    .prepare(
      `SELECT m.id, m.name, m.path, e.src AS classId
       FROM nodes m JOIN edges e ON e.dst = m.id
       WHERE m.type = 'method' AND e.type = 'defines'`,
    )
    .all() as unknown as MethodRow[];

  return rows
    .filter((m) => !referencedIds.has(m.id))
    .map((m) => ({
      ...m,
      ambiguouslyReferenced: ambiguousNames.has(m.name),
    }));
}
