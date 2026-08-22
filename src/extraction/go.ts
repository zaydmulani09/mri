import type Parser from "tree-sitter";
import type {
  CallSite,
  CalleeKind,
  ClassSymbol,
  FunctionSymbol,
  ImportSymbol,
  MethodSymbol,
  ReferenceSite,
} from "./types.js";

type Node = Parser.SyntaxNode;

export interface GoExtraction {
  functions: FunctionSymbol[];
  classes: ClassSymbol[];
  imports: ImportSymbol[];
  exports: [];
  calls: CallSite[];
  references: ReferenceSite[];
}

interface PendingMethod {
  typeName: string;
  methodName: string;
  receiverName: string | null;
  node: Node;
}

// Go visibility is purely lexical: an identifier starting with an uppercase
// letter is exported outside its package; everything else is package-private.
function isExportedName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

export function extractGo(root: Node): GoExtraction {
  const acc: GoExtraction = {
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    references: [],
  };

  // Receiver methods can precede their type declaration in source order, so
  // they are stashed and attached to classes in a second pass. Methods whose
  // receiver type is declared in another file stay unattached: inventing a
  // host node would fabricate structure the file does not define.
  const pendingMethods: PendingMethod[] = [];

  for (const child of root.namedChildren) {
    switch (child.type) {
      case "import_declaration":
        recordImports(child, acc);
        break;
      case "function_declaration": {
        const name = child.childForFieldName("name")?.text;
        if (!name) break;
        acc.functions.push({
          name,
          exported: isExportedName(name),
          startLine: startLine(child),
          endLine: endLine(child),
        });
        collectCalls(child.childForFieldName("body"), name, null, acc);
        break;
      }
      case "method_declaration":
        recordPendingMethod(child, pendingMethods);
        break;
      case "type_declaration":
        recordTypeDeclaration(child, acc);
        break;
      default:
        break;
    }
  }

  attachMethods(pendingMethods, acc);
  collectReferences(root, acc);
  return acc;
}

function recordImports(declaration: Node, acc: GoExtraction): void {
  const specList = declaration.namedChildren.find(
    (child) => child.type === "import_spec_list",
  );
  const specs = specList ? specList.namedChildren : declaration.namedChildren;

  for (const spec of specs) {
    if (spec.type !== "import_spec") continue;
    const pathNode = spec.childForFieldName("path");
    if (!pathNode) continue;
    const specifier = stripStringLiteral(pathNode.text);
    if (!specifier) continue;

    const line = startLine(spec);
    const nameNode = spec.childForFieldName("name");

    // Default local package name is the last path segment of the import
    // path; a named import overrides it, and blank/dot imports bind nothing
    // callable (blank side-effect only, dot merges unprovably into scope).
    let namespaceImport: string | null;
    if (nameNode === null) {
      namespaceImport = lastPathSegment(specifier);
    } else if (nameNode.type === "blank_identifier" || nameNode.text === "_") {
      namespaceImport = null;
    } else if (nameNode.text === ".") {
      namespaceImport = null;
    } else {
      namespaceImport = nameNode.text;
    }

    acc.imports.push({
      specifier,
      defaultImport: null,
      namespaceImport,
      namedImports: [],
      line,
    });
  }
}

function lastPathSegment(pathLike: string): string {
  const segments = pathLike.split("/");
  return segments[segments.length - 1] ?? pathLike;
}

function recordTypeDeclaration(declaration: Node, acc: GoExtraction): void {
  for (const spec of declaration.namedChildren) {
    if (spec.type !== "type_spec" && spec.type !== "type_spec_list") continue;
    const specs = spec.type === "type_spec" ? [spec] : spec.namedChildren;
    for (const one of specs) {
      if (one.type !== "type_spec") continue;
      const nameNode = one.childForFieldName("name");
      const typeNode = one.childForFieldName("type");
      if (!nameNode || !typeNode) continue;
      const name = nameNode.text;

      if (typeNode.type === "struct_type") {
        acc.classes.push(
          structClass(name, typeNode),
        );
      } else if (typeNode.type === "interface_type") {
        acc.classes.push(interfaceClass(name, typeNode));
      }
      // Simple renamed types (type MyInt int) carry no members to model.
    }
  }
}

