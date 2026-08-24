# LAUNCH_POST.md — Show HN draft (FOR REVIEW — do not post yet)

> **Reviewer notes (not part of the post):**
> - No writing-guide file was found in the repo or attached; this draft follows
>   the two rules stated in the task (rule zero: never invent — every claim
>   traces to a repo artifact, listed in the traceability table at the bottom)
>   plus standard Show HN conventions. If the guide lives elsewhere, drop it in
>   and I'll re-shape the draft to it.
> - Two candidate posts below. The guide's note that a genuine bug story is a
>   valid post on its own is why the second one exists.
> - Every number in both drafts is verifiable: benchmark counts from
>   `examples/benchmark/results.json`, got-repo counts from
>   `examples/reports/got-analysis.md`, test counts from the suite at HEAD.

---

## Candidate 1 (primary): the tool

**Title:** Show HN: mri – a code-intelligence engine that refuses to guess

**Post:**

We built mri because every code-intelligence tool we tried had the same
failure mode: when it couldn't prove something, it made something up.

mri (source: https://github.com/zaydmulani09/mri) is a code-intelligence
engine that extracts symbols, imports, calls, and inheritance from
JavaScript/TypeScript, Python, Go, and Rust repositories into a SQLite graph,
then answers structural questions from that graph only. The core rule is in
the schema itself: every cross-symbol reference is either `resolved` (points
at a concrete destination via a deterministic proof) or `ambiguous` (kept
with no destination, original source text preserved). Ambiguous edges fail
closed — they are never guessed into grants, blast radii, or dead-code
verdicts.

What you can do with it today:

- `mri analyze <repo>` — architecture, churn-based risk scores, dead-code
  candidates with confidence labels, import-based test coverage. On
  sindresorhus/got (85 files, 311 functions): one command, ~33 seconds, with
  the full captured run in the repo.
- `mri blast-radius <node>` — everything that depends on a symbol, by depth,
  with confirmed reachability kept separate from ambiguous-only references.
- `mri ask "<question>"` — natural-language questions mapped onto graph
  queries, refusing to guess when a name is ambiguous ("noop" matches two
  symbols? it shows you both instead of picking one).
- `mri guard <scope> <file>` — the part we think is most interesting: a
  fail-closed allowlist generated from the graph (only what a scope provably
  touches), and code that passes the gate runs inside an isolated-vm V8
  isolate — a separate realm and heap with no host objects injected.

On that last point, we want to be precise about what it is and isn't, because
we got burned claiming it first. An adversarial benchmark we ran against our
own guard (33 cases, in the repo) found a real sandbox escape: any host
object injected into a node:vm context leaks its realm's Function
constructor, and `.constructor.constructor("return process")()` reached the
host. We replaced node:vm with isolated-vm (a real V8 isolate boundary),
re-ran the full benchmark — 33/33 attack and legitimacy cases now resolve
correctly, with the two escape payloads blocked and pinned by regression
tests — and wrote down what is still NOT protected (no OS-level sandbox
underneath the isolate, no taint-flow between resource grants, JS-only
scanning). That threat model ships in the repo.

The same honesty applies to the analysis side. Dead-code findings carry
confidence labels and refuse to declare death under uncertainty. Risk scores
are churn + test coverage, stated as approximations. When `mri ask` can't map
a question to a graph query, it says so and lists what it supports.

There's also a VS Code extension (risk/blast-radius CodeLenses, a blast
radius panel, guard diagnostics in the Problems panel), a `mri serve` +
dashboard mode, and an MCP server for editor/agent integration.

Requirements: Node ≥ 22.5 (the graph lives in node:sqlite). Native tree-sitter
grammars are bundled, so `npm install -g mri-codeintel` works without a
compiler toolchain on the common platforms.

Repo: https://github.com/zaydmulani09/mri
Threat model: docs/THREAT_MODEL.md
Adversarial benchmark (33 cases, raw results committed):
examples/benchmark/ADVERSARIAL_REPORT.md

Happy to answer questions about the graph schema, the fail-closed decisions,
or the parts that are still weak.

---

## Candidate 2 (secondary): the bug story

**Title:** Our own adversarial benchmark broke our sandbox, then our tests
hid a second bug

**Post:**

We maintain mri, a small code-intelligence engine with a "guard" feature:
machine-generated JavaScript gets checked against a per-scope allowlist
derived from a code graph, and if it passes, it executes in a sandbox. We
hired the most hostile reviewer we had access to — ourselves, with a
different hat on — and told them to break it. The result changed how we
think about both the sandbox and our tests. Full write-up with raw results
is in the repo (examples/benchmark/ADVERSARIAL_REPORT.md); the short version:

