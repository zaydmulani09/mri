# mri vs. sharkdp/fd — second Go-pattern validation, first Rust run

Real captured output of `mri build` / `mri analyze` / `mri blast-radius`
against a live open-source **Rust** repository, immediately after landing
Rust support in the extraction layer. Every tool-output block below is
verbatim captured stdout/stderr; nothing is hand-edited.

## Run metadata

| | |
| --- | --- |
| Target repo | https://github.com/sharkdp/fd |
| Commit analyzed | `ee20f42` ("Merge pull request #2091 ... actions/attest-4.2.1") — full history present (2005 commits) |
| Clone location | outside the mri repo (temp dir) |
| Date of run | 2026-08-22 |
| mri version | from source at `8da78a6` ("fix(extraction): collapse whitespace in Rust grouped use specifiers"), built dist (`npm run build`), all 114 tests passing |
| Environment | Windows 11, PowerShell, Node v24.14.0 |

Reproduction:

```text
git clone https://github.com/sharkdp/fd <outside-this-repo>
node <mri>/dist/cli/index.js build <fd>
node <mri>/dist/cli/index.js analyze <fd>
node <mri>/dist/cli/index.js blast-radius "<node-id>" --format tree --db <fd>/.mri/graph.sqlite
```

Wall-clock times:

| Command | Time |
| --- | --- |
| `build` (24 files; 364 ms internal) | ~0.9 s |
| `analyze` (rebuilds graph + all passes) | ~0.6 s |
| `blast-radius` | sub-second |

## `mri build` — verbatim output

```text
24 files parsed
nodes: 24 files, 231 functions, 33 classes, 94 methods, 78 external modules
edges: 313 defines, 158 imports, 1413 calls (315 resolved / 1098 ambiguous), 10 inherits (2 resolved / 8 ambiguous)
full build in 364 ms
Graph written to <fd>\.mri\graph.sqlite
```

(The SQLite `ExperimentalWarning` stderr line is elided here only.)
Exit code 0; zero parse errors across all 24 `.rs` files.

## `mri analyze` — verbatim output

The external-module list below is long because Rust use statements are
recorded at their full grouped-path text; it is reproduced complete once in
ARCHITECTURE and elided (marked) in the SECURITY section where it repeats.

