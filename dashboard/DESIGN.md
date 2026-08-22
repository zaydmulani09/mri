# DESIGN.md — mri dashboard

Filled out per Appendix A before any code. Every choice below traces to the premise.
If a future change cannot cite this document, it does not go in.

## Premise

One sentence naming the world and its materials:

> A calibration bench for a code-integrity instrument: near-ink surfaces,
> phosphor-green traces reserved for proven structure, amber markers restricted
> to unresolved evidence, and every figure typeset like a measurement readout.

Why this world: mri's entire value proposition is the proven-vs-ambiguous split.
A calibration bench is a place where instruments are trusted precisely because
uncertainty is labeled, not hidden. The dashboard therefore has exactly two
signal channels — solid phosphor green for what the graph proved, dashed amber
for what it could not resolve — and nothing else may borrow them.

## Audience and job

Primary audience: engineers running mri locally against their own repositories.
The one job of this page: show what is proven versus unresolved about a
dependency graph in under a minute, with zero setup theater.

## Color tokens

--bg:        #101312   unlit instrument panel; slightly green-cast near-black
--surface:   #171c19   docked rails and raised tables, one step above bg
--border:    #29312c   hairline panel seams; the only divider allowed
--text:      #d8ded9   primary readouts, ~13:1 on bg
--muted:     #8f9a92   secondary metadata, ~5.5:1 on bg (passes 4.5:1)
--accent:    #4cd787   phosphor green. Justification: long-persistence scope
                       trace color; reserved exclusively for PROVEN structure —
                       resolved edges, confirmed paths, selected state, primary
                       action. If green appears, the graph asserted the fact.
--caution:   #e0b04b   bench warning amber. Reserved exclusively for UNRESOLVED
                       evidence — ambiguous edges, no-resolved-references tier,
                       ambiguous-only dependents. If amber appears, the tool is
                       admitting uncertainty.

Rule: two signal channels, two colors, hard-coded meanings. Everything else is
neutral ink. No third chromatic token exists; severity is expressed by marker
shape and text weight, never by new hues.

## Type

Data / structural voice: ui-monospace stack (SFMono, Cascadia Mono, JetBrains
Mono, Consolas fallbacks). All node ids, metrics, table figures, graph labels,
eyebrows, and the status strip. Justification: measurement readouts on a bench
are monospaced so digits align and values scan; this face carries the identity.
Zero webfont bytes ship — the platform's own mono keeps the tool native and
offline-first.

UI face: system-ui stack. Controls, tooltips, prose fragments. Chosen over a
webfont for the same local-first reason; not a trend pick.

Scale (px): display 20 / h1 16 / h2 14 / body 13 / small 12 / label 11.
Weights: body 400, labels and eyebrows 500, section titles 600, one heavy use
(700) permitted on the status-strip numerals only.

Avoid: Inter, Geist, Space Grotesk (banned defaults); also no webfonts at all.

## Spacing and radius

Spacing scale: 4, 8, 12, 16, 24, 32. Dense instrument sizing; nothing outside
the scale without a cited reason.
Layout: full-bleed application grid (status strip top, canvas center, inspector
rail right). Max width 1760px centered beyond that.
Radius: 2px on every rectilinear surface, uniform. Instruments are machined,
not bubbled.

## Signature element

The dual-channel confidence marker, applied identically everywhere evidence
appears: a solid green tick for proven facts, a dashed amber tick for unresolved
ones. It is the legend chip in the header, the stroke style of every graph edge,
the row prefix in dead-code and risk tables, and the grouping rule of the
blast-radius tree. Learn it once and the whole dashboard reads.

Secondary chrome (not the signature): a persistent process-monitor status strip
across the top — `MRI · repo · nodes N · edges M · resolved R · ambiguous U ·
built T` in mono — always visible, updated per build.

## Motion budget

No entrance animations. Transitions limited to 120–160ms on color, opacity,
and border only. The force-directed layout is content, not decoration: watching
it settle is information, so it runs regardless of preference settings, but all
hover/selection transitions collapse under prefers-reduced-motion. No parallax,
no scroll-jacking, no cursor-follow effects, no stagger reveals.

## Banned in this build

From the manual: gradients (including data-decorative ones — edges are flat),
glassmorphism, drop shadows except a single popover elevation, uniform soft
radii, Lucide or any icon set (legend marks are drawn glyphs, not icons),
sparkle/AI glyphs, emoji headers, bento grids, three-card rows, dot grids,
fake terminals (CLI examples shown in-app must be real captured output),
testimonials/pricing/trust badges/loading spinners as entertainment,
em dashes in copy, "it's not X it's Y", "Learn more" links, lorem ipsum,
mock metrics, skill bars.

Project-specific bans: no third chromatic hue (severity is shape + weight);
no glow on selected nodes (ring + fill change only); no animation of the
confidence markers (they are measurements, blinking implies instability).

## Content is real

Every figure rendered comes from `/api/graph` and `/api/analysis`, which serve
the SQLite graph built by `mri build` from a real repository. No mock JSON, no
invented repos, no placeholder counts. Empty states say "no data" plainly.

## Execution contract (Section 3.6 pre-commit)

Styled dark scrollbar matching --surface; z-index ladder: canvas 0, docked
panels 1, popover/tooltip 2, nothing above 3; one shared hover rule for all
interactive rows/buttons; selection indicated by border + background change
identically in every list; console must stay clean; all fetches same-origin.
