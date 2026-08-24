import type Parser from "tree-sitter";
import { parserFor } from "../extraction/loader.js";

type Node = Parser.SyntaxNode;

export interface ScannedImportBinding {
  kind: "default" | "namespace" | "named";
  imported?: string;
  local: string;
}

export interface ScannedImport {
  specifier: string | null;
  bindings: ScannedImportBinding[];
  via: "static-import" | "require-call" | "dynamic-import";
  line: number;
  attempted: string;
  startIndex?: number;
  endIndex?: number;
}

export interface ScannedResourceAccess {
  category: "environment" | "network";
  target: string | null;
  mode?: "read" | "write";
  attempted: string;
  line: number;
}

export interface ScannedIdentifier {
  name: string;
  line: number;
}

export interface CodeScan {
  parseFailed: boolean;
  parseErrorLine: number | null;
  imports: ScannedImport[];
  resourceAccesses: ScannedResourceAccess[];
  identifiers: ScannedIdentifier[];
}

interface ChainStep {
  via: "root" | "property" | "index";
  node: Node;
  accessor: Node | null;
}

const SAFE_GLOBAL_IDENTIFIERS: ReadonlySet<string> = new Set([
  "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date",
  "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "URIError",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "BigInt",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
  "structuredClone", "console", "NaN", "Infinity", "undefined", "globalThis",
  "arguments",
]);

