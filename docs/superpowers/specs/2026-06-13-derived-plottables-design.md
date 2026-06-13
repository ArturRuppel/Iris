# Master Table → Derived Plottables — Design Spec

Date: 2026-06-13

## Why

Triad today is a single reactive triad: one global typed table
(`schemaAtom`/`rowsAtom`) → one derived `specAtom` → one figure + one stats
result. Real analysis is rarely one figure per dataset. A user types or imports
one big table and wants several figures off it: a subset here, the same
measurement collapsed to the biological-replicate level there, a different
grouping somewhere else — each with its own plot and statistics.

This unit introduces that layer: **one master table as the source of truth, and
many derived "plottables", each a saved *reduction* (filter + collapse) of the
master that recomputes live, carrying its own figure and stats.** It is the
pattern proven in `CellFlow`'s aggregate quantifier (`pool → aggregate(df,
spec)` with `filter`, `group_by`, `level`, `stat`), brought into Triad as a
declarative spec clause.

Crucially, this is *not* the Tier 4 "multi-table documents with joins" the
roadmap defers — there is still exactly one master table. Derived tables are
reproducible *views* of it, not independent stores.

## Decisions (locked, from brainstorming)

1. **Live computed views.** The master table is the single source of truth. A
   plottable is a saved reduction definition; the engine recomputes the derived
   table from the master on demand. Editing the master re-flows every plottable.
   Derived tables are read-only results you inspect, never hand-edit. (Rejected:
   materialized editable snapshots, and a hybrid freeze mode — both break the
   master→derived link and weaken provenance.)
2. **Reduction vocabulary = filter + collapse.** Filter rows by column
   conditions; collapse by group-by + per-column aggregate (mean/median/count/
   sum/sem). No derived/computed columns in v1 (clean follow-on).
3. **Reduction lives in the spec, executed engine-side.** A new declarative
   `reduce` clause on `AnalysisSpec`; the engine applies it in pandas before the
   existing analyze pipeline runs. (Rejected: reducing in the frontend, or a
   separate `/reduce` endpoint — both split the keystone "spec compiles to plot
   and test" contract.)
4. **A plottable is exactly one tidy table.** Collapse fully replaces the table
   (one row per group). No two-level/superplot display in v1 — it would force a
   plottable to carry two tables and add a raw-overlay layer; clean follow-on.
5. **Two-mode workspace.** A *Data* mode is the maximized master-table editor; an
   *Analyses* mode shows the selected plottable's triad. A sidebar lists
   plottables; a top toggle switches modes.
6. **Collapsible triad sections.** In Analyses mode each of the three triad
   sections — reduced-table, figure, stats — is independently collapsible, so the
   user can focus any one. The Reduce controls live in the table section's header
   (they define what the table is).

## Architecture

```
MASTER TABLE  (schemaAtom / rowsAtom — one typed table, the .viz CSV)
      │   respect_exclusions removes excluded rows first
      ▼
  reduce clause  (per plottable, declarative, in the spec)
      ├─ filter:  row conditions (AND-ed)
      └─ collapse: group_by + aggregate     → REDUCED TIDY TABLE
                                                 │
                  existing pipeline, unchanged:  ▼
                  mappings → layers → compiler → FIGURE (svg)
                                    → stats/recommendation → STATS
```

One master table, N plottables. Each plottable owns what is today global:
mappings, plot type, test override, style, **and its `reduce` clause**. The
existing single triad is simply "the first plottable with an empty reduce".

## 1. Spec schema (1.1 → 1.2, additive)

`src/types.ts` — new optional clause on `AnalysisSpec`; bump `spec_version` to
`"1.2"`.

```ts
export type FilterOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in";
export interface FilterCond {
  column: string;
  op: FilterOp;
  value: string | number | (string | number)[];   // array for in / not-in
}
export type AggFn = "mean" | "median" | "count" | "sum" | "sem";
export interface CollapseSpec {
  group_by: string[];                 // columns defining a group
  aggregate: Record<string, AggFn>;   // numeric column -> fn; default "mean"
}
export interface ReduceSpec {
  filter: FilterCond[];               // AND-ed; [] = no filter
  collapse: CollapseSpec | null;      // null = no collapse
}
```

`AnalysisSpec` gains `reduce?: ReduceSpec`. Semantics:

- **Absent / `{ filter: [], collapse: null }` = today's behavior exactly** — the
  whole (exclusion-respecting) master table.
- `respect_exclusions` applies **before** reduction: excluded rows never enter a
  filter match or a group.
- Filter conditions are AND-ed. `in` / `not-in` take an array `value`.
- Collapse: rows are grouped by `group_by`; each numeric column listed in
  `aggregate` is reduced by its fn (default `mean` for unlisted numerics);
  group-by columns pass through; other columns are dropped. `count` yields the
  group size (same for every aggregated column → one `count` column suffices, see
  §2).

Existing `data.filter: unknown[]` (declared but unused) is **superseded** by
`reduce.filter`. The migration (below) leaves `data.filter` in place but the
engine ignores it; new specs write `[]`.

## 2. Engine flow (`engine/triad_engine/`)

A new headless module `reduce.py`, quantity-agnostic and pandas-only:

```python
def apply_reduction(df: pd.DataFrame, schema: Schema, reduce: ReduceSpec | None,
                    ) -> tuple[pd.DataFrame, Schema]:
    """Filter rows, then optionally group_by + aggregate. Returns the reduced
    frame and a fresh typed schema. Exclusions are assumed already removed by the
    caller. Empty/None reduce returns the frame and schema unchanged."""
