# MRI VS Code extension — demo script

A short, GIF-able walkthrough (~90 seconds of recording). Every step is
reproducible; nothing is staged. Record at 2560x1440 or higher with editor
zoom ~16px so CodeLens text is legible in a GIF.

## Setup (once, before recording)

```bash
git clone https://github.com/zaydmulani09/mri && cd mri
npm install && npm run build

cd vscode-extension && npm install && npm run compile
code --install-extension @vscode/vsce -g 2>/dev/null || true   # if vsce not installed: npm i -g @vscode/vsce
npx @vscode/vsce package
code --install-extension mri-vscode-0.1.0.vsix
```

Use a demo workspace that MRI can analyze quickly and that has interesting
risk data. The `got` clone used in `examples/reports/got-analysis.md` is
ideal (85 files, real churn):

```bash
git clone https://github.com/sindresorhus/got && cd got
git fetch --unshallow        # churn scores need history
code .
```

First launch shows `$(sync~spin) MRI analyzing` in the status bar, then
`🛡 MRI ready`. Wait for it before recording (≈2s on warm cache).

## Shot 1 — CodeLenses (~20s)

1. Open `source/core/calculate-retry-delay.ts`.
2. Hover over the lenses above `calculateRetryDelay`:
   - `🛡 MRI risk N · churn-based`
   - `📡 blast radius: 1 dependent`
3. Scroll briefly to show every function/class carries them.

Narration: *"Risk comes from git churn + test coverage; blast radius is the
number of graph nodes that depend on this symbol."*

## Shot 2 — Blast radius panel (~25s)

1. Open `source/core/options.ts`, put the cursor inside `assertAny`
   (the repo's highest fan-in function).
2. Run **MRI: Show blast radius for this function** from the Command Palette.
3. Panel opens beside the editor: depth-by-depth dependent tree,
   ✓ confirmed vs ? ambiguous-only, one *reveal* button per row.
4. Click a *reveal* on a depth-2 dependent (`fn:source/create.ts#create`) —
   the editor jumps to it.

Narration: *"Confirmed edges only for ✓; the graph refuses to guess about
ambiguous names — those are listed separately."*

## Shot 3 — Guard diagnostics (~30s)

1. Create a scratch file `scratch.js` in the same workspace:
   ```js
   const fs = require("node:fs");
   const secret = fs.readFileSync(".env", "utf8");
   console.log("exfiltrated:", secret);
   ```
2. Save it (so the scope id resolves), then run
   **MRI: Run guard check** with the file focused.
3. Problems panel fills with line-mapped breaches:
   `line 1 · [ungranted-resource] violated rule resources.filesystem …`
4. Replace the content with an allowed call (e.g. call a symbol granted by the
   file's allowlist), save, re-run → clean execution message.

Narration: *"The code never executed. Guard statically checks against the
scope's allowlist and fails closed; violations are exact, not vibes."*
Optional beat: run the same scratch file with bare `node` to show the secret
would have leaked without the guard.

## Shot 4 — Analyze Workspace overview (~15s)

1. Run **MRI: Analyze Workspace**.
2. Webview opens: stat tiles (files / coverage / dead-code candidates /
   churn window), risk hotspot table (`source/core/options.ts` on top),
   dead-code grouped by confidence label, not-covered list.
3. Show the "MRI Analysis" output channel briefly (same digest as text).

Narration: *"The whole report, straight from the same graph the CLI uses."*

## Recording checklist

- [ ] Status bar reads `🛡 MRI ready` before Shot 1
- [ ] Editor zoom ≥ 16px; CodeLenses readable
- [ ] Problems panel visible in Shot 3 before showing breaches
- [ ] No `.env` with a real secret anywhere in frame (use a decoy)
- [ ] End card: `github.com/zaydmulani09/mri`
