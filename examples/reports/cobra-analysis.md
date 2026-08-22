# mri vs. spf13/cobra — first Go validation run

Real captured output of `mri build` / `mri analyze` / `mri blast-radius`
against a live open-source **Go** repository, immediately after landing Go
support in the extraction layer. Every tool-output block below is verbatim
captured stdout/stderr; nothing is hand-edited.

## Run metadata

| | |
| --- | --- |
| Target repo | https://github.com/spf13/cobra |
| Commit analyzed | `adbc881` ("fix: resolve macOS test link failure and update lint rules (#2429)") — full history present (1106 commits) |
| Clone location | outside the mri repo (temp dir) |
| Date of run | 2026-08-22 |
| mri version | from source at `935c247` ("test(extraction): Go fixtures incl. ambiguous interface dispatch") — the commit that landed Go extraction. Executed via `tsx` directly against `src/` because the concurrently-in-flight watch/serve CLI work does not yet typecheck; command behavior is unchanged. |
| Environment | Windows 11, PowerShell, Node v24.14.0 |

Reproduction:

```text
git clone https://github.com/spf13/cobra <outside-this-repo>
npx tsx <mri>/src/cli/index.ts build <cobra>
npx tsx <mri>/src/cli/index.ts analyze <cobra>
npx tsx <mri>/src/cli/index.ts blast-radius "<node-id>" --format tree --db <cobra>/.mri/graph.sqlite
```

Wall-clock times (`Measure-Command`, includes tsx startup):

| Command | Time |
| --- | --- |
| `build` (36 files; 644 ms internal) | ~4.1 s |
| `analyze` (rebuilds graph + all passes) | ~2.5 s |
| `blast-radius` | sub-second |

## `mri build` — verbatim output

```text
36 files parsed
nodes: 36 files, 495 functions, 11 classes, 120 methods, 24 external modules
edges: 558 defines, 190 imports, 3839 calls (1151 resolved / 2688 ambiguous), 0 inherits (0 resolved / 0 ambiguous)
full build in 644 ms
Graph written to <cobra>\.mri\graph.sqlite
```

(The SQLite `ExperimentalWarning` stderr line is elided here only.)
Exit code 0. `files with parse errors 0` — every one of cobra's 36 `.go`
files parsed cleanly with the new grammar.

## `mri analyze` — verbatim output

