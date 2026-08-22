# Using mri in GitHub Actions

mri ships two composite actions so another repository can run the same
structural analysis and fail-closed containment that mri runs against itself.
Both are defined in this repository:

| Action | Path | What it does |
| --- | --- | --- |
| `mri guard` | [`.github/actions/mri-guard`](../.github/actions/mri-guard/action.yml) | Builds the graph for your repo, enforces an allowlist scope against one or more code files, emits `::error` annotations per breach, fails the step on any block. |
| `mri analyze summary` | [`.github/actions/mri-analyze`](../.github/actions/mri-analyze/action.yml) | Runs the full analysis pass and posts risk hotspots, dead-code candidates, coverage estimate and unresolved-reference signals to the job summary. |

The self-check workflow (`.github/workflows/self-check.yml`) runs both actions
against this repository on every PR — including a negative-control job that
asserts an exfiltration-shaped payload stays blocked. That workflow is the
living proof the actions work.

## Quick start

Drop this into `.github/workflows/mri.yml` in your repository:

```yaml
name: mri

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  analyze:
    name: structural analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # git history feeds churn-based risk scores
      - uses: zaydmulani09/mri/.github/actions/mri-analyze@main
        with:
          repo-path: .
          window-days: 90

  guard:
    name: contain generated code to its scope
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: zaydmulani09/mri/.github/actions/mri-guard@main
        with:
          scope: f:src/auth.ts          # node id of the scope to enforce
          changed-files: |
            src/auth/generated-handler.js
```

Pin `@main` to a commit sha for reproducible enforcement. The analyzed
repository never changes; mri checks out its own source into a temp directory
outside your workspace and builds there.

## Inputs

### `mri-guard`

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `scope` | yes | — | Graph node id whose allowlist is enforced. File scopes: `f:src/auth.ts`. Symbol scopes: `fn:src/auth.ts#login`, `cls:src/auth.ts#Session`, `m:src/auth.ts#Session.refresh`. |
| `code-path` | one of code-path / changed-files | `''` | File(s) to check, one per line, relative to `repo-path`. Use for a fixed payload or agent-generated file. |
| `changed-files` | one of code-path / changed-files | `''` | Newline-separated list, e.g. filtered output of `git diff --name-only "$BASE" HEAD`. Combined with `code-path`. |
| `repo-path` | no | `.` | Repository root to build the graph from. |
| `resources-config` | no | `''` | Optional resource-grant config JSON keyed by scope id, for scopes that legitimately need filesystem/network/env/subprocess grants (see `mri guard --help`). |
| `timeout-ms` | no | `1000` | Sandbox timeout per checked file. |
| `mri-ref` | no | `main` | Branch/tag/commit of mri to run. Pin it. |
| `node-version` | no | `22` | Node used to build/run mri. |

Outputs: `verdict` (`clean` \| `blocked`), `checked`, `blocked`.

Behavior contract:

- **Blocked files fail the step**, but only after every listed file has been
  checked, and each individual breach emits a GitHub annotation pinned to
  `file=` + `line=` with the named rule (`ungranted-resource`,
  `unknown-reference`, `unverifiable-import`, …) and what was attempted. No
  bare "unsafe" verdicts.
- **Clean runs succeed** and write a decision table to the job summary:
  outcome per file, granted symbol count, and how many ambiguous references
  were excluded.
- **A file that cannot be found, or a decision that cannot be produced, is a
  failure** — an unverifiable check must not pass silently. This is the same
  fail-closed posture as the tool itself.
- Blocked means **pre-execution**: nothing ran. The allowlist is derived only
  from *resolved* graph edges; ambiguous references are excluded and reported,
  never guessed into grants.

### `mri-analyze`

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `repo-path` | no | `.` | Repository root to analyze. |
| `top` | no | `10` | How many top-risk files to list. |
| `window-days` | no | `90` | Git churn window for risk scoring. |
| `mri-ref` / `node-version` | no | `main` / `22` | Same as above. |

Outputs: `coverage-ratio`, `dead-code-count`, `top-risk-file`,
`top-risk-score`. The step is informational and does not fail on findings;
dead-code candidates keep their confidence labels
(`confirmed-unreferenced` vs `no-resolved-references`) end to end.

## Choosing a scope

Scopes are graph node ids, printed by `mri build`/`mri extract` and stored in
the graph's `nodes` table. Typical choices:

- A file that agent-written or generated code must not escape:
  `f:src/auth.ts`.
- A single entry point and everything it provably reaches:
  `fn:src/api/server.ts#startServer`.
- A class and its methods: `cls:src/state/store.ts#Store`.

Inspect what a scope grants locally before wiring CI:

```bash
npm install && npm run build
node dist/cli/index.js guard "f:src/auth.ts" payload.js --path . --json
```

The JSON decision shows the exact allowlist (symbols, files, resources,
excluded unresolved references) that CI will enforce.

## Fully local, fully free

- **No API keys, no tokens, no external calls.** Extraction (tree-sitter),
  resolution, analysis and containment all execute inside the runner. Your
  source never leaves the machine.
- **No service to sign up for.** The actions check out this repository and
  build mri from source; public repos pay nothing, private repos spend their
  own minutes (a typical run is 1–3 minutes).
- **No network access is granted to checked code.** Guarded payloads execute
  in a sandbox whose allowlist starts empty; anything unlisted is denied.

## Requirements and notes

- Runner OS: any Linux/macOS runner with git; mri itself requires
  Node ≥ 22.5 (see `engines` in package.json). Windows works but is untested
  in self-check.
- Add `.mri/` to your `.gitignore` — the graph database is written under
  `<repo>/.mri/graph.sqlite` during the run.
- `changed-files` should be filtered to extensions mri parses
  (`.js .jsx .mjs .cjs .ts .tsx .mts .cts .py .go .rs`); other files are simply
  not part of the graph.
- Security claims and limits are scoped honestly in
  [docs/THREAT_MODEL.md](THREAT_MODEL.md) and demonstrated in
  [examples/CONTAINMENT_DEMO.md](../examples/CONTAINMENT_DEMO.md). Guarding a
  payload proves containment of *that payload*, verified by static scan plus
  a stub-sandboxed execution — it is not a general sandbox for arbitrary code.
