# MRI Architecture

> Status: reflects the implementation as of `feat(analysis): explainable risk
> scoring and mri analyze report` (August 2026). This document describes what
> is actually built — extraction, graph, analysis, CLI. Planned layers are
> listed at the end and are not described as if they exist.

MRI is a local code intelligence engine. It parses a repository, extracts its
symbols and structure into a graph, stores that graph in SQLite, and answers
structural questions over it: who calls this, what depends on it, what looks
dead, where risk concentrates.

## The core design principle

**Ambiguous edges fail closed, never guessed.**

Every reference between symbols in the graph is in exactly one of two states:

- `resolved` — the edge points at a specific destination node, reached by a
  deterministic proof: same-file scope, an import binding chain, or an
  exported-symbol lookup.
- `ambiguous` — the reference could not be proven to point anywhere specific.
  The edge is kept with `dst = NULL` and the original source text of the
  callee preserved in `callee_text`.

There is no third state, no fuzzy matching, no "closest candidate", no
majority vote. When MRI cannot *prove* where a call goes, it records the fact
that the call exists and nothing more.

This is enforced structurally, not by convention:

- The SQLite schema has a `CHECK` constraint (`src/graph/schema.ts:48`):
  a `resolved` edge must have a non-null `dst`; an `ambiguous` edge must have
  a null `dst`. A graph that lies about confidence cannot be written.
- The store re-checks on every insert (`src/graph/store.ts:91-107`).
- Downstream consumers honor it: blast-radius keeps confirmed reachability
  separate from ambiguous-only dependents; dead-code refuses to call a symbol
  dead if its name appears anywhere among ambiguous references.

Everything MRI reports can therefore be traced to either a proven path or an
explicitly labeled unknown. The unknowns stay visible instead of being folded
into plausible-looking guesses. That property is the trust model for every
feature built on top of the graph.

## System overview

```text
            ┌─────────────────────────────────────────────────┐
            │                    CLI (src/cli)                │
            │   extract · build · blast-radius · analyze      │
            └───────┬──────────────┬───────────────┬──────────┘
                    │              │               │
             ┌──────▼──────┐ ┌─────▼─────┐ ┌───────▼────────┐
             │ extraction  │ │   graph   │ │    analysis    │
             │ (tree-sitter│ │ resolvers │ │ dead code,     │
             │  per-file)  │ │ + sqlite  │ │ coverage, churn│
             └─────────────┘ └───────────┘ │ risk scoring,  │
                                           │ blast radius   │
                                           └────────────────┘
```

Data flows one way: extraction produces per-file symbol facts; the graph layer
resolves references between them and persists the result; analysis passes and
CLI commands read the persisted graph. There is no runtime dependency of
extraction on the graph, or of analysis on extraction.

## Extraction layer

**Source:** `src/extraction/`. Public API: `extractRepo(root)` →
`{ root, generatedAt, files: FileSymbols[] }`, plus single-file `extractFile`.

### Language support

| Language | Extensions | Grammar |
| --- | --- | --- |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | tree-sitter-javascript |
| TypeScript | `.ts` `.mts` `.cts` | tree-sitter-typescript |
| TSX | `.tsx` | tree-sitter-typescript (tsx grammar) |
| Python | `.py` | tree-sitter-python |
| Go | `.go` | tree-sitter-go |
| Rust | `.rs` | tree-sitter-rust |

