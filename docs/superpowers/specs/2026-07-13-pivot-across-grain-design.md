# Pivot across the grain — make the grouped view work on real tables (epic)

**Status:** design — not yet started
**Date:** 2026-07-13
**Builds on:** `2026-07-13-grouped-sheet-lens-design.md` (the grouped sheet as a lens),
`2026-06-16-data-hierarchy-redesign.md` (the spine/classifier model),
`2026-06-24-iris-file-format-redesign-design.md` (the `.iris` container).

## Problem

The grouped sheet is supposed to be the "flip any table into a spreadsheet and back"
lens. On the tables Iris actually exists to serve, it never opens.

Every COV2D report table (`electronic_labbook_database/reports/COV2D/*.iris`) is
80k–180k rows of per-object measurements. `pivotability()` (`src/grouped.ts:54`)
refuses all of them, for two independent reasons:

1. **A hard `MAX_GROUPED_ROWS = 2000` cap** (`grouped.ts:75`). Every real table is
   40–90× over it. The cap exists because `longToWide` materialises *one cell per
   tidy row* — a full pivot. For 180k rows that is meaningless anyway; nobody wants
   a 180,000-cell sheet.
2. **"Exactly one numeric value column"** (`grouped.ts:58`). `cell_size` carries
   `frame` + `value`; `neighbor_enrichment` carries `obs` + `exp`. The pivot can't
   guess which fills the grid, so it gives up.

The root cause is that the current pivot derives its structure from *column types*
(one numeric = the value, the rest = factors) and lays out every row. That is the
wrong axis. The grain is already defined — by the **hierarchy spine** — and the
grouped view should be built on it.

## The decision that shapes everything: pivot across the grain

The grain of a measurement table is its nesting spine, coarsest → finest, already
modelled as `Hierarchy.spine` (`types.ts:109`) and edited in the Data-hierarchy
panel (`src/components/HierarchyPanel.tsx`). For `cell_size` the spine is
`experiment › position › cell › frame`, with `subpopulation` a **classifier**
attached at the `cell` level.

The grouped view spreads **all but the finest grain across the top**, and runs the
**finest grain down the side**:

- **Vertical axis** = `spine[last]` — the finest spine level.
- **Horizontal bands** = `spine[0..last-1]`, nested coarse → fine, with each
  classifier attached as a label at its `home` level (subpopulation under `cell`).
- **Body** = the value column(s) — every column that is neither a spine level nor a
  classifier. Multiple values (`obs`, `exp`) become stacked value sub-columns.

For `cell_size`: bands `experiment × position × cell (+subpopulation)`, `frame` down
the side, `value` in the body — ~1,726 columns × up to 50 frame-rows. Rectangular,
rows aligned by `frame`, each body cell ↔ exactly one tidy row, so edits round-trip
through the existing `rowIds` path unchanged.

