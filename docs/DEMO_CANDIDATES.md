# Demo Candidates

Candidate repositories for the eventual public demo — running `mri analyze`
and `mri blast-radius` against a real, recognizable open-source project.

> **Status: shortlist only. No final choice has been made.** Nothing here is
> a claim about what mri will find in these repos; the "expected findings"
> sections are hypotheses based on each project's known structure, to be
> confirmed or discarded when mri can actually run against them end-to-end.
> Activity data below was pulled from the GitHub API on 2026-08-22 and will
> age.

## Selection criteria

A good showcase repo:

1. **Actively maintained** — recent commits/releases; a demo against a dead
   project invites "why analyze that?".
2. **Medium-sized** — enough files for a graph to look impressive, few
   enough that `mri build` finishes in seconds, not minutes.
3. **Genuinely analyzable** — real internal structure (multi-module source
   tree with non-trivial call/import/inheritance webs), so resolved vs
   ambiguous edges both show up meaningfully.
4. **Likely to surface findings** — plausible dead code, test-coverage gaps,
   or churn/risk concentration worth showing on screen.
5. **Recognizable** — an audience should know the project by name.

## Shortlist

### 1. axios/axios

- **Language:** JavaScript · **Stars:** ~109k · **Last push:** 2026-08-21 · **License:** MIT
- The single most recognizable JS HTTP client. Source lives in a compact
  plain-JS `lib/` tree (core, adapters, helpers, cancel, plugins) inside a
  larger repo whose docs/dist noise the walker already skips (`dist`,
  gitignore rules).
- **Why it could win:** fourteen years of accumulated platform branches
  (xhr / http / fetch adapters), backward-compat aliases, and helper modules
  make it a plausible hunting ground for unreferenced internals; churn-based
  risk scoring should concentrate visibly on adapters and core dispatch.
- **Concerns:** heavy dynamic dispatch (`config`-driven adapter selection)
  means many genuinely ambiguous calls — which is fine if framed as the
  fail-closed principle working, but reduces "resolved" eye-candy unless
  narrated carefully.

### 2. pallets/click

- **Language:** Python · **Stars:** ~17.6k · **Last push:** 2026-08-22 · **License:** BSD-3-Clause
- THE Python CLI toolkit (Flask's sibling under Pallets). Clean `src/click/`
  layout of roughly three dozen modules — ideal medium size.
- **Why it could win:** mature codebase with explicit deprecation cycles;
  decorator-heavy architecture produces interesting resolution cases
  (top-level defs are exported by convention, so dead-code candidates must
  come from methods and unexported helpers — a nuanced story). Import-graph
  coverage gaps between modules and tests are plausible.
- **Concerns:** very well-maintained; may simply have little true dead code.
  If findings come back thin, the demo leans on risk/churn instead.

### 3. tqdm/tqdm

- **Language:** Python · **Stars:** ~31k · **Last push:** 2026-08-17 · **License:** MPL/MIT dual (custom)
- The progress-bar library everyone knows. One large core module plus
  `cli.py`, `gui.py`, `tk.py`, `auto.py`, and a `contrib/` tree of optional
  integrations (notebook, telegram, discord, keras...).
- **Why it could win:** the contrib integrations and GUI layers are classic
  import-based test-gap material (rarely exercised together); version-compat
  shims accumulated over a decade give dead-code candidates somewhere to
  hide. Small total size means instant analysis.
- **Concerns:** the giant single-file core means per-symbol granularity
  carries the demo (methods of one class), not file-level structure. License
  field needs care when presenting.

### 4. pinojs/pino

- **Language:** JavaScript · **Stars:** ~18k · **Last push:** 2026-08-13 · **License:** MIT
- Node's flagship JSON logger. Compact `lib/` tree: levels, transport worker
  plumbing, serializers, symbols, legacy wrappers kept for API stability.
- **Why it could win:** performance-critical code with strict structure;
  long-lived compatibility surfaces (old option names, wrapper shims) are
  exactly where confirmed-unreferenced candidates accumulate. Thread/
  transport code paths often escape straightforward test coverage — a fair,
  honest test-gap story rather than an accusation.
- **Concerns:** much of the magic is runtime string-keyed (`symbols.js`)
  which resolves ambiguously by design; again a narration point, but it
  thins the resolved-edge visual.

### 5. sindresorhus/got

- **Language:** TypeScript · **Stars:** ~15k · **Last push:** 2026-07-17 · **License:** MIT
- The human-friendly HTTP client; pure-TS source, deep internal call graph
  (calculate-retry-timeouts, normalize-options, as-* pipeline modules).
- **Why it could win:** best case for *resolved-edge density* — idiomatic TS
  with explicit imports gives the resolver plenty to prove; blast-radius
  demos from a core function should walk impressively far through the
  pipeline. Publicly documented known-issues list gives an honest framing
  for risk discussion.
- **Concerns:** exceptionally thorough test suite weakens the test-gap
  angle; the demo would rest mostly on blast radius + churn. Slower-moving
  than the others (pushed ~5 weeks before check date) — still active, but
  verify momentum at demo time.

## Considered and rejected

- **httpie/cli** (Python) — checked via GitHub API on 2026-08-22: last push
  2024-12-17. Fails the actively-maintained criterion despite being
  otherwise well-suited (recognizable CLI tool, medium Python codebase).

## How the final choice gets made

Once the analysis output is stable, run all five through the same battery:

1. `mri build <repo>` — record file count, node/edge counts, resolved-vs-
   ambiguous ratios, wall-clock time.
2. `mri analyze <repo>` — inspect dead-code candidates for false positives
   (the demo dies if the headline finding is wrong).
3. `mri blast-radius` from 2–3 hand-picked hub nodes — does the confirmed /
   ambiguous-only split tell a clean story?

Pick the repo where all three outputs are simultaneously correct, fast, and
visually legible. Document actual results then; until then this list stays
hypothesis-only.
