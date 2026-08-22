import type { LanguageId } from "./languages.js";

export interface SymbolSpan {
  name: string;
  startLine: number;
  endLine: number;
}

export interface FunctionSymbol extends SymbolSpan {
  exported: boolean;
}

export interface MethodSymbol extends SymbolSpan {}

export interface ClassSymbol extends SymbolSpan {
  exported: boolean;
  methods: MethodSymbol[];
}

export interface ImportSymbol {
  specifier: string;
  defaultImport: string | null;
  namespaceImport: string | null;
  namedImports: string[];
  line: number;
}

export type ExportKind = "named" | "default" | "all";

export interface ExportSymbol {
  kind: ExportKind;
  names: string[];
  line: number;
}

export interface FileSymbols {
  path: string;
  language: LanguageId;
  hasParseErrors: boolean;
  functions: FunctionSymbol[];
  classes: ClassSymbol[];
  imports: ImportSymbol[];
  exports: ExportSymbol[];
}
