import vm from "node:vm";
import { analyzeCode, isSafeGlobal } from "./code-scan.js";
import type { ScannedImport, ScannedImportBinding } from "./code-scan.js";
import type {
  Allowlist,
  EnvironmentGrant,
  NetworkGrant,
  SymbolGrant,
} from "./types.js";
import type { AllowlistArea, CheckAndRunResult, ContainmentBreach } from "./breach.js";

export interface SandboxImplementations {
  fetch?: FetchLike;
  modules?: Record<string, unknown>;
  environment?: Record<string, string>;
}

export interface FetchLike {
  (input: string | URL, init?: unknown): Promise<unknown>;
}

export interface CheckAndRunOptions {
  timeoutMs?: number;
  implementations?: SandboxImplementations;
}

const DEFAULT_TIMEOUT_MS = 1000;

type ResourceCategory = "filesystem" | "network" | "environment" | "subprocess";

type ModuleClassification =
  | { kind: "relative"; pathLike: string; escapesBase: boolean }
  | { kind: "builtin"; category: ResourceCategory | null; module: string }
  | { kind: "package" };

const NETWORK_BUILTIN_BASES: ReadonlySet<string> = new Set([
  "http", "https", "net", "dgram", "dns", "tls",
]);

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

const NODE_BUILTIN_BASES: ReadonlySet<string> = new Set([
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

export function checkAndRun(
  code: string,
  allowlist: Allowlist,
  vmContext?: vm.Context,
  options: CheckAndRunOptions = {},
): CheckAndRunResult {
  const scan = analyzeCode(code);

  if (scan.parseFailed) {
    return {
      outcome: "blocked",
      breaches: [
        {
          kind: "parse-failure",
          line: scan.parseErrorLine ?? 1,
          attempted: code.split("\n")[scan.parseErrorLine ? scan.parseErrorLine - 1 : 0]?.trim() ?? "",
          rule: null,
          message:
            `code failed to parse (line ${scan.parseErrorLine ?? "?"}); ` +
            "unparseable code is never executed (fail closed)",
        },
      ],
    };
  }

  const breaches: ContainmentBreach[] = [];

  for (const imp of scan.imports) {
    const breach = checkModuleAccess(imp.specifier, imp.bindings, allowlist, {
      line: imp.line,
      attempted: `${imp.via} ${imp.attempted}`.trim(),
    });
    if (breach) breaches.push(breach);
  }

  for (const access of scan.resourceAccesses) {
    breaches.push(...checkResourceAccess(access.category, access.target, allowlist, {
      line: access.line,
      attempted: access.attempted,
      mode: access.mode,
    }));
  }

  const grantedNames = new Set(allowlist.symbols.map((s) => s.name));
  const seenIdentifiers = new Set<string>();
  for (const identifier of scan.identifiers) {
    if (isSafeGlobal(identifier.name) || grantedNames.has(identifier.name)) continue;
    const dedupeKey = `${identifier.line}:${identifier.name}`;
    if (seenIdentifiers.has(dedupeKey)) continue;
    seenIdentifiers.add(dedupeKey);
    breaches.push({
      kind: "unknown-reference",
      line: identifier.line,
      attempted: `reference to '${identifier.name}'`,
      rule: { area: "symbols", expected: identifier.name },
      message:
        `code references '${identifier.name}' at line ${identifier.line}, which is neither ` +
        "a granted symbol nor a safe global; refusing to execute (fail closed)",
    });
  }

  if (breaches.length > 0) {
    breaches.sort((a, b) => a.line - b.line);
    return { outcome: "blocked", breaches };
  }

  const context = vmContext ?? createGuardedContext(allowlist, options.implementations);
  const executableCode = prepareForExecution(code, scan.imports);

  installGuards(allowlist, context as unknown as Record<string, unknown>, options.implementations);

  try {
    const value = vm.runInContext(executableCode, context, {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    // A returned value can carry delayed violations: getters or proxies that
    // stay quiet during execution and only fire when the host inspects the
    // result. Force that inspection here, inside the containment boundary, so
    // the violation becomes a blocked verdict instead of a surprise on the
    // host side.
    marshalReturnValue(value);
    return { outcome: "executed", value };
  } catch (error) {
    if (isContainmentViolation(error)) {
      return { outcome: "blocked", breaches: [error.breach] };
    }
    // Defense in depth: checkAndRun must NEVER let an exception escape.
    // A crash is not a containment decision; anything the sandbox cannot
    // finish is recorded as blocked with the failure as evidence.
    return {
      outcome: "blocked",
      breaches: [
        {
          kind: "denied-unclassifiable",
          line: 0,
          attempted: "sandbox execution",
          rule: null,
          message:
            `execution could not complete inside the sandbox ` +
            `(${describeError(error)}); recorded as a containment block (fail closed)`,
        },
      ],
    };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  return String(error);
}

function prepareForExecution(code: string, imports: ScannedImport[]): string {
  const rewrites: Array<{ start: number; end: number; text: string }> = [];

  for (const imp of imports) {
    if (
      imp.specifier === null ||
      typeof imp.startIndex !== "number" ||
      typeof imp.endIndex !== "number"
    ) {
      continue;
    }
    if (imp.via === "static-import") {
      rewrites.push({
        start: imp.startIndex,
        end: imp.endIndex,
        text: synthRequireDeclaration(imp),
      });
    } else if (imp.via === "dynamic-import") {
      // Literal dynamic imports run through the same guarded require bridge
      // instead of the VM's missing dynamic-import callback.
      const spec = JSON.stringify(imp.specifier);
      rewrites.push({
        start: imp.startIndex,
        end: imp.endIndex,
        text: `(Promise.resolve().then(() => require(${spec})))`,
      });
    }
  }

  if (rewrites.length === 0) return code;

  let rewritten = code;
  for (const rw of rewrites.sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, rw.start) + rw.text + rewritten.slice(rw.end);
  }
  return rewritten;
}

function synthRequireDeclaration(imp: ScannedImport): string {
  if (imp.specifier === null) return "";
  const spec = JSON.stringify(imp.specifier);
  const defaults = imp.bindings.filter((b) => b.kind === "default");
  const namespaces = imp.bindings.filter((b) => b.kind === "namespace");
  const named = imp.bindings.filter((b) => b.kind === "named");

  if (defaults.length === 0 && namespaces.length === 0 && named.length > 0) {
    return `const {${formatNamedBindings(named)}} = require(${spec});`;
  }
  if (defaults.length === 1 && namespaces.length === 0 && named.length === 0) {
    return `const ${defaults[0]?.local} = require(${spec});`;
  }
  if (namespaces.length === 1 && defaults.length === 0 && named.length === 0) {
    return `const ${namespaces[0]?.local} = require(${spec});`;
  }

  const temp = "__mri_module";
  const lines = [`const ${temp} = require(${spec});`];
  for (const d of defaults) lines.push(`const ${d.local} = ${temp};`);
  for (const ns of namespaces) lines.push(`const ${ns.local} = ${temp};`);
  if (named.length > 0) lines.push(`const {${formatNamedBindings(named)}} = ${temp};`);
  return lines.join("\n");
}

function formatNamedBindings(bindings: ScannedImportBinding[]): string {
  return bindings
    .map((b) => (b.imported === b.local ? b.local : `${b.imported}: ${b.local}`))
    .join(", ");
}

interface AccessContext {
  line: number;
  attempted: string;
  mode?: "read" | "write";
}

function checkModuleAccess(
  specifier: string | null,
  bindings: ScannedImportBinding[],
  allowlist: Allowlist,
  ctx: { line: number; attempted: string },
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

  if (externalAccessAllowed(allowlist.symbols, specifier, bindings)) return null;
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

function checkResourceAccess(
  category: "environment" | "network",
  target: string | null,
  allowlist: Allowlist,
  ctx: AccessContext,
): ContainmentBreach[] {
  if (category === "environment") {
    if (target === null) {
      return [
        {
          kind: "unverifiable-resource",
          line: ctx.line,
          attempted: ctx.attempted,
          rule: { area: "resources.environment", expected: "a specific variable name" },
          message:
            "process.env is accessed without a statically known variable name " +
            `(${ctx.attempted}); only explicitly granted variable names are allowed`,
        },
      ];
    }
    const grant = findEnvironmentGrant(allowlist, target);
    const neededMode = ctx.mode ?? "read";
    if (!grant || !grant.access.includes(neededMode)) {
      return [
        {
          kind: "ungranted-resource",
          line: ctx.line,
          attempted: ctx.attempted,
          rule: { area: "resources.environment", expected: target },
          message:
            `${neededMode} access to environment variable '${target}' is not granted ` +
            `(granted variables: ${allowlist.resources.environment.map((g) => g.name).join(", ") || "none"})`,
        },
      ];
    }
    return [];
  }

  if (target === null) {
    return [
      {
        kind: "unverifiable-resource",
        line: ctx.line,
        attempted: ctx.attempted,
        rule: { area: "resources.network", expected: "a statically known host" },
        message:
          "network target cannot be statically verified " +
          `(${ctx.attempted}); only fetch calls with a literal URL matching an ` +
          "explicit network grant are allowed",
      },
    ];
  }

  const match = findNetworkGrant(allowlist, target);
  if (!match.grant) {
    return [
      {
        kind: "ungranted-resource",
        line: ctx.line,
        attempted: ctx.attempted,
        rule: { area: "resources.network", expected: match.describeTarget() },
        message:
          `network target '${match.describeTarget()}' does not match any grant in ` +
          `allowlist.resources.network ` +
          `[${allowlist.resources.network.map(describeNetworkGrant).join(", ") || "none"}]`,
      },
    ];
  }
  return [];
}

function fileAllowed(files: Allowlist["files"], pathLike: string): boolean {
  const candidates = [pathLike];
  const lastSegment = pathLike.split("/").pop() ?? pathLike;
  const hasExtension = /\.[a-z]+$/i.test(lastSegment);
  if (!hasExtension) {
    candidates.push(`${pathLike}.js`, `${pathLike}.ts`, `${pathLike}/index.js`);
  }
  return candidates.some(
    (candidate) =>
      files.some(
        (f) => f.path === candidate || f.path.endsWith(`/${candidate}`),
      ),
  );
}

function categoryGranted(allowlist: Allowlist, category: ResourceCategory): boolean {
  const specific = allowlist.resources.categoryLevel?.some(
    (grant) => grant.category === category,
  );
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
  bindings: ScannedImportBinding[],
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
  return bindings.every((b) => wholeModuleGranted || grantedNames.has(b.imported ?? b.local));
}

export function findEnvironmentGrant(
  allowlist: Allowlist,
  name: string,
): EnvironmentGrant | undefined {
  return allowlist.resources.environment.find((g) => g.name === name);
}

interface NetworkMatch {
  grant: NetworkGrant | null;
  describeTarget: () => string;
}

export function findNetworkGrant(allowlist: Allowlist, urlText: string): NetworkMatch {
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    return {
      grant: null,
      describeTarget: () => urlText,
    };
  }
  const scheme = parsed.protocol.replace(":", "");
  const port = parsed.port !== "" ? Number(parsed.port) : scheme === "https" ? 443 : scheme === "http" ? 80 : NaN;
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

function describeNetworkGrant(grant: NetworkGrant): string {
  return `${grant.host}${grant.port !== undefined ? `:${grant.port}` : ""}`;
}

class ContainmentViolation extends Error {
  constructor(readonly breach: ContainmentBreach) {
    super(breach.message);
    this.name = "ContainmentViolation";
  }
}

export function isContainmentViolation(error: unknown): error is ContainmentViolation {
  return error instanceof ContainmentViolation;
}

// Forces any getter/proxy wired into the completion value to fire while still
// inside checkAndRun's containment boundary. Only containment violations
// propagate; ordinary non-serializable values (functions, cycles) are fine.
function marshalReturnValue(value: unknown): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    if (isContainmentViolation(error)) throw error;
  }
}

export function createGuardedContext(
  allowlist: Allowlist,
  implementations: SandboxImplementations = {},
): vm.Context {
  const sandbox: Record<string, unknown> = Object.create(null);
  sandbox["console"] = {
    log: (...args: unknown[]) => console.log(...args),
    error: (...args: unknown[]) => console.error(...args),
    warn: (...args: unknown[]) => console.warn(...args),
  };
  installGuards(allowlist, sandbox, implementations);
  return vm.createContext(sandbox);
}

const GUARDS_INSTALLED = Symbol("mri.guardrail.guards");

function installGuards(
  allowlist: Allowlist,
  target: Record<string, unknown>,
  implementations: SandboxImplementations = {},
): void {
  if ((target as Record<PropertyKey, unknown>)[GUARDS_INSTALLED] === allowlist) return;
  target["require"] = makeGuardedRequire(allowlist, implementations.modules ?? {});
  target["process"] = makeGuardedProcess(allowlist, implementations.environment ?? {});
  if (allowlist.resources.network.length > 0) {
    target["fetch"] = makeGuardedFetch(allowlist, implementations.fetch);
  }
  Object.defineProperty(target, GUARDS_INSTALLED, {
    value: allowlist,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function runtimeBreach(kind: ContainmentBreach["kind"], attempted: string, rule: ContainmentBreach["rule"], message: string): ContainmentViolation {
  return new ContainmentViolation({
    kind,
    line: 0,
    attempted,
    rule,
    message: `${message} (detected by runtime guard)`,
  });
}

function makeGuardedRequire(
  allowlist: Allowlist,
  modules: Record<string, unknown>,
): (specifier: unknown) => unknown {
  return (specifier: unknown) => {
    if (typeof specifier !== "string") {
      throw runtimeBreach(
        "unverifiable-import",
        `require(${String(specifier)})`,
        null,
        "require() argument must be a string literal that passes the allowlist check",
      );
    }
    const breach = checkModuleAccess(specifier, [], allowlist, {
      line: 0,
      attempted: `require(${JSON.stringify(specifier)})`,
    });
    if (breach) throw new ContainmentViolation(breach);
    // The gate is the point: only host-provided implementations are bridged
    // into the sandbox; anything else resolves to an inert stub. Bridging
    // richer capability plumbing belongs to the enforcement prompt.
    return modules[specifier] ?? Object.create(null);
  };
}

function makeGuardedProcess(
  allowlist: Allowlist,
  envSeed: Record<string, string>,
): unknown {
  const envGrants = allowlist.resources.environment;
  const envStore: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(envSeed)) {
    const grant = envGrants.find((g) => g.name === name);
    if (grant && grant.access.includes("read")) envStore[name] = value;
  }
  const envProxy = new Proxy(envStore, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      assertEnvRead(envGrants, prop);
      return envStore[prop];
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return false;
      assertEnvWrite(envGrants, prop);
      envStore[prop] = String(value);
      return true;
    },
    has(_target, prop) {
      if (typeof prop !== "string") return false;
      assertEnvRead(envGrants, prop);
      return prop in envStore;
    },
    ownKeys() {
      throw runtimeBreach(
        "unverifiable-resource",
        "Object.keys(process.env)",
        { area: "resources.environment", expected: "specific variable names" },
        "enumerating environment variables is not permitted",
      );
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return undefined;
      assertEnvRead(envGrants, prop);
      return envStore[prop] === undefined
        ? undefined
        : { configurable: true, enumerable: true, value: envStore[prop] };
    },
  });

  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "env") return envProxy;
      throw runtimeBreach(
        "ungranted-resource",
        `process.${String(prop)}`,
        { area: "symbols", expected: "process" },
        `access to process.${String(prop)} is not part of any allowlist grant`,
      );
    },
  });
}

