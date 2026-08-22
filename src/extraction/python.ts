import type Parser from "tree-sitter";
import type {
  CallSite,
  CalleeKind,
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
  calls: CallSite[];
}

export function extractPython(root: Node): PythonExtraction {
  const acc: PythonExtraction = {
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
  };
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
  collectCalls(node, name, acc);
}

function recordClass(node: Node, acc: PythonExtraction): void {
  const className = node.childForFieldName("name")?.text ?? "<anonymous>";
  const methods: MethodSymbol[] = [];
  const superClasses = collectSuperClasses(node);
  const body = node.childForFieldName("body");
  if (body && body.type === "block") {
    for (const member of body.namedChildren) {
      const definition =
        member.type === "decorated_definition"
          ? member.childForFieldName("definition")
          : member;
      if (definition?.type === "function_definition") {
        const methodName = definition.childForFieldName("name")?.text;
        if (methodName) {
          methods.push({
            name: methodName,
            startLine: startLine(definition),
            endLine: endLine(definition),
          });
          collectCalls(
            definition,
            methodName === "__init__" ? className : `${className}.${methodName}`,
            acc,
          );
        }
      }
    }
  }
  acc.classes.push({
    name: className,
    exported: false,
    methods,
    extends: superClasses,
    startLine: startLine(node),
    endLine: endLine(node),
  });
}

function collectSuperClasses(classNode: Node): string[] {
  const superclasses = classNode.childForFieldName("superclasses");
  if (!superclasses) return [];
  const bases: string[] = [];
  for (const arg of superclasses.namedChildren) {
    if (arg.type === "keyword_argument") continue;
    bases.push(arg.text);
  }
  return bases;
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

function collectCalls(root: Node, container: string, acc: PythonExtraction): void {
  walkNamed(root, (node) => {
    if (node.type !== "call") return;
    const site = classifyCallee(node.childForFieldName("function"));
    if (site) {
      acc.calls.push({ ...site, line: startLine(node), container });
    }
  });
}

function walkNamed(node: Node, visit: (n: Node) => void): void {
  for (const child of node.namedChildren) {
    visit(child);
    walkNamed(child, visit);
  }
}

function classifyCallee(
  callee: Node | null,
): { kind: CalleeKind; object: string | null; name: string } | null {
  if (!callee) return null;
  switch (callee.type) {
    case "identifier":
      return { kind: "plain", object: null, name: callee.text };
    case "attribute": {
      const property = callee.childForFieldName("attribute")?.text;
      const object = callee.childForFieldName("object");
      if (!property || !object) return null;
      if (object.type === "identifier" && object.text === "self") {
        return { kind: "self", object: null, name: property };
      }
      if (
        object.type === "call" &&
        object.childForFieldName("function")?.text === "super"
      ) {
        return { kind: "super", object: null, name: property };
      }
      if (object.type === "identifier" && object.text === "cls") {
        return { kind: "self", object: null, name: property };
      }
      return { kind: "member", object: object.text, name: property };
    }
    default:
      return null;
  }
}
