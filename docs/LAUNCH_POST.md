# LAUNCH_POST.md — Show HN draft (FOR REVIEW — do not post yet)

> **Reviewer notes (not part of the post):**
> - Revised against the writing guide (rule zero + linguistic-tells list +
>   launch shape + pre-post checklist). A checklist audit is at the bottom.
> - Two candidates. The bug-story candidate exists because the guide names
>   "a weird bug / unexpected result" as a real post; the benchmark gave us
>   two, both documented in the repo.
> - Every number traces to an artifact (table at the bottom). The npm
>   package is NOT published yet, so neither draft claims `npm install`
>   works today.

---

## Candidate 1 (primary): the tool

**Title:** Show HN: mri – code intelligence that marks what it can't prove

**Post:**

I wrote mri, a TypeScript CLI that builds a code graph for JavaScript,
TypeScript, Python, Go, and Rust repositories and answers structural
questions from it: what calls this, what depends on this symbol, what looks
dead, where churn concentrates. Closest existing tools I know of are rule
engines (CodeQL, semgrep) and index formats (LSIF/SCIP). mri differs in one
specific way: its SQLite schema enforces that every cross-symbol reference
is either `resolved` (a deterministic proof points at a destination) or
`ambiguous` (stored with no destination and its source text). Unproven
references are never dropped and never guessed.

That rule shows up downstream:

- `mri blast-radius <node>` separates confirmed dependents from
  ambiguous-only ones instead of blending them.
- Dead-code findings carry confidence labels and refuse to declare death
  when a reference is unresolved.
- `mri ask` maps questions to graph queries; when "noop" matches two
  symbols it lists both rather than picking one.

On sindresorhus/got (85 files, 311 functions), `mri analyze` runs in about
3 seconds and reports architecture, dead-code candidates, churn-based risk,
import-based coverage, and cyclomatic complexity. The captured run is
committed.

The second half is `mri guard <scope> <file>`: it derives a fail-closed
allowlist from the graph — only what a scope provably touches — and runs
code that passes the gate inside an isolated-vm V8 isolate. I originally
used node:vm with guarded bridges; an adversarial benchmark I wrote against
it found that any injected host object leaks the host realm's Function
constructor (`console.log.constructor.constructor("return process")()` read
the host cwd and PATH). The backend is now isolated-vm — a separate realm
and heap where `process` doesn't exist — and the benchmark's escape payloads
are pinned as regression tests.

It does not: sandbox at the OS level, trace data flow between resource
grants (a granted env var copied into a granted fetch is exfiltration
working as configured), scan TypeScript or Python in the guard gate, or
protect against a compromised host. The full list is in
docs/THREAT_MODEL.md, and a 33-case adversarial benchmark with committed
raw results is in examples/benchmark/. On the current build Suite B's 14
attack cases all fail closed — 10 BLOCKED outright, 4 EXECUTED but
contained-by-construction with zero side effects — and 18 of 19 legitimate
tasks execute; the one remaining block needs a real filesystem bridge that
doesn't exist yet, not a scanner fix.

Repo: https://github.com/zaydmulani09/mri

I'd want to know what breaks first when someone points `mri guard` at
generated code from a real agent workflow — the benchmark fixtures are mine,
and I expect real prompts to find scanner gaps I haven't.

---

## Candidate 2 (secondary): the bug story

**Title:** An adversarial benchmark found a sandbox escape and a swallowed breach in our guard

**Post:**

mri has a guard feature: machine-generated JavaScript is checked against a
per-scope allowlist derived from a code graph, and code that passes runs in
a sandbox. We ran an adversarial benchmark against it — 33 cases written to
break it — and it found two things worth describing, plus one that stung.
Full report with raw per-case output:
examples/benchmark/ADVERSARIAL_REPORT.md.

The sandbox escape. Untrusted code ran in Node's `vm` module with a
null-prototype context and guarded `require`/`process` bridges. None of it
mattered: any object the host injects carries its realm's `Function`
constructor, so `console.log.constructor.constructor("return process")()`
left the sandbox and read the host's cwd and PATH. Node's docs warn that
`vm` is not a security mechanism; we had read that warning and assumed the
bridges changed the math. They didn't. The fix: execution now happens in an
isolated-vm V8 isolate — separate realm and heap, `process` doesn't exist
inside, and the original escape payloads are pinned as regression tests.