Parsing is per-file and best-effort: a file with syntax errors still yields
symbols, flagged via `hasParseErrors` (from tree-sitter's `rootNode.hasError`).

### File walking

`walker.ts` walks the repo recursively:

- Hard-skipped directories: `.git`, `node_modules`, `dist`, `build`, `out`,
  `coverage`, `vendor`, `__pycache__`, `.venv`, `venv`.
- Honors `.gitignore` files with proper scoping: each directory's gitignore
  applies to everything beneath it, and nested gitignores stack.
- Skips symbolic links. Only files with the extensions above are collected.
- Output is a sorted list of POSIX-style paths relative to the repo root.

### What is captured per file

Each file becomes a `FileSymbols` record (`types.ts`) containing:

- **Functions** — name, span, exported flag.
- **Classes** — name, span, exported flag, methods (name + span), and raw
  superclass texts (`extends: string[]`).
- **Imports** — specifier, default/namespace/named bindings, line.
- **Exports** — kind (`named` | `default` | `all`) and names.
- **Call sites** — callee kind (`plain` | `member` | `this` | `self` |
  `super`), object text when present, callee name, line, and the container
  (the enclosing function or `Class.method`).

Language-specific notes:

- **JavaScript/TS**: top-level function declarations, generator declarations,
  and variable declarators bound to arrow/function expressions are extracted;
  class methods include field definitions holding arrows (constructor is not
  listed as a method but its call sites are collected); both `import`
  statements and `require()` calls become imports; `new X()` counts as a call
  site of `X`.
- **Python**: top-level defs and decorated definitions are extracted and
  marked exported (Python has no export syntax, so all top-level symbols are
  treated as exported); `self.x()`, `cls.x()` and `super().x()` calls are
  classified as their own kinds so they resolve through the inheritance
  chain rather than as opaque member calls.
- **Go**: function declarations become functions; structs and interfaces
  become class nodes whose embedded types are recorded as bases; receiver
  methods (value and pointer) attach to their receiver type, with a call
  through the receiver name classified like `self` so it resolves along the
  type's method chain. Exported status follows Go's capitalization rule.
  Imports record named (`alias "path"`), blank (`_ "path"`), and dot forms,
  with the local package name defaulting to the last path segment.
- **Rust**: functions, structs, enums, and type aliases become nodes;
  traits are class nodes carrying their method signatures; `impl` blocks
  attach their methods to the self type in a second pass and an
  `impl Trait for Type` block records `Trait` as heritage so it resolves
  through the existing inheritance pass. Visibility is the explicit `pub`
  modifier. Calls through `self.method()` inside impls resolve along the
  type's chain; everything dispatched through `dyn Trait`, generics, or a
  bare value stays ambiguous. Macros (`println!` etc.) are not call sites.
  `use` statements record plain, grouped (`a::b::{C, D}`), glob, and
  `pub use` re-export forms with whitespace collapsed.

Known extraction limits (by design, today):

- Only top-level symbols are nodes; functions/classes nested inside other
  functions are not extracted. (In Go and Rust this also means methods on
  types declared in *another file or module* have no host node in this file
  and their call sites are dropped.)
- Intermediate calls are suppressed: in `a.b().c()`, only `c` is recorded,
  since recording `b` as a standalone target would be noise.
- Call sites at module top level (outside any function/method) have no
  container and are dropped rather than attributed to the file.

## Graph layer

**Source:** `src/graph/`. Storage is SQLite via Node's built-in
`node:sqlite` (`store.ts`). One database per analyzed repo, default location
`<repo>/.mri/graph.sqlite`, rebuilt atomically: `build.ts` deletes any prior
database, then writes everything inside a single transaction that commits or
rolls back as a unit.

### Nodes

| Type | Meaning | ID scheme |
| --- | --- | --- |
| `file` | source file | `f:<path>` |
| `function` | top-level function | `fn:<path>#<name>` |
| `class` | top-level class | `cls:<path>#<name>` |
| `method` | method of a class | `m:<path>#<Class>.<name>` |
| `module` | external package (synthetic) | `xm:<specifier>` |
| external `function`/`class` | referenced-but-not-analyzed symbol stub | `xf:`/`xc:<owner>#<name>` |

Internal node columns carry identity and metadata: `name`, `path`, span
(`start_line`/`end_line`), `exported`, `language`, and `external` (1 for
synthetic stubs). External stubs exist so that references into dependencies
resolve to something explicit — "this calls into package X" — instead of
being silently dropped or guessed at internal targets.

### Edges

| Type | Direction | Notes |
| --- | --- | --- |
| `defines` | file → symbol, class → method | structural containment |
| `imports` | file → file, or file → external module | resolved by import resolver |
| `calls` | function/method → callee | the resolution-heavy edge |
| `inherits` | class → class | base-class links |

Edge columns beyond endpoints: `line` (source line), `callee_text` (original
reference text, populated for ambiguous edges), and `confidence`
(`resolved` \| `ambiguous`).

### Build pipeline

`buildRepoGraph` runs five phases in order, all inside one transaction:

1. **Symbol nodes** — files, functions, classes, methods, plus `defines`
   edges.
2. **Imports** — each import statement is resolved to an internal file or an
   external module; `imports` edges written; internal target file nodes are
   ensured to exist.
3. **Inheritance** — each class's `extends` texts are resolved against the
   symbol index; `inherits` edges written; successful internal resolutions
   feed the ancestor index used later for `this`/`super` chains.
4. **Calls** — every collected call site is resolved; `calls` edges written.
5. **Meta** — root path, generation timestamp, file count stored in `meta`.

The build summary reports, separately: calls resolved vs ambiguous, inherits
resolved vs ambiguous. These counts are surfaced directly by the CLI because
the ratio of ambiguity is itself signal about how much of a repo's structure
MRI could prove.

## Resolution rules and the confidence model

This section is the contract behind the principle stated at the top: what
earns a `resolved` edge, and what stays ambiguous.

### Import resolution (`import-resolver.ts`)

- JS/TS: relative specifiers are tried against extension candidates
  (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`) and directory
  `index.*` files. Bare specifiers (packages) are external by definition.
- Python: dotted module paths are searched from the repo root (absolute
  imports) or from the importer's package directory computed from leading-dot
  count (relative imports); candidates are `<pkg>.py` and `<pkg>/__init__.py`.
- Go: a specifier is internal only when it equals or extends the module path
  declared in `<root>/go.mod` and the target package directory contains Go
  sources; the edge destination is the first `.go` file of that directory in
  sorted order. Everything else is external.
- Rust: `crate::…` paths and paths prefixed with the crate's own name (from
  `Cargo.toml`) map onto files under `src/`, walking segments right-to-left
  until a module file (`<mod>.rs` or `<mod>/mod.rs`) exists — a use path may
  end in an item name, which is then found by the exported-symbol lookup.
  Everything else is external.
- Anything resolving outside the repo root is treated as external.
- Imports always produce a concrete `dst` (internal file or external module)
  — there are no ambiguous imports today.

### Inheritance resolution (`hierarchy-resolver.ts`)

A base class text is resolved, in order, by:

1. Same-file class of that name.
2. An imported binding: if the binding resolves internally, look up an
   exported class in the target file; if the specifier is external, create an
   external class stub (resolved, pointing outside the repo).
3. A unique repo-wide match: if exactly one class with that name exists in
   the whole graph and it is not the child itself, resolve to it.

If none of these apply — zero candidates, or several — the edge is written
with `confidence = 'ambiguous'`, `dst = NULL`, and the base text preserved.
A unique global name match is considered a proof; a non-unique name is not.

### Call resolution (`call-resolver.ts`)

Per call-site kind:

- `plain` (`foo()`): local function in the same file → else follow import
  bindings (external specifier → external stub; internal file → exported
  function/class) → else local class (constructor-style use).
- `this` / `self` (`this.foo()`, `self.foo()`): search the enclosing class,
  then walk the recorded inheritance chain (BFS over ancestors) for the
  method.
- `super`: same walk, ancestors only.
- `member` (`obj.foo()`): the object expression is looked up through import
  bindings exactly like a plain-name binding; if the binding resolves, the
  member is looked up in the target's exported surface (or as an external
  stub). Otherwise the call stays unresolved.

Any call site that survives none of these paths is written as an ambiguous
edge: `dst = NULL`, `callee_text = "obj.name"` or `"name"`. The graph never
substitutes a guess for a failed lookup.

### Why ambiguity is data, not garbage

Ambiguous rows keep enough context (`callee_text`, line, source container)
for consumers to reason honestly:

- `mri blast-radius` traverses only `resolved` edges for its confirmed set;
  dependents reachable *only* through ambiguous references are reported
  separately, labeled `ambiguous-only`, so "definitely impacted" and
  "possibly impacted" never blend.
- Dead-code detection (`analysis/dead-code.ts`) splits candidates into
  `confirmed-unreferenced` (no resolved references *and* the name never
  appears in any ambiguous `callee_text`) vs `no-resolved-references`
  (nothing proved, but some ambiguous reference mentions the name). The tool
  refuses to declare death under uncertainty.
- Test-coverage mapping (`analysis/test-coverage.ts`) walks only resolved
  import edges outward from test files — an estimate, labeled as such, built
  exclusively from proven links.
- Risk scoring (`analysis/risk.ts`) is deliberately simple and explainable:
  churn points (commits in window, capped, scaled to 70) plus a flat 30-point
  penalty when no covering test file is found plus a cyclomatic-complexity
  component scaled from the most complex function in the file (capped at
  CC 15 → 30 points). No black-box weights; every score prints its components.

## Analysis layer

**Source:** `src/analysis/`. All passes read the persisted graph (plus git
history for churn) and return plain data structures:

- **Dead code candidates** — internal, non-exported functions/classes with no
  resolved incoming `calls`/`inherits` edges; entry files (`index.*`,
  `main.*`, `__init__.*`) and test files excluded; two-level confidence as
  described above; methods of dead classes inherit the class's status.
- **Test coverage estimate** — which source files are transitively imported
  by test files (import-based reachability, not execution-based coverage).
- **Git churn & risk** — commit counts within a configurable window, last-
  modified dates, untracked-file flag; per-file risk = churn points +
  missing-test penalty + complexity points.
- **Cyclomatic complexity** (`analysis/complexity.ts`) — per-function
  decision-point counts computed by re-parsing sources with the same
  tree-sitter grammars extraction uses. Base path of 1; each if/else-if,
  loop, switch/match case arm (wildcard/default arms excluded), ternary,
  catch/except clause, and short-circuit operator (`&&`, `||`, `and`, `or`)
  adds one. Decisions are attributed to the innermost enclosing function,
  closure, or method; module-level decisions land in a synthetic `<module>`
  entry. Not counted: plain `else` branches, comprehension clauses, `??`,
  Go's `default` case.
- **Blast radius** — reverse-dependency traversal from any node id by depth,
  confirmed vs ambiguous-only kept separate end to end.

## CLI surface

`mri extract <path>` — JSON dump of per-file symbols + summary.
`mri build <path>` — full pipeline into SQLite; prints node/edge counts
including resolved-vs-ambiguous breakdowns.
`mri blast-radius <node-id>` — dependents by depth, confirmed vs ambiguous.
`mri analyze <path>` — builds the graph and runs all passes; prints the
report.

## Layers above the graph

Two more layers have landed on top of the analysis core since the graph was
built:

- **Reasoning (`src/reasoning`)** — structured query intents parsed
  deterministically, executed against the stored graph, and narrated from
  the structured result. An `LlmClient` seam exists for mapping natural
  questions onto the fixed intent set, but ships stubbed (`NoLocalModel`);
  no model is required for any output today.
- **Guardrail (`src/guardrail`)** — allowlists derived *from the code
  graph* (`generate.ts`: resolved edges grant, ambiguous edges are excluded
  and surfaced on an explicit `unresolved` list), plus validated resource
  grants (`resources.ts`). The scan/interceptor enforcement half is present
  in the working tree and still landing. Security claims are scoped in
  `docs/THREAT_MODEL.md`.

## Not yet built

Tracked here so the boundary between "exists" and "planned" stays honest:

- Containment CLI entry point and public demo — spec'd in
  `docs/CONTAINMENT_DEMO_SCRIPT.md`, gated on the enforcement half above.
- Incremental rebuilds, watch mode, language servers, cross-repo indexing —
  not started.

Phase ordering and dependencies live in `docs/ROADMAP.md`.