function assertEnvRead(grants: EnvironmentGrant[], name: string): void {
  const grant = grants.find((g) => g.name === name);
  if (!grant || !grant.access.includes("read")) {
    throw runtimeBreach(
      "ungranted-resource",
      `process.env[${JSON.stringify(name)}] read`,
      { area: "resources.environment", expected: name },
      `read access to environment variable '${name}' is not granted`,
    );
  }
}

function assertEnvWrite(grants: EnvironmentGrant[], name: string): void {
  const grant = grants.find((g) => g.name === name);
  if (!grant || !grant.access.includes("write")) {
    throw runtimeBreach(
      "ungranted-resource",
      `process.env[${JSON.stringify(name)}] write`,
      { area: "resources.environment", expected: name },
      `write access to environment variable '${name}' is not granted`,
    );
  }
}

function makeGuardedFetch(allowlist: Allowlist, realFetch?: FetchLike): FetchLike {
  return (input: string | URL, init?: unknown): Promise<unknown> => {
    const urlText = typeof input === "string" ? input : input.toString();
    const match = findNetworkGrant(allowlist, urlText);
    if (!match.grant) {
      throw runtimeBreach(
        "ungranted-resource",
        `fetch(${JSON.stringify(urlText)})`,
        { area: "resources.network", expected: match.describeTarget() },
        `network target '${match.describeTarget()}' does not match any resources.network grant`,
      );
    }
    if (!realFetch) {
      throw new Error(
        "network access is granted but no fetch implementation was provided to the sandbox",
      );
    }
    return realFetch(input, init);
  };
}
