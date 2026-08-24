# Threat Model

> **Positioning statement first:** mri's containment layer is a *policy gate*
> plus a *guarded execution context* for untrusted, machine-generated
> JavaScript snippets. It is designed to stop one specific threat class —
> generated code reaching capabilities it was never granted — and it does
> that with deterministic, explainable decisions. It is **not** a hardened
> sandbox, **not** an anti-virus, and **not** a defense against a compromised
> host. For a security tool, overclaiming is worse than underclaiming; this
> document errs toward the blunt end.
>
> Implementation status note: allowlist generation, the AST scanner, the
> check-and-run interceptor, and the breach taxonomy are committed and wired
> into the CLI as `mri guard <scope-id> <file>`. Since the adversarial
> benchmark, execution runs inside an isolated-vm V8 isolate (separate realm
> and heap) instead of node:vm - see `src/guardrail/isolate-runner.ts` and
> `examples/benchmark/ADVERSARIAL_REPORT.md`. Fail-closed behavior is
> verified end-to-end against a real codebase (sindresorhus/got at mri
> `40ba1d8`): ungranted imports are refused before anything executes, and
> in-scope code runs against inert stubs — captured verbatim in
> `examples/reports/got-analysis.md`. The limitations below are the ones
> that still hold after the isolate backend and scanner-precision fixes;
> superseded node:vm-era caveats have been removed.

## Assets being protected

| Asset | Example |
| --- | --- |
| Host environment variables | API keys, tokens readable via `process.env` |
| Host filesystem | source files, `.env` files, SSH keys |
| Network egress | internal services, exfiltration endpoints |
| Process spawn | running arbitrary commands on the host |
| Analysis integrity | the graph/allowlist not silently widened |

## Trust boundaries