```

- **Filter**: build a boolean mask from the AND-ed conditions; numeric/categorical
  comparisons honor the column type; unknown column or unparsable value → a
  `400`-style engine error with a clear message (never a silent empty plot).
- **Collapse**: `df.groupby(group_by, observed=True).agg(...)`. `sem` →
  `scipy.stats.sem` (or `std/sqrt(n)`), `count` → group size. Aggregated columns
  stay numeric; group-by columns keep their declared type/levels. A single
  `n` (count) column is added when any aggregate is `count`, rather than one per
  column.
- **Schema**: derive a new `Schema` for the reduced frame so downstream mappings,
  the recommendation tree, and the figure see correct types/labels. Aggregated
  numeric columns keep their source `label`/`unit`; group-by categoricals keep
  `levels`.

`compiler`/`main.py` `analyze(table, spec)` gains a pre-step:

```python
df0 = drop_excluded(df, spec.data.respect_exclusions)
reduced_df, reduced_schema = apply_reduction(df0, schema, spec.reduce)
# everything below is UNCHANGED, just runs on reduced_df / reduced_schema
```

`AnalyzeResponse` gains `reduced_table: Table` (the reduced rows + schema) so the
UI can render the derived table the figure and stats were computed from. The
stats are honest by construction: after a collapse, `n` = number of groups and
the recommendation tree sees exactly that.

`/export` and `/document/save` take the same path — export reduces before
rendering; a saved document stores the master table once and the reduce clause
per analysis, so re-opening recomputes identically.

## 3. Frontend state (`src/state.ts`)

Today's per-analysis atoms (`mappingsAtom`, `plotTypeAtom`, `overrideAtom`,
`styleAtom`) move **into a plottable record**; the master table atoms
(`schemaAtom`, `rowsAtom`, `exclusionLogAtom`) stay global.

```ts
export interface Plottable {
  id: string;
  name: string;                       // user-editable, shown in the sidebar
  mappings: { x: string; y: string };
  plotType: PlotType;
  override: TestName | null;
  style: StyleOverrides;
  reduce: ReduceSpec;                 // { filter: [], collapse: null } by default
}
export const plottablesAtom = atom<Plottable[]>([]);     // >=1 after a table loads
export const activePlottableIdAtom = atom<string | null>(null);
export const viewModeAtom = atom<"data" | "analyses">("data");
```

- `specAtom` becomes a derived atom over the **active** plottable (same builder as
  today, reading the plottable's fields instead of the globals, and emitting the
  `reduce` clause and `spec_version: "1.2"`).
- `analysisAtom` keys results per plottable (a `Record<id, AnalyzeResponse>` or
  one fetch per active plottable) so switching is instant and re-fetches only on
  edit.
- `loadTableAtom` resets to a single default plottable with empty `reduce` (the
  existing default-mapping logic moves into a `makeDefaultPlottable(schema)`
  helper). The style carry-over rule (drop title/labels/offsets) is per-plottable.
- Plottable CRUD atoms: add (clone defaults), duplicate (deep-clone, new id +
  name), rename, delete (keep ≥1; deleting the active selects a neighbor).

## 4. UI (`src/App.tsx`, `src/components/`)

A top-level mode toggle (**Data** | **Analyses**).

- **Data mode** — the master-table editor maximized: the existing AG Grid
  `DataTable` at full width with its import / data-entry / edit / exclusion
  affordances. This is the "big table editor" of the request. No figure/stats
  compete for width here.
- **Analyses mode** — a left **sidebar** listing plottables (add · duplicate ·
  rename · delete; the active one highlighted) + the active plottable's triad as
  three **independently collapsible** sections:
  1. **Reduced table** — the `reduced_table` from `AnalyzeResponse`, read-only.
     Its header hosts the **Reduce** controls:
     - *Filter*: a small condition builder (column · op · value rows, add/remove),
       writing `reduce.filter`.
     - *Collapse*: a group-by multiselect + per-numeric-column aggregate pickers,
       writing `reduce.collapse` (a "no collapse" default).
  2. **Figure** — the existing `FigurePane` (svg, drag labels, style panel).
  3. **Stats** — the existing `StatsPanel`.
  Each section has a collapse chevron; collapsing one gives the others the room.

The style panel, exclusion flow, and figure interactivity are unchanged — they
now operate on the active plottable.

## 5. Document format (`.viz`)

`saveDocument(table, analyses[], provenance)` already stores a single master CSV
+ an `analyses[]` array — the plurality has always been there, unused. Each
plottable serializes as one `AnalysisSpec` entry (now carrying `reduce` and
`name`). Load maps `analyses[]` back to `plottablesAtom`. **No structural change
to the archive**; only the per-analysis spec grows the `reduce` clause, and a
plottable `name`/`id` ride in the spec (`title` already exists; add `name`
alongside, or reuse `title` as the sidebar label — decided in implementation,
default: reuse `title`).

Migration: a loader shim stamps any `spec_version` `"1.0"`/`"1.1"` analysis with
`reduce: { filter: [], collapse: null }` and bumps to `"1.2"` — additive, lossless.

## 6. Test plan

Engine (headless, pytest):
- `apply_reduction` filter: each op (`==`,`in`,`>`, …) selects the right rows;
  unknown column / unparsable value raises a clear error; AND-ing two conditions
  intersects.
- `apply_reduction` collapse: group means/medians/sums match a hand calc; `count`
  reproduces n-per-group; `sem` matches `scipy.stats.sem`; group-by columns keep
  type/levels; reduced schema types are correct.
- Exclusions removed before reduction (an excluded row changes neither a filter
  match nor a group mean).
- End-to-end `analyze`: a collapsed plottable's stats report `n` = number of
  groups; the figure renders one mark per group; `reduced_table` is returned and
  matches `apply_reduction`.
- Migration: a 1.1 spec loads, gains an empty `reduce`, and analyzes identically
  to pre-change.

Frontend (vitest / Playwright `e2e/`):
- Plottable CRUD: add/duplicate/rename/delete; ≥1 always preserved; deleting the
  active selects a neighbor.
- Switching active plottable swaps the derived spec and the shown triad.
- Mode toggle: Data shows the maximized table; Analyses shows sidebar + triad;
  each triad section collapses independently.
- A `.viz` document with two plottables (one filtered, one collapsed) round-trips
  and recomputes identical figures/stats.

Run: engine `pytest` suite; frontend `tsc` + existing Playwright e2e.

## 7. Implementation order

1. **Spec types + migration** (`types.ts`): `ReduceSpec` and friends, `1.2` bump,
   loader shim. No behavior change yet (empty reduce everywhere).
2. **Engine `reduce.py`** + wire `apply_reduction` into `analyze`/`export`/`save`;
   add `reduced_table` to `AnalyzeResponse`. Engine tests.
3. **Frontend state**: `Plottable`, `plottablesAtom`, active/mode atoms; refactor
   `specAtom` and `loadTableAtom`; CRUD atoms. Keep the UI single-plottable to
   land this safely.
4. **UI**: mode toggle; Data mode (maximized table); Analyses mode (sidebar +
   three collapsible sections); the Reduce panel (filter builder + collapse
   pickers). Frontend e2e.
5. **Document**: serialize/deserialize plottables through `analyses[]`; round-trip
   test. Update ROADMAP.

## Out of scope / follow-ons

- **Derived/computed columns** (ratios, log, normalize-to-control) — a new
  `transform` clause; the roadmap already names the seam.
- **Superplots / two-level display** — a collapsed plottable keeping both raw and
  reduced tables + a raw-overlay layer in the compiler.
- **Cross-plottable / cross-table joins**, **multiple master tables** — explicitly
  the Tier 4 deferral; unchanged by this unit.
- **Saved filter/collapse presets** reusable across plottables.
- **Per-plottable export bundle** (all figures + a combined methods/stats table).
