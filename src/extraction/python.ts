import type Parser from "tree-sitter";
import type {
  ClassSymbol,
  ExportSymbol,
  FunctionSymbol,
  ImportSymbol,
  MethodSymbol,
} from "./types.js";

type Node = Parser.SyntaxNode;

export interface PythonExtraction {
  functions: FunctionSymbol[];
  classes: ClassSymbol[];
  imports: ImportSymbol[];
  exports: ExportSymbol[];
}

export function extractPython(root: Node): PythonExtraction {
  const acc: PythonExtraction = { functions: [], classes: [], imports: [], exports: [] };
  for (const child of root.namedChildren) {
    visitTopLevelStatement(child, acc);
  }
  return acc;
}

function visitTopLevelStatement(node: Node, acc: PythonExtraction): void {
  switch (node.type) {
    case "function_definition":
      recordFunction(node, acc);
      return;
    case "decorated_definition": {
      const definition = node.childForFieldName("definition");
      if (definition?.type === "function_definition") recordFunction(definition, acc);
      if (definition?.type === "class_definition") recordClass(definition, acc);
      return;
    }
    case "class_definition":
      recordClass(node, acc);
      return;
    case "import_statement":
      recordPlainImports(node, acc);
      return;
    case "import_from_statement":
      recordFromImport(node, acc);
      return;
    default:
      return;
  }
}

function recordFunction(node: Node, acc: PythonExtraction): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  acc.functions.push({
    name,
    exported: false,
    startLine: startLine(node),
    endLine: endLine(node),
  });
}

function recordClass(node: Node, acc: PythonExtraction): void {
  const className = node.childForFieldName("name")?.text ?? "<anonymous>";
  const methods: MethodSymbol[] = [];
  const body = node.childForFieldName("body");
  if (body && body.type === "block") {
    for (const member of body.namedChildren) {
      if (member.type === "function_definition") {
        const methodName = member.childForFieldName("name")?.text;
        if (methodName) {
          methods.push({
            name: methodName,
            startLine: startLine(member),
            endLine: endLine(member),
          });
        }
      } else if (member.type === "decorated_definition") {
        const definition = member.childForFieldName("definition");
        if (definition?.type === "function_definition") {
          const methodName = definition.childForFieldName("name")?.text;
          if (methodName) {
            methods.push({
              name: methodName,
              startLine: startLine(definition),
              endLine: endLine(definition),
            });
          }
        }
      }
    }
  }
  acc.classes.push({
    name: className,
    exported: false,
    methods,
    startLine: startLine(node),
    endLine: endLine(node),
  });
}

function recordPlainImports(statement: Node, acc: PythonExtraction): void {
  for (const imported of statement.childrenForFieldName("name")) {
    if (imported.type === "aliased_import") {
      const moduleNode = imported.childForFieldName("name");
      const aliasNode = imported.childForFieldName("alias");
      if (!moduleNode) continue;
      acc.imports.push({
        specifier: moduleNode.text,
        defaultImport: null,
        namespaceImport: aliasNode?.text ?? null,
        namedImports: [],
        line: startLine(statement),
      });
    } else {
      const specifierText = imported.text;
      const segments = specifierText.split(".");
      acc.imports.push({
        specifier: specifierText,
        defaultImport: null,
        namespaceImport: segments[0] ?? specifierText,
        namedImports: [],
        line: startLine(statement),
      });
    }
  }
}

function recordFromImport(statement: Node, acc: PythonExtraction): void {
  const moduleNameNode = statement.childForFieldName("module_name");
  if (!moduleNameNode) return;
  const entry: ImportSymbol = {
    specifier: moduleNameNode.text,
    defaultImport: null,
    namespaceImport: null,
    namedImports: [],
    line: startLine(statement),
  };
  for (const imported of statement.childrenForFieldName("name")) {
    if (imported.id === moduleNameNode.id) continue;
    if (imported.type === "aliased_import") {
      const aliasNode = imported.childForFieldName("alias");
      entry.namedImports.push(aliasNode?.text ?? imported.text);
    } else {
      entry.namedImports.push(imported.text);
    }
  }
  const hasWildcard = statement.namedChildren.some((c) => c.type === "wildcard_import");
  if (hasWildcard) entry.namedImports.push("*");
  acc.imports.push(entry);
}

function startLine(node: Node): number {
  return node.startPosition.row + 1;
}

function endLine(node: Node): number {
  return node.endPosition.row + 1;
}
