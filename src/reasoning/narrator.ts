import type { LlmClient } from "./llm.js";
import type { Answer } from "./executor.js";

export function renderAnswer(answer: Answer): string {
  switch (answer.kind) {
    case "blast-radius":
      return renderBlastRadius(answer);
    case "dead-code-check":
      return renderDeadCodeCheck(answer);
    case "riskiest-file":
      return renderRiskiestFile(answer);
    case "untested":
      return renderUntested(answer);
    case "target-not-found":
      return `I could not find anything named "${answer.target}" in the graph, so I have nothing grounded to report.`;
    case "ambiguous-target": {
      const list = answer.candidates
        .map((c) => `  - ${c.id} (${c.type}${c.path ? `, ${c.path}` : ""})`)
        .join("\n");
      return `"${answer.target}" matches multiple nodes; pick one:\n${list}`;
    }
  }
}

function renderBlastRadius(
  answer: Extract<Answer, { kind: "blast-radius" }>,
): string {
  const { target, result } = answer;
  if (result.dependents.length === 0) {
    return `${target.id} has no resolved dependents in the graph. Nothing confirmed depends on it. Note: dynamic or ambiguous references may still exist.`;
  }
  const confirmed = result.dependents.filter((d) => d.via === "confirmed");
  const ambiguousOnly = result.dependents.filter((d) => d.via === "ambiguous-only");

  const lines = [`${target.id} has ${result.dependents.length} dependent(s):`];
  for (const dep of confirmed) {
    lines.push(`  depth ${dep.depth}: ${dep.id} (via ${dep.relation}, resolved)`);
  }
  for (const dep of ambiguousOnly) {
    lines.push(
      `  ${dep.id} matches by name only via an unresolved reference — treat as unconfirmed.`,
    );
  }
  lines.push(
    `(${confirmed.length} confirmed, ${ambiguousOnly.length} ambiguous-only. Confirmed counts are only as good as the resolver: dynamic dispatch is not tracked.)`,
  );
  return lines.join("\n");
}

function renderDeadCodeCheck(
  answer: Extract<Answer, { kind: "dead-code-check" }>,
): string {
  const node = answer.target;
  switch (answer.verdict) {
    case "not-a-candidate":
      return `${node.id} is a ${node.type}; dead-code analysis covers functions, classes and methods.`;
    case "referenced":
      return `${node.id} is not flagged dead: it has at least one resolved incoming reference in the graph.`;
    case "dead-candidate":
      if (answer.confidence === "confirmed-unreferenced") {
        return `${node.id} looks dead: zero resolved incoming references and zero unresolved references that could point at it.`;
      }
      return `${node.id} is a dead-code candidate with low confidence: no resolved references were found, but there are unresolved references to that name, so it may still be used.`;
  }
}

function renderRiskiestFile(
  answer: Extract<Answer, { kind: "riskiest-file" }>,
): string {
  const scopeText = answer.scope ? ` within "${answer.scope}"` : "";
  if (!answer.file) {
    return `No files found${scopeText}, so there is no riskiest file to report.`;
  }
  const f = answer.file;
  const parts = [
    `churn ${f.churnCommits} commits in ${f.windowDays}d`,
    f.hasTests ? "has tests" : "no tests found",
  ];
  return `Riskiest file${scopeText}: ${f.path} (score ${f.score}: ${parts.join("; ")}). Score is churn plus missing-test penalty — an approximation, not a measurement of code quality.`;
}

function renderUntested(answer: Extract<Answer, { kind: "untested" }>): string {
  const scopeText = answer.scope ? ` within "${answer.scope}"` : "";
  if (answer.files.length === 0) {
    return `Nothing uncovered found${scopeText}. Coverage is import-based, so runtime-only usage may still be missed.`;
  }
  const shown = answer.files.slice(0, 10);
  const more =
    answer.files.length > shown.length
      ? `, +${answer.files.length - shown.length} more`
      : "";
  return `${answer.files.length} file(s) lack test coverage${scopeText} (of ${answer.totalSourceFiles} source files, ${answer.totalUncovered} uncovered overall):\n${shown
    .map((p) => `  - ${p}`)
    .join("\n")}${more}\nThis is import proximity, not real coverage instrumentation.`;
}

// Narration is the only place a model touches: it receives the already
// executed structured answer plus instructions to restate it faithfully.
// Questions never reach the model; parsing is deterministic by design.
export async function narrateAnswer(
  answer: Answer,
  client: LlmClient,
): Promise<string> {
  const narration = await client.complete(buildNarrationPrompt(answer));
  if (narration !== null && narration.trim().length > 0) {
    return narration.trim();
  }
  return renderAnswer(answer);
}

function buildNarrationPrompt(answer: Answer): string {
  return [
    "Rewrite the following structured result as 2-4 short sentences.",
    "Rules: state only facts present in the data; keep confidence labels exactly;",
    "do not add interpretations, recommendations or numbers that are not present.",
    "",
    JSON.stringify(answer, null, 2),
  ].join("\n");
}