export function analyzeCode(code: string): CodeScan {
  const parser = parserFor("javascript");
  const tree = parser.parse(code);
  const root = tree.rootNode;

  if (root.hasError) {
    return {
      parseFailed: true,
      parseErrorLine: firstErrorLine(root),
      imports: [],
      resourceAccesses: [],
      identifiers: [],
    };
  }

  const imports: ScannedImport[] = [];
  const resourceAccesses: ScannedResourceAccess[] = [];
  const declaredNames = new Set<string>();
  const boundNodes = new Set<number>();
  const consumedNodes = new Set<number>();

  const declareName = (nameNode: Node | null): void => {
    if (!nameNode || nameNode.type !== "identifier") return;
    declaredNames.add(nameNode.text);
    boundNodes.add(nameNode.id);
  };

      const declareSubtree = (subtree: Node | null): void => {
    if (!subtree) return;
    walkNamed(subtree, (n) => {
      if (n.type === "identifier" || n.type === "shorthand_property_identifier_pattern") {
        declareName(n);
      }
    });
  };

  const visit = (node: Node): void => {
    switch (node.type) {
      case "import_statement": {
        recordStaticImport(node, imports);
        const clause = node.namedChildren.find((c) => c.type === "import_clause");
        if (clause) {
          for (const part of clause.namedChildren) {
            if (part.type === "identifier") {
              declareName(part);
            } else if (part.type === "namespace_import") {
              const inner = part.namedChildren[0];
              if (inner) declareName(inner);
            } else if (part.type === "named_imports") {
              for (const spec of part.namedChildren) {
                const targetNode =
                  spec.childForFieldName("alias") ?? spec.childForFieldName("name");
                if (targetNode) declareName(targetNode);
              }
            }
          }
        }
        return;
      }
      case "call_expression": {
        recordCallExpression(node, imports, resourceAccesses, consumedNodes);
        break;
      }
      case "member_expression":
      case "subscript_expression": {
        recordEnvAccess(node, resourceAccesses, consumedNodes);
        break;
      }
      case "variable_declarator": {
        declareName(node.childForFieldName("name"));
        break;
      }
      case "function_declaration":
      case "generator_function_declaration": {
        // Bind the name AND the parameter subtree - declared-function params
        // are ordinary locals (benchmark Suite A defect #1: `function
        // helper(items)` flagged `items` as an unknown reference).
        declareName(node.childForFieldName("name"));
        declareSubtree(node.childForFieldName("parameters"));
        break;
      }
      case "class_declaration": {
        declareName(node.childForFieldName("name"));
        break;
      }
      case "arrow_function":
      case "function":
      case "function_expression": {
        declareSubtree(node.childForFieldName("parameters"));
        break;
      }
      case "for_of_statement":
      case "for_in_statement":
      case "for_statement": {
        // Loop-head declarations (`for (const p of xs)`) are ordinary locals.
        // tree-sitter-javascript gives for-in/of a bare identifier left child
        // with NO field name, so the field lookup returns null - fall back to
        // declaring every named child except the loop body (last child).
        const left = node.childForFieldName("left");
        if (left) {
          declareSubtree(left);
        } else {
          // for-in/of: children[0] is the head binding (identifier or
          // destructuring pattern); everything after it is the iterated
          // expression (references stay references) and the body.
          const head = node.namedChildren[0];
          if (head) {
            if (head.type === "identifier") declareName(head);
            else if (head.type !== "statement_block") declareSubtree(head);
          }
        }
        break;
      }
      case "catch_clause": {
        // tree-sitter-javascript exposes the catch binding as a plain
        // identifier child without a field name, so childForFieldName(
        // "parameter") returns null. Bind it directly (and any pattern
        // subtree for destructuring catches) - benchmark Suite A defect #2:
        // `catch (error)` flagged `error` as an unknown reference.
        for (const child of node.namedChildren) {
          if (child.type === "statement_block") continue;
          if (child.type === "identifier") declareName(child);
          else declareSubtree(child);
        }
        break;
      }
      case "assignment_expression": {
        declareName(node.childForFieldName("left"));
        break;
      }
      default:
        break;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);

  const identifiers: ScannedIdentifier[] = [];
  walkNamed(root, (node) => {
    if (node.type !== "identifier") return;
    if (boundNodes.has(node.id) || consumedNodes.has(node.id)) return;
    if (declaredNames.has(node.text)) return;
    if (isStructuralPosition(node)) return;
    identifiers.push({ name: node.text, line: startLine(node) });
  });

  return {
    parseFailed: false,
    parseErrorLine: null,
    imports,
    resourceAccesses,
    identifiers,
  };
}

export function isSafeGlobal(name: string): boolean {
  return SAFE_GLOBAL_IDENTIFIERS.has(name);
}

function recordStaticImport(statement: Node, out: ScannedImport[]): void {
  const source = statement.childForFieldName("source");
  if (!source) return;
  out.push({
    specifier: stripQuotes(source.text),
    bindings: importBindings(statement),
    via: "static-import",
    line: startLine(statement),
    attempted: statement.text.split("\n")[0] ?? statement.text,
    startIndex: statement.startIndex,
    endIndex: statement.endIndex,
  });
}

function importBindings(statement: Node): ScannedImportBinding[] {
  const bindings: ScannedImportBinding[] = [];
  const clause = statement.namedChildren.find((c) => c.type === "import_clause");
  if (!clause) return bindings;
  for (const part of clause.namedChildren) {
    if (part.type === "identifier") {
      bindings.push({ kind: "default", local: part.text });
    } else if (part.type === "namespace_import") {
      const inner = part.namedChildren[0];
      if (inner) bindings.push({ kind: "namespace", local: inner.text });
    } else if (part.type === "named_imports") {
      for (const spec of part.namedChildren) {
        const name = spec.childForFieldName("name")?.text;
        const alias = spec.childForFieldName("alias")?.text;
        if (name) bindings.push({ kind: "named", imported: name, local: alias ?? name });
      }
    }
  }
  return bindings;
}

function recordCallExpression(
  node: Node,
  imports: ScannedImport[],
  accesses: ScannedResourceAccess[],
  consumed: Set<number>,
): void {
  const callee = node.childForFieldName("function");
  if (!callee) return;

  // Dynamic import() parses as a call_expression whose function field is a
  // dedicated `import` keyword node - NOT an identifier - so it must be
  // matched separately from require()/plain calls or it escapes analysis.
  const dynamicImportForm = callee.type === "import";

  if (callee.type === "identifier" || dynamicImportForm) {
    const args = node.childForFieldName("arguments");
    const firstArg = args?.namedChildren[0] ?? null;
    const isRequire = callee.type === "identifier" && callee.text === "require";
    const isDynamicImport = dynamicImportForm || (callee.type === "identifier" && callee.text === "import");

    if (isRequire || isDynamicImport) {
      consumed.add(callee.id);
      const literal = firstArg !== null && isLiteralString(firstArg);
      imports.push({
        specifier: literal ? literalString(firstArg as Node) : null,
        bindings: [],
        via: isRequire ? "require-call" : "dynamic-import",
        line: startLine(node),
        attempted: node.text.split("\n")[0] ?? node.text,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      });
      return;
    }

    if (callee.type === "identifier" && callee.text === "fetch") {
      consumed.add(callee.id);
      accesses.push({
        category: "network",
        target: firstArg && isLiteralString(firstArg) ? literalString(firstArg) : null,
        attempted: node.text.split("\n")[0] ?? node.text,
        line: startLine(node),
      });
      return;
    }
  }
}

function recordEnvAccess(
  node: Node,
  accesses: ScannedResourceAccess[],
  consumed: Set<number>,
): void {
  if (insideLongerEnvChain(node)) return;
  const steps = flattenChain(node);
  if (!steps || steps.length < 2) return;
  if (!isEnvRooted(steps)) return;

  consumeChainIdentifiers(steps, consumed);

  const nameStep = steps[2];
  let variable: string | null = null;
  if (nameStep && nameStep.accessor) {
    if (nameStep.via === "property" && isPropertyNameNode(nameStep.accessor)) {
      variable = nameStep.accessor.text;
    } else if (nameStep.via === "index" && isLiteralString(nameStep.accessor)) {
      variable = literalString(nameStep.accessor);
    }
  }

  accesses.push({
    category: "environment",
    target: variable,
    mode: isWriteContext(node) ? "write" : "read",
    attempted: chainText(steps),
    line: startLine(node),
  });
}

function insideLongerEnvChain(node: Node): boolean {
  let ancestor = node.parent;
  while (
    ancestor &&
    (ancestor.type === "member_expression" || ancestor.type === "subscript_expression")
  ) {
    const steps = flattenChain(ancestor);
    if (steps && isEnvRooted(steps)) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

function isEnvRooted(steps: ChainStep[]): boolean {
  const rootStep = steps[0];
  const envStep = steps[1];
  return Boolean(
    rootStep &&
      envStep &&
      rootStep.via === "root" &&
      rootStep.node.text === "process" &&
      envStep.accessor &&
      isPropertyNameNode(envStep.accessor) &&
      envStep.accessor.text === "env",
  );
}

function isPropertyNameNode(node: Node): boolean {
  return node.type === "identifier" || node.type === "property_identifier";
}

function consumeChainIdentifiers(steps: ChainStep[], consumed: Set<number>): void {
  for (const step of steps) {
    if (step.via === "root") {
      consumed.add(step.node.id);
    } else if (step.accessor && isPropertyNameNode(step.accessor)) {
      consumed.add(step.accessor.id);
    }
  }
}

function flattenChain(node: Node): ChainStep[] | null {
  const steps: ChainStep[] = [];
  let current: Node | null = node;
  while (
    current &&
    (current.type === "member_expression" || current.type === "subscript_expression")
  ) {
    if (current.type === "member_expression") {
      steps.push({
        via: "property",
        node: current,
        accessor: current.childForFieldName("property"),
      });
      current = current.childForFieldName("object");
    } else {
      steps.push({ via: "index", node: current, accessor: current.childForFieldName("index") });
      current = current.childForFieldName("object");
    }
  }
  if (!current || current.type !== "identifier") return null;
  steps.push({ via: "root", node: current, accessor: null });
  steps.reverse();
  return steps;
}

function chainText(steps: ChainStep[]): string {
  const last = steps[steps.length - 1];
  return (last?.node.text ?? "").split("\n")[0] ?? "";
}

function isWriteContext(node: Node): boolean {
  let current: Node | null = node.parent;
  while (current) {
    if (
      (current.type === "assignment_expression" ||
        current.type === "augmented_assignment_expression") &&
      current.childForFieldName("left")?.id === node.id
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isStructuralPosition(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "member_expression" && parent.childForFieldName("property")?.id === node.id) {
    return true;
  }
  if (parent.type === "pair" && parent.childForFieldName("key")?.id === node.id) {
    return true;
  }
  if (
    (parent.type === "method_definition" || parent.type === "method_signature") &&
    parent.childForFieldName("name")?.id === node.id
  ) {
    return true;
  }
  if (parent.type === "labeled_statement" && parent.childForFieldName("label")?.id === node.id) {
    return true;
  }
  return false;
}

function isLiteralString(node: Node): boolean {
  if (node.type === "string") return true;
  if (node.type === "template_string") {
    return !templateHasSubstitution(node);
  }
  return false;
}

function templateHasSubstitution(template: Node): boolean {
  let found = false;
  walkNamed(template, (n) => {
    if (n.type === "template_substitution") found = true;
  });
  return found;
}

function literalString(node: Node): string {
  if (node.type === "string") return stripQuotes(node.text);
  if (node.type === "template_string") return node.text.slice(1, -1);
  return "";
}

function stripQuotes(raw: string): string {
  if (
    raw.length >= 2 &&
    (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith("`"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function firstErrorLine(root: Node): number {
  let line = root.endPosition.row + 1;
  walkNamed(root, (n) => {
    if ((n.type === "ERROR" || n.isMissing) && n.startPosition.row + 1 < line) {
      line = n.startPosition.row + 1;
    }
  });
  return line;
}

function walkNamed(node: Node, visitFn: (n: Node) => void): void {
  for (const child of node.namedChildren) {
    visitFn(child);
    walkNamed(child, visitFn);
  }
}

function startLine(node: Node): number {
  return node.startPosition.row + 1;
}
