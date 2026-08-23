import { promises as fs } from "node:fs";
import path from "node:path";
import type Parser from "tree-sitter";
import { detectLanguage, type LanguageId } from "../extraction/languages.js";
import { parserFor } from "../extraction/loader.js";
import { walkSourceFiles } from "../extraction/walker.js";

type Node = Parser.SyntaxNode;

export interface FunctionComplexity {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
}

export interface FileComplexity {
  path: string;
  language: LanguageId;
  functions: FunctionComplexity[];
  maxComplexity: number;
}

export interface ComplexityOptions {
  topN?: number;
}

export interface ComplexityReport {
  files: FileComplexity[];
  totalFunctions: number;
  maxComplexity: number;
  topFunctions: Array<FunctionComplexity & { path: string }>;
}

interface LanguageConfig {
  functionLike: ReadonlySet<string>;
  decisions: ReadonlySet<string>;
  operatorCarriers: ReadonlySet<string>;
}

const LOGICAL_OPERATORS = new Set(["&&", "||", "and", "or"]);
const ANONYMOUS_BASES = new Set(["<anonymous>", "<lambda>", "<closure>"]);

const JS_FAMILY: LanguageConfig = {
  functionLike: new Set([
    "function_declaration",
    "generator_function_declaration",
    "function_expression",
    "generator_function_expression",
    "arrow_function",
    "method_definition",
  ]),
  decisions: new Set([
    "if_statement",
    "for_statement",
    "for_in_statement",
    "for_of_statement",
    "while_statement",
    "do_statement",
    "switch_case",
    "ternary_expression",
    "catch_clause",
  ]),
  operatorCarriers: new Set(["binary_expression"]),
};

const PYTHON: LanguageConfig = {
  functionLike: new Set(["function_definition", "lambda"]),
  decisions: new Set([
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "conditional_expression",
    "except_clause",
    "case_clause",
  ]),
  operatorCarriers: new Set(["boolean_operator"]),
};

const GO: LanguageConfig = {
  functionLike: new Set(["function_declaration", "method_declaration"]),
  decisions: new Set([
    "if_statement",
    "for_statement",
    "expression_case",
    "communication_case",
  ]),
  operatorCarriers: new Set(["binary_expression"]),
};

const RUST: LanguageConfig = {
  functionLike: new Set(["function_item", "closure_expression"]),
  decisions: new Set([
    "if_expression",
    "for_expression",
    "while_expression",
    "loop_expression",
    "match_arm",
  ]),
  operatorCarriers: new Set(["binary_expression"]),
};

const CONFIGS: Record<LanguageId, LanguageConfig> = {
  javascript: JS_FAMILY,
  typescript: JS_FAMILY,
  tsx: JS_FAMILY,
  python: PYTHON,
  go: GO,
  rust: RUST,
};

