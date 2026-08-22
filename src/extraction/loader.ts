import Parser from "tree-sitter";
import JavaScriptGrammar from "tree-sitter-javascript";
import TypeScriptGrammars from "tree-sitter-typescript";
import PythonGrammar from "tree-sitter-python";
import type { LanguageId } from "./languages.js";

type Grammar = NonNullable<Parameters<InstanceType<typeof Parser>["setLanguage"]>[0]>;

const GRAMMARS: Record<LanguageId, Grammar> = {
  javascript: JavaScriptGrammar as Grammar,
  typescript: TypeScriptGrammars.typescript as Grammar,
  tsx: TypeScriptGrammars.tsx as Grammar,
  python: PythonGrammar as Grammar,
};

let sharedParser: Parser | null = null;

export function parserFor(language: LanguageId): Parser {
  if (!sharedParser) sharedParser = new Parser();
  sharedParser.setLanguage(GRAMMARS[language]);
  return sharedParser;
}
