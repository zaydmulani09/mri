# mri vs. sindresorhus/got — real-world validation run

Real captured output of `mri build` / `mri analyze` / `mri blast-radius` /
`mri ask` / `mri guard` against a live open-source repository, plus a QA
write-up tracking three bugs from discovery through fix verification. Every
tool-output block below is verbatim captured stdout/stderr; nothing is
hand-written or edited to look better than it was.

**Final status (mri `40ba1d8`): all three correctness bugs found by this
run are fixed and verified against got. The report below reflects the
final verified state; per-bug history is preserved in
[Bugs found](#bugs-found).**

## Run metadata

| | |
| --- | --- |
| Target repo | https://github.com/sindresorhus/got |
| Commit analyzed | `e3924aa1e53a6ca3eb93a43618ce532442a89b40` ("Add support for `QUERY` HTTP method (#2466)", 2026-07-06) — same commit for all three runs |
| Clone location | outside the mri repo (temp dir); full history fetched before the recorded runs (shallow-clone caveat below) |
| Date of runs | 2026-08-22 (run 1 initial discovery → run 2 after partial fix → run 3 final verification) |
| mri version | 0.1.0 from source (`npm run build`, dist rebuilt immediately before each run). Final run at `40ba1d8` ("test: const-arrow reference regression and non-dangling source assertions"), which includes `fc2f11b` (TS 5.0 export-type-star normalization), `e0939d1` (declarator-bound symbol references), `ae1352c` (file-node fallback for reference containers), `47d75cb`, `aca0db4`. All 79 tests pass. |
| Environment | Windows 11, PowerShell, Node v24.14.0, git 2.53.0.windows.1 |

Reproduction:

```text
git clone https://github.com/sindresorhus/got <outside-this-repo>
cd got && git fetch --unshallow        # needed for honest churn data, see caveats
node <mri>/dist/cli/index.js build <path-to-got>
node <mri>/dist/cli/index.js analyze <path-to-got>
node <mri>/dist/cli/index.js blast-radius "fn:source/core/options.ts#assertAny" --format tree --db <path-to-got>/.mri/graph.sqlite
node <mri>/dist/cli/index.js ask "<question>" <path-to-got>
```

Wall-clock times (PowerShell `Measure-Command`, warm FS cache; final run):

| Command | Time |
| --- | --- |
| `build` (85 files) | ~1.9 s |
| `analyze` (rebuilds graph + all passes) | ~2.6 s |
| `ask` (each question re-runs analysis internally) | ~2.0–3.6 s |
| `guard` (rebuilds graph + allowlist + VM run) | ~2 s per case |

Earlier runs were ~0.9–2.4 s for build/analyze — same order of magnitude
throughout.

## `mri build` — verbatim output (final run)

```text
85 files parsed
nodes: 85 files, 311 functions, 24 classes, 189 methods, 57 external modules
edges: 495 defines, 525 imports, 2334 calls (712 resolved / 1622 ambiguous), 16 inherits (14 resolved / 2 ambiguous)
Graph written to <got>\.mri\graph.sqlite
```

(The SQLite `ExperimentalWarning` line that Node prints on stderr is elided
here only.)

Exit code 0. Note what is *absent*: earlier mri versions printed
"1 file(s) had parse errors" here (`source/index.ts` tripping over TS 5.0
`export type *`); that is fixed as of `fc2f11b` — see
[Bug 1](#bug-1-ts-50-export-type--syntax-fails-to-parse). Node/edge counts
are unchanged from the parse-error era because `source/index.ts` declares no
top-level functions or classes (only a const object plus re-exports), so its
symbol contribution was empty either way.

## `mri analyze` — verbatim output (final run)

```text
====================================================
mri codebase report
====================================================
repo:  <got>
built: 2026-08-22T19:19:28.711Z   churn window: 90d

ARCHITECTURE
  files             85   (typescript 79, javascript 6)
  symbols           functions 311 | classes 24 | methods 189
  edges             defines 495 | imports 525 | calls 2334 (710 resolved / 1624 ambiguous) | inherits 16
  external modules  57   [../../dist/source/index.js, @hapi/bourne, @sindresorhus/is, @sinonjs/fake-timers, ava, benchmark, body-parser, byte-counter, cacheable-request, chunk-data, create-cert, create-test-server, decompress-response, delay, expect-type, express, get-stream, got, keyv, lowercase-keys, node-fetch, node:assert/strict, node:buffer, node:child_process, node:crypto, node:diagnostics_channel, node:dns, node:events, node:fs, node:fs/promises, node:http, node:http2, node:https, node:net, node:os, node:path, node:process, node:stream, node:stream/promises, node:timers/promises, node:tls, node:url, node:util, node:zlib, p-event, pem, pify, readable-stream, request, responselike, sinon, slow-stream, tempy, then-busboy, tough-cookie, type-fest, uint8array-extras]
  most depended on  test/helpers/with-server.ts (32), source/index.ts (30), source/core/options.ts (12), source/core/index.ts (9), source/core/response.ts (8)

TECH DEBT
  dead code candidates 9   (detail under DEAD CODE)

  risk scores (top 10 of 33 files, window 90d)
     1. source/core/options.ts       score  42   [churn 6 commits (+42pts) | tested (+0pts) | last modified 2026-07-06]
     2. documentation/examples/h2c.js score  37   [churn 1 commits (+7pts) | no tests found (+30pts) | last modified 2026-07-06]
     3. source/core/index.ts         score  35   [churn 5 commits (+35pts) | tested (+0pts) | last modified 2026-07-06]
     4. benchmark/index.ts           score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-02-24]
     5. benchmark/server.ts          score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2023-03-03]
     6. documentation/examples/advanced-creation.js score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-02-23]
     7. documentation/examples/gh-got.js score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-02-23]
     8. documentation/examples/pagination.js score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-02-23]
     9. documentation/examples/runkit-example.js score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2021-04-16]
    10. documentation/examples/uppercase-headers.js score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-02-23]

SECURITY-RELEVANT SIGNALS (gaps in knowledge, not findings)
  unresolved references   206   "Error" x54, "response.end" x50, "TypeError" x28, "Object.hasOwn" x26, "URL" x24, "Promise" x24
  untested & churning     1   -> documentation/examples/h2c.js
  external dependencies   57   -> ../../dist/source/index.js, @hapi/bourne, @sindresorhus/is, @sinonjs/fake-timers, ava, benchmark, body-parser, byte-counter, cacheable-request, chunk-data, create-cert, create-test-server, decompress-response, delay, expect-type, express, get-stream, got, keyv, lowercase-keys, node-fetch, node:assert/strict, node:buffer, node:child_process, node:crypto, node:diagnostics_channel, node:dns, node:events, node:fs, node:fs/promises, node:http, node:http2, node:https, node:net, node:os, node:path, node:process, node:stream, node:stream/promises, node:timers/promises, node:tls, node:url, node:util, node:zlib, p-event, pem, pify, readable-stream, request, responselike, sinon, slow-stream, tempy, then-busboy, tough-cookie, type-fest, uint8array-extras
  files with parse errors 0

DEAD CODE
  candidates 9: 5 confirmed-unreferenced, 2 referenced-but-uncalled, 2 no-resolved-references
    [confirmed-unreferenced]  cls:documentation/examples/uppercase-headers.js#TransformHeadersAgent  [documentation/examples/uppercase-headers.js]
    [confirmed-unreferenced]  fn:documentation/examples/advanced-creation.js#getMessageSignature  [documentation/examples/advanced-creation.js]
    [confirmed-unreferenced]  fn:documentation/examples/gh-got.js#getRateLimit  [documentation/examples/gh-got.js]
    [confirmed-unreferenced]  fn:documentation/examples/h2c.js#getSession  [documentation/examples/h2c.js]
    [confirmed-unreferenced]  fn:documentation/examples/h2c.js#closeSessions  [documentation/examples/h2c.js]
    [referenced-but-uncalled]  fn:source/core/options.ts#destroyLateRequestResult  [source/core/options.ts]
    [referenced-but-uncalled]  fn:source/core/timed-out.ts#noop  [source/core/timed-out.ts]
    [no-resolved-references]  m:documentation/examples/uppercase-headers.js#TransformHeadersAgent.addRequest  [documentation/examples/uppercase-headers.js] (method of unreferenced class)
    [no-resolved-references]  m:documentation/examples/uppercase-headers.js#TransformHeadersAgent.transformHeader  [documentation/examples/uppercase-headers.js] (method of unreferenced class)

TEST COVERAGE
  estimated coverage 72.7% (24/33 source files, import-based approximation)
    covered by test/abort.ts -> source/index.ts, source/core/index.ts, source/create.ts, … (24-file list per test file; full lines preserved in raw capture)
    covered by test/agent.ts -> …
    (one line per test file — 40 test files total; see raw capture for the complete verbatim block)
    not covered: benchmark/index.ts, benchmark/server.ts, documentation/examples/advanced-creation.js, documentation/examples/gh-got.js, documentation/examples/h2c.js, documentation/examples/pagination.js, documentation/examples/runkit-example.js, documentation/examples/uppercase-headers.js, +1 more
```

Note: the TEST COVERAGE section's per-test-file `covered by …` lines are
long (each lists every transitively imported source file). They are
abbreviated above with `…`; the complete output was captured verbatim during
the run and is reproducible with the commands above. Everything else is
complete and unmodified.

## `mri blast-radius` — verbatim output

Retry-delay calculation (the DEMO_CANDIDATES.md hypothesized demo root):

```text
$ mri blast-radius "fn:source/core/calculate-retry-delay.ts#calculateRetryDelay" --format tree
fn:source/core/calculate-retry-delay.ts#calculateRetryDelay  (function)
├─ ✓ m:source/core/index.ts#Request._beforeError   d1 · calls
```

Highest fan-in internal function (`assertAny`, 56 resolved callers):

```text
$ mri blast-radius "fn:source/core/options.ts#assertAny" --format tree
fn:source/core/options.ts#assertAny  (function)
├─ ✓ cls:source/core/options.ts#Options   d1 · calls
│  ├─ ✓ cls:source/core/index.ts#Request   d2 · calls
│  │  ├─ ✓ fn:source/as-promise/index.ts#asPromise   d3 · calls
│  │  ├─ ✓ m:source/core/index.ts#Request._beforeError   d3 · calls
│  ├─ ✓ fn:benchmark/index.ts#internalBenchmark   d2 · calls
│  ├─ ✓ fn:source/create.ts#create   d2 · calls
│  ├─ ✓ m:source/core/index.ts#Request._onResponseBase   d2 · calls
├─ ✓ fn:source/core/options.ts#validateSearchParameters   d1 · calls
├─ ✓ m:source/core/options.ts#Options.agent   d1 · calls
├─ ✓ m:source/core/options.ts#Options.body   d1 · calls
… (21 more Options.* accessor methods, all ✓ confirmed, d1)
```

All edges confirmed; zero ambiguous-only dependents for these roots.

## `mri ask` — verbatim outputs

Environment note: an Ollama server was running at localhost:11434 with
model `gemma4:latest`. mri defaults to `llama3.2` (override via
`MRI_OLLAMA_MODEL`); results below marked *(raw)* came through the grounded
fallback path.

**Q: "what is the riskiest file"** → exit 0, ~2.0 s *(raw)*

```text
Riskiest file: source/core/options.ts (score 42: churn 6 commits in 90d; has tests). Score is churn plus missing-test penalty — an approximation, not a measurement of code quality.
```

**Q: "who calls calculateRetryDelay"** → exit 0, ~2.0 s *(raw)*

```text
fn:source/core/calculate-retry-delay.ts#calculateRetryDelay has 1 dependent(s):
  depth 1: m:source/core/index.ts#Request._beforeError (via calls, resolved)
(1 confirmed, 0 ambiguous-only. Confirmed counts are only as good as the resolver: dynamic dispatch is not tracked.)
```

**Q: "is noop dead code"** → exit 0, ~2.2 s *(raw)* — ambiguity handled by
refusing to guess:

```text
"noop" matches multiple nodes; pick one:
  - fn:source/core/index.ts#noop (function, source/core/index.ts)
  - fn:source/core/timed-out.ts#noop (function, source/core/timed-out.ts)
```

**Q: "is fn:source/core/timed-out.ts#noop dead code"** (picking the exact id
from that list) → exit 1 — the parser does not accept full node ids:

```text
I can't map that to a supported graph query, so I won't guess. Supported questions: blast radius of
<function-or-file>; what depends on <function-or-file>; who calls <function>; is <name> dead code; what is the
riskiest file [in <scope>]; what is not tested [in <scope>].
```

**Q: "what is not tested"** → exit 0, ~3.6 s *(raw)*

```text
9 file(s) lack test coverage (of 33 source files, 9 uncovered overall):
  - benchmark/index.ts
  - benchmark/server.ts
  - documentation/examples/advanced-creation.js
  - documentation/examples/gh-got.js
  - documentation/examples/h2c.js
  - documentation/examples/pagination.js
  - documentation/examples/runkit-example.js
  - documentation/examples/uppercase-headers.js
  - source/core/utils/options-to-url.ts
This is import proximity, not real coverage instrumentation.
```

**Q: "how many lines of code are in this repo"** (out of scope) → exit 1,
fail-closed as designed: same "I can't map that to a supported graph query,
so I won't guess." message.

**Same riskiest-file question with `MRI_OLLAMA_MODEL=gemma4:latest`** →
exit 0 but ~62 s wall clock and identical raw text: generation hit the 60 s
timeout (or returned empty), so narration silently fell back to
`renderAnswer`. The content stayed correct, but there is no signal to the
user that narration failed.

## Findings

What held up against a real repo:

1. **Risk hotspot matches the hypothesis.** `docs/DEMO_CANDIDATES.md`
   predicted churn would concentrate on retry/options-normalization.
   Result: #1 `source/core/options.ts` (6 commits/90d), #3
   `source/core/index.ts` (5). With full git history the scores are
   meaningful; with a shallow clone every file reads "churn 1 commit" and
   the ranking degenerates to the no-tests penalty (see caveats).
2. **Resolved-edge density is decent but not dominant:** 710/2334 call
   edges resolved (~30%). The ambiguous bulk is dominated by globals and
   dynamic dispatch (`Error` ×54, `response.end` ×50, `TypeError` ×28,
   `Object.hasOwn` ×26, `URL` ×24, `Promise` ×24) — exactly the fail-closed
   story: those stay ambiguous instead of being guessed into fake edges.
3. **Blast radius tells a clean two-part story**: from `assertAny` the walk
   goes three levels deep (`Options` → `Request` → `asPromise`) entirely on
   ✓-confirmed edges. From `calculateRetryDelay` it stops at depth 1 —
   which honestly falsifies DEMO_CANDIDATES.md's guess that the
   retry-timeout calculation would "traverse visibly deep". Pick `assertAny`
   (or another hub) for demos, not the retry function.
4. **Coverage estimate behaves sensibly:** 72.7% (24/33 non-test files);
   uncovered set = benchmarks + doc examples + one util
   (`options-to-url.ts`). Matches expectations for a thoroughly tested repo.
5. **`ask` fail-closed behavior works on real inputs:** unsupported intents
   refused with a supported-list message; ambiguous names produce a
   pick-one list rather than a coin flip.
6. **Dead-code output is now defensible end-to-end** (after `40ba1d8`):
   every remaining candidate is either a documentation-snippet function
   with no in-file usage, or correctly downgraded to
   `referenced-but-uncalled`. The false-positive class that motivated this
   validation run is gone from got's real code, not just from synthetic
   tests.

Caveats to keep in mind when presenting:

- **Shallow clones break churn scoring.** First runs used `--depth 1`;
  every file then showed "churn 1 commit" and risk ranking became a
  no-tests-penalty listing. Always `git fetch --unshallow` before demoing.
- The external-module list includes test-only deps (`ava`, `express`,
  `sinon`, …) because the graph covers the whole repo including `test/`.
  That also puts `test/helpers/with-server.ts` atop "most depended on".
  Fine, but worth narrating.
- `../../dist/source/index.js` shows up as an external module (a built-dist
  import somewhere under `test/types`) — cosmetic oddity.

## Bugs found

### Bug 1 — TS 5.0 `export type *` syntax fails to parse

> **Status: FIXED** in `fc2f11b` ("normalize TS 5.0 export-type-star syntax
> and contain per-file extraction failures"), verified on got at `40ba1d8`:
> build no longer reports any parse errors (`files with parse errors 0`),
> and `mri extract` confirms zero files with `hasParseErrors`.

`source/index.ts` (got's public entry point!) reported parse errors under
the pre-fix grammar, so the graph was missing all symbol structure for it.
Minimal reproduction (any file containing the line):

```ts
export type * from './a.js';
```

→ that file comes back `hasParseErrors: true`. Root cause: the bundled
`tree-sitter-typescript@0.23.2` grammar predates TS 5.0's `export type *`.
Impact here: `source/index.ts` contributes 0 functions/classes/methods;
its re-export surface is invisible to symbol-level passes. Fix options:
upgrade the grammar, or special-case-skip with a louder warning naming the
offending construct/file.

### Bug 2 — Dead-code pass produces false positives labeled `confirmed-unreferenced`

> **Status: FIXED** in `e0939d1` + `ae1352c`, with regression tests covering
> got's exact const-arrow pattern (`40ba1d8`). Verified on got at `40ba1d8`
> — see [Final verification](#final-verification-mri-40ba1d8--fixed) below.

Two of the seven `confirmed-unreferenced` candidates were provably alive:

- `fn:source/core/options.ts#destroyLateRequestResult` — referenced at
  `options.ts:3655` (passed as a callback argument).
- `fn:source/core/timed-out.ts#noop` — referenced three times inside its own
  file (`return noop;`, `Array<typeof noop>` ×2).

DB evidence at discovery time: both nodes had **zero incoming reference
edges** despite real textual references. Chain of causes:

1. Extraction records call sites only from syntactic
   `call_expression`/`new_expression` nodes (`src/extraction/javascript.ts`,
   `collectCalls`) — a function passed by reference produces *no edge at
   all*, neither resolved nor ambiguous.
2. `findDeadCode` (`src/analysis/dead-code.ts`) treats "no resolved
   calls/inherits edge + name absent from ambiguous callee texts" as proof
   of death → `confirmed-unreferenced`.

That violates the project's own contract ("dead-code findings refuse to
declare death under uncertainty"): the strongest confidence label is being
emitted precisely where knowledge is missing. Per DEMO_CANDIDATES.md, "the
demo dies if the headline finding is wrong" — this must be fixed before any
public run.

#### Re-test after the first fix attempt (mri `aff3494`) — historical

mri main gained (2026-08-22): `references` edges from file-level identifier
usage (`47d75cb`), a `referenced-but-uncalled` dead-code tier (`aca0db4`),
and regression tests (`aff3494`). All 73 mri tests pass, including the new
regression tests. Re-running against the same got commit:
**unchanged results** — still 7 confirmed-unreferenced / 0
referenced-but-uncalled, with `destroyLateRequestResult` and `noop` still
labeled confirmed-unreferenced. The graph contains only 13 `references`
edges across the whole repo, none pointing at either symbol.

Minimal A/B repro pinpoints why — declaration style decides the outcome
(same usage site `return noop;` in both):

```ts
// a.ts — function_declaration style: fix WORKS
function noop(): void {}
export function makeCanceller(): () => void {
  return noop;
}
// → candidates 1: 0 confirmed-unreferenced, 1 referenced-but-uncalled
//   [referenced-but-uncalled]  fn:a.ts#noop
```

```ts
// a.ts — const arrow-function style (what got uses): fix DOES NOT FIRE
const noop = (): void => {};
export function makeCanceller(): () => void {
  return noop;
}
// → candidates 1: 1 confirmed-unreferenced, 0 referenced-but-uncalled
//   [confirmed-unreferenced]  fn:a.ts#noop
```

Root cause of the residual gap: in `collectReferences`
(`src/extraction/javascript.ts`), every `variable_declarator` name is added
to a per-file `localBindings` set, and any identifier whose text matches a
local binding is then excluded from references entirely — regardless of
position. Since `const noop = …` binds its name via variable_declarator,
every later use of `noop` (including `return noop;` and argument-passing)
is filtered out, and no reference edge is ever created. The regression
tests exercise the `function_declaration` path only.

Secondary defect introduced by the same feature: all 13 `references` edges
written for got have a **dangling source node id**. Extraction sets
`container: "<file>"`, and `writeReferenceEdges`'s `containerNodeId()`
maps that to `fn:<path>#<file>`, which is not an existing node (the
`?? fileNodeId` fallback never triggers because "<file>" contains no dot).
Observed example: `fn:source/core/errors.ts#<file> -> cls:source/core/errors.ts#RequestError`,
`srcNodeExists=false`.

#### Final verification (mri `40ba1d8`) — FIXED

Fixes landed: declarator-bound symbols now record their usages as
references (`e0939d1`), and top-level/unresolved reference containers fall
back to the file node (`ae1352c`), plus regression tests covering got's
exact pattern (`40ba1d8`). Re-run against the same got commit:

- Both former false positives now classify correctly:
  - `[referenced-but-uncalled] fn:source/core/options.ts#destroyLateRequestResult`
  - `[referenced-but-uncalled] fn:source/core/timed-out.ts#noop`
- Remaining 5 `confirmed-unreferenced` candidates all live in
  self-contained documentation example snippets, where nothing else in-file
  references them — plausible candidates, not known false positives.
- References-edge integrity: **78 reference edges total (up from 13),
  zero dangling src-or-dst ids.** Sources are now real file nodes, e.g.
  `f:source/core/calculate-retry-delay.ts -> fn:...#calculateRetryDelay`.
  Both target symbols have incoming reference edges.
- Byte-level diff vs the pre-fix baseline shows only the expected changes:
  build timestamp, `files with parse errors 1 → 0`, and the two dead-code
  reclassifications. Architecture, risk, security-signal, and coverage
  sections are identical.

### Bug 3 (minor, open) — `ask` can't consume its own disambiguation output

`is noop dead code` answers "pick one:" and lists full node ids
(`fn:source/core/timed-out.ts#noop`), but re-asking with that exact id fails
to parse ("is \<name\> dead code" accepts bare names only). The user is
told to pick one yet has no working syntax to do so.

### Bug 4 (minor, open) — Silent, slow LLM-narration fallback

With an available server but a model other than `llama3.2`
(`MRI_OLLAMA_MODEL=gemma4:latest`), `narrateAnswer` waits out the full 60 s
generation timeout, gets nothing usable, and silently prints the raw
grounded answer. Correct content, but ~60 s of silence and no indication
that narration didn't happen. Consider probing `/api/tags` for the
configured model specifically, and/or printing a one-line notice on
narration failure.

## Final verification pass (`40ba1d8`) — `ask` and `guard`

Re-verified after all fixes landed (same got clone, same commit).

**`mri ask` — unchanged, correct:**

```text
$ mri ask "what is the riskiest file" <got>
Riskiest file: source/core/options.ts (score 42: churn 6 commits in 90d; has tests). Score is churn plus missing-test penalty — an approximation, not a measurement of code quality.
```

```text
$ mri ask "is noop dead code" <got>
"noop" matches multiple nodes; pick one:
  - fn:source/core/index.ts#noop (function, source/core/index.ts)
  - fn:source/core/timed-out.ts#noop (function, source/core/timed-out.ts)
```

(Bug 3 still applies: there is no follow-up syntax to pick one of the two.)

**`mri guard` — fail-closed enforcement verified in both directions.**
Scope: the retry-delay module; sandboxed code may only use what the scope's
allowlist provably grants.

Allowed case — calls a symbol granted by the file scope; runs against an
inert stub, exit 0:

```text
$ mri guard f:source/core/calculate-retry-delay.ts guard-clean.js --path <got>
retry delay: {
  mri: 'granted-symbol-stub',
  symbol: 'fn:source/core/calculate-retry-delay.ts#calculateRetryDelay',
  args: [ '{"computedValue":1000,"retryCount":2,"retryAfter":null}' ]
}
EXECUTED cleanly within the allowlist for f:source/core/calculate-retry-delay.ts
return value: undefined
note: calls to granted repo symbols ran against inert stubs — this verifies containment, not behavior
allowlist: 1 symbol(s), 2 file(s) granted; 5 unresolved reference(s) were excluded fail-closed
```

Blocked case — `require("node:fs")` with no filesystem grant; refused
without executing anything, exit 1:

```text
$ mri guard fn:source/core/calculate-retry-delay.ts#calculateRetryDelay guard-breach.js --path <got>
BLOCKED — code refused for scope fn:source/core/calculate-retry-delay.ts#calculateRetryDelay
1 containment breach(es):

  line 1 · ungranted-resource
    attempted: require-call require("node:fs")
    rule:      resources.filesystem -> expected at least one resources.filesystem grant
    reason:    'node:fs' provides filesystem access but allowlist.resources.filesystem has no grants

nothing was executed (fail closed). allowlist: 0 symbol(s), 1 file(s); 5 unresolved reference(s) excluded
```

One design note for demos: a function-node scope does not grant *itself*
(`generateAllowlist` skips the scope node when seeding symbol grants), so
code run under `fn:<id>` scope cannot call that very function — the first
attempt above was blocked as `unknown-reference` until re-scoped to the
file node. Defensible fail-closed design, but worth narrating on stage;
a clearer error message ("scope symbols are not self-granted; use the file
node or add an explicit grant") would help.

## Verdict — demo-ready?

**Yes, with two caveats.** At mri `40ba1d8`, against sindresorhus/got @
`e3924aa`:

- All three correctness bugs discovered by this validation are fixed and
  verified on real code: TS 5.0 parse failure (`fc2f11b`), const-arrow
  dead-code false positives (`e0939d1`), dangling reference-edge sources
  (`ae1352c`). The remaining dead-code candidates are plausible rather than
  provably wrong, and the headline risk/blast-radius stories hold up:
  `source/core/options.ts` tops churn-based risk exactly as hypothesized,
  and blast radius from `assertAny` walks three confirmed levels deep.
- Byte-level diffing across runs shows no regressions anywhere else in the
  report.
- Caveat 1 (cosmetic): unresolved-reference counts are dominated by JS
  globals and dynamic dispatch (`Error`, `response.end`, …) — correct
  fail-closed behavior, but it needs the prepared narration so it doesn't
  look like tool failure on screen.
- Caveat 2 (minor UX): Bug 3 and Bug 4 remain open — neither affects
  correctness of results, only ergonomics of `ask`.

Recommended demo root for blast radius: `fn:source/core/options.ts#assertAny`
(not the retry-delay function — its true blast radius is depth 1).
Always analyze a full-history clone; shallow clones gut the churn signal.