function structClass(name: string, structType: Node): ClassSymbol {
  const methods: MethodSymbol[] = [];
  const bases: string[] = [];
  const list = structType.namedChildren.find(
    (child) => child.type === "field_declaration_list",
  );

  if (list) {
    for (const field of list.namedChildren) {
      if (field.type === "field_declaration") {
        // A field_declaration with no name field is an embedded type; its
        // whole subtree is the referenced type, which behaves like heritage.
        const nameNode = field.childForFieldName("name");
        if (!nameNode) bases.push(...embeddedTypeTexts(field));
      } else if (field.type === "type_identifier" || field.type === "qualified_type") {
        bases.push(field.text);
      }
    }
  }

  return {
    name,
    exported: isExportedName(name),
    methods,
    extends: bases,
    startLine: startLine(structType.parent ?? structType),
    endLine: endLine(structType.parent ?? structType),
  };
}

function interfaceClass(name: string, interfaceType: Node): ClassSymbol {
  const methods: MethodSymbol[] = [];
  const bases: string[] = [];

  for (const elem of interfaceType.namedChildren) {
    if (elem.type === "method_elem") {
      const methodName = elem.childForFieldName("name")?.text;
      if (methodName) {
        methods.push({
          name: methodName,
          startLine: startLine(elem),
          endLine: endLine(elem),
        });
      }
    } else if (
      elem.type === "type_elem" ||
      elem.type === "type_identifier" ||
      elem.type === "qualified_type"
    ) {
      bases.push(...embeddedTypeTexts(elem));
    }
  }

  return {
    name,
    exported: isExportedName(name),
    methods,
    extends: bases,
    startLine: startLine(interfaceType.parent ?? interfaceType),
    endLine: endLine(interfaceType.parent ?? interfaceType),
  };
}

function embeddedTypeTexts(node: Node): string[] {
  const out: string[] = [];
  if (node.type === "type_identifier" || node.type === "qualified_type") {
    out.push(node.text);
  }
  for (const child of node.namedChildren) {
    if (
      child.type === "type_identifier" ||
      child.type === "qualified_type"
    ) {
      out.push(child.text);
    }
  }
  return out;
}

function recordPendingMethod(
  declaration: Node,
  pending: PendingMethod[],
): void {
  const nameNode = declaration.childForFieldName("name");
  const receiverList = declaration.childForFieldName("receiver");
  if (!nameNode || !receiverList) return;

  const methodName = nameNode.text;
  const receiverParam = receiverList.namedChildren[0];
  const receiverTypeNode = receiverParam?.childForFieldName("type");
  const receiverNameNode = receiverParam?.childForFieldName("name");

  const receiverType =
    receiverTypeNode?.type === "pointer_type"
      ? receiverTypeNode.namedChildren[0]?.text
      : receiverTypeNode?.text;
  if (!receiverType) return;

  pending.push({
    typeName: receiverType.replace(/^\*|\[\]|\.\.\./g, ""),
    methodName,
    receiverName: receiverNameNode?.text ?? null,
    node: declaration,
  });
}

function attachMethods(pending: PendingMethod[], acc: GoExtraction): void {
  for (const method of pending) {
    const cls = acc.classes.find((candidate) => candidate.name === method.typeName);
    const span = {
      name: method.methodName,
      startLine: startLine(method.node),
      endLine: endLine(method.node),
    };
    const container = `${method.typeName}.${method.methodName}`;

    if (cls) {
      cls.methods.push(span);
      collectCalls(
        method.node.childForFieldName("body"),
        container,
        method.receiverName,
        acc,
      );
    }
    // Method on a type declared in another file: no host class here. Its
    // calls are dropped rather than attributed to an invented container.
  }
}