```text
====================================================
mri codebase report
====================================================
repo:  <cobra>
built: 2026-08-22T20:57:26.271Z   churn window: 90d

ARCHITECTURE
  files             36   (go 36)
  symbols           functions 495 | classes 11 | methods 120
  edges             defines 558 | imports 190 | calls 3839 (1151 resolved / 2688 ambiguous) | inherits 0
  external modules  24   [bufio, bytes, context, errors, fmt, github.com/cpuguy83/go-md2man/v2/md2man, github.com/inconshreveable/mousetrap, github.com/spf13/pflag, go.yaml.in/yaml/v3, io, os, os/exec, path/filepath, reflect, regexp, runtime, sort, strconv, strings, sync, testing, text/template, time, unicode]
  most depended on  active_help.go (11), doc/cmd_test.go (1)

TECH DEBT
  dead code candidates 32   (detail under DEAD CODE)

  risk scores (top 10 of 19 files, window 90d)
     1. args.go                      score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-04-25]
     2. bash_completions.go          score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2024-04-01]
     3. bash_completionsV2.go        score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2025-12-06]
     4. cobra.go                     score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2025-01-27]
     5. command_notwin.go            score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2023-03-06]
     6. command_win.go               score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2023-03-06]
     7. command.go                   score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2025-11-17]
     8. completions.go               score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-04-24]
     9. doc/man_docs.go              score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2025-03-27]
    10. doc/md_docs.go               score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2025-03-27]

SECURITY-RELEVANT SIGNALS (gaps in knowledge, not findings)
  unresolved references   1085   "t.Errorf" x536, "executeCommand" x203, "rootCmd.AddCommand" x116, "len" x113, "assertNoErr" x63, "append" x54
  untested & churning     0
  external dependencies   24   -> bufio, bytes, context, errors, fmt, github.com/cpuguy83/go-md2man/v2/md2man, github.com/inconshreveable/mousetrap, github.com/spf13/pflag, go.yaml.in/yaml/v3, io, os, os/exec, path/filepath, reflect, regexp, runtime, sort, strconv, strings, sync, testing, text/template, time, unicode
  files with parse errors 0

DEAD CODE
  candidates 32: 0 confirmed-unreferenced, 23 referenced-but-uncalled, 9 no-resolved-references
    [referenced-but-uncalled]  cls:command.go#tmplFunc  [command.go]
    [referenced-but-uncalled]  cls:completions.go#flagCompError  [completions.go]
    [referenced-but-uncalled]  cls:doc/yaml_docs.go#cmdOption  [doc/yaml_docs.go]
    [referenced-but-uncalled]  cls:doc/yaml_docs.go#cmdDoc  [doc/yaml_docs.go]
    [no-resolved-references]  fn:args.go#legacyArgs  [args.go]
    [referenced-but-uncalled]  fn:bash_completions.go#writePreamble  [bash_completions.go]
    [referenced-but-uncalled]  fn:bash_completions.go#writePostscript  [bash_completions.go]
    [referenced-but-uncalled]  fn:bash_completionsV2.go#genBashComp  [bash_completionsV2.go]
    [no-resolved-references]  fn:cobra.go#trimRightSpace  [cobra.go]
    [referenced-but-uncalled]  fn:cobra.go#appendIfNotPresent  [cobra.go]
    [no-resolved-references]  fn:cobra.go#rpad  [cobra.go]
    [no-resolved-references]  fn:cobra.go#tmpl  [cobra.go]
    [no-resolved-references]  fn:cobra.go#ld  [cobra.go]
    [no-resolved-references]  fn:cobra.go#stringInSlice  [cobra.go]
    [referenced-but-uncalled]  fn:command.go#defaultUsageFunc  [command.go]
    [referenced-but-uncalled]  fn:command.go#defaultHelpFunc  [command.go]
    [referenced-but-uncalled]  fn:command.go#defaultVersionFunc  [command.go]
    [referenced-but-uncalled]  fn:command_win.go#preExecHook  [command_win.go]
    [referenced-but-uncalled]  fn:completions.go#helpOrVersionFlagPresent  [completions.go]
    [referenced-but-uncalled]  fn:completions.go#completeRequireFlags  [completions.go]
    [referenced-but-uncalled]  fn:completions.go#checkIfFlagCompletion  [completions.go]
    [no-resolved-references]  fn:completions.go#getEnvConfig  [completions.go]
    [referenced-but-uncalled]  fn:doc/rest_docs.go#defaultLinkHandler  [doc/rest_docs.go]
    [no-resolved-references]  fn:doc/util.go#hasSeeAlso  [doc/util.go]
    [no-resolved-references]  fn:doc/util.go#forceMultiLine  [doc/util.go]
    [referenced-but-uncalled]  fn:fish_completions.go#genFishComp  [fish_completions.go]
    [referenced-but-uncalled]  fn:flag_groups.go#processFlagForGroupAnnotation  [flag_groups.go]
    [referenced-but-uncalled]  fn:flag_groups.go#validateRequiredFlagGroups  [flag_groups.go]
    [referenced-but-uncalled]  fn:flag_groups.go#validateOneRequiredFlagGroups  [flag_groups.go]
    [referenced-but-uncalled]  fn:flag_groups.go#validateExclusiveFlagGroups  [flag_groups.go]
    [referenced-but-uncalled]  fn:powershell_completions.go#genPowerShellComp  [powershell_completions.go]
    [referenced-but-uncalled]  fn:zsh_completions.go#genZshComp  [zsh_completions.go]

TEST COVERAGE
  estimated coverage 5.3% (1/19 source files, import-based approximation)
    covered by active_help_test.go -> (nothing internal)
    covered by args_test.go -> (nothing internal)
    covered by bash_completionsV2_test.go -> (nothing internal)
    covered by bash_completions_test.go -> (nothing internal)
    covered by cobra_test.go -> (nothing internal)
    covered by command_test.go -> (nothing internal)
    covered by completions_test.go -> (nothing internal)
    covered by doc/cmd_test.go -> active_help.go
    covered by doc/man_docs_test.go -> active_help.go
    covered by doc/man_examples_test.go -> active_help.go
    covered by doc/md_docs_test.go -> active_help.go
    covered by doc/rest_docs_test.go -> active_help.go
    covered by doc/yaml_docs_test.go -> active_help.go
    covered by fish_completions_test.go -> (nothing internal)
    covered by flag_groups_test.go -> (nothing internal)
    covered by powershell_completions_test.go -> (nothing internal)
    covered by zsh_completions_test.go -> (nothing internal)
    not covered: args.go, bash_completions.go, bash_completionsV2.go, cobra.go, command.go, command_notwin.go, command_win.go, completions.go, +10 more
```

