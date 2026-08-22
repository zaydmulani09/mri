# Circular dependency detection — first real-repo findings

Captured `CIRCULAR DEPENDENCIES` sections from `mri analyze` runs against
the three validated showcase repos, immediately after landing the pass
(`00cfaa6`). Detector rules: strongly-connected groups over **resolved
edges only** (ambiguous edges are never traversed); one representative path
per group, starting at its lexicographically smallest member.

Fixture verification (`tests/cycles.test.ts`): a genuine 3-file import +
resolved-call cycle is reported with exact paths; an external-module
near-miss is not reported; a call pair that only closes through an
ambiguous edge produces no cycle.

## got @ e3924aa (JavaScript/TypeScript)

```text
  circular dependency groups 1   (detail under CIRCULAR DEPENDENCIES)
CIRCULAR DEPENDENCIES (resolved edges only)
  import cycles 1   (files involved 4)
    f:source/as-promise/types.ts -> f:source/core/index.ts -> f:source/core/calculate-retry-delay.ts ->
f:source/core/options.ts -> f:source/as-promise/types.ts   [4 files]
  call cycles 0
```

A real architectural finding: got's promise layer, request core, retry-delay
calculation and options machinery form a proven 4-file import loop — every
edge in the path is a resolved import, so this survives the fail-closed bar.
(Consistent with long-standing upstream discussion about `types.ts` reaching
into core internals.)

## cobra @ adbc881 (Go)

```text
  circular dependency groups 0   (detail under CIRCULAR DEPENDENCIES)
CIRCULAR DEPENDENCIES (resolved edges only)
  import cycles 0   (files involved 0)
  call cycles 0
```

Clean, and expected twice over: Go rejects import cycles at compile time,
and cobra is a single flat package whose files don't import each other at
all. Zero false positives on a repo whose resolved-edge density was already
validated in `cobra-analysis.md`.

## fd @ ee20f42 (Rust)

```text
  circular dependency groups 1   (detail under CIRCULAR DEPENDENCIES)
CIRCULAR DEPENDENCIES (resolved edges only)
  import cycles 1   (files involved 3)
    f:src/config.rs -> f:src/filetypes.rs -> f:src/dir_entry.rs -> f:src/config.rs   [3 files]
  call cycles 0
```

A genuine 3-module Rust loop between config, file-type tables and the
directory-entry abstraction — all three edges resolved `use` paths under
`crate::`, so it passes the same fail-closed bar.

## Notes

- Call-level cycles read 0 across all three repos. With dynamic dispatch
  excluded by design, function-level loops need fully static plain/self
  chains end to end — rare outside fixtures. The section stays in the
  report so absence is visible rather than assumed.
- The detector reports one representative path per strongly-connected
  group, not every elementary cycle, keeping output bounded and stable on
  large graphs.
