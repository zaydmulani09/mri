import type { ParseResult, ReasoningQuery } from "./intent.js";
import { SUPPORTED_INTENTS } from "./intent.js";

const TARGET = String.raw`["']?([A-Za-z0-9_./@#-]+)["']?`;
const OPTIONAL_SCOPE = String.raw`(?:\s+in\s+["']?([A-Za-z0-9_./-]+)["']?)?`;

interface PatternRule {
  re: RegExp;
  build: (match: RegExpMatchArray) => ReasoningQuery;
}

const RULES: readonly PatternRule[] = [
  {
    re: new RegExp(
      String.raw`(?:blast\s*radius(?:\s+of)?|impact\s+of\s+(?:changing|removing|deleting)|what\s+depends\s+on|who\s+calls|who\s+uses)\s+${TARGET}\s*$`,
      "i",
    ),
    build: (m) => ({ type: "blast-radius", target: m[1] as string }),
  },
  {
    re: new RegExp(String.raw`\bis\s+${TARGET}\s+(?:a\s+)?dead(?:\s+code)?\b`, "i"),
    build: (m) => ({ type: "dead-code-check", target: m[1] as string }),
  },
  {
    re: new RegExp(String.raw`\bis\s+${TARGET}\s+unused\b`, "i"),
    build: (m) => ({ type: "dead-code-check", target: m[1] as string }),
  },
  {
    re: new RegExp(String.raw`\bwhat(?:'s|\s+is)\s+the\s+riskiest\s+file${OPTIONAL_SCOPE}\b`, "i"),
    build: (m) => ({ type: "riskiest-file", scope: m[1] }),
  },
  {
    re: new RegExp(String.raw`\bwhich\s+file\s+is\s+(?:the\s+)?riskiest${OPTIONAL_SCOPE}\b`, "i"),
    build: (m) => ({ type: "riskiest-file", scope: m[1] }),
  },
  {
    re: new RegExp(
      String.raw`\bwhat(?:'s|\s+is)\s+(?:not\s+tested|untested)${OPTIONAL_SCOPE}\b`,
      "i",
    ),
    build: (m) => ({ type: "untested", scope: m[1] }),
  },
  {
    re: new RegExp(String.raw`\buntested\s+(?:files|code|things|symbols)${OPTIONAL_SCOPE}\b`, "i"),
    build: (m) => ({ type: "untested", scope: m[1] }),
  },
  {
    re: new RegExp(String.raw`\bwhat\s+lacks?\s+(?:test\s+)?coverage${OPTIONAL_SCOPE}\b`, "i"),
    build: (m) => ({ type: "untested", scope: m[1] }),
  },
];

export function parseQuestion(question: string): ParseResult {
  for (const rule of RULES) {
    const match = question.match(rule.re);
    if (match) {
      return { ok: true, query: rule.build(match) };
    }
  }
  return {
    ok: false,
    reason:
      `I can't map that to a supported graph query, so I won't guess. ` +
      `Supported questions: ${SUPPORTED_INTENTS.join("; ")}.`,
  };
}