function startLine(node: Node): number {
  return node.startPosition.row + 1;
}

function endLine(node: Node): number {
  return node.endPosition.row + 1;
}

function stripStringLiteral(raw: string): string {
  if (
    raw.length >= 2 &&
    (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith("`"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function collectCalls(
  bodyNode: Node | null,
  container: string,
  receiverName: string | null,
  acc: GoExtraction,
): void {
  if (!bodyNode) return;
  walkNamed(bodyNode, (node) => {
    if (node.type !== "call_expression") return;
    if (isIntermediateCall(node)) return;
    const site = classifyCallee(node.childForFieldName("function"), receiverName);
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

function isIntermediateCall(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "call_expression") {
    const callee = parent.childForFieldName("function");
    if (callee && callee.id === node.id) return true;
  }
  if (parent.type === "selector_expression") {
    const operand = parent.childForFieldName("operand");
    if (operand && operand.id === node.id) return true;
  }
  return false;
}

function classifyCallee(
  callee: Node | null,
  receiverName: string | null,
): { kind: CalleeKind; object: string | null; name: string } | null {
  if (!callee) return null;
  switch (callee.type) {
    case "identifier":
      return { kind: "plain", object: null, name: callee.text };
    case "selector_expression": {
      const property = callee.childForFieldName("field")?.text;
      const operand = callee.childForFieldName("operand");
      if (!property || !operand) return null;
      if (
        receiverName !== null &&
        operand.type === "identifier" &&
        operand.text === receiverName
      ) {
        // r.helper() inside a method of r's own type is provably a method
        // lookup on that type's chain - the one dynamic dispatch Go allows
        // resolving without guessing.
        return { kind: "self", object: null, name: property };
      }
      return { kind: "member", object: operand.text, name: property };
    }
    default:
      return null;
  }
}

const REFERENCE_IDENTIFIER_TYPES = new Set(["identifier", "type_identifier"]);

const REFERENCE_SKIP_SUBTREES = new Set([
  "import_declaration",
  "parameter_list",
]);

function collectReferences(root: Node, acc: GoExtraction): void {
  const visit = (node: Node): void => {
    if (REFERENCE_SKIP_SUBTREES.has(node.type)) return;
    if (REFERENCE_IDENTIFIER_TYPES.has(node.type)) {
      if (
        !isTypeDeclarationName(node) &&
        !isCalleeOrFieldPosition(node) &&
        !isBindingSite(node) &&
        node.text !== "_"
      ) {
        acc.references.push({
          name: node.text,
          line: startLine(node),
          container: "<file>",
        });
      }
      return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
}

function isTypeDeclarationName(node: Node): boolean {
  const parent = node.parent;
  if (!parent || parent.type !== "type_spec") return false;
  const nameNode = parent.childForFieldName("name");
  return nameNode !== null && nameNode.id === node.id;
}

function isCalleeOrFieldPosition(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (parent.type === "call_expression") {
    const callee = parent.childForFieldName("function");
    if (callee && callee.id === node.id) return true;
  }
  if (parent.type === "selector_expression") {
    const field = parent.childForFieldName("field");
    if (field && field.id === node.id) return true;
  }
  if (parent.type === "qualified_type") {
    const pkg = parent.childForFieldName("package");
    if (pkg && pkg.id === node.id) return true;
  }
  if (parent.type === "keyed_element") {
    const key = parent.childForFieldName("key");
    if (key && key.id === node.id) return true;
  }
  return false;
}

function isBindingSite(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (
    (parent.type === "var_spec" || parent.type === "const_spec") &&
    parent.childForFieldName("name")?.id === node.id
  ) {
    return true;
  }
  if (
    parent.type === "short_var_declaration" ||
    parent.type === "assignment_statement"
  ) {
    const left = parent.childForFieldName("left");
    if (left?.namedChildren.some((child) => child.id === node.id)) return true;
  }
  return false;
}
