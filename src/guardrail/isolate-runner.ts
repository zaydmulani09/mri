// Real-containment execution backend: runs guarded code inside an isolated-vm
// V8 isolate (separate heap, separate realm - NOT a node:vm shared-realm
// context). Cross-boundary surface is limited to explicit Reference bridges,
// so the `.constructor.constructor` host-realm escape class that defeats
// node:vm (adversarial report b01/b02) is structurally closed: the guest has
// no `process`, no host objects, and its Function constructor compiles
// in-isolate only.
//
// Marshaling rules discovered empirically on isolated-vm 7.x:
// - guest->host calls: reference.applySync(undefined, [args...]) (array form;
//   positional args are dropped otherwise)
// - host->guest returns: primitives cross directly; objects must be returned
//   as JSON strings and parsed guest-side (object copies arrive emptied)
// - throws inside a host callback propagate into the guest with the message
//   intact, which is how policy denials are delivered

import ivm from "isolated-vm";
import type { Allowlist } from "./types.js";
import type { ContainmentBreach } from "./breach.js";
import { checkModuleAccess, classifyModuleSpecifier } from "./policy-lookup.js";
import { findEnvironmentGrant } from "./policy-lookup.js";

export interface SandboxImplementations {
  /** Data-only module snapshots bridged for allowlisted specifiers. */
  modules?: Record<string, unknown>;
  /** Seeded values for granted environment variables (read-granted only). */
  environment?: Record<string, string>;
}

export interface IsolateRunResult {
  value: unknown;
  transferred: "copy" | "untransferable";
  /** True when the watchdog had to hard-dispose the isolate mid-run. */
  disposed: boolean;
  breaches: ContainmentBreach[];
  stubCalls: Array<{ symbol: string; args: string[] }>;
  consoleLines: string[];
}

const DEFAULT_MEMORY_LIMIT_MB = 128;

function escapeForSingleQuotedJs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

/**
 * Bootstrap executed inside the isolate before user code. Everything here
 * runs in the GUEST realm: guards are plain guest objects whose decisions
 * come from synchronous host bridges.
 */
function buildShimSource(allowlist: Allowlist): string {
  const lines: string[] = [];
  lines.push("const __mri_breaches = [];");

  // Breach recorder: payloads are built host-side (authoritative shapes) and
  // handed over as JSON strings.
  lines.push(`globalThis.__mri_recordBreach = function (json) {
    __mri_breaches.push(typeof json === 'string' ? JSON.parse(json) : json);
    var err = new Error('blocked by mri policy');
    err.__mri_blocked = true;
    throw err;
  };`);

  // Guarded require: host re-runs the full module-access check (single source
  // of truth) and answers with JSON. Allowed specifiers resolve to inert data
  // snapshots only - imported code never executes (dual defense, b12).
  lines.push(`globalThis.require = function (specifier) {
    var answer;
    try {
      answer = JSON.parse(__mri_host_require.applySync(undefined, [String(specifier)]));
    } catch (e) {
      throw new Error('require unavailable: ' + String(e.message || e));
    }
    if (answer && answer.deny) __mri_recordBreach(answer.deny);
    var obj = answer.data ? JSON.parse(answer.data) : {};
    (answer.stubNames || []).forEach(function (entry) {
      obj[entry.name] = function () {
        var args = [].slice.call(arguments).map(function (a) {
          try { return JSON.stringify(a) ?? String(a); } catch (e) { return String(a); }
        });
        __mri_host_stub_call.applySync(undefined, [JSON.stringify(entry.id), JSON.stringify(args)]);
        return { mri: 'granted-symbol-stub', symbol: entry.id, args: args };
      };
    });
    return obj;
  };`);

  // Guarded process: only .env.<name> reads/writes exist, each individually
  // authorized host-side against resources.environment grants.
  lines.push(`globalThis.process = {
    env: new Proxy(Object.create(null), {
      get: function (_t, prop) {
        if (typeof prop !== 'string') return undefined;
        var answer = JSON.parse(__mri_host_env.applySync(undefined, ['get', prop]));
        if (answer.deny) __mri_recordBreach(answer.deny);
        return answer.value;
      },
      set: function (_t, prop, value) {
        if (typeof prop !== 'string') return false;
        var answer = JSON.parse(__mri_host_env.applySync(undefined, ['set', prop, String(value)]));
        if (answer.deny) __mri_recordBreach(answer.deny);
        return true;
      },
      has: function (_t, prop) {
        if (typeof prop !== 'string') return false;
        var answer = JSON.parse(__mri_host_env.applySync(undefined, ['has', prop]));
        if (answer.deny) __mri_recordBreach(answer.deny);
        return Boolean(answer.value);
      },
      ownKeys: function () {
        var answer = JSON.parse(__mri_host_env.applySync(undefined, ['keys']));
        if (answer.deny) __mri_recordBreach(answer.deny);
        return [];
      },
      getOwnPropertyDescriptor: function () {
        return undefined;
      }
    })
  };
  Object.freeze(globalThis.process);`);

  // Console passthrough (host prints; nothing of the host realm leaks in).
  lines.push(`globalThis.console = {
    log: function () { __mri_host_console.applySync(undefined, [JSON.stringify(['log'].concat([].slice.call(arguments).map(String)))]); },
    error: function () { __mri_host_console.applySync(undefined, [JSON.stringify(['error'].concat([].slice.call(arguments).map(String)))]); },
    warn: function () { __mri_host_console.applySync(undefined, [JSON.stringify(['warn'].concat([].slice.call(arguments).map(String)))]); },
  };`);

  // Granted-symbol stubs: inert receipts derived purely from allowlist
  // metadata. No host closures exist anywhere inside the boundary.
  for (const symbol of allowlist.symbols) {
    if (symbol.external) continue;
    const name = escapeForSingleQuotedJs(symbol.name);
    const id = escapeForSingleQuotedJs(symbol.nodeId);
    lines.push(`globalThis['${name}'] = function () {
      var args = [].slice.call(arguments).map(function (a) {
        try { return JSON.stringify(a) ?? String(a); } catch (e) { return String(a); }
      });
      __mri_host_stub_call.applySync(undefined, ['${id}', JSON.stringify(args)]);
      return { mri: 'granted-symbol-stub', symbol: '${id}', args: args };
    };`);
  }

  return lines.join("\n");
}

