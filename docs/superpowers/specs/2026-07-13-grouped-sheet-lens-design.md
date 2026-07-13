# Grouped sheet — a spreadsheet lens for entering and editing tidy data (epic)

**Status:** landed — all slices (0–5) shipped 2026-07-13
**Date:** 2026-07-13
**Builds on:** the `DataEntry` merged-header rework landed this session (working tree,
uncommitted) — `src/components/DataEntry.tsx`. Extends its wide grouped grid from a
one-shot entry modal into a persistent, editable *view* of the live table.
**Related guide pages:** `docs/guide/data-in.md`, `docs/guide/nesting.md`,
`docs/guide/reshaping.md`, `docs/guide/shape.md`.

## Problem

The people Iris is for — researchers who keep their data in Excel or Prism — think in
**wide grouped sheets**: repeating condition columns under merged group bands, one value
per cell, replicates running down the rows. Iris stores **tidy long** tables (correctly:
scipy/statsmodels/pingouin want tidy, and the plot↔test honesty model depends on it).

Today those two worlds meet in exactly one place and in one direction: the `DataEntry`
modal lets a user build a wide grouped sheet and, on **Create**, melts it to a tidy table
(`pivot_longer`) which is then loaded as the graph's root. After that, the wide shape is
gone. To *see or fix* their data, the user faces the tidy long table in `DataTable`
(ag-grid) — the representation they came to Iris to avoid. A Prism refugee who wants to
correct a mistyped value, add a replicate, or rename a condition has to do it in a form
that doesn't match how they think about the experiment.

This epic closes the loop: make the wide grouped sheet a **first-class, editable view of
the live table**, available alongside the tidy table view, so entry and editing happen in
the shape the user already holds in their head.

## The decision that shapes everything: lens, not format

The tidy table stays the single source of truth. The grouped sheet is a **projection** of
it, not an alternative stored form. This is not a preference; the architecture forces it:

- The table is **server-owned**. The browser never holds the rows — `DataTable` is an
  ag-grid *infinite* view that pulls windows via `engine.rowsWindow(id, start, end)`; the
  client holds only a `TableHandle = {id, n, version, schema, counts}` (`types.ts:22`).
- The tidy table is the **root node of the workbench graph**. Every `Plottable` binds to
  its `tableId`; the reactive figure/stats loop keys on `handle.id + handle.version`.
- Edits are already **op-based and server-authoritative**: a cell edit is
  `engine.editCell` → bump handle `version` → refetch the affected window and re-run
  downstream compute (`DataTable.tsx:88`, `state.ts:575`).

Making the grouped sheet a stored form would mean re-rooting the graph, re-plumbing every
downstream analysis, and maintaining two canonical shapes that can disagree — the exact
failure the tidy mandate exists to prevent. So: **tidy is canonical; the grouped sheet
reads from it and writes back to it through engine ops.**

## Two faces, one renderer

The wide grouped grid serves two jobs that look identical on screen but differ underneath:

| | **Entry** (`DataEntry`, inline — Slice 5) | **Lens** (this epic) |
|---|---|---|
| Data behind it | none yet — being typed/pasted | a live, server-owned tidy table |
| Header semantics | **free-form merge**: merging cells *defines* factors that don't exist yet | **factor nesting**: pick and order factor columns that *already exist* |
| Illegal-merge machinery | needed (a crossing merge is meaningless) | **not needed** — nesting real factor columns is always laminar |
| Commit | melt → load a new table | continuous write-back via ops |

They share the **grid renderer** (merged-header `<table>`, editable cells, selection
model) but not the header *interaction*. Do not force the free-form-merge model onto the
lens: over an existing table, "which factor is outer vs. inner" is a choice among existing
columns, and re-nesting is a pure view change with no data write.

## Model

### Pivot spec

A grouped-sheet rendering of a tidy table is fixed by:

- **value column** — the one numeric column whose cells fill the grid body;
- **header factors** — an ordered list of categorical columns, outer→inner, that become
  the merged header bands and the leaf column headers;
- **row identity** — what a grid row means. Tidy replicates are usually unlabelled, so
  rows are **positional**: the k-th value within each (factor-combination) column. Ragged
  groups (unequal n) leave blank tails, which melt away — the existing entry model already
  treats rows this way.

Much of the spec is already declared: `HierarchyPanel` assigns column roles
(identifier / categorical / numeric), which names the factors and (by elimination) the
value column. The default spec can be inferred; the user can override ordering.

