# Roadmap

Phases ordered by **dependency**, not by date — no timelines are promised.
Status reflects the tree as of August 2026 (post `fix(cli): surface
parse-error blind spots`); see `ARCHITECTURE.md` for how each layer works
and git history for exactly what landed when.

## Landed

These exist in `src/` today and are covered by tests.

**P0 — Extraction foundation**
Gitignore-aware source walker; per-file symbol extraction via tree-sitter
for JavaScript, TypeScript/TSX, and Python; `mri extract` JSON dump.

**P1 — Code graph**
SQLite store (`nodes`/`edges`/`meta`); import, inheritance, and call
resolvers; atomic single-transaction build pipeline (`mri build`) with
resolved-vs-ambiguous accounting enforced end to end.

**P2 — Analysis passes & CLI surface**
Dead-code candidates with two-level confidence labels; import-based test
coverage estimates; git-churn risk scoring with printed components;
reverse-dependency blast radius keeping confirmed and ambiguous-only paths
separate; sectioned `mri analyze` report with `--json`; `mri blast-radius`
tree view.

**P3 — Reasoning layer v0 (deterministic core)**
Structured query intents with a deterministic parser; graph-backed executor;
grounded narration that rewords structured results instead of answering from
model knowledge; `mri ask`. The LLM seam (`LlmClient`) exists but ships
stubbed (`NoLocalModel`) — everything above it already works without a model.

**G1 — Containment enforcement**
Committed and wired: fail-closed allowlist generation from the code graph
(resolved edges grant; ambiguous edges land on an explicit `unresolved`
list), validated resource-grant schema, AST code scanner, check-and-run
interceptor, and breach taxonomy — exposed as
`mri guard <scope-id> <file>` with end-to-end CLI tests. Verified
fail-closed in both directions against sindresorhus/got at mri `40ba1d8`:
ungranted `require("node:fs")` refused before execution; in-scope code ran
against inert stubs (`examples/reports/got-analysis.md`).

## Planned (dependency order)

**Phase A — Land enforcement.** Done — shipped as G1 above.

**Phase B — Public containment demo.** Execute
`CONTAINMENT_DEMO_SCRIPT.md` end to end (scope setup, control actions,
three escape attempts incl. the fail-closed obfuscation case,
counterfactual run); capture real artifacts into `examples/`.
*Depends on:* G1.

**Phase C — Reasoning model integration.** Local-model narration has
landed: an Ollama-backed `LlmClient` narrates when a server is reachable
(`MRI_OLLAMA_URL`, `MRI_OLLAMA_MODEL`); without one, structured results
print as-is. Remaining: broaden the intent set behind the same
parser/executor contract. *Depends on:* P3 only.

**Phase D — Showcase repository run.** First showcase complete:
sindresorhus/got validated demo-ready at mri `40ba1d8`
([examples/reports/got-analysis.md](../examples/reports/got-analysis.md)),
including three correctness bugs found on it and fixed. Hypothesis scorecard
from `DEMO_CANDIDATES.md`: risk hotspot confirmed (`source/core/options.ts`
tops churn-based risk); blast-radius depth confirmed for hub nodes
(`assertAny`, three confirmed levels) and corrected for the retry-delay
function (true depth 1). Running the remaining four candidates is optional;
got stands as the reference demo.

**Phase E — Hardening & packaging.** In the order the threat model asks
for: TypeScript/Python parity in the containment scanner; memory/CPU caps
beside the wall-clock timeout; OS-level isolation story; then incremental
rebuilds/watch mode, schema versioning guarantees, and package publishing.
*Depends on:* A for scanner work; D feedback for packaging priorities.

## Known open items (not blockers)

Both surfaced during the got validation run and left open deliberately —
neither affects the correctness of results, only ergonomics:

- **`ask` disambiguation dead-end.** When a name is ambiguous, `ask`
  answers with a pick-one list of full node ids
  (`fn:source/core/timed-out.ts#noop`), but re-asking with that exact id is
  rejected — the intent grammar only accepts bare names. The tool tells you
  to pick one yet provides no working syntax to do so.
- **`guard` self-grant error is unclear.** A function-node scope does not
  grant *itself* (`generateAllowlist` skips seeding the scope node), which
  is defensible fail-closed design — but code calling that very function
  then blocks as a bare `unknown-reference` with no hint that file-node
  scoping or an explicit grant is the fix.

## Later candidates (no commitments)

Cross-repo indexing · editor/LSP integration · multi-file program
containment · remote/team analysis service.

Each will get its own phase entry here only once something above it has
shipped.
