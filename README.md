# mri

> An MRI scan for your codebase — structural code intelligence you can trust,
> because every fact in the graph is either proven or explicitly marked
> unknown.

mri extracts symbols and structure from JavaScript/TypeScript, Python, Go,
and Rust repositories into a queryable graph, then answers hard structural
questions: what calls this, what depends on it, what looks dead, where risk
concentrates. It is **not** an LLM guessing about your code — resolution is
deterministic, and when a reference cannot be proven, the graph says so
instead of inventing an edge.

## Watch it work

Real terminal recordings (captured with
[examples/recordings/capture.mjs](examples/recordings/capture.mjs); replay
with `asciinema play <file>` or read the `.txt` transcript alongside):

- **[analyze-got.cast](examples/recordings/analyze-got.cast)** — `mri analyze`
  against [sindresorhus/got](https://github.com/sindresorhus/got): architecture,
  dead-code candidates, churn-based risk, import-based coverage — one command,
  ~33 seconds.
- **[ask-got.cast](examples/recordings/ask-got.cast)** — `mri ask` refusing to
  guess on an ambiguous name ("noop" matches two symbols), then answering
  "who calls calculateRetryDelay" and "what is the riskiest file" strictly from
  graph facts.
- **[containment.cast](examples/recordings/containment.cast)** — `mri guard`:
  the allowlist receipt for a billing-module scope, in-scope code executing
  cleanly, then an attempted `.env` read blocked pre-execution with the exact
  violated rule (`resources.filesystem`, zero grants).

Every recording is a real run against real repositories — no staged output.
The fixture used by the containment recording ships in
[examples/recordings/fixture](examples/recordings/fixture).
## The core idea

Most code-intelligence tools optimize for plausible-looking answers. mri
optimizes for trustworthy ones:

- Every cross-symbol reference is stored as either `resolved` (points at a
  concrete destination via a deterministic proof) or `ambiguous` (kept with
  no destination and its original source text preserved).
- The database schema itself forbids lying about which is which.
- Downstream analysis honors the distinction end-to-end: blast radius keeps
  confirmed reachability separate from ambiguous-only dependents; dead-code
  findings refuse to declare death under uncertainty.

**Ambiguous edges fail closed, never guessed.**

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Installation

**Requires Node.js ≥ 22.5** (mri stores its code graph in `node:sqlite`,
which ships with Node from 22.5). The installer verifies Node, SQLite and the
tree-sitter native bindings up front and prints actionable instructions if
anything is missing.

### From npm (after publish)

The npm package is published as **`mri-codeintel`**; the installed command is
**`mri`**.

```bash
npm install -g mri-codeintel
mri --help
```

Or use it without installing globally:

```bash
npx mri-codeintel analyze /path/to/repo
```

The npm package bundles its tree-sitter native dependencies, so a plain
`npm install mri-codeintel` works out of the box on platforms with prebuilt binaries
(win32/x64, darwin arm64+x64, linux arm64+x64) — no compiler toolchain needed.

### From source

```bash
git clone https://github.com/zaydmulani09/mri
cd mri
npm install
npm run build
node dist/cli/index.js --help
```

If tree-sitter native bindings ever break after a Node upgrade:

```bash
npm rebuild tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-rust
```

## Usage

The CLI ships six commands: `extract`, `build`, `blast-radius`, `analyze`,
`ask`, and `guard`.

```bash
npx mri analyze /path/to/repo
```

```text
ARCHITECTURE
  files             15   (javascript 11, python 4)
  symbols           functions 15 | classes 5 | methods 4
  edges             defines 23 | imports 7 | calls 12 (8 resolved / 4 ambiguous) | inherits 3
  external modules  1   [extlib]

TECH DEBT
  dead code candidates 3   (detail under DEAD CODE)

SECURITY-RELEVANT SIGNALS (gaps in knowledge, not findings)
  unresolved references   4   "process" x1, "formatter" x1, ...
DEAD CODE
  candidates 3: 2 confirmed-unreferenced, 1 no-resolved-references
TEST COVERAGE
  estimated coverage 38.5% (5/13 source files, import-based approximation)
```

```bash
npx mri blast-radius fn:src/api.js#fetchUser --format tree
```

```text
fn:src/format.js#pad  (function)
├─ ✓ fn:src/api.js#fetchUser   d1 · calls
│  ├─ ✓ fn:src/index.js#main   d2 · calls
└─ ✓ fn:src/format.js#money   d1 · calls
```

`mri ask` maps a natural-language question onto one of the supported graph
queries, executes it against the real graph, and narrates only that result;
unmappable questions are rejected rather than guessed at. When a local Ollama
server is reachable (`MRI_OLLAMA_URL`, `MRI_OLLAMA_MODEL`) the answer is
narrated by the model; otherwise the structured result is printed as-is.

`mri guard` checks a code snippet against the fail-closed allowlist generated
for any scope in the graph. Ungranted resources, unknown references, or
imports outside the scope's proven reachability block execution before it
starts. Code that passes the gate runs inside an **isolated-vm V8 isolate** —
a separate realm and heap with no host objects injected — so cross-realm
escape attempts (the `.constructor.constructor` class from the adversarial
benchmark) are structurally impossible rather than merely discouraged:

```bash
npx mri guard fn:src/api.js#fetchUser snippet.js --path /path/to/repo
```

```text
BLOCKED — code refused for scope fn:src/api.js#fetchUser
1 containment breach(es):

  line 1 · ungranted-resource
    attempted: process.env.TOKEN
    rule:      resources.environment -> expected TOKEN
    reason:    read access to environment variable 'TOKEN' is not granted (granted variables: none)

nothing was executed (fail closed). allowlist: 4 symbol(s), 3 file(s); 2 unresolved reference(s) excluded
```

Command reference: run `mri --help`.

To run these checks inside another repository's CI, see
[docs/GITHUB_ACTION.md](docs/GITHUB_ACTION.md) — mri ships composite GitHub
Actions for scoped containment (`mri guard`) and PR analysis summaries
(`mri analyze`), and runs them against this repository on every PR.

### Against a real codebase

The snippets above use a tiny fixture for readability. A full validation run
against [sindresorhus/got](https://github.com/sindresorhus/got) — including a
QA pass that found and fixed three real correctness bugs — is captured
verbatim in [examples/reports/got-analysis.md](examples/reports/got-analysis.md)
(mri `40ba1d8`). Two highlights from it:

```text
$ mri build <got>
85 files parsed
nodes: 85 files, 311 functions, 24 classes, 189 methods, 57 external modules
edges: 495 defines, 525 imports, 2334 calls (712 resolved / 1622 ambiguous),
       16 inherits (14 resolved / 2 ambiguous)
```

```text
$ mri blast-radius "fn:source/core/options.ts#assertAny" --format tree
fn:source/core/options.ts#assertAny  (function)
├─ ✓ cls:source/core/options.ts#Options   d1 · calls
│  ├─ ✓ cls:source/core/index.ts#Request   d2 · calls
│  │  ├─ ✓ fn:source/as-promise/index.ts#asPromise   d3 · calls
│  ├─ ✓ fn:benchmark/index.ts#internalBenchmark   d2 · calls
│  ├─ ✓ fn:source/create.ts#create   d2 · calls
│  ├─ ✓ m:source/core/index.ts#Request._onResponseBase   d2 · calls
├─ ✓ fn:source/core/options.ts#validateSearchParameters   d1 · calls
… (21 more Options.* accessor methods, all ✓ confirmed, d1)
```

Note the build line: 1622 call edges stayed `ambiguous` rather than being
guessed into destinations — mostly JS globals and dynamic dispatch. That
ratio is the fail-closed contract doing its job on real code.

## What's inside

- **Extraction** — gitignore-aware walker plus tree-sitter parsers for
  JavaScript (.js/.jsx/.mjs/.cjs), TypeScript (.ts/.tsx), Python, Go, and
  Rust.
- **Graph** — SQLite store of files, functions, classes, methods and their
  `defines` / `imports` / `calls` / `inherits` relations, built in one
  atomic transaction per repository.
- **Analysis** — dead-code candidates with two-level confidence labels,
  import-based test-coverage estimates, cyclomatic-complexity scoring,
  git-churn risk scoring with printed components, reverse-dependency blast
  radius by depth.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and the
resolution/confidence contract.

## Roadmap

Built and working today:

- Extraction layer for JS/TS/Python (`mri extract`)
- Graph construction with resolved-vs-ambiguous tracking (`mri build`)
- Dead-code, coverage, complexity, churn-risk, and blast-radius passes
  (`mri analyze`, `mri blast-radius`)
- Reasoning v0: deterministic question intents over the graph, grounded
  narration via a local Ollama model when available (`mri ask`)
- Guardrail enforcement: fail-closed allowlists per graph scope plus a
  sandboxed checker (`mri guard`)
- Local dashboard (mri serve): force-graph viewer with live blast-radius
  highlighting (confirmed vs ambiguous kept visually separate), dead-code
  and risk tables, fully offline
- Showcase validation run against sindresorhus/got, demo-ready
  ([examples/reports/got-analysis.md](examples/reports/got-analysis.md))

In flight / planned:

- Public containment demo per `docs/CONTAINMENT_DEMO_SCRIPT.md`
- Incremental rebuilds and watch mode

Full phase breakdown by dependency order: [docs/ROADMAP.md](docs/ROADMAP.md)

## Status

Pre-alpha under active development. The graph schema and CLI surface may
still change. Nothing in this README describes capabilities that don't
already exist in `src/`.

## License

[MIT](LICENSE)
