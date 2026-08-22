export type ReasoningQuery =
  | { type: "blast-radius"; target: string }
  | { type: "dead-code-check"; target: string }
  | { type: "riskiest-file"; scope?: string }
  | { type: "untested"; scope?: string };

export type ParseResult =
  | { ok: true; query: ReasoningQuery; via: "deterministic" | "llm" }
  | { ok: false; reason: string };

export const SUPPORTED_INTENTS: readonly string[] = [
  "blast radius of <function-or-file>",
  "what depends on <function-or-file>",
  "who calls <function>",
  "is <name> dead code",
  "what is the riskiest file [in <scope>]",
  "what is not tested [in <scope>]",
];
