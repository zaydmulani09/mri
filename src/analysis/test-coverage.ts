import type { GraphStore } from "../graph/store.js";
import { DEFAULT_TEST_FILE_PATTERNS, isTestFile } from "./file-kinds.js";

export interface TestCoverageResult {
  testFiles: string[];
  sourceFiles: string[];
  coveredFiles: string[];
  uncoveredFiles: string[];
  exercises: Array<{ testFile: string; covers: string[] }>;
  coverageRatio: number;
}

export interface TestCoverageOptions {
  patterns?: readonly RegExp[];
}

export function mapTestCoverage(
  store: GraphStore,
  options: TestCoverageOptions = {},
): TestCoverageResult {
  const patterns = options.patterns ?? DEFAULT_TEST_FILE_PATTERNS;

  const rows = store.db
    .prepare(
      `SELECT id, path FROM nodes WHERE type = 'file' AND path IS NOT NULL`,
    )
    .all() as unknown as Array<{ id: string; path: string }>;

  const testRows = rows.filter((row) => isTestFile(row.path, patterns));
  const sourceRows = rows.filter((row) => !isTestFile(row.path, patterns));

  const covered = new Set<string>();
  const exercises: Array<{ testFile: string; covers: string[] }> = [];

  for (const testRow of testRows) {
    const reachable = reachableSourceFiles(store, testRow.id);
    const covers = [...reachable].filter(
      (path) => !isTestFile(path, patterns),
    );
    exercises.push({ testFile: testRow.path, covers });
    for (const path of covers) covered.add(path);
  }

  const sourcePaths = sourceRows.map((row) => row.path).sort();
  const coveredFiles = sourcePaths.filter((path) => covered.has(path));
  const uncoveredFiles = sourcePaths.filter((path) => !covered.has(path));

  return {
    testFiles: testRows.map((row) => row.path).sort(),
    sourceFiles: sourcePaths,
    coveredFiles,
    uncoveredFiles,
    exercises,
    coverageRatio:
      sourcePaths.length === 0
        ? 0
        : Math.round((coveredFiles.length / sourcePaths.length) * 10000) / 10000,
  };
}

function reachableSourceFiles(store: GraphStore, fileId: string): Set<string> {
  const seen = new Set<string>([fileId]);
  const queue = [fileId];
  const outgoing = store.db.prepare(
    `SELECT dst FROM edges WHERE src = ? AND type = 'imports'
     AND confidence = 'resolved' AND dst IS NOT NULL`,
  );

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const row of outgoing.all(current) as unknown as Array<{ dst: string }>) {
      if (seen.has(row.dst)) continue;
      seen.add(row.dst);
      queue.push(row.dst);
    }
  }

  const paths = new Set<string>();
  for (const id of seen) {
    const node = store.getNode(id);
    if (node?.path) paths.add(node.path);
  }
  return paths;
}
