import { promises as fs } from "node:fs";
import path from "node:path";
import { detectLanguage } from "./languages.js";
import { parserFor } from "./loader.js";
import { extractJavaScript } from "./javascript.js";
import { extractPython } from "./python.js";
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
  const tree = parser.parse(source);

  const partial =
    language === "python" ? extractPython(tree.rootNode) : extractJavaScript(tree.rootNode);

  return {
    path: displayPath(absolutePath, options.root),
    language,
    hasParseErrors: tree.rootNode.hasError,
    ...partial,
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
    extracted.push(
      await extractFile(path.join(absoluteRoot, relativeFile), { root: absoluteRoot }),
    );
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
