// Shared policy core for the guardrail: module classification, allowlist
// matching and resource-grant lookups. Used by the static gate
// (interceptor.ts) and by the host-side bridges of the isolate runner
// (isolate-runner.ts) so both layers can never disagree about what is
// allowed.

import type { Allowlist, EnvironmentGrant, NetworkGrant, SymbolGrant } from "./types.js";
import type { AllowlistArea, ContainmentBreach } from "./breach.js";

const DEFAULT_TIMEOUT_MS = 1000;

export interface CheckAndRunOptions {
  timeoutMs?: number;
  implementations?: import("./interceptor.js").SandboxImplementations;
}

type ResourceCategory = "filesystem" | "network" | "environment" | "subprocess";

export type ModuleClassification =
  | { kind: "relative"; pathLike: string; escapesBase: boolean }
  | { kind: "builtin"; category: ResourceCategory | null; module: string }
  | { kind: "package" };

const NETWORK_BUILTIN_BASES: ReadonlySet<string> = new Set([
  "http", "https", "net", "dgram", "dns", "tls",
]);

export const NODE_BUILTIN_BASES: ReadonlySet<string> = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
  "zlib",
]);

function isNodeBuiltinBase(base: string): boolean {
  return NODE_BUILTIN_BASES.has(base);
}

export function classifyModuleSpecifier(specifier: string): ModuleClassification {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return {
      kind: "relative",
      pathLike: specifier.replace(/^\.?\//, ""),
      escapesBase: specifier.includes("../"),
    };
  }
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  const base = bare.split("/")[0] ?? bare;
  let category: ResourceCategory | null = null;
  if (base === "fs") category = "filesystem";
  else if (base === "child_process") category = "subprocess";
  else if (NETWORK_BUILTIN_BASES.has(base)) category = "network";
  if (category !== null) {
    return { kind: "builtin", category, module: specifier };
  }
  if (isNodeBuiltinBase(base)) {
    return { kind: "builtin", category: null, module: specifier };
  }
  return { kind: "package" };
}

interface AccessContext {
  line: number;
  attempted: string;
}

export function checkModuleAccess(
  specifier: string | null,
  bindings: Array<{ imported?: string; local: string }>,
  allowlist: Allowlist,
  ctx: AccessContext,
): ContainmentBreach | null {
  if (specifier === null) {
    return {
      kind: "unverifiable-import",
      line: ctx.line,
      attempted: ctx.attempted,
      rule: null,
      message:
        `import target cannot be statically verified (${ctx.attempted}); ` +
        "only literal import specifiers are permitted (fail closed)",
    };
  }

  const classification = classifyModuleSpecifier(specifier);

  if (classification.kind === "relative") {
    if (classification.escapesBase) {
      return {
        kind: "unverifiable-import",
        line: ctx.line,
        attempted: ctx.attempted,
        rule: { area: "files", expected: specifier },
        message:
          `relative import '${specifier}' climbs above its base directory and cannot be ` +
          "resolved without knowing the importing file; not allowed (fail closed)",
      };
    }
    if (fileAllowed(allowlist.files, classification.pathLike)) return null;
    return {
      kind: "disallowed-import",
      line: ctx.line,
      attempted: ctx.attempted,
      rule: { area: "files", expected: specifier },
      message:
        `import of '${specifier}' does not match any allowed file ` +
        `[${allowlist.files.map((f) => f.path).join(", ") || "none"}]`,
    };
  }

  if (classification.kind === "builtin") {
    if (classification.category === null) {
      return {
        kind: "disallowed-import",
        line: ctx.line,
        attempted: ctx.attempted,
        rule: null,
        message:
          `builtin module '${specifier}' has no corresponding resource grant category ` +
          "in the allowlist schema and is therefore never allowed",
      };
    }
    if (!categoryGranted(allowlist, classification.category)) {
      return {
        kind: "ungranted-resource",
        line: ctx.line,
        attempted: ctx.attempted,
        rule: {
          area: `resources.${classification.category}` as AllowlistArea,
          expected: `at least one resources.${classification.category} grant`,
        },
        message:
          `'${specifier}' provides ${classification.category} access but ` +
          `allowlist.resources.${classification.category} has no grants`,
      };
    }
    return null;
  }

  const importedNames = bindings.map((b) => b.imported ?? b.local);
  if (externalAccessAllowed(allowlist.symbols, specifier, importedNames)) return null;
  return {
    kind: "disallowed-import",
    line: ctx.line,
    attempted: ctx.attempted,
    rule: { area: "symbols", expected: specifier },
    message:
      `import of '${specifier}' does not match any external symbol or module grant` +
      (bindings.length > 0
        ? ` (bindings checked individually: ${bindings.map((b) => b.local).join(", ")})`
        : ""),
  };
}

