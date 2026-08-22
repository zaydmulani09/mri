import type Parser from "tree-sitter";
import type {
  ClassSymbol,
  ExportSymbol,
  FunctionSymbol,
  ImportSymbol,
  MethodSymbol,
} from "./types.js";

type Node = Parser.SyntaxNode;

export interface JavaScriptExtraction {
  functions: FunctionSymbol[];
  classes: ClassSymbol[];
  imports: ImportSymbol[];
  exports: ExportSymbol[];
}

const FUNCTION_VALUE_TYPES = new Set([
  "arrow_function",
  "function_expression",
  "generator_function_expression",
]);

export function extractJavaScript(root: Node): JavaScriptExtraction {
  const acc: JavaScriptExtraction = { functions: [], classes: [], imports: [], exports: [] };
  for (const child of root.namedChildren) {
    visitTopLevelStatement(child, acc);
  }
  return acc;
}

function visitTopLevelStatement(node: Node, acc: JavaScriptExtraction): void {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (name) recordFunction(node, name, false, acc);
      return;
    }
    case "class_declaration":
    case "abstract_class_declaration":
      recordClass(node, false, acc);
      return;
    case "lexical_declaration":
    case "variable_declaration":
      recordVariableDeclaration(node, false, acc);
      return;
    case "import_statement":
      recordImport(node, acc);
      return;
    case "expression_statement": {
      const specifier = requireCallSpecifier(node.namedChildren[0] ?? null);
      if (specifier !== null) {
        acc.imports.push({
          specifier,
          defaultImport: null,
          namespaceImport: null,
          namedImports: [],
          line: startLine(node),
        });
      }
      return;
    }
    case "export_statement":
      recordExport(node, acc);
      return;
    default:
      return;
  }
}

function recordVariableDeclaration(
  decl: Node,
  exported: boolean,
  acc: JavaScriptExtraction,
): void {
  for (const declarator of decl.namedChildren) {
    if (declarator.type !== "variable_declarator") continue;
    const name = declarator.childForFieldName("name")?.text;
    if (!name) continue;
    const value = declarator.childForFieldName("value");
    const specifier = requireCallSpecifier(value);
    if (specifier !== null) {
      acc.imports.push({
        specifier,
        defaultImport: name,
        namespaceImport: null,
        namedImports: [],
        line: startLine(declarator),
      });
    } else if (value && FUNCTION_VALUE_TYPES.has(value.type)) {
      recordFunction(value, name, exported, acc);
    }
  }
}

function recordFunction(
  node: Node,
  name: string,
  exported: boolean,
  acc: JavaScriptExtraction,
): void {
  const fn: FunctionSymbol = {
    name,
    exported,
    startLine: startLine(node),
    endLine: endLine(node),
  };
  acc.functions.push(fn);
}