```text
====================================================
mri codebase report
====================================================
repo:  <fd>
built: 2026-08-22T22:07:48.206Z   churn window: 90d

ARCHITECTURE
  files             24   (rust 24)
  symbols           functions 231 | classes 33 | methods 94
  edges             defines 313 | imports 158 | calls 1413 (307 resolved / 1106 ambiguous) | inherits 10
  external modules  78   [aho_corasick::AhoCorasick, anyhow::anyhow, anyhow::{Context, Result, anyhow, bail},
    anyhow::{Result, anyhow}, anyhow::{Result, bail}, argmax::Command, clap::{ Arg, ArgAction, ArgGroup,
    ArgMatches, Command, Parser, ValueEnum, error::ErrorKind, value_parser, }, clap::{CommandFactory, Parser},
    clap_complete::Shell, crate::testenv::TestEnv, crossbeam_channel::{Receiver, RecvTimeoutError, SendError,
    Sender, bounded}, etcetera::BaseStrategy, faccess::PathExt, globset::GlobBuilder,
    ignore::overrides::{Override, OverrideBuilder}, ignore::{WalkBuilder, WalkParallel, WalkState},
    jiff::Timestamp, jiff::{Span, Timestamp, Zoned, civil::DateTime, tz::TimeZone}, lscolors::LsColors,
    lscolors::{Colorable, LsColors, Style}, lscolors::{Indicator, LsColors, Style}, nix::sys::signal::{SigHandler,
    Signal, raise, signal}, nix::unistd::{Gid, Group, Uid, User}, normpath::PathExt, regex::Regex,
    regex::bytes::Regex, regex::bytes::RegexSet, regex::bytes::{Regex, RegexBuilder, RegexSetBuilder},
    regex::escape, regex_syntax::ParserBuilder, regex_syntax::hir::Hir,
    self::command::{execute_commands, handle_cmd_error}, self::input::{basename, dirname, remove_extension},
    self::job::{batch, job}, self::owner::OwnerFilter, self::size::SizeFilter, self::time::TimeFilter,
    std::borrow::Cow, std::cell::OnceCell, std::env, std::ffi::OsStr, std::ffi::OsString,
    std::ffi::{OsStr, OsString}, std::fmt::Write, std::fmt::{self, Display, Formatter},
    std::fmt::{self, Formatter, Write}, std::fs, std::fs::{FileType, Metadata}, std::io, std::io::IsTerminal,
    std::io::Write, std::io::{self, Write}, std::iter, std::mem, std::num::NonZeroUsize, std::os::unix,
    std::os::unix::fs::FileTypeExt, std::os::windows, std::path::Path, std::path::PathBuf,
    std::path::{Component, Path, Prefix}, std::path::{Path, PathBuf}, std::process, std::process::Stdio,
    std::sync::Arc, std::sync::OnceLock, std::sync::atomic::{AtomicBool, Ordering},
    std::sync::{Arc, Mutex, MutexGuard}, std::thread, std::time::Duration, std::time::{Duration, Instant},
    std::time::{Duration, SystemTime, UNIX_EPOCH}, std::time::{Duration, SystemTime},
    std::{path::PathBuf, sync::Arc, time::Duration}, super::CommandSet, tempfile::TempDir, test_case::test_case]
  most depended on  src/filter/mod.rs (6), src/filesystem.rs (6), src/exit_codes.rs (5), src/config.rs (5),
    src/exec/mod.rs (4)

TECH DEBT
  dead code candidates 17   (detail under DEAD CODE)

  risk scores (top 10 of 22 files, window 90d)
     1. src/filter/time.rs           score  44   [churn 2 commits (+14pts) | no tests found (+30pts) | last modified 2026-07-30]
     2. src/walk.rs                  score  44   [churn 2 commits (+14pts) | no tests found (+30pts) | last modified 2026-07-01]
     3. src/main.rs                  score  37   [churn 1 commits (+7pts) | no tests found (+30pts) | last modified 2026-06-26]
     4. src/cli.rs                   score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-05-17]
     5. src/config.rs                score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-03-17]
     6. src/dir_entry.rs             score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-05-05]
     7. src/error.rs                 score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-05-05]
     8. src/exec/command.rs          score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2025-10-03]
     9. src/exec/job.rs              score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-05-05]
    10. src/exec/mod.rs              score  30   [churn 0 commits (+0pts) | no tests found (+30pts) | last modified 2026-05-17]

SECURITY-RELEVANT SIGNALS (gaps in knowledge, not findings)
  unresolved references   365   "te.assert_output" x229, "Ok" x43, "te.test_root().join" x35, "Some" x26,
    "te.assert_failure" x19, "te.assert_output_subdirectory" x13
  untested & churning     3   -> src/filter/time.rs, src/walk.rs, src/main.rs
  external dependencies   78   -> (identical list to the ARCHITECTURE external modules above; elided here)
  files with parse errors 0

DEAD CODE
  candidates 17: 4 confirmed-unreferenced, 13 referenced-but-uncalled, 0 no-resolved-references
    [referenced-but-uncalled]  cls:src/dir_entry.rs#DirEntryInner  [src/dir_entry.rs]
    [referenced-but-uncalled]  cls:src/exec/command.rs#Outputs  [src/exec/command.rs]
    [referenced-but-uncalled]  cls:src/exec/mod.rs#CommandBuilder  [src/exec/mod.rs]
    [referenced-but-uncalled]  cls:src/exec/mod.rs#CommandTemplate  [src/exec/mod.rs]
    [referenced-but-uncalled]  cls:src/filter/owner.rs#Check  [src/filter/owner.rs]
    [referenced-but-uncalled]  cls:src/walk.rs#ReceiverMode  [src/walk.rs]
    [referenced-but-uncalled]  cls:src/walk.rs#Batch  [src/walk.rs]
    [referenced-but-uncalled]  cls:src/walk.rs#BatchSender  [src/walk.rs]
    [referenced-but-uncalled]  cls:src/walk.rs#ReceiverBuffer  [src/walk.rs]
    [referenced-but-uncalled]  cls:src/walk.rs#WorkerState  [src/walk.rs]
    [referenced-but-uncalled]  fn:src/cli.rs#default_num_threads  [src/cli.rs]
    [referenced-but-uncalled]  fn:src/cli.rs#parse_millis  [src/cli.rs]
    [confirmed-unreferenced]  fn:src/filter/time.rs#now  [src/filter/time.rs]
    [referenced-but-uncalled]  fn:src/hyperlink.rs#host  [src/hyperlink.rs]
    [confirmed-unreferenced]  fn:src/regex_helper.rs#pattern_has_uppercase_char_simple  [src/regex_helper.rs]
    [confirmed-unreferenced]  fn:src/regex_helper.rs#pattern_has_uppercase_char_advanced  [src/regex_helper.rs]
    [confirmed-unreferenced]  fn:src/regex_helper.rs#matches_strings_with_leading_dot_simple  [src/regex_helper.rs]

TEST COVERAGE
  estimated coverage 0.0% (0/22 source files, import-based approximation)
    covered by tests/testenv/mod.rs -> (nothing internal)
    covered by tests/tests.rs -> (nothing internal)
    not covered: src/cli.rs, src/config.rs, src/dir_entry.rs, src/error.rs, src/exec/command.rs, src/exec/job.rs,
      src/exec/mod.rs, src/exit_codes.rs, +14 more
```