## `mri blast-radius` — verbatim outputs

The unexported helper that two default-callback functions reference by name
but never provably call:

```text
$ mri blast-radius "fn:cobra.go#trimRightSpace" --format tree
fn:cobra.go#trimRightSpace  (function)

? ambiguous-name references (not confirmed to point here):
   ? fn:command.go#defaultHelpFunc   ambiguous-reference
   ? fn:command.go#defaultUsageFunc   ambiguous-reference
```

A hub with confirmed reachability plus honest unknowns — including a test
helper whose name matches but whose calls stay dynamic:

```text
$ mri blast-radius "m:command.go#Command.ExecuteC" --format tree
m:command.go#Command.ExecuteC  (method)
├─ ✓ m:command.go#Command.Execute   d1 · calls
│  ├─ ✓ m:command.go#Command.ExecuteContext   d2 · calls
├─ ✓ m:command.go#Command.ExecuteContextC   d1 · calls

? ambiguous-name references (not confirmed to point here):
   ? fn:command_test.go#executeCommandC   ambiguous-reference
   ? fn:completions_test.go#TestCompletionDoesNotMutateOsArgs   ambiguous-reference
   ? m:command.go#Command.ExecuteC   ambiguous-reference
```

## What held up, what did not

Go-specific findings from this first real run:

1. **Resolution ratio lands where the fail-closed model predicts.**
   1151/3839 call edges (~30%) resolved — nearly identical to got's ~30%.
   The ambiguous bulk is dominated by exactly the constructs Go resolution
   must refuse: interface/pointer method dispatch (`t.Errorf` ×536,
   `rootCmd.AddCommand` ×116), builtins treated as plain identifiers
   (`len` ×113, `append` ×54), and cross-package test helpers
   (`executeCommand` ×203). None of these are guessed into fake edges.
2. **Receiver-self resolution works on real code**: methods calling their
   own receiver's methods (`c.Area()` inside `func (c Circle)`-style code)
   resolve through the class chain, which is why 1151 edges still resolve
   despite zero interface guessing.
3. **Module-path import resolution works**: all 190 imports classified;
   stdlib and third-party paths (`github.com/spf13/pflag`,
   `go.yaml.in/yaml/v3`) became explicit external module nodes, and the
   single internal package layout of cobra needed no special casing.
4. **Dead-code pass stays conservative and useful**: 0
   `confirmed-unreferenced`, every candidate downgraded to
   `referenced-but-uncalled` or `no-resolved-references`. For a library
   like cobra that is the correct posture — its exported API is consumed
   outside the repo and its internals are heavily dispatched dynamically.
   The candidate list still surfaces genuinely interesting review targets
   (the five shell-completion generators, the flag-group validators).
5. **Coverage estimate breaks on Go's same-package tests — known
   limitation.** 5.3% is an artifact, not a finding: Go test files live in
   the same package directory and reference symbols *without importing
   them*, so import-proximity coverage cannot see the relationship.
   `doc/*_test.go` shows the one case where an import exists (its own
   package). Fixing this needs package-aware coverage mapping, not a tweak.
6. **Risk ranking degenerated — for a different reason than got's caveat.**
   Every score is the flat 30-point no-tests penalty because cobra had no
   commits inside the 90-day churn window (quiet repo since April 2026).
   Same visual symptom as the shallow-clone degeneration, different cause:
   a genuinely quiet window. Widen `--window` when demoing quiet repos.
7. **`inherits 0` is accurate for cobra**: it composes rather than embeds;
   no struct/interface embedding exists between analyzed types. The
   embedding path itself is exercised by fixture tests.

## Caveats when presenting

- Go ambiguity share looks high next to TS repos; lead with the
  `unresolved references` top-list so the audience sees *what* stayed
  ambiguous before showing counts.
- Do not show the TEST COVERAGE number for Go repos without the item-5
  explanation ready.
- `most depended on active_help.go (11)` reflects test-file imports of the
  standalone `active_help` package, not architectural centrality.

## Verdict — Go support demo-ready?

For structure, risk framing, dead-code conservatism, and blast radius: yes,
at mri `935c247` against cobra @ `adbc881`. The coverage estimator needs
package-aware rework before its numbers mean anything on Go repos, and the
risk story needs a widened window on quiet repositories.
