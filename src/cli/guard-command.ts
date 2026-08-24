import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { buildRepoGraph, openGraph } from "../graph/index.js";
import { generateAllowlist, loadResourceConfig } from "../guardrail/index.js";
import type { Allowlist } from "../guardrail/index.js";
import { checkAndRun, isContainmentViolation } from "../guardrail/interceptor.js";
import type { CheckAndRunResult } from "../guardrail/breach.js";

export interface GuardCommandArgs {
  scopeId: string;
  source: string;
  repoPath: string;
  resourcesPath?: string | null;
  json?: boolean;
  timeoutMs?: number | null;
}

export interface CommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runGuardCommand(args: GuardCommandArgs): Promise<CommandOutput> {
  try {
    const repoRoot = path.resolve(args.repoPath);
    const dbPath = path.join(repoRoot, ".mri", "graph.sqlite");
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await buildRepoGraph(repoRoot, dbPath);

    const store = openGraph(dbPath);
    let stdout = "";
    let exitCode = 0;
    try {
      if (!store.getNode(args.scopeId)) {
        throw new Error(
          `unknown scope node id '${args.scopeId}' â€” run \`mri build\` and check \`nodes\` table for valid ids`,
        );
      }

      const resourceConfig = args.resourcesPath
        ? await loadResourceConfig(args.resourcesPath)
        : undefined;

      const allowlist = generateAllowlist(
        args.scopeId,
        store,
        resourceConfig ? { resourceConfig } : {},
      );

      const code =
        args.source === "-"
          ? readFileSync(0, "utf8")
          : await fs.readFile(path.resolve(args.source), "utf8");

      const result = await checkAndRun(code, allowlist, {
        timeoutMs: args.timeoutMs ?? undefined,
      });

      stdout = args.json
        ? renderJson(args.scopeId, result, allowlist)
        : renderHuman(args.scopeId, result, allowlist);
      exitCode = result.outcome === "blocked" ? 1 : 0;
    } finally {
      store.db.close();
    }
    return { exitCode, stdout, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `error: ${message}\n` };
  }
}

function renderHuman(
  scopeId: string,
  result: CheckAndRunResult,
  allowlist: Allowlist,
): string {
  const lines: string[] = [];
  if (result.outcome === "blocked") {
    lines.push(`BLOCKED â€” code refused for scope ${scopeId}`);
    lines.push(`${result.breaches.length} containment breach(es):`);
    lines.push("");
    for (const breach of result.breaches) {
      lines.push(`  line ${breach.line} Â· ${breach.kind}`);
      lines.push(`    attempted: ${breach.attempted}`);
      if (breach.rule) {
        lines.push(`    rule:      ${breach.rule.area} -> expected ${breach.rule.expected}`);
      }
      lines.push(`    reason:    ${breach.message}`);
      lines.push("");
    }
    lines.push(
      `nothing was executed (fail closed). allowlist: ${allowlist.symbols.length} symbol(s), ` +
        `${allowlist.files.length} file(s); ${allowlist.unresolved.length} unresolved reference(s) excluded`,
    );
    return lines.join("\n");
  }

  lines.push(`EXECUTED cleanly within the allowlist for ${scopeId}`);
  lines.push(`return value: ${formatValue(result.value)}`);
  lines.push(
    `note: calls to granted repo symbols ran against inert stubs â€” this verifies containment, not behavior`,
  );
  lines.push(
    `allowlist: ${allowlist.symbols.length} symbol(s), ${allowlist.files.length} file(s) granted` +
      (allowlist.unresolved.length > 0
        ? `; ${allowlist.unresolved.length} unresolved reference(s) were excluded fail-closed`
        : ""),
  );
  return lines.join("\n");
}

function renderJson(
  scopeId: string,
  result: CheckAndRunResult,
  allowlist: Allowlist,
): string {
  return (
    JSON.stringify(
      {
        scope: allowlist.scope,
        policy: allowlist.policy,
        outcome: result.outcome,
        ...(result.outcome === "blocked"
          ? { breaches: result.breaches }
          : { value: result.value }),
        allowlist: {
          symbols: allowlist.symbols.length,
          files: allowlist.files.length,
          unresolved: allowlist.unresolved.length,
          resources: allowlist.resources,
        },
        scopeId,
      },
      null,
      2,
    ) + "\n"
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (error) {
    // Serialization can trip runtime guards (getters/proxies touching
    // ungranted resources). A containment violation must propagate to
    // checkAndRun so the verdict becomes blocked with a breach record;
    // swallowing it here would report a clean execution after detection.
    if (isContainmentViolation(error)) throw error;
    return String(value);
  }
}
