# Grouped sheet — a spreadsheet lens for entering and editing tidy data (epic)

**Status:** design, awaiting review
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

| | **Entry** (`DataEntry` modal, exists) | **Lens** (this epic) |
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

Only `edit_cell` and `set_schema` exist today (`session.py:56,64`). Everything structural
is **new engine surface**, following the same pattern: the session owns the DataFrame, the
op mutates it and bumps `version`, the client refetches. The lossy ones (`delete_rows`,
collision-merging `relabel_category`, `drop_column`) must return enough for the UI to state
the consequence before or as it happens.

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

- **Slice 0 — the entry-modal rework (done, uncommitted).** Merged-header data model
  (laminar, arbitrary depth via grouping rows) + select-then-act UX (click to select,
  toolbar Merge / Unmerge / Delete columns). Formalize, add the selection CSS, and land it.
  *This is the shared renderer everything else reuses.* — verified: typecheck + build clean,
  header math exercised; **not yet driven in-app**.
- **Slice 1 — read-only grouped projection behind a Data-view toggle.** Add a
  representation toggle inside the `data-mode` panel (next to `DataTable`): **Table** vs
  **Grouped sheet**. Implement long→wide over `rowsWindow(0, n)`, the pivotability
  predicate, and size gating. No write-back. Proves the pivot and the gates with zero risk.
- **Slice 2 — value-cell editing.** Wire grouped value cells to `engine.editCell` (map
  cell → tidy row id + value field). Rides existing rails; delivers "fix a mistyped value
  in the shape I think in." Renaming a *leaf/group label* deferred to Slice 4.
- **Slice 3 — re-nest / reorder factors.** Let the user choose which categorical column is
  outer vs. inner (drives the header bands). Pure view respec — no engine change, no data
  write. Cheap, high-value for reading the data different ways.
- **Slice 4 — structural edits (new engine ops).** The Rust/Python work:
  `relabel_category` (with collision surfacing), `add_rows`, `delete_rows` (with row-count
  surfacing), `add_column` / `drop_column`. Wire the grouped sheet's add/delete/rename
  affordances to them. Land op-by-op, each with the honesty surfacing from the ledger.
- **Slice 5 — unify entry into the lens (optional).** Treat an empty grouped sheet as an
  uncommitted table: typing/pasting into the lens with no table loaded creates the engine
  session on first commit, collapsing the `DataEntry` modal and the lens into one surface.
  Only worth doing if Slices 1–4 prove the shared renderer carries both roles cleanly.

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
  `relabel_category` reports the merge; `add_rows` appends blanks addressable by the new
  combination; all bump the version and recompute downstream.
- **Honesty:** no path in the lens mutates the table except through an engine op + version
  bump (no client-only table state).
