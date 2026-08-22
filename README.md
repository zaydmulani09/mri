# mri

> An MRI scan for your codebase — structural code intelligence you can trust,
> because every fact in the graph is either proven or explicitly marked
> unknown.

mri extracts symbols and structure from JavaScript/TypeScript and Python
repositories into a queryable graph, then answers hard structural questions:
what calls this, what depends on it, what looks dead, where risk
concentrates. It is **not** an LLM guessing about your code — resolution is
deterministic, and when a reference cannot be proven, the graph says so
instead of inventing an edge.

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

From source (no published package yet):

```bash
git clone <this-repo>
cd mri
npm install
npm run build
```

Requires Node.js ≥ 18.

## Usage

The CLI ships four commands: `extract`, `build`, `blast-radius`, `analyze`.

```bash
npx mri analyze /path/to/repo
```

<!-- [example output once CLI output format is finalized] -->

```bash
npx mri blast-radius fn:src/core/engine.ts#dispatch
```

<!-- [example output once CLI output format is finalized] -->

Command reference: run `mri --help`.

## What's inside

- **Extraction** — gitignore-aware walker plus tree-sitter parsers for
  JavaScript (.js/.jsx/.mjs/.cjs), TypeScript (.ts/.tsx), and Python.
- **Graph** — SQLite store of files, functions, classes, methods and their
  `defines` / `imports` / `calls` / `inherits` relations, built in one
  atomic transaction per repository.
- **Analysis** — dead-code candidates with two-level confidence labels,
  import-based test-coverage estimates, git-churn risk scoring with printed
  components, reverse-dependency blast radius by depth.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and the
resolution/confidence contract.

## Roadmap

Built and working today:

- Extraction layer for JS/TS/Python (`mri extract`)
- Graph construction with resolved-vs-ambiguous tracking (`mri build`)
- Dead-code, coverage, churn-risk, and blast-radius passes (`mri analyze`,
  `mri blast-radius`)

Planned (not started — see docs for specs):

- Guardrail/sandbox interceptor for agent workflows, culminating in a public
  containment demo (`docs/CONTAINMENT_DEMO_SCRIPT.md`)
- Reasoning layers on top of the graph
- Incremental rebuilds and watch mode
- Public showcase run against a real open-source repo
  (`docs/DEMO_CANDIDATES.md` shortlist; final pick pending test runs)

## Status

Pre-alpha under active development. The graph schema and CLI surface may
still change. Nothing in this README describes capabilities that don't
already exist in `src/`.

## License

[MIT](LICENSE)