```text
┌────────────────────────────────────────────────────────────┐
│ HOST (trusted)                                             │
│   orchestrator · allowlist generation · guardrail module   │
│                                                            │
│   ┌──────────────────────────────────────────────────────┐ │
│   │ STATIC GATE (code-scan.ts)                           │ │
│   │   tree-sitter parse of generated JS; every import,   │ │
│   │   resource access and free identifier checked        │ │
│   │   against the allowlist — before any execution       │ │
│   └──────────────────┬───────────────────────────────────┘ │
│                      │ only if zero breaches               │
│   ┌──────────────────▼───────────────────────────────────┐ │
│   │ ISOLATED VM (isolated-vm, separate V8 isolate)        │ │
│   │   own realm + heap; require/process/fetch bridges     │ │
│   │   re-check grants host-side at every runtime call     │ │
│   │ ┌──────────────────────────────────────────────────┐ │ │
│   │ │ UNTRUSTED GENERATED CODE                         │ │ │
│   │ └──────────────────────────────────────────────────┘ │ │
│   └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

The untrusted party is the *generated code* (typically LLM output). The host,
the allowlist file, and the graph database are inside the trust boundary:
**if the attacker controls the allowlist or the host, nothing below holds.**

## What the containment layer actually protects against

Each row names the mechanism and where it lives.

1. **Cross-realm escapes.** Guest code runs in an isolated-vm V8 isolate:
   a separate realm and heap with no host objects injected. The
   `.constructor.constructor` host-realm escape class (benchmark b01/b02)
   is structurally closed - the guest `Function` constructor compiles
   in-isolate only, and `process` does not exist inside. Regression tests
   pin both payloads in `tests/guardrail-interceptor.test.ts`.
2. **Capability overreach via imports.** `fs`, `child_process`, network
   builtins (`http`, `https`, `net`, `dgram`, `dns`, `tls`) are classified
   (`classifyModuleSpecifier`) and allowed only if the corresponding
   resource category has at least one grant. Node builtins with **no**
   grant category (e.g. `vm`, `worker_threads`, `os`) are never allowed at
   all. Package imports require matching external symbol/module grants.
3. **Secret environment access.** `process.env.NAME` is checked per variable
   name, per mode (read/write), both statically and at runtime through a
   Proxy. `Object.keys(process.env)` and friends throw — enumeration is not
   permitted even for granted variables.
4. **Unapproved network egress.** `fetch` requires a literal URL whose
   host/port/protocol matches a network grant; and because grants alone do
   not perform I/O in the isolate, a fetch without a host-provided network
   bridge is recorded as a denial instead of silently doing nothing.
5. **Evasion via indirection.** Dynamic imports (`import(expr)`),
   non-literal `require()`, computed `fetch` URLs, and unnamed
   `process.env` access cannot be proven safe, so they are blocked as
   *unverifiable* rather than allowed.
6. **Free identifiers.** Any identifier that is neither declared locally nor
   on a small safe-globals list nor explicitly granted produces an
   `unknown-reference` breach. The default posture is deny.
7. **Unparseable code.** If the snippet does not parse, nothing executes.
8. **Ambiguous graph edges at scoping time.** When the allowlist is
   generated from the code graph (`generateAllowlist`), only `resolved`
   edges produce grants. Ambiguous references are excluded from the
   allowlist and surfaced on its `unresolved` list for a human to resolve.
9. **Runtime bypass attempts and resource abuse.** Even after passing the
   static gate, calls through the bridged `require`/`process` surfaces
   re-verify grants at execution time; imported project files execute
   never (inert data snapshots only). Each run is bounded by both a
   wall-clock timeout (default 1000 ms) and an isolate memory limit
   (default 128 MB); a watchdog hard-disposes the isolate on overrun and
   the run is recorded as a containment block, never a clean execution.
10. **Suppressed detections.** Guest-recorded denials are authoritative on
    every code path — including throws that cross marshaling boundaries or
    runtime failures — so a detected violation always reaches the verdict
    (the failure mode benchmark case b15 exposed and closed).

Every block is a structured `ContainmentBreach` with a stable `kind`
(`parse-failure`, `disallowed-import`, `unverifiable-import`,
`ungranted-resource`, `unverifiable-resource`, `unknown-reference`), the
offending line, the attempted text, and the rule area violated. Decisions are
deterministic and replayable.

Threat actors this addresses: a misbehaving or prompt-injected LLM agent
writing code that reaches beyond its task; sloppy generated code that
accidentally touches secrets; and replay/audit needs ("show me exactly why
this was blocked").

## Empirical evidence

These claims are not self-assessed; they come from an adversarial benchmark
built to break the system, re-run after the isolate backend and
scanner-precision fixes. Full per-case output:
[examples/benchmark/ADVERSARIAL_REPORT.md](../examples/benchmark/ADVERSARIAL_REPORT.md)
(raw captures in its `results.json`; harness runs every case through the
real `mri guard --json` CLI).

- **Suite A — legitimate tasks: 18/19 EXECUTE.** The original run found a
  5/19 hard false-block rate (plus 3 degraded results) caused by scanner
  binding defects (declared-function parameters, catch parameters, loop-head
  declarations, `.js`→`.ts` import mapping). All fixed; the one remaining
  block (a17, real filesystem read under a granted scope) is denied **by
  design** because no filesystem capability bridge exists yet — recorded as
  a denial, not a false positive.
- **Suite B — adversarial escapes: every attack class fails closed.**
  The two complete sandbox escapes from the original run (b01/b02,
  cross-realm `.constructor.constructor` against node:vm) are now BLOCKED
  with zero host leakage and pinned by regression tests. Four cases report
  EXECUTED but are contained-by-construction with zero side effects:
  deferred work dies with the disposed isolate (b03), prototype pollution
  is guest-realm-only (b10), imported modules are inert data (b12),
  `Error.stack` is host-anonymized (b14). The silent suppression bug (b15:
  a detected violation vanishing into argument marshaling) is fixed twice
  over — marshaling rethrows, and the isolate records denials before any
  wrapper can intervene.
- **Verdict diff vs the pre-isolate baseline: exactly 9 flips, all in the
  correct direction** (2 escapes EXECUTED→BLOCKED, 6 legitimate tasks
  BLOCKED→EXECUTED, b12 BLOCKED→EXECUTED with zero side effects).

## What it explicitly does NOT protect against

Read this list as the honest price tag of the current design.

1. **Zero-days in the isolation layer itself.** Execution uses
   `isolated-vm`: a separate V8 isolate per run, a fundamentally stronger
   boundary than node:vm shared-realm contexts and the mechanism the
   adversarial benchmark identified as the fix for the b01/b02 escapes.
   That is still not a promise of perfection - a V8 or isolated-vm engine
   bug may break out, the dependency is native and must stay current, and
   there is **no OS-level isolation underneath** (no containers, seccomp,
   or jails). Treat containment as strong policy enforcement, not a
   convicts-and-walls guarantee.
2. **Host-side compromise.** The guardrail runs in-process with the full
   privileges of the host. A compromised host, a malicious orchestrator, or
   a tampered allowlist/graph makes every guarantee void.
3. **Side-channel attacks and post-verdict semantics.** Timing analysis,
    cache channels, and similar are out of scope. Resource exhaustion is
    bounded per run (wall-clock timeout plus an isolate memory limit,
    watchdog-disposed on overrun), but the verdict is synchronous: guest
    work deferred past the verdict window is killed when the isolate is
    disposed — it cannot produce side effects, and legitimate deferred work
    does not complete either (benchmark b03, contained-by-construction).
4. **Anything not visible to the AST scan of a single snippet.** The static
   gate sees one JavaScript snippet. It has no data-flow/taint analysis, no
   inter-procedural reasoning across files, and no view of values produced
   at runtime. Concretely: a *granted* environment variable's value passed
   into a *granted* fetch target is exfiltration working exactly as
   configured. Grants are capabilities; combining two legitimate grants into
   a leak channel is not detected.
5. **Host-provided bridge implementations.** The sandbox's `require` returns
   whatever module implementations the host chooses to bridge in. Those
   implementations are fully trusted: if the host bridges a real filesystem
   reader, path-level checks inside that reader are the integrator's
   responsibility, not mri's.
6. **Languages other than JavaScript.** The scanner parses with the
   JavaScript grammar today. Generated TypeScript and Python snippets are
   outside the current enforcement envelope.
7. **Attacks on the pipeline above the guardrail.** Prompt injection that
   convinces the orchestrator to widen the allowlist, tampering with the
   graph database before generation, or hand-editing grant JSON: the layer
   enforces whatever allowlist it is given. Garbage scope in, garbage scope
   out.
8. **Denial of service against the checker itself.** The parse phase has no
   independent timeout; pathological inputs designed to stress the parser
   could stall the host thread.
9. **Multi-file programs.** `checkAndRun` evaluates one snippet in isolation.
   There is no mechanism yet for containing a multi-module generated program
   with internal imports resolved from disk.

## Why fail-closed-on-ambiguity matters here

The graph layer's core rule — ambiguous references get no destination and no
guesses — is what makes the security story coherent:

- **No silent permissions.** Allowlist generation refuses to convert an
  ambiguous callee text into a grant. A guessed entry could let code reach a
  same-named helper in another module under a legitimate-looking permission;
  instead, ambiguity lands on the allowlist's `unresolved` list and blocks
  the path until a human resolves it.
- **Every uncertainty class has a name.** Parse failure, unverifiable import
  targets, unnamed resource access, unknown identifiers — each maps to an
  explicit breach kind, never to a shrug-and-allow. An audit log therefore
  distinguishes "definitely bad" from "could not prove safe" instead of
  blending them.
- **Known cost, stated plainly:** a scope containing ambiguous references
  yields an allowlist too small to run correctly — by design. That friction
  is deliberate: it forces ambiguity to be fixed in the graph (and thus in
  the analyzed codebase) rather than papered over at enforcement time.

A containment tool that guessed would be worse than useless: it would issue
permissions dressed up as analysis. Fail-closed is what lets the block log
be treated as evidence.

## Hardening direction (not built)

In dependency order, what would need to exist before "production security
boundary" claims become defensible:

1. OS-level isolation beneath the isolate (container/jail/seccomp profile
    around the host process).
2. Data-flow awareness for grant combinations (env var to network pairing,
    benchmark finding b06).
3. TypeScript/Python scanning parity in the code gate (today's scanner is
    JavaScript-only; the benchmark's Suite A false-block class within
    JavaScript is fixed).
4. Independent security review and fuzzing of `code-scan.ts`, the isolate
    bootstrap, and the bridge surfaces.
5. Bridged real capabilities behind guarded require/fetch with the taint
    rules from the benchmark, replacing today's inert-stub semantics.

Until those land, the correct claim is the narrow one: **mri containment
deterministically stops generated-code capability overreach that is visible
to AST-level inspection, fails closed when it cannot prove safety, and
explains every decision — within a trusted host, atop an unhardened runtime.**

## Reporting

Found a way around the containment layer? That is valuable — please open a
private security advisory on the GitHub repository rather than a public
issue.
