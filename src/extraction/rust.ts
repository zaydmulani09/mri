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

export interface RustExtraction {
  functions: FunctionSymbol[];
  classes: ClassSymbol[];
  imports: ImportSymbol[];
  exports: [];
  calls: CallSite[];
  references: ReferenceSite[];
}

interface PendingImplMethod {
  typeName: string;
  methodName: string;
  node: Node;
}

// Rust visibility is explicit: items are private unless decorated with `pub`.
function isPublic(node: Node): boolean {
  return (
    node.namedChildren.some((child) => child.type === "visibility_modifier") ||
    node.children.some((child) => child.type === "visibility_modifier")
  );
}

export function extractRust(root: Node): RustExtraction {
  const acc: RustExtraction = {
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    references: [],
  };

  // Impl blocks can appear before or after their type's definition, so their
  // methods are stashed and attached in a second pass - same structure as
  // Go's receiver methods. An inherent impl on a type declared in another
  // module stays unattached rather than inventing a host node.
  const pendingImplMethods: PendingImplMethod[] = [];
  const pendingTraitImpls: Array<{ typeName: string; traitName: string }> = [];

  for (const child of root.namedChildren) {
    switch (child.type) {
      case "use_declaration":
        recordUse(child, acc);
        break;
      case "function_item": {
        const name = child.childForFieldName("name")?.text;
        if (!name) break;
        acc.functions.push({
          name,
          exported: isPublic(child),
          startLine: startLine(child),
          endLine: endLine(child),
        });
        collectCalls(child.childForFieldName("body"), name, false, acc);
        break;
      }
      case "struct_item":
      case "enum_item":
      case "type_item":
        recordTypeLike(child, acc);
        break;
      case "trait_item":
        recordTrait(child, acc);
        break;
      case "impl_item":
        recordImpl(child, pendingImplMethods, pendingTraitImpls);
        break;
      default:
        break;
    }
  }

  attachImplItems(pendingImplMethods, pendingTraitImpls, acc);
  collectReferences(root, acc);
  return acc;
}

function recordUse(declaration: Node, acc: RustExtraction): void {
  const argument = declaration.childForFieldName("argument");
  if (!argument) return;

  const line = startLine(declaration);
  // Grouped use lists span lines in the wild; collapse whitespace so
  // downstream output (external module listings) stays single-line.
  const specifier = argument.text.replace(/\s+/g, " ");

  // A plain `use a::b;` binds the last segment locally; grouped and glob
  // forms bind exactly the named items (a glob binds nothing provable, so
  // it is recorded for the import graph but creates no usable binding).
  if (argument.type === "scoped_identifier" || argument.type === "identifier") {
    const segments = specifier.split("::");
    acc.imports.push({
      specifier,
      defaultImport: null,
      namespaceImport: segments[segments.length - 1] ?? specifier,
      namedImports: [],
      line,
    });
    return;
  }

  if (argument.type === "scoped_use_list" || argument.type === "use_list") {
    const entry: ImportSymbol = {
      specifier,
      defaultImport: null,
      namespaceImport: null,
      namedImports: [],
      line,
    };
    if (argument.type === "scoped_use_list") {
      const pathNode = argument.childForFieldName("path");
      const listNode = argument.namedChildren.find((c) => c.type === "use_list");
      const pathText = pathNode?.text ?? "";
      const segments = pathText.split("::");
      // `use a::b::{self, C}` binds b itself plus each listed item.
      entry.namespaceImport = segments[segments.length - 1] || null;
      if (listNode) collectUseListNames(listNode, entry.namedImports);
    } else {
      collectUseListNames(argument, entry.namedImports);
    }
    acc.imports.push(entry);
  }
}

function collectUseListNames(listNode: Node, out: string[]): void {
  for (const item of listNode.namedChildren) {
    switch (item.type) {
      case "identifier":
        out.push(item.text);
        break;
      case "scoped_identifier":
        out.push(item.childForFieldName("name")?.text ?? item.text);
        break;
      case "glob_modifier":
      case "*":
        out.push("*");
        break;
      case "use_list":
        collectUseListNames(item, out);
        break;
      default:
        // `self` keyword entries bind the parent module itself, already
        // covered via namespaceImport; anything exotic stays unbound.
        break;
    }
  }
}

function recordTypeLike(item: Node, acc: RustExtraction): void {
  const name = item.childForFieldName("name")?.text;
  if (!name) return;
  acc.classes.push({
    name,
    exported: isPublic(item),
    methods: [],
    extends: [],
    startLine: startLine(item),
    endLine: endLine(item),
  });
}

function recordTrait(traitItem: Node, acc: RustExtraction): void {
  const name = traitItem.childForFieldName("name")?.text;
  if (!name) return;

  const methods: MethodSymbol[] = [];
  const body = traitItem.childForFieldName("body");
  if (body) {
    for (const signature of body.namedChildren) {
      if (signature.type !== "function_signature_item") continue;
      const methodName = signature.childForFieldName("name")?.text;
      if (!methodName) continue;
      methods.push({
        name: methodName,
        startLine: startLine(signature),
        endLine: endLine(signature),
      });
    }
  }

  acc.classes.push({
    name,
    exported: isPublic(traitItem),
    methods,
    extends: [],
    startLine: startLine(traitItem),
    endLine: endLine(traitItem),
  });
}

function recordImpl(
  implItem: Node,
  pendingMethods: PendingImplMethod[],
  pendingTraitImpls: Array<{ typeName: string; traitName: string }>,
): void {
  const selfType = implItem.childForFieldName("type");
  const traitType = implItem.childForFieldName("trait");
  if (!selfType) return;
  const typeName = selfType.text;

  if (traitType) {
    pendingTraitImpls.push({ typeName, traitName: traitType.text });
  }

  const body = implItem.childForFieldName("body");
  if (!body) return;

  for (const item of body.namedChildren) {
    if (item.type !== "function_item") continue;
    const methodName = item.childForFieldName("name")?.text;
    if (!methodName) continue;
    pendingMethods.push({ typeName, methodName, node: item });
  }
}

