import path from "node:path";

export type LanguageId = "javascript" | "typescript" | "tsx" | "python";

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, LanguageId>> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
};

export function detectLanguage(filePath: string): LanguageId | null {
  return EXTENSION_TO_LANGUAGE[path.extname(filePath).toLowerCase()] ?? null;
}