### Pivotability predicate

The lens is **available** for a table iff it has a clean grouped rendering:

- exactly one **value** column (numeric, non-identifier), and
- the remaining non-identifier columns are **categorical factors**, and
- (soft) the factor combinations tile without collision — each (combination, replicate)
  addresses at most one row.

Tables with two value columns, a continuous covariate, or an id column that isn't a pure
replicate index have **no unique** wide rendering. For those the toggle is
disabled-with-reason ("this view needs a single value column and categorical groups") —
the same integrity-via-guidance pattern used across Iris.

### Size gating

The grouped sheet is inherently whole-table (you see every group and replicate at once),
so it **materializes** the table via `rowsWindow(0, n)`. That is fine at the sizes this
audience works at (tens to low hundreds of rows) and pointless past a threshold. Above it,
disable with reason and keep the user in the infinite `DataTable`. The tidy view remains
the only representation that scales.

### Bidirectional pivot

- **long → wide** (new; the render path): group the materialized rows by the ordered
  factor combination → columns; order values within each column by replicate → rows;
  ragged tails blank. Pure client-side; no engine change.
- **wide → long** (exists; the entry melt): `pivot_longer` via the import pipeline,
  unchanged.

### Edits as engine ops — the honesty ledger

Every edit in the lens is an operation on the canonical tidy table. Grouped by cost and by
how lossy they are (lossy moves must be **surfaced**, never silent):

| Grouped-sheet action | Tidy-table effect | Engine op | Lossy? |
|---|---|---|---|
| edit a value cell | set one row's value | `edit_cell` (exists) | no |
| re-nest / reorder factors | none — view respec | none | no |
| rename a leaf column header | rename a factor *value* to itself elsewhere? no — renames the leaf **category label** across its rows | new `relabel_category` | **only if it collides** with a sibling → merges two levels; must warn |
| rename a group band | relabel a coarser factor's category across rows | new `relabel_category` | same collision caveat |
| add a column | append rows for a new factor combination, blank values | new `add_rows` | no |
| delete columns | **delete every row** in that factor combination | new `delete_rows` | **yes** — it drops data; must read as dropping N rows |
| add / delete a grouping row (band) | add / drop a **factor column** | new `add_column` / `drop_column` (+ `set_schema`) | delete drops a factor; must be explicit |

`edit_cell`, `set_schema`, `relabel_category`, `delete_rows`, `add_level`, and `drop_column`
exist today (the four structural ops added across Slice 4a–4d); only `add_column` (add a
whole *new* factor to the design) remains new surface. All
follow the same pattern: the session owns the DataFrame, the op mutates it and bumps
`version`, the client refetches. The lossy ones (`delete_rows`, collision-merging
`relabel_category`, `drop_column`) return enough for the UI to state the consequence before
or as it happens.

## Invariants

1. **Tidy is canonical.** The grouped sheet never becomes a stored form; it reads from and
   writes to the one server-owned tidy table.
2. **Availability is honest.** The lens is offered only when the table is genuinely
   pivotable and small enough; otherwise disabled-with-reason.
3. **Lossy edits are surfaced.** Deleting columns (= deleting rows) and relabels that merge
   categories are stated in the UI, not performed silently.
4. **The header stays laminar.** In the lens this is automatic (factor nesting); in entry
   it is enforced (the merge-legality rule already in `DataEntry`).
5. **One write path.** Edits go through engine ops and the existing version-bump
   reactivity, so downstream figures/stats recompute exactly as they do for `DataTable`
   edits. No second, divergent mutation path.

## Staging — the slices (cheap and low-risk first)

Each slice is independently shippable and never puts the canonical table at risk.

- **Slice 0 — the entry-modal rework (DONE, landed 2026-07-13).** Merged-header data
  model (laminar, arbitrary depth via grouping rows) + select-then-act UX (click to
  select, toolbar Merge / Unmerge / Delete columns). Selection CSS added
  (`.de-sel`/`.de-selcol`/`.de-sep`), dead join-handle CSS removed. *This is the shared
  visual language the lens reuses (`.de-grid`).* — verified: typecheck + full unit suite
  + production build clean; **driven in-app** via `e2e/data_entry_test.mjs` (add grouping
  row → select two cells → merge → delete a column).