function attachImplItems(
  pendingMethods: PendingImplMethod[],
  pendingTraitImpls: Array<{ typeName: string; traitName: string }>,
  acc: RustExtraction,
): void {
  for (const implTrait of pendingTraitImpls) {
    const cls = acc.classes.find((candidate) => candidate.name === implTrait.typeName);
    if (cls && !cls.extends.includes(implTrait.traitName)) {
      // `impl Trait for Type` is a provable type-to-trait relation, so it is
      // recorded as heritage and resolved by the existing inheritance pass.
      cls.extends.push(implTrait.traitName);
    }
  }

  for (const method of pendingMethods) {
    const cls = acc.classes.find((candidate) => candidate.name === method.typeName);
    const span = {
      name: method.methodName,
      startLine: startLine(method.node),
      endLine: endLine(method.node),
    };
    if (cls) {
      cls.methods.push(span);
      collectCalls(
        method.node.childForFieldName("body"),
        `${method.typeName}.${method.methodName}`,
        true,
        acc,
      );
    }
    // Inherent methods of types declared elsewhere: dropped, not invented.
  }
}

function startLine(node: Node): number {
  return node.startPosition.row + 1;
}

function endLine(node: Node): number {
  return node.endPosition.row + 1;
}

function collectCalls(
  bodyNode: Node | null,
  container: string,
  inMethodImpl: boolean,
  acc: RustExtraction,
): void {
  if (!bodyNode) return;
  walkNamed(bodyNode, (node) => {
    if (node.type !== "call_expression") return;
    if (isIntermediateCall(node)) return;
    const site = classifyCallee(node.childForFieldName("function"), inMethodImpl);
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
  if (parent.type === "generic_function") {
    const callee = parent.childForFieldName("function");
    if (callee && callee.id === node.id) return true;
  }
  if (parent.type === "field_expression") {
    const value = parent.childForFieldName("value");
    if (value && value.id === node.id) return true;
  }
  if (parent.type === "type_cast_expression") return true;
  return false;
}

function classifyCallee(
  callee: Node | null,
  inMethodImpl: boolean,
): { kind: CalleeKind; object: string | null; name: string } | null {
  if (!callee) return null;
  switch (callee.type) {
    case "identifier":
      return { kind: "plain", object: null, name: callee.text };
    case "generic_function":
      return classifyCallee(callee.childForFieldName("function"), inMethodImpl);
    case "scoped_identifier": {
      const name = callee.childForFieldName("name")?.text;
      const path = callee.childForFieldName("path");
      if (!name || !path) return null;
      return { kind: "member", object: path.text, name };
    }
    case "field_expression": {
      const field = callee.childForFieldName("field")?.text;
      const value = callee.childForFieldName("value");
      if (!field || !value) return null;
      // s.area() where s is &dyn Shape cannot be proven statically; but
      // self.helper() inside an impl block is provably this-type dispatch
      // (`self` parses as its own keyword node here, not an identifier).
      if (
        inMethodImpl &&
        (value.type === "self" ||
          (value.type === "identifier" && value.text === "self"))
      ) {
        return { kind: "self", object: null, name: field };
      }
      return { kind: "member", object: value.text, name: field };
    }
    default:
      return null;
  }
}

const REFERENCE_SKIP_SUBTREES = new Set([
  "use_declaration",
  "parameters",
]);

function collectReferences(root: Node, acc: RustExtraction): void {
  const visit = (node: Node): void => {
    if (REFERENCE_SKIP_SUBTREES.has(node.type)) return;
    if (node.type === "identifier" || node.type === "type_identifier") {
      if (
        !isDeclarationName(node) &&
        !isPathOrCalleePosition(node) &&
        !isBindingSite(node)
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

const DECLARATION_NAME_PARENTS = new Set([
  "function_item",
  "trait_item",
  "struct_item",
  "enum_item",
  "type_item",
]);

function isDeclarationName(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (DECLARATION_NAME_PARENTS.has(parent.type)) {
    const nameNode = parent.childForFieldName("name");
    if (nameNode && nameNode.id === node.id) return true;
  }
  if (parent.type === "enum_variant") {
    const nameNode = parent.childForFieldName("name");
    if (nameNode && nameNode.id === node.id) return true;
  }
  return false;
}

function isPathOrCalleePosition(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  // Everything inside a qualified path is module/crate navigation, handled
  // by the call/import logic rather than free references.
  if (parent.type === "scoped_identifier" || parent.type === "macro_invocation") {
    return true;
  }
  if (parent.type === "call_expression") {
    const callee = parent.childForFieldName("function");
    if (callee && callee.id === node.id) return true;
  }
  if (parent.type === "generic_function") {
    const callee = parent.childForFieldName("function");
    if (callee && callee.id === node.id) return true;
  }
  if (parent.type === "field_expression") {
    const field = parent.childForFieldName("field");
    if (field && field.id === node.id) return true;
  }
  return false;
}

function isBindingSite(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (parent.type === "let_declaration") {
    const pattern = parent.childForFieldName("pattern");
    if (pattern?.namedChildren.some((child) => child.id === node.id)) return true;
    if (pattern?.id === node.id) return true;
  }
  if (parent.type === "assignment_expression") {
    const left = parent.childForFieldName("left");
    if (left && left.id === node.id) return true;
  }
  if (parent.type === "compound_assignment_expr") {
    const left = parent.childForFieldName("left");
    if (left && left.id === node.id) return true;
  }
  return false;
}