function recordClass(node: Node, exported: boolean, acc: JavaScriptExtraction): void {
  const className = node.childForFieldName("name")?.text ?? "<anonymous>";
  const methods: MethodSymbol[] = [];
  const body = node.childForFieldName("body");
  if (body) {
    for (const member of body.namedChildren) {
      switch (member.type) {
        case "method_definition":
        case "abstract_method_signature": {
          const methodName = member.childForFieldName("name")?.text;
          if (methodName) {
            methods.push({
              name: methodName,
              startLine: startLine(member),
              endLine: endLine(member),
            });
          }
          break;
        }
        case "field_definition":
        case "public_field_definition": {
          const prop =
            member.childForFieldName("property") ?? member.childForFieldName("name");
          const value = member.childForFieldName("value");
          if (prop && value && FUNCTION_VALUE_TYPES.has(value.type)) {
            methods.push({
              name: prop.text,
              startLine: startLine(member),
              endLine: endLine(member),
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }
  acc.classes.push({
    name: className,
    exported,
    methods,
    startLine: startLine(node),
    endLine: endLine(node),
  });
}

function recordImport(statement: Node, acc: JavaScriptExtraction): void {
  const sourceNode = statement.childForFieldName("source");
  if (!sourceNode) return;
  const entry: ImportSymbol = {
    specifier: stripQuotes(sourceNode.text),
    defaultImport: null,
    namespaceImport: null,
    namedImports: [],
    line: startLine(statement),
  };
  const clause =
    statement.namedChildren.find((child) => child.type === "import_clause") ?? null;
  if (clause) {
    for (const part of clause.namedChildren) {
      switch (part.type) {
        case "identifier":
          entry.defaultImport = part.text;
          break;
        case "namespace_import":
          entry.namespaceImport = part.namedChildren[0]?.text ?? null;
          break;
        case "named_imports":
          for (const spec of part.namedChildren) {
            const imported =
              spec.childForFieldName("alias")?.text ??
              spec.childForFieldName("name")?.text;
            if (imported) entry.namedImports.push(imported);
          }
          break;
        default:
          break;
      }
    }
  }
  acc.imports.push(entry);
}

function recordExport(statement: Node, acc: JavaScriptExtraction): void {
  const declaration = statement.childForFieldName("declaration");
  const source = statement.childForFieldName("source");
  const isDefaultExport = statement.children.some(
    (child) => !child.isNamed && child.type === "default",
  );

  if (isDefaultExport) {
    let names: string[] = [];
    if (declaration) {
      names = recordDeclaration(declaration, true, acc);
    } else {
      const exprs = statement.namedChildren.filter((n) => n.type !== "string");
      const expr = exprs[exprs.length - 1];
      if (expr && expr.type === "identifier") names = [expr.text];
    }
    acc.exports.push({ kind: "default", names, line: startLine(statement) });
    return;
  }

  if (declaration) {
    const names = recordDeclaration(declaration, true, acc);
    acc.exports.push({ kind: "named", names, line: startLine(statement) });
    return;
  }

  let sawClause = false;
  for (const child of statement.namedChildren) {
    if (child.type === "export_clause") {
      sawClause = true;
      const names = child.namedChildren
        .map(
          (spec) =>
            spec.childForFieldName("alias")?.text ?? spec.childForFieldName("name")?.text,
        )
        .filter((n): n is string => Boolean(n));
      acc.exports.push({ kind: "named", names, line: startLine(statement) });
    } else if (child.type === "namespace_export") {
      sawClause = true;
      const nsName = child.namedChildren[0]?.text;
      acc.exports.push({
        kind: "all",
        names: nsName ? [nsName] : [],
        line: startLine(statement),
      });
    }
  }
  if (!sawClause && source) {
    acc.exports.push({ kind: "all", names: [], line: startLine(statement) });
  }
}

function recordDeclaration(
  node: Node,
  exported: boolean,
  acc: JavaScriptExtraction,
): string[] {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (name) recordFunction(node, name, exported, acc);
      return name ? [name] : [];
    }
    case "class_declaration":
    case "abstract_class_declaration":
      recordClass(node, exported, acc);
      return [node.childForFieldName("name")?.text ?? "<anonymous>"];
    case "lexical_declaration":
    case "variable_declaration": {
      recordVariableDeclaration(node, exported, acc);
      return node.namedChildren
        .filter((c) => c.type === "variable_declarator")
        .map((c) => c.childForFieldName("name")?.text)
        .filter((n): n is string => Boolean(n));
    }
    case "interface_declaration":
    case "type_alias_declaration":
    case "enum_declaration":
    case "internal_module":
    case "module":
      return [node.childForFieldName("name")?.text ?? ""].filter(Boolean);
    default:
      return [];
  }
}

function requireCallSpecifier(node: Node | null): string | null {
  if (!node || node.type !== "call_expression") return null;
  const callee = node.childForFieldName("function");
  if (!callee || callee.type !== "identifier" || callee.text !== "require") return null;
  const args = node.childForFieldName("arguments");
  const first = args?.namedChildren[0];
  if (!first || first.type !== "string") return null;
  return stripQuotes(first.text);
}

function startLine(node: Node): number {
  return node.startPosition.row + 1;
}

function endLine(node: Node): number {
  return node.endPosition.row + 1;
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
