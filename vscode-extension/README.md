# MRI Code Intelligence — VS Code extension

Brings [MRI](https://github.com/zaydmulani09/mri) code intelligence into the
editor: churn-based risk scores, per-symbol blast radius, dead-code and
coverage overviews, and fail-closed sandboxed execution — all computed from
MRI's real graph, nothing hardcoded.

![icon](icon.png)

## Features

- **Risk + blast-radius CodeLenses** above every function, class, and method:
  `🛡 MRI risk 42 · churn-based` and `📡 blast radius: 7 dependents`. Clicking
  a blast-radius lens opens the panel for that exact graph node.
- **`MRI: Show blast radius for this function`** — resolves the symbol under
  the cursor to its graph node id and lists every dependent by depth. Confirmed
  reachability (✓) is kept separate from ambiguous name references (?); each
  row has a one-click *reveal* that jumps to the dependent in your workspace.
- **`MRI: Run guard check`** — runs the current file or selection through
  MRI's guard against scope `f:<relative-path>`. Blocked code lands in the
  Problems panel line-by-line with the exact violated rule
  (`resources.filesystem`, `symbols → exec`, …). Blocked code never executes.
- **`MRI: Analyze Workspace`** — full bird's-eye view without leaving the
  editor: risk hotspots table, dead-code candidates grouped by confidence
  label, and estimated test coverage, in a webview plus an "MRI Analysis"
  output channel.

## Install (local)

The extension is not on the marketplace yet. Two local options:

### Option A — package and install the VSIX

```bash
git clone https://github.com/zaydmulani09/mri && cd mri
npm install && npm run build          # builds the mri CLI into dist/

cd vscode-extension
npm install
npx @vscode/vsce package              # produces mri-vscode-0.1.0.vsix
code --install-extension mri-vscode-0.1.0.vsix
```

### Option B — develop against a sibling checkout

Open this folder (`vscode-extension/`) in VS Code and press **F5** to launch
an Extension Development Host. The host resolves the CLI automatically:

1. `mri.entryPoint` setting, if set
2. `<workspace>/dist/cli/index.js` — when the analyzed workspace **is** an
   mri checkout
3. `<parent>/mri/dist/cli/index.js` — a **sibling mri checkout**
4. `mri` on PATH

## Requirements

- A built MRI CLI (`npm run build` in the mri repo) or `mri` installed globally
- Git history in the analyzed workspace for meaningful churn scores

## Extension settings

| Setting | Default | Description |
| --- | --- | --- |
| `mri.entryPoint` | auto-detect | Path to MRI's CLI entry point |
| `mri.codeLensEnabled` | `true` | Show risk / blast-radius CodeLenses |
| `mri.autoRefreshOnSave` | `true` | Debounced re-analysis on save |
| `mri.saveDebounceMs` | `700` | Debounce window for save-triggered refreshes |
| `mri.churnWindowDays` | `90` | Churn window for risk scoring |
| `mri.guardResourcesPath` | empty | Optional guard resource-grant JSON |

All settings are editable in the standard Settings UI under **Extensions →
MRI**; no hand-editing of `settings.json` required.

Analysis results are cached per workspace folder and refreshed on activation,
on demand, or debounced on save — never per keystroke.

## Building & testing

```bash
cd vscode-extension
npm install
npm run typecheck     # tsc --noEmit
npm test              # unit tests for pure parsing/id logic
npm run compile       # outputs to out/
npm run make-icon     # regenerates icon.png from scripts/make-icon.mjs
```
