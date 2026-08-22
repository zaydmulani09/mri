import { promises as fs } from "node:fs";
import path from "node:path";
import { detectLanguage, type LanguageId } from "./languages.js";
import { parserFor } from "./loader.js";
import { extractJavaScript } from "./javascript.js";
import { extractPython } from "./python.js";
import { extractGo } from "./go.js";
import { extractRust } from "./rust.js";
import { walkSourceFiles } from "./walker.js";
import type { FileSymbols } from "./types.js";

export interface ExtractOptions {
  root?: string;
}

export async function extractFile(
  filePath: string,
  options: ExtractOptions = {},
): Promise<FileSymbols> {
  const language = detectLanguage(filePath);
  if (!language) {
    throw new Error(`Unsupported file extension (cannot infer language): ${filePath}`);
  }
  const absolutePath = path.resolve(filePath);
  const source = await fs.readFile(absolutePath, "utf8");
  const parser = parserFor(language);
  const tree = parser.parse(normalizeSource(source, language));

  const partial =
    language === "python"
      ? extractPython(tree.rootNode)
      : language === "go"
        ? extractGo(tree.rootNode)
        : language === "rust"
          ? extractRust(tree.rootNode)
          : extractJavaScript(tree.rootNode);

  return {
    path: displayPath(absolutePath, options.root),
    language,
    hasParseErrors: tree.rootNode.hasError,
    ...partial,
  };
}

// The bundled tree-sitter-typescript (0.23.2, newest published) predates
// TypeScript 5.0's `export type *` syntax and emits ERROR nodes for it.
// Dropping the word "type" — padded with spaces so every byte offset and
// line number stays identical — turns it into plain `export *`, which the
// grammar handles and which preserves the export-all semantics extraction
// cares about.
function normalizeSource(source: string, language: LanguageId): string {
  if (language !== "typescript" && language !== "tsx") return source;
  return source.replace(
    /export(\s+)type(\s+)\*/g,
    (_match, before: string, after: string) =>
      `export${before}${" ".repeat(after.length)}*`,
  );
}

function emptyFileSymbols(filePath: string): FileSymbols {
  return {
    path: filePath,
    language: "javascript",
    hasParseErrors: true,
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    references: [],
  };
}

export interface RepoExtraction {
  root: string;
  generatedAt: string;
  files: FileSymbols[];
}

export async function extractRepo(root: string): Promise<RepoExtraction> {
  const absoluteRoot = path.resolve(root);
  const files = await walkSourceFiles(absoluteRoot);
  const extracted: FileSymbols[] = [];
  for (const relativeFile of files) {
    try {
      extracted.push(
        await extractFile(path.join(absoluteRoot, relativeFile), { root: absoluteRoot }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`mri: extraction failed for ${relativeFile}: ${message}`);
      extracted.push(emptyFileSymbols(relativeFile));
    }
  }
  return {
    root: absoluteRoot.split(path.sep).join("/"),
    generatedAt: new Date().toISOString(),
    files: extracted,
  };
}

function displayPath(absolutePath: string, root?: string): string {
  const posix = absolutePath.split(path.sep).join("/");
  if (!root) return posix;
  const posixRoot = path.resolve(root).split(path.sep).join("/");
  return posix.startsWith(posixRoot + "/") ? posix.slice(posixRoot.length + 1) : posix;
}