export interface IsolateOptions {
  timeoutMs?: number;
  memoryLimitMb?: number;
  implementations?: SandboxImplementations;
}

/**
 * Execute prepared (statically gated, import-rewritten) code inside an
 * isolated-vm isolate. Async because isolated-vm's eval returns a promise
 * even for synchronous guest code.
 */
export async function runInIsolate(
  code: string,
  allowlist: Allowlist,
  options: IsolateOptions = {},
): Promise<IsolateRunResult> {
  const implementations = options.implementations ?? {};
  const memoryLimitMb = options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;

  let disposed = false;
  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });

  const disposeQuietly = (): void => {
    if (!disposed) {
      disposed = true;
      try {
        isolate.dispose();
      } catch {
        /* already disposed by watchdog */
      }
    }
  };

  const run = async (): Promise<IsolateRunResult> => {
    const context = await isolate.createContext();
    const jail = context.global;
    jail.setSync('global', jail.derefInto());
        // --- host bridges -------------------------------------------------------
    const breaches: ContainmentBreach[] = [];
    const stubCalls: Array<{ symbol: string; args: string[] }> = [];
    const consoleLines: string[] = [];

    const hostRequire = new ivm.Reference((specifierJson: string) => {
      const specifier = specifierJson;
      const classification = classifyModuleSpecifier(specifier);
      const breach = checkModuleAccess(specifier, [], allowlist, {
        line: 0,
        attempted: `require(${JSON.stringify(specifier)})`,
      });
      if (breach) {
        // Uniform deny delivery: {deny} payloads are recorded guest-side via
        // __mri_recordBreach; nothing throws across the boundary.
        return JSON.stringify({ deny: breach });
      }
      const data = implementations.modules?.[specifier];
      // Allowed-file imports get in-isolate stub functions for the granted
      // symbols that file defines (parity with global granted stubs).
      const stubNames: Array<{ name: string; id: string }> = [];
      if (classification.kind === "relative") {
        const like = classification.pathLike;
        const likeTs = like.replace(/\.js$/i, ".ts");
        for (const symbol of allowlist.symbols) {
          if (symbol.external || symbol.path === null) continue;
          const p = symbol.path;
          if (
            p === like ||
            p.endsWith("/" + like) ||
            p === likeTs ||
            p.endsWith("/" + likeTs)
          ) {
            stubNames.push({ name: symbol.name, id: symbol.nodeId });
          }
        }
      }
      return JSON.stringify({
        data: data === undefined ? null : JSON.stringify(data),
        stubNames,
      });
    });

    const hostEnv = new ivm.Reference((...callArgs: string[]) => {
      const action = callArgs[0];
      if (action === "keys") {
        return JSON.stringify({
          deny: {
            kind: "unverifiable-resource",
            line: 0,
            attempted: "Object.keys(process.env)",
            rule: { area: "resources.environment", expected: "specific variable names" },
            message: "enumerating environment variables is not permitted",
          },
        });
      }
      const name = callArgs[1] ?? "";
      const mode = action === "set" ? "write" : "read";
      const grant = findEnvironmentGrant(allowlist, name);
      if (!grant || !grant.access.includes(mode)) {
        return JSON.stringify({
          deny: {
            kind: "ungranted-resource",
            line: 0,
            attempted: `process.env[${JSON.stringify(name)}] ${mode}`,
            rule: { area: "resources.environment", expected: name },
            message: `${mode} access to environment variable '${name}' is not granted`,
          },
        });
      }
      if (mode === "write") {
        implementations.environment ??= {};
        implementations.environment[name] = callArgs[2] ?? "";
      }
      return JSON.stringify({
        value: implementations.environment?.[name] ?? "",
      });
    });

    const hostStubCall = new ivm.Reference((symbolIdJson: string, argsJson: string) => {
      stubCalls.push({
        symbol: symbolIdJson,
        args: JSON.parse(argsJson) as string[],
      });
      return true;
    });

    const hostConsole = new ivm.Reference((partsJson: string) => {
      const parts = JSON.parse(partsJson) as string[];
      const level = parts[0] ?? "log";
      const line = parts.slice(1).join(" ");
      consoleLines.push(`${level}: ${line}`);
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
      return true;
    });


    jail.setSync("__mri_host_require", hostRequire);
    jail.setSync("__mri_host_env", hostEnv);
    jail.setSync("__mri_host_stub_call", hostStubCall);
    jail.setSync("__mri_host_console", hostConsole);

    // --- bootstrap + user code ----------------------------------------------
    await context.eval(buildShimSource(allowlist), { timeout: options.timeoutMs });

    let value: unknown;
    let transferred: IsolateRunResult["transferred"] = "copy";
    let disposed = false;
    try {
      // The completion value is serialized IN-ISULATE and parsed host-side:
      // isolated-vm only reliably copies primitives across, so JSON is the
      // transfer envelope. Non-JSON-safe completions (functions, Promises,
      // circulars) degrade to an explicit marker instead of pretending.
      // Completion-value preserving: nested guest eval keeps the exact
      // script semantics of vm.runInContext, then serializes the result
      // in-isolate (isolated-vm only reliably copies primitives across).
      const raw =
        (await context.eval(
          // JSON.stringify(undefined) returns undefined, and an undefined
          // guest completion is non-transferable across the ivm boundary -
          // coalesce it to a sentinel string inside the isolate.
          '(JSON.stringify(eval(' + JSON.stringify(code) + ')) ?? "__mri_undefined__")',
          { timeout: options.timeoutMs },
        ) as unknown as string) ?? "";
      if (raw === "__mri_undefined__" || raw === "") {
        transferred = "copy";
        value = undefined;
      } else {
        value = JSON.parse(raw) as unknown;
      }
    } catch (error) {
      const message = String((error as Error).message ?? error);
      if (/timed out|terminated|disposed/i.test(message)) {
        // Per-eval CPU timeout (or watchdog disposal): the isolate is dead.
        return {
          value: undefined,
          transferred: "untransferable",
          disposed: true,
          breaches: [],
          stubCalls,
          consoleLines,
        };
      }
      // Any other guest rejection (runtime TypeError, ReferenceError, ...) is
      // Guest-recorded denials are authoritative even on a rejection path:
      // if a runtime guard already fired (delayed getters, proxy traps), its
      // specific breach must reach the verdict, not a generic wrapper.
      let recorded: ContainmentBreach[] = [];
      try {
        recorded = JSON.parse(
          (await context.eval("JSON.stringify(__mri_breaches)", {
            timeout: options.timeoutMs,
          }) as unknown as string) || "[]",
        ) as ContainmentBreach[];
      } catch {
        // isolate unusable; fall through to the generic block below
      }
      if (recorded.length > 0) {
        return {
          value: undefined,
          transferred: "untransferable" as const,
          disposed: false,
          breaches: recorded,
          stubCalls,
          consoleLines,
        };
      }
      // recorded as a containment block: a sandbox that could not finish is
      // never reported as a clean execution.
      return {
        value: undefined,
        transferred: "untransferable",
        disposed: false,
        breaches: [
          {
            kind: "denied-unclassifiable",
            line: 0,
            attempted: "sandbox execution",
            rule: null,
            message: `execution failed inside the isolate (${message}); recorded as a containment block (fail closed)`,
          },
        ],
        stubCalls,
        consoleLines,
      };
    }

    // Recorded breaches always win - they are authoritative denials that the
    // guest raised through policy shims (b15-class events must never vanish).
    let rawBreaches = "[]";
    try {
      rawBreaches =
        (await context.eval("JSON.stringify(__mri_breaches)", {
          timeout: options.timeoutMs,
        })) || "[]";
    } catch {
      disposed = true;
    }

    return {
      value,
      transferred,
      disposed,
      breaches: JSON.parse(rawBreaches || "[]") as ContainmentBreach[],
      stubCalls,
      consoleLines,
    };
  };

  // Watchdog: hard-dispose beats any guest behavior, including infinite loops
  // and microtask bursts that would outlive a verdict.
  const timeoutMs = options.timeoutMs ?? 1000;
  const watchdog = setTimeout(() => disposeQuietly(), timeoutMs);

  try {
    return await run();
  } finally {
    clearTimeout(watchdog);
    disposeQuietly();
  }
}