- **Slice 1 — read-only grouped projection behind a Data-view toggle (DONE, landed
  2026-07-13).** `dataViewAtom` + `DataViewToggle` (in both panes' heads) switch the
  `data-mode` right pane between **Table** (`DataTable`) and **Grouped sheet**
  (`GroupedSheet`), routed by `DataView`. The pivot lives in the pure module
  `src/grouped.ts` (`pivotability` predicate + row/col size gating + `longToWide` over
  `rowsWindow(0, n)`), unit-tested in `src/grouped.test.ts` (13 cases). No write-back.
  Verified in-app via `e2e/grouped_sheet_test.mjs` (import → flip to grouped → merged
  bands + value body + toggle round-trip).
- **Slice 2 — value-cell editing (DONE, landed 2026-07-13).** Value cells backed by a
  tidy row are click-to-edit in `GroupedSheet`; a commit calls `engine.editCell` on the
  value column of the cell's `rowId` (carried by the pivot), bumps the handle, and the
  existing effect refetches + re-pivots — one write path, no client-only table state
  (invariant 5). Numeric coercion matches the tidy grid (blank/unparseable → NA). Blank
  padding cells (ragged tails, no row behind them) stay read-only: creating a row is a
  structural edit (Slice 4). Renaming a *leaf/group label* also deferred to Slice 4.
  Verified in-app (`e2e/grouped_sheet_test.mjs`): edit 1 → 42 in the grouped shape,
  confirm it re-pivots AND that the tidy table shows 42 (the edit is canonical).
- **Slice 3 — re-nest / reorder factors (DONE, landed 2026-07-13).** A "Grouping ·
  outer → inner" strip above the grid lets the user nudge each factor coarser/finer
  (◄/►); the order drives the header bands. Stored per-table in the session-only
  `factorOrderAtom` and reconciled on read (`grouped.applyFactorOrder` — self-heals
  across role changes, empty = default schema-order nesting). Pure view respec:
  `longToWide` re-pivots client-side, no engine op, no data write. Verified in-app
  (`e2e/grouped_nesting_test.mjs`): flip "group" inward → "day" becomes the outer band
  and "group" the leaf headers, shape stays 2 × 4, no engine error.
- **Slice 4 — structural edits (new engine ops).** New session ops, each honest about
  its cost. Landing op-by-op:
  - **4a/4b — `delete_rows` + `relabel_category` (DONE, landed 2026-07-13).** The two
    gestures that act directly on the existing grouped headers. `SessionTable.delete_rows`
    (by id; returns the count dropped) and `.relabel_category` (renames a level across its
    rows; returns `merged` when it collides with a sibling, and keeps schema levels in
    sync as a copy — never mutating the caller's schema); routes `/table/{id}/delete_rows`
    and `/table/{id}/relabel`; client `engine.deleteRows`/`engine.relabelCategory`; state
    `applyTableEditAtom` (syncs handle.n from the server counts on delete + schema on
    relabel, one write path). In `GroupedSheet`: hover a leaf/band header for a × that
    **confirms the exact row count before dropping** (`delete_rows`), double-click a header
    to rename it — a fresh name applies straight away, a name that collides with a sibling
    **warns it will merge the two levels before it runs** (`relabel_category`); every op
    states its outcome in a notice (invariant 3). Verified: `test_session.py` (+5 cases),
    full unit suite (493) + tsc + build clean, and `e2e/grouped_structural_test.mjs`
    (delete states 2 rows → 2×4→2×3; rename Control→Ctrl no-confirm; Ctrl→Treatment
    warns-then-merges → 4×2).
  - **4c/4d — `add_level` + `drop_column` (DONE, landed 2026-07-13).** The two gestures
    that reshape the *design* rather than a cell/row, so they live in a factor strip above
    the grid (kept apart from the in-grid cell/row/label gestures — "reshape the design" vs
    "edit these values"). The strip now shows at ≥1 factor; each factor chip carries ◄/►
    (re-nest), a **＋** (add a level) and an **✕** (drop the factor, disabled at the last
    one). `SessionTable.add_level(factor, level)` appends `depth` blank rows (depth = the
    tallest full-combination group today) for the new level across **every** combination of
    the *other* factors, so the new grouped column arrives full-height and editable — pure
    addition, no confirm; a client pre-check states a duplicate level rather than 422-ing;
    an explicit schema level list grows with it. `SessionTable.drop_column(column)` removes
    a factor column + its schema entry — lossy (its labels vanish, rows that differed only
    by it become undifferentiated replicates; **no rows are dropped, only the column**), so
    the ✕ **confirms first**; the returned schema shrinks the factor list (self-heals the
    saved nesting). Routes `/table/{id}/add_level` and `/table/{id}/drop_column`; client
    `engine.addLevel`/`engine.dropColumn`; both ride `applyTableEditAtom` (schema + counts).
    Verified: `test_session.py` (+5 cases: full-height add, cross-combination blanks, add
    rejects existing/non-factor, drop syncs schema + keeps rows, drop rejects value/unknown),
    full unit suite (493) + tsc + build clean, and `e2e/grouped_factor_test.mjs` (add
    day=D3 → 2×4→2×6 across both groups; drop day → 6×2, strip collapses to one factor, no
    error). **Deferred: `add_column`** (add a whole *new* factor). Unlike these two it has no
    honest home in the lens yet — a new factor would be a single degenerate level spanning
    everything, and the grouped sheet offers no way to *subdivide* it (its cells are numeric,
    not the factor's labels), so it'd be an un-actionable band. It waits for a real
    split-a-factor gesture (or belongs in the tidy/Data tab, where per-row factor editing
    already lives).
- **Slice 5 — unify entry into the lens (DONE, landed 2026-07-13).** The grouped-sheet
  pane, when there is no table, *is* the entry surface: `DataEntry` lost its modal chrome
  and now renders inline as `GroupedSheet`'s empty state (`.de-inline`). Typing/pasting and
  hitting **Create** melts the header hierarchy → tidy through the unchanged import pipeline
  and `loadTableAtom` mints the session; the instant a handle exists the entry surface
  unmounts and the *same pane* shows the live lens — entry → lens is one continuous surface,
  one write path (invariant 5). `DataView` routes a table-less Data tab to the grouped pane
  (nothing to tabulate yet); `DataViewToggle` forces **Grouped** on and disables **Table**
  while empty; the "+ Add data → Enter data" menu now reveals this surface (Data tab +
  grouped view) instead of opening a modal. The modal — overlay, `open`/`close`, the
  `forwardRef` handle, the hidden App mount — was deleted outright (no legacy path kept).
  The two-faces split still holds under the shared container: entry keeps its **free-form
  merge** header machinery (defining factors that don't exist yet), the lens keeps **factor
  nesting** (ordering columns that do) — Slices 1–4 proved the shared renderer (`.de-grid`)
  carries both roles. Verified: full unit suite (493) + tsc + build clean, and the rewritten
  `e2e/data_entry_test.mjs` (reveal inline surface — no `.de-modal`; the Slice-0 merge/delete
  toolbar works inline; fill values → Create mints the session and the pane flips to the live
  `.gs-grid`, shape 2 × 2, no engine error).

## Out of scope

- The grouped sheet as a **stored/canonical** format (rejected above; it stays a lens).
- Pivoting tables that aren't cleanly pivotable (multi-value, continuous covariates) — no
  guessing a wide shape that isn't there.
- A grouped view for **large** tables (the tidy `DataTable` owns scale).
- Labelled (non-positional) replicate identity — rows stay positional in v1.
- Any change to the melt / import pipeline or the tidy schema model.

## Testing

- **Pivotability predicate:** unit matrix — one-value+categorical → pivotable; two value
  columns → not; continuous covariate → not; id-that-isn't-a-replicate-index → not.
- **long→wide:** balanced factors tile exactly; ragged groups blank-pad without dropping
  values; round-trips against the entry melt (wide→long→wide is identity on shape).
- **Slice 1:** toggle disabled-with-reason on non-pivotable and oversize tables; grouped
  render matches the tidy contents for a known fixture.
- **Slice 2:** a value edit in the grouped sheet issues one `edit_cell` for the right row
  and bumps the version; the downstream figure recomputes.
- **Slice 3:** re-nesting factors changes the header/layout and issues **no** engine op.
- **Slice 4 (per op):** `delete_rows` reports the row count it will drop; a colliding
  `relabel_category` reports the merge; `add_level` appends blanks across every other-factor
  combination (a full-height new column); `drop_column` confirms first and keeps every row
  while removing the factor; all bump the version and recompute downstream.
- **Slice 5:** the inline entry surface replaces the empty grouped pane (no modal); its
  Create melts → mints the session and the *same* pane hands off to the live lens.
- **Honesty:** no path in the lens mutates the table except through an engine op + version
  bump (no client-only table state).