export async function analyzeComplexity(
  root: string,
  options: ComplexityOptions = {},
): Promise<ComplexityReport> {
  const rootPath = path.resolve(root);
  const relativeFiles = await walkSourceFiles(rootPath);

  const files: FileComplexity[] = [];
  for (const relative of relativeFiles) {
    const language = detectLanguage(relative);
    if (!language) continue;
    let source: string;
    try {
      source = await fs.readFile(path.join(rootPath, relative), "utf8");
    } catch {
      continue;
    }
    const tree = parserFor(language).parse(source);
    const functions = computeFileFunctions(tree.rootNode, CONFIGS[language]);
    functions.sort(
      (a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name),
    );
    files.push({
      path: relative,
      language,
      functions,
      maxComplexity: functions.reduce((max, fn) => Math.max(max, fn.complexity), 0),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const flattened = files.flatMap((file) =>
    file.functions.map((fn) => ({ ...fn, path: file.path })),
  );
  const topN = options.topN ?? 10;
  const topFunctions = [...flattened]
    .sort(
      (a, b) =>
        b.complexity - a.complexity ||
        a.path.localeCompare(b.path) ||
        a.startLine - b.startLine,
    )
    .slice(0, topN);

  return {
    files,
    totalFunctions: flattened.length,
    maxComplexity: flattened.reduce((max, fn) => Math.max(max, fn.complexity), 0),
    topFunctions,
  };
}

export function maxComplexityByPath(report: ComplexityReport): Map<string, number> {
  const map = new Map<string, number>();
  for (const file of report.files) map.set(file.path, file.maxComplexity);
  return map;
}

interface Bucket {
  name: string;
  startLine: number;
  endLine: number;
  decisions: number;
}

function computeFileFunctions(root: Node, config: LanguageConfig): FunctionComplexity[] {
  const moduleBucket: Bucket = { name: "<module>", startLine: 0, endLine: 0, decisions: 0 };
  const stack: Bucket[] = [moduleBucket];
  const buckets: Bucket[] = [];

  const startLine = (node: Node): number => node.startPosition.row + 1;
  const endLine = (node: Node): number => node.endPosition.row + 1;

  const visit = (node: Node): void => {
    if (config.functionLike.has(node.type)) {
      const bucket: Bucket = {
        name: functionNameOf(node),
        startLine: startLine(node),
        endLine: endLine(node),
        decisions: 0,
      };
      buckets.push(bucket);
      stack.push(bucket);
      for (const child of node.namedChildren) visit(child);
      stack.pop();
      return;
    }

    if (isDecisionPoint(node, config)) {
      const current = stack[stack.length - 1] ?? moduleBucket;
      current.decisions += 1;
      if (current === moduleBucket) {
        if (moduleBucket.startLine === 0) moduleBucket.startLine = startLine(node);
        moduleBucket.endLine = Math.max(moduleBucket.endLine, endLine(node));
      }
    }

    for (const child of node.namedChildren) visit(child);
  };

  visit(root);

  const functions: FunctionComplexity[] = [];
  for (const bucket of buckets) {
    functions.push({
      name: displayName(bucket),
      startLine: bucket.startLine,
      endLine: bucket.endLine,
      complexity: 1 + bucket.decisions,
    });
  }
  if (moduleBucket.decisions > 0) {
    functions.push({
      name: `<module>@${moduleBucket.startLine}`,
      startLine: moduleBucket.startLine,
      endLine: moduleBucket.endLine,
      complexity: 1 + moduleBucket.decisions,
    });
  }
  return functions;
}

function displayName(bucket: Bucket): string {
  if (!ANONYMOUS_BASES.has(bucket.name)) return bucket.name;
  return `${bucket.name}@${bucket.startLine}`;
}

function isDecisionPoint(node: Node, config: LanguageConfig): boolean {
  if (config.decisions.has(node.type)) return !isWildcardArm(node);
  if (config.operatorCarriers.has(node.type)) {
    return LOGICAL_OPERATORS.has(operatorText(node));
  }
  return false;
}

function isWildcardArm(node: Node): boolean {
  if (node.type === "match_arm") {
    const pattern = node.namedChildren.find((child) => child.type === "match_pattern");
    return pattern !== undefined && pattern.text.trim() === "_";
  }
  if (node.type === "case_clause") {
    const pattern = node.namedChildren.find((child) => child.type === "case_pattern");
    return pattern !== undefined && pattern.text.trim() === "_";
  }
  return false;
}

function operatorText(node: Node): string {
  const field = node.childForFieldName("operator");
  if (field) return field.text;
  for (const child of node.children) {
    if (!child.isNamed) return child.type;
  }
  return "";
}

function functionNameOf(node: Node): string {
  const declared = node.childForFieldName("name");
  if (declared) return declared.text;

  let current = node.parent;
  while (current) {
    switch (current.type) {
      case "variable_declarator":
      case "let_declaration":
      case "assignment": {
        const bound =
          current.childForFieldName("name") ??
          current.childForFieldName("pattern") ??
          current.childForFieldName("left");
        if (bound) return bound.text;
        break;
      }
      case "assignment_expression": {
        const left = current.childForFieldName("left");
        if (left) return left.text;
        break;
      }
      case "pair":
      case "field_definition":
      case "public_field_definition": {
        const key =
          current.childForFieldName("key") ?? current.childForFieldName("property");
        if (key) return key.text;
        break;
      }
      case "parenthesized_expression":
        break;
      default:
        return fallbackName(node);
    }
    current = current.parent;
  }
  return fallbackName(node);
}

function fallbackName(node: Node): string {
  if (node.type === "lambda") return "<lambda>";
  if (node.type === "closure_expression") return "<closure>";
  return "<anonymous>";
}
