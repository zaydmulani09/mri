export const DEFAULT_TEST_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)(tests?|__tests__)(\/|$)/i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /(^|\/)[^/]+_test\.py$/i,
];

const DEFAULT_ENTRY_FILE_PREFIXES = ["index.", "main.", "__init__."];

export function matchesAny(path: string | null, patterns: readonly RegExp[]): boolean {
  if (!path) return false;
  return patterns.some((pattern) => pattern.test(path));
}

export function isTestFile(
  filePath: string,
  patterns: readonly RegExp[] = DEFAULT_TEST_FILE_PATTERNS,
): boolean {
  return matchesAny(filePath, patterns);
}

export function isEntryFile(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? filePath;
  return DEFAULT_ENTRY_FILE_PREFIXES.some((prefix) => base.startsWith(prefix));
}