This is a **true pivot**, not the ragged stack. It follows the hierarchy, so it
inherits — for free — everything the hierarchy already answers: grain order (the
spine + the panel's ↑↓ reorder), what is a level vs a label (identifier/classifier),
and "average away everything finer" (the per-level reducer `fn` + `defaultPlan`,
`src/collapse.ts`), which is how the 1,726-column pivot collapses to a readable
summary.

### Why the two current blockers dissolve

- **The row cap goes.** Sheet size is no longer "total rows." Columns =
  distinct occupied combinations of the coarser spine levels; rows = the finest
  grain's extent. It becomes a *virtualisation* problem, not a wall.
- **The one-value rule goes.** Value columns are "everything not in the spine and
  not a classifier." Zero, one, or many — many just means more body sub-columns.

## Model

### Grouped spec, rebuilt on the spine

`GroupedSpec` (`grouped.ts`) stops being `{ value, factors }` derived from column
types. It becomes derived from `Hierarchy` + `Schema`:

```
bands   = spine[0 .. n-1]         // coarse → fine, minus the finest
vertical = spine[n-1]             // the finest spine level
labels  = classifiers, each attached at its home band
values  = columns ∉ spine ∪ classifiers   // the body, ≥ 0 columns
```

`applyFactorOrder`'s job (re-nesting) is subsumed by reordering the spine in the
panel: moving a different level to the innermost slot re-picks the vertical axis.

### Availability, rebuilt

`pivotability()` no longer counts numeric columns or checks a row cap. It asks only
whether there is anything to lay out:

- available iff there is at least one column to band by — **a non-empty spine, or at
  least one categorical** (so `t1_landscape`, spine-less but with `contact_type`,
  still pivots via the `id` fallback below).
- unavailable only when there is no structure at all (e.g. a lone numeric column):
  honest reason, not a crash.
- a spine with **no value columns** is still valid — a pure index grid.

### The finest-grain fallback (no fine identifier)

When the spine has only coarse levels and no per-object index — e.g.
`neighbor_enrichment` (spine `experiment`, no cell/event id) — the finest grain does
not uniquely key a row. The vertical axis falls back to the implicit row `id`, and
columns become ragged member-stacks of that group's rows. Same code path; honest
because rows are not claimed to align.

### Edits and the canonical invariant

Unchanged. Tidy stays canonical; every body edit is a single `engine.editCell`
against the tidy row named by `rowIds[r][c]`. One write path. The pivot is a pure,
recomputed lens (`longToWide`), never stored.

### Scale — virtualisation, not a cap

`GroupedSheet.tsx` currently renders a hand-rolled `<table>` of all cells. With the
cap gone it must **virtualise columns** (and rows) — render only the visible window.
No hard block on size; the honesty mandate is served by the sheet being correct and
navigable, and by the reducer path offering the summary when you want to *read*
rather than *navigate*. (No soft-warning banner — keep it simple.)

## Persistence — already implemented; the gap is upstream

The `.iris` container already round-trips the spine: `document.py:64` writes
`tables/*/hierarchy.json` from the table's `hierarchy`, `document.py:110` reads it,
and on open the loader (`state.ts:1187`) prefers the saved spine, falling back to
`identifierCols(schema)`; import seeds the same way (`state.ts:975`). So a spine
assigned in Iris persists across save/reload today. No Iris-side persistence work is
required; a round-trip regression test is enough.

The COV2D files carry `spine: []` for two upstream reasons, both out of scope here:

1. They were written by an **external** producer (`cov2d.report`, in the private
   `electronic_labbook_database` repo) that emits an empty spine. Fixing that writer
   is a downstream follow-up.
2. `frame` and `t1_event_id` are typed **numeric**, but they are indices. The
   identifier-seed misses them, so they would fall into the body as spurious value
   columns. Making these tables pivot cleanly means promoting those columns to
   `identifier` (a `setSchema` from the hierarchy panel) — a data-typing fix, not a
   code change; the panel and persistence already support it.

Iris's behaviour on an empty-spine, no-categorical table is still defined below:
grouped view unavailable, honest reason, no crash.

## Invariants

1. Tidy is canonical; the grouped sheet is a recomputed lens, never stored.
2. One write path: every edit is an `engine.editCell` on a tidy row via `rowIds`.
3. The grouped view is built from the hierarchy spine, not from column types.
4. Availability follows the spine; empty spine → unavailable, never a crash.
5. Nothing silently truncates: virtualisation renders a window of a complete sheet.

## Staging — the slices

- **Slice 1 (this plan) — the pivot, on the spine.** Rebuild `GroupedSpec`,
  `pivotability()`, and `longToWide()` to read `Hierarchy`: bands = spine minus
  finest, plus classifiers; vertical = finest spine level; body = the value
  columns, one leaf sub-column each. Aligned by the vertical grain, with the `id`
  fallback when there is no spine. Wire `GroupedSheet.tsx` to `activeHierarchyAtom`
  and relax the caps so a spine-carrying real table is not blocked. Pure functions
  are unit-tested; the wiring is covered by the existing grouped-sheet e2e.
- **Slice 2 (follow-up) — virtualisation.** `GroupedSheet.tsx` renders only the
  visible column/row window so 1,700-column sheets scroll instead of refusing;
  fully drop the col cap. Its own plan (a rendering/perf concern, separable).
- **Slice 3 (follow-up) — nesting reconciliation.** Retire `factorOrderAtom`; let
  the hierarchy spine (`moveSpineAtom`) be the single nesting control, so reordering
  the spine re-picks the vertical axis. Its own plan.
- **Out of the epic entirely:** the `cov2d.report` writer emitting the spine, and
  re-typing `frame`/`t1_event_id` to `identifier` — both upstream data/writer work
  in the private database repo.

A round-trip persistence regression test (save a spine, reopen, assert intact) lands
in Slice 1 since the behaviour already exists and only needs pinning.

## Out of scope (explicit)

- **Editor ergonomics** — flexible multi-cell selection, copy/paste across surfaces,
  and removing the "create table" gate. That is project #2, a separate spec, and it
  sits on top of a grouped view that already works.
- **The `cov2d.report` writer fix + regenerating the COV2D `.iris` files** — a
  downstream change in the private database repo.
- **Any change to the reduce pipeline** — the summary view already exists via `fn` /
  `defaultPlan`; this epic only makes the raw pivot available.

## Testing

- Unit: `GroupedSpec` derivation from representative spines (deep spine with a
  classifier = `cell_size`; shallow/no-fine-id = `neighbor_enrichment`; single-level
  categorical = `t1_landscape`); availability on empty vs non-empty spine; value-set
  = columns minus spine minus classifiers.
- Round-trip: an edit to a body cell hits the correct tidy row after a re-nest.
- Persistence: `{spine, fn}` survives an `.iris` save/reload.
- E2E: open a spine-carrying table, flip to grouped, edit a cell, flip back, confirm
  the tidy value changed; confirm an empty-spine table reports the view unavailable.
