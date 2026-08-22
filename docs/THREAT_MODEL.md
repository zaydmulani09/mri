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
> Implementation status note: allowlist generation and the grant schema are
> committed (`src/guardrail/generate.ts`, d4b6eb0); the scan/interceptor
> files described here are present in the working tree and in flight.

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
│   │ GUARDED VM CONTEXT (node:vm)                         │ │
│   │   null-prototype sandbox; require/process/fetch are  │ │
│   │   host-built bridges that re-check grants at runtime │ │
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

1. **Capability overreach via imports.** `fs`, `child_process`, network
   builtins (`http`, `https`, `net`, `dgram`, `dns`, `tls`) are classified
   (`classifyModuleSpecifier`) and allowed only if the corresponding
   resource category has at least one grant. Node builtins with **no**
   grant category (e.g. `vm`, `worker_threads`, `os`) are never allowed at
   all. Package imports require matching external symbol/module grants.
2. **Secret environment access.** `process.env.NAME` is checked per variable
   name, per mode (read/write), both statically and at runtime through a
   Proxy. `Object.keys(process.env)` and friends throw — enumeration is not
   permitted even for granted variables.
3. **Unapproved network egress.** `fetch` requires a literal URL whose
   host/port/protocol matches a network grant; re-checked at call time by
   the runtime bridge.
4. **Evasion via indirection.** Dynamic imports (`import(expr)`),
   non-literal `require()`, computed `fetch` URLs, and unnamed
   `process.env` access cannot be proven safe, so they are blocked as
   *unverifiable* rather than allowed.
5. **Free identifiers.** Any identifier that is neither declared locally nor
   on a small safe-globals list nor explicitly granted produces an
   `unknown-reference` breach. The default posture is deny.
6. **Unparseable code.** If the snippet does not parse, nothing executes.
7. **Ambiguous graph edges at scoping time.** When the allowlist is
   generated from the code graph (`generateAllowlist`), only `resolved`
   edges produce grants. Ambiguous references are excluded from the
   allowlist and surfaced on its `unresolved` list for a human to resolve.
8. **Runtime bypass attempts.** Even after passing the static gate, calls
   through the bridged `require`/`process`/`fetch` surfaces re-verify grants
   at execution time. A wall-clock timeout (default 1000 ms) bounds runaway
   snippets.

Every block is a structured `ContainmentBreach` with a stable `kind`
(`parse-failure`, `disallowed-import`, `unverifiable-import`,
`ungranted-resource`, `unverifiable-resource`, `unknown-reference`), the
offending line, the attempted text, and the rule area violated. Decisions are
deterministic and replayable.

Threat actors this addresses: a misbehaving or prompt-injected LLM agent
writing code that reaches beyond its task; sloppy generated code that
accidentally touches secrets; and replay/audit needs ("show me exactly why
this was blocked").

## What it explicitly does NOT protect against

Read this list as the honest price tag of the current design.

1. **Zero-days in the sandbox runtime itself.** Execution uses Node's
   `node:vm`. Node's own documentation is explicit that `vm` is **not** a
   security mechanism. A V8 engine bug, an exotic sandbox escape chain, or a
   hostile prototype-pollution gadget may break out entirely. There is no
   OS-level isolation underneath (no containers, seccomp, jails, or separate
   processes). Treat containment as policy enforcement, not a convicts-and-
   walls guarantee.
2. **Host-side compromise.** The guardrail runs in-process with the full
   privileges of the host. A compromised host, a malicious orchestrator, or
   a tampered allowlist/graph makes every guarantee void.
3. **Side-channel attacks.** Timing analysis, cache channels, and similar
   are out of scope. Resource exhaustion is only partially bounded: there is
   an execution timeout but **no memory cap**, so a memory-hungry snippet
   can degrade or OOM the host process before the timeout fires.
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

1. OS-level isolation beneath the VM (container/jail/seccomp profile around
   the host process).
2. Memory/CPU caps alongside the wall-clock timeout.
3. Data-flow awareness for grant combinations (env var → network pairing).
4. TypeScript/Python scanning parity in the code gate.
5. Independent security review and fuzzing of `code-scan.ts` and the bridge
   surfaces.

Until those land, the correct claim is the narrow one: **mri containment
deterministically stops generated-code capability overreach that is visible
to AST-level inspection, fails closed when it cannot prove safety, and
explains every decision — within a trusted host, atop an unhardened runtime.**

## Reporting

Found a way around the containment layer? That is valuable — please open a
private security advisory on the GitHub repository rather than a public
issue.