Finding 1 — the sandbox was not a boundary. We executed untrusted code in
Node's `vm` module with a null-prototype context and carefully guarded
`require`/`process` bridges. None of it mattered: any object we injected
into the sandbox (even `console.log`) carries its realm's `Function`
constructor. One line —
`console.log.constructor.constructor("return process")()`
— left the sandbox entirely and read the host's cwd and PATH. Node's docs do
warn that `vm` is not a security mechanism; we had read that warning and
assumed our bridges changed the calculus. They did not. The fix was
architectural: untrusted code now runs in an isolated-vm V8 isolate — a
separate realm and heap where `process` simply does not exist and the
`.constructor.constructor` chain compiles in the guest, not the host. The
original escape payloads are pinned as regression tests.

Finding 2 — the one that scared us more. A test case used a getter that
fired late and read an environment variable it had no grant for. The
runtime guard *detected it and threw*. And the verdict still came back
"executed, no breaches" — because the thrown error crossed into a
host-side argument serializer that had a try/catch around JSON.stringify.
Detection that is silently discarded is worse than no detection: the audit
log said everything was fine. Both halves are fixed now (denials recorded
in-sandbox survive marshaling; recorded denials always win over generic
errors), and the benchmark re-run confirms the case is blocked with a named
breach.

Finding 3 — the humbling one. The same benchmark showed our static scanner
blocked 5 of 19 completely legitimate tasks: it didn't bind parameters of
declared functions, didn't bind catch-clause variables, and didn't map
`.js`-style import paths onto `.ts` sources. A guard that blocks
`function helper(items)` cannot ship to agents that write helpers. All three
are fixed with regression tests; 18 of 19 legitimate tasks now run.

The meta-lesson we keep coming back to: the dangerous failures weren't the
attacks we failed to stop — those were at least visible in a hostile review.
The dangerous ones were the places where our own plumbing quietly converted
a detected violation into a success story, and where a scanner bug wore the
costume of security. If you build anything with a fail-closed story, it's
worth having something try to fail you closed on purpose.

Benchmark harness, 33 cases, and raw per-case output:
https://github.com/zaydmulani09/mri (examples/benchmark/)

---

## Rule-zero traceability (every claim → artifact)

| Claim | Source |
| --- | --- |
| Languages: JS/TS, Python, Go, Rust | README.md line 4; src/extraction/languages.ts |
| Schema-level resolved/ambiguous split | src/graph/schema.ts (CHECK constraint); README "core idea" |
| got: 85 files, 311 functions, ~33s analyze | examples/reports/got-analysis.md (verbatim capture) |
| Commands: analyze/blast-radius/ask/guard/serve | src/cli/index.ts USAGE |
| ask refusing ambiguous "noop" | examples/recordings/ask-got.cast; got-analysis.md |
| 33-case adversarial benchmark, committed results | examples/benchmark/{cases.json,results.json,run.mjs} |
| b01/b02 escape via .constructor.constructor | ADVERSARIAL_REPORT.md deep dive; tests/guardrail-interceptor.test.ts (b01/b02 regressions) |
| isolated-vm isolate backend | src/guardrail/isolate-runner.ts; THREAT_MODEL.md diagram |
| b15 suppression bug + fix | ADVERSARIAL_REPORT.md b15; tests/guardrail-marshaling.test.ts; f65d4b3 |
| Suite A scanner defects (params/catch/.js) + fix | ADVERSARIAL_REPORT.md Suite A; tests/code-scan.test.ts |
| 18/19 Suite A execute; 33/33 resolved correctly | examples/benchmark/results.json at c628986 |
| a17 blocked by design (fs bridge) | ADVERSARIAL_REPORT.md update note; THREAT_MODEL.md "bridge implementations" |
| Node ≥ 22.5, bundled grammars | package.json engines/files; scripts/check-install.mjs |
| VS Code extension, dashboard/serve, MCP server | vscode-extension/, dashboard/, src/cli/serve-command.ts, src/mcp/, docs/MCP_SERVER.md |
| No OS sandbox / no taint-flow / JS-only scan limits | docs/THREAT_MODEL.md "does NOT protect" §1/§3/§6 |
| 162 tests / 24 files | vitest run at HEAD (c628986) |
