import type { ParseResult, ReasoningQuery } from "./intent.js";
import { SUPPORTED_INTENTS } from "./intent.js";
import type { LlmClient } from "./llm.js";

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
      return { ok: true, query: rule.build(match), via: "deterministic" };
    }
  }
  return {
    ok: false,
    reason:
      `I can't map that to a supported graph query, so I won't guess. ` +
      `Supported questions: ${SUPPORTED_INTENTS.join("; ")}.`,
  };
}

export async function parseQuestionSmart(
  question: string,
  client: LlmClient,
): Promise<ParseResult> {
  const llmResult = await tryLlmParse(client, question);
  if (llmResult !== null) return { ok: true, query: llmResult, via: "llm" };
  return parseQuestion(question);
}

async function tryLlmParse(
  client: LlmClient,
  question: string,
): Promise<ReasoningQuery | null> {
  const response = await client.complete(buildParsePrompt(question));
  if (response === null || response.trim().length === 0) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response);
  } catch {
    return null;
  }
  return validateQueryShape(parsedJson);
}

function buildParsePrompt(question: string): string {
  return [
    "Map the question onto exactly one of these JSON shapes, or exactly {\"type\":\"unsupported\"}:",
    '{"type":"blast-radius","target":"<name>"}',
    '{"type":"dead-code-check","target":"<name>"}',
    '{"type":"riskiest-file","scope":"<optional dir prefix>"}',
    '{"type":"untested","scope":"<optional dir prefix>"}',
    "",
    "Respond with JSON only.",
    "",
    `Question: ${question}`,
  ].join("\n");
}

function validateQueryShape(value: unknown): ReasoningQuery | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const type = record["type"];
  if (typeof type !== "string") return null;

  if (type === "blast-radius" || type === "dead-code-check") {
    const target = record["target"];
    if (typeof target === "string" && target.length > 0) {
      return { type, target };
    }
    return null;
  }
  if (type === "riskiest-file" || type === "untested") {
    const scope = record["scope"];
    const query: ReasoningQuery =
      type === "riskiest-file"
        ? { type: "riskiest-file", scope: typeof scope === "string" ? scope : undefined }
        : { type: "untested", scope: typeof scope === "string" ? scope : undefined };
    return query;
  }
  if (type === "unsupported") return null;
  return null;
}