function fileAllowed(files: Allowlist["files"], pathLike: string): boolean {
  const candidates = [pathLike];
  const lastSegment = pathLike.split("/").pop() ?? pathLike;
  const hasExtension = /\.[a-z]+$/i.test(lastSegment);
  if (!hasExtension) {
    candidates.push(`${pathLike}.js`, `${pathLike}.ts`, `${pathLike}/index.js`);
  } else {
    // ESM/TS convention: relative imports use the EMITTED extension (.js) while
    // the graph stores SOURCE paths (.ts/.tsx). Map emitted -> source
    // (benchmark Suite A defect #3: `import ... from './billing.js'` never
    // matched graph path `src/billing.ts`).
    const mapped = lastSegment
      .replace(/\.js$/i, ".ts")
      .replace(/\.mjs$/i, ".mts")
      .replace(/\.cjs$/i, ".cts");
    if (mapped !== lastSegment) {
      candidates.push(pathLike.replace(/\.js$/i, ".ts").replace(/\.mjs$/i, ".mts").replace(/\.cjs$/i, ".cts"));
      candidates.push(pathLike.replace(/\.js$/i, ".tsx").replace(/\.mjs$/i, ".mts").replace(/\.cjs$/i, ".cts"));
    }
  }
  return candidates.some((candidate) =>
    files.some((f) => f.path === candidate || f.path.endsWith(`/${candidate}`)),
  );
}

function categoryGranted(allowlist: Allowlist, category: ResourceCategory): boolean {
  const specific = allowlist.resources.categoryLevel?.some((grant) => grant.category === category);
  if (specific) return true;
  switch (category) {
    case "filesystem":
      return allowlist.resources.filesystem.length > 0;
    case "network":
      return allowlist.resources.network.length > 0;
    case "subprocess":
      return allowlist.resources.subprocess.length > 0;
    default:
      return false;
  }
}

function parseExternalSymbolId(nodeId: string): { owner: string; name: string } | null {
  const match = /^x[fm]:([^#]+)(?:#(.+))?$/.exec(nodeId);
  if (!match) return null;
  return { owner: match[1] ?? "", name: match[2] ?? "*" };
}

function externalAccessAllowed(
  symbols: SymbolGrant[],
  owner: string,
  importedNames: string[],
): boolean {
  const grantedNames = new Set<string>();
  let wholeModuleGranted = false;
  for (const symbol of symbols) {
    if (!symbol.external) continue;
    const parsed = parseExternalSymbolId(symbol.nodeId);
    if (!parsed || parsed.owner !== owner) continue;
    if (parsed.name === "*") wholeModuleGranted = true;
    else grantedNames.add(parsed.name);
  }
  if (!wholeModuleGranted && grantedNames.size === 0) return false;
  return importedNames.every((name) => wholeModuleGranted || grantedNames.has(name));
}

export function findEnvironmentGrant(
  allowlist: Allowlist,
  name: string,
): EnvironmentGrant | undefined {
  return allowlist.resources.environment.find((g) => g.name === name);
}

export interface NetworkMatch {
  grant: NetworkGrant | null;
  describeTarget: () => string;
}

export function findNetworkGrant(allowlist: Allowlist, urlText: string): NetworkMatch {
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    return { grant: null, describeTarget: () => urlText };
  }
  const scheme = parsed.protocol.replace(":", "");
  const port =
    parsed.port !== "" ? Number(parsed.port) : scheme === "https" ? 443 : scheme === "http" ? 80 : NaN;
  const describeTarget = () =>
    `${scheme}://${parsed.hostname}${parsed.port !== "" ? `:${parsed.port}` : ""}`;
  const grant =
    allowlist.resources.network.find(
      (g) =>
        g.host === parsed.hostname &&
        (g.port === undefined || g.port === port) &&
        (!g.protocols || (g.protocols as readonly string[]).includes(scheme)),
    ) ?? null;
  return { grant, describeTarget };
}

export { DEFAULT_TIMEOUT_MS };
