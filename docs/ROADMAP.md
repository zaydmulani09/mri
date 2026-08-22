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

## In flight

**G1 — Containment enforcement (guardrail)**
Committed: fail-closed allowlist generation from the code graph
(resolved edges grant, ambiguous edges land on an explicit `unresolved`
list) and validated resource-grant schema. Working-tree, not yet committed:
the static code scanner, the check-and-run interceptor, and the breach
taxonomy that together enforce the allowlist against generated JavaScript.

## Planned (dependency order)

**Phase A — Land enforcement.** Commit the scan/interceptor/breach trio and
wire a CLI entry point so containment is usable outside unit tests.
*Blocks:* everything below except Phase C.

**Phase B — Public containment demo.** Execute
`CONTAINMENT_DEMO_SCRIPT.md` end to end (scope setup, control actions,
three escape attempts incl. the fail-closed obfuscation case,
counterfactual run); capture real artifacts into `examples/`.
*Depends on:* A.

**Phase C — Reasoning model integration.** Implement `LlmClient` against a
local model (the stub's TODO names Ollama as the candidate), keeping the two
existing constraints: the model only maps questions onto the fixed intent
set and rewords executor output verbatim. Add query intents behind the same
parser/executor contract. *Depends on:* P3 only; can proceed in parallel
with A/B.

**Phase D — Showcase repository run.** Run the five-repo battery in
`DEMO_CANDIDATES.md` (build stats → analyze findings → blast-radius spot
checks), pick the showcase repo, publish real reports/screenshots under
`examples/`. *Depends on:* stable P1/P2 output format.

**Phase E — Hardening & packaging.** In the order the threat model asks
for: TypeScript/Python parity in the containment scanner; memory/CPU caps
beside the wall-clock timeout; OS-level isolation story; then incremental
rebuilds/watch mode, schema versioning guarantees, and package publishing.
*Depends on:* A for scanner work; D feedback for packaging priorities.

## Later candidates (no commitments)

Cross-repo indexing · editor/LSP integration · multi-file program
containment · remote/team analysis service.

Each will get its own phase entry here only once something above it has
shipped.