The swallowed breach. One case used a getter that fired late and read an
env var it had no grant for. The runtime guard detected it and threw. The
verdict still came back "executed, no breaches" — the throw crossed into a
host-side argument serializer with a try/catch around JSON.stringify, and
died there. The audit log said everything was fine. Both halves are fixed
(denials are recorded in-sandbox and recorded denials beat generic errors),
and the case now blocks with a named breach.

The stinging one. The same benchmark blocked 5 of 19 completely legitimate
tasks, because the scanner didn't bind parameters of declared functions,
didn't bind catch-clause variables, and didn't map `.js` import paths onto
`.ts` sources. A guard that blocks `function helper(items)` can't run in
front of an agent that writes helpers. Fixed, with tests; 18 of 19 now run.

The asymmetry is what stuck with us: the escape was at least visible the
moment we looked for it. The swallowed breach looked exactly like success
in the logs, and the false blocks looked exactly like the guard working.

Harness, cases, and raw results: https://github.com/zaydmulani09/mri
(examples/benchmark/)

---

## Pre-post checklist audit (this revision)

| Item | Status |
| --- | --- |
| Nothing invented | PASS — "every tool we tried" motivation removed (undocumented experience); all numbers trace via table below |
| First two sentences: problem/target/mechanism | PASS — both candidates open with mechanism, no mission statement |
| Adjectives removed or backed | PASS — "deterministic" backed by schema CHECK; "fail-closed" backed by 33-case results; no "fast/robust/seamless" |
| Real limitation stated plainly | PASS — "It does not:" list; a17; npm not yet published stated |
| Differs from two closest tools | PASS — CodeQL/semgrep + LSIF/SCIP, mechanism-level, no superiority claim |
| Quickstart commands actually run | PASS — clone/npm install/build/guard/analyze all executed this session in clean archive stages; `npm -g` claim removed (package unpublished) |
| README examples match current CLI | PASS — commands cross-checked against src/cli/index.ts USAGE |
| Hype tells removed | PASS — cut: "most interesting", "got burned", "hired a hostile reviewer", "the one that scared us more", "the humbling one", "Happy to answer questions", universal-lesson closer |
| One real reason to exist | PASS — candidate 1: benchmark-evidenced containment; candidate 2: two documented bugs |
| Paste-onto-another-project test | PASS — b01/b02/b15 specifics and the 33-case numbers are project-unique |

## Rule-zero traceability (every claim → artifact)

| Claim | Source |
| --- | --- |
| Languages: JS/TS, Python, Go, Rust | README.md; src/extraction/languages.ts |
| Schema-level resolved/ambiguous split | src/graph/schema.ts (CHECK constraint) |
| got: 85 files, 311 functions, ~3s | examples/reports/got-analysis.md (verbatim capture); re-measured 2.9–3.0 s at the captured got commit `e3924aa` |
| blast-radius confirmed vs ambiguous split | src/analysis/blast-radius.ts; got-analysis.md |
| dead-code confidence labels | src/analysis/dead-code.ts; got-analysis.md |
| ask "noop" two-symbol refusal | examples/recordings/ask-got.cast; got-analysis.md |
| node:vm escape via .constructor.constructor (b01/b02) | ADVERSARIAL_REPORT.md deep dive; tests/guardrail-interceptor.test.ts |
| isolated-vm backend | src/guardrail/isolate-runner.ts; THREAT_MODEL.md diagram |
| 14 attack cases blocked (Suite B 10 blocked + 4 contained-executes) | examples/benchmark/results.json at HEAD |
| 18/19 legitimate execute; a17 needs fs bridge | examples/benchmark/results.json; ADVERSARIAL_REPORT.md update note |
| b15 swallowed-breach bug + fix | ADVERSARIAL_REPORT.md b15; tests/guardrail-marshaling.test.ts |
| Suite A scanner defects + fix | ADVERSARIAL_REPORT.md Suite A; tests/code-scan.test.ts |
| No OS sandbox / no taint-flow / JS-only guard scan / compromised-host | docs/THREAT_MODEL.md "does NOT protect" |
| Node ≥ 22.5, bundled grammars, mri-codeintel bin | package.json; scripts/check-install.mjs |
| VS Code extension / dashboard+serve / MCP | vscode-extension/; dashboard/; src/cli/serve-command.ts; src/mcp/ |
| 162 tests / 24 files | vitest run at 3ecfba4 |
| npm package not yet published | package.json (unpublished name mri-codeintel); publish on hold per task context |
