# MRI Code Intelligence (VS Code extension)

Surfaces [MRI](../README.md) analysis inline while editing:

- **CodeLenses** above every extracted function, class, and method showing the
  file's churn-based **risk score** and a **`blast radius: N dependents`**
  indicator. Clicking a blast-radius lens opens MRI's blast radius panel for
  that exact graph node.
- **`MRI: Show blast radius for this function`** — resolves the symbol under
  the cursor to its graph node id and lists every dependent by depth, keeping
  confirmed reachability (`✓`) separate from ambiguous name references (`?`),
  with one-click reveal of each dependent in the editor.
- **`MRI: Run guard check`** — runs MRI's fail-closed guard against the
  current file (or just the current selection) using scope `f:<relative-path>`.
  Blocked code is reported line-by-line in the Problems panel with the exact
  violated rule; nothing is ever executed.

## How it works

The extension is fully decoupled from the MRI source tree: it shells out to
the MRI CLI. The entry point is resolved in this order:

1. `mri.entryPoint` setting (absolute path to `dist/cli/index.js`)
2. `<workspace>/dist/cli/index.js` (workspace *is* an mri checkout)
3. sibling `../mri/dist/cli/index.js`
4. `mri` binary on PATH

Analysis results are cached per workspace folder and refreshed:

- once when the extension activates,
- when you run `MRI: Refresh analysis`,
- debounced on file **save** (`mri.autoRefreshOnSave`, default on).

There are no per-keystroke analyses.

Per-symbol dependent counts come from the same SQLite graph `mri build`
produces, read through the same Node runtime that runs the CLI, so
`node:sqlite` availability matches whatever already runs `mri build`.

## Requirements

- A built MRI CLI (`npm run build` in the mri repo) or `mri` installed globally
- Git history in the analyzed workspace for meaningful churn scores

## Extension settings

| Setting | Default | Description |
| --- | --- | --- |
| `mri.entryPoint` | `""` | Absolute path to MRI's CLI entry point |
| `mri.churnWindowDays` | `90` | Churn window for risk scoring |
| `mri.codeLensEnabled` | `true` | Show risk/blast-radius CodeLenses |
| `mri.autoRefreshOnSave` | `true` | Debounced re-analysis on save |
| `mri.guardResourcesPath` | `""` | Optional guard resource-grant JSON |

## Building

```bash
cd vscode-extension
npm install
npm run compile     # outputs to out/
npm test            # unit tests for pure parsing/id logic
```

Then open this folder in VS Code and press F5 to launch an Extension
Development Host, or package with `vsce package`.