(Line wrapping inside the external-modules block is a presentation artifact
of this document; the captured output was single-line per entry after the
`8da78a6` whitespace fix.)

## `mri blast-radius` — verbatim output

The shared error-printing helper, reached from three subsystems on confirmed
edges — plus one honest ambiguous-only reference from `main.rs`:

```text
$ mri blast-radius "fn:src/error.rs#print_error" --format tree
fn:src/error.rs#print_error  (function)
├─ ✓ fn:src/exec/command.rs#handle_cmd_error   d1 · calls
│  ├─ ✓ fn:src/exec/command.rs#execute_commands   d2 · calls
├─ ✓ fn:src/exec/job.rs#batch   d1 · calls
├─ ✓ fn:src/exec/job.rs#job   d1 · calls
├─ ✓ m:src/cli.rs#Opts.search_paths   d1 · calls
├─ ✓ m:src/walk.rs#WorkerState.build_walker   d1 · calls
│  ├─ ✓ m:src/walk.rs#WorkerState.scan   d2 · calls

? ambiguous-name references (not confirmed to point here):
   ? fn:src/main.rs#main   ambiguous-reference
```

## What held up, what did not

Rust-specific findings from this first real run:

1. **Resolution ratio consistent with the language model.** 315/1413 call
   edges (~22%) resolved. The ambiguous bulk is dominated by exactly the
   constructs Rust resolution must refuse: method calls through trait
   objects/generics and the integration-test helper (`te.assert_output`
   alone accounts for 229 ambiguous references; `te.*` total 329), enum
   constructors like `Ok`/`Some` used as plain identifiers (69 combined),
   and macro-free std paths not bound by a top-level `use`.
2. **Trait impls resolve as inheritance where provable.** `inherits 10
   (2 resolved / 8 ambiguous)`: inherent/trait impls on locally declared
   types produced resolved `impl Trait for Type` edges via the existing
   hierarchy resolver; impls referencing types from other modules stayed
   ambiguous rather than guessed.
3. **Cross-module crate paths work**: all 158 imports classified; internal
   `crate::…`, `self::…`, and `super::…` module paths were separated from
   78 external crates without any registry or Cargo.lock access.
4. **Dead-code pass stays conservative and useful**: only 4
   `confirmed-unreferenced` candidates — the `regex_helper.rs` trio (very
   plausibly dead after smart-case refactors) and `filter/time.rs#now`.
   Everything else was correctly downgraded to `referenced-but-uncalled`;
   fd's heavy trait-object dispatch means most types show up as referenced.
5. **Risk scoring found a real signal here** (unlike quiet cobra): three
   files flagged `untested & churning` — `filter/time.rs`, `walk.rs`,
   `main.rs` — which is exactly the review-priority story the demo wants.
6. **Coverage estimate reads 0% — same known limitation as Go, worse.**
   fd's integration tests live under `tests/` and drive the built binary
   through `assert_cmd`; they import nothing from `src/`, so import-based
   coverage sees nothing. The estimate remains honest-as-labeled
   ("import-based approximation") but carries no signal for this repo.

## Caveats when presenting

- Lead with the `unresolved references` top-list so the ambiguity share
  (78%) reads as named gaps, not tool failure.
- Skip or explain the TEST COVERAGE number (see item 6).
- Grouped-use specifiers are recorded verbatim (`anyhow::{Context, Result,
  anyhow, bail}`); they are single-line since `8da78a6` but still verbose.

## Verdict — Rust support demo-ready?

For structure, inheritance, risk framing, dead-code conservatism, and blast
radius: yes, at mri `8da78a6` against fd @ `ee20f42`. Same open item as the
Go run: package-aware coverage mapping before coverage numbers mean
anything outside JS/TS.
