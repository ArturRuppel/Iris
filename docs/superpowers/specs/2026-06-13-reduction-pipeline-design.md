# Composable Reduction Pipeline — Design Spec

Date: 2026-06-13

## Why

The derived-plottables unit (landed 2026-06-13) gave each plottable a `reduce`
clause — filter rows, then collapse to group summaries — edited through a single
flat `ReducePanel`. On real data that panel collapses under its own weight: the
sample dataset `cells_by_frame.csv` has **53 columns and ~82k rows**, so the
group-by checkbox list and the per-numeric aggregate pickers each render dozens
of controls at once. The selectors are overwhelming, and the only available
shape is the fixed *filter-then-collapse*.

This unit reworks the **interface and shape** of that reduction into a
**composable, ordered pipeline** the user builds interactively as a distinct
data-preparation step that precedes the figure and stats — without changing the
master→plottable model the previous unit established.

## Scope decisions (locked, from brainstorming)

1. **Per-plottable, unchanged ownership.** Reduction still belongs to each
   plottable (the multi-figure capability the last unit added is preserved). No
   shared base table, no second master. We are redesigning the *editor and the
   spec shape*, not where reduction lives. (Rejected: a single shared pipeline,
   and a shared-prep-plus-per-plottable-refine two-level model — both reopen the
   architecture the last unit just settled.)
2. **Reduction is an ordered, rearrangeable list of steps.** The fixed
   `{filter, collapse}` shape becomes `steps: ReduceStep[]`, applied top to
   bottom; each step transforms the output of the one above. Order matters and is
   honored (e.g. Filter → Collapse → Filter to keep groups with n>5). (Rejected:
   keeping a fixed canonical order with more named stages — less flexible, and the
   user explicitly wants free reordering.)
3. **Three step kinds in v1: `select`, `filter`, `collapse`.** `select` is the
   new column-projection ("pick only specific columns") the request named.
   `steps[]` is a tagged union kept open so `sort/limit`, `derive`, etc. can be
   added later as new kinds with no model rework. (Rejected for v1: sort/limit,
   rename/relabel, derived/computed columns — YAGNI; derive remains the deferred
   `transform` follow-on.)
4. **Editing lives in Analyses mode, as a collapsible left rail.** Not a third
   top-level mode. The pipeline editor is a panel beside the plottable sidebar
   that collapses to a thin rail to give the triad full width. The Reduced-table
   section is the live preview the user maximizes (collapsing Figure + Stats) to
   watch each step take effect. (Rejected: a third Data|Prepare|Analyses mode;
   merging the editor into the sidebar; burying it in the Reduced-table header.)
5. **A `select` step starts with zero columns.** Adding a Select begins blank and
   the user builds up the kept set deliberately — it never silently duplicates the
   full table. An empty pipeline (`steps: []`) is still the no-op full table,
   exactly today's behavior.
6. **Column pickers are prefix-grouped + searchable.** Columns nest under their
   dotted prefix (`cell_dynamics`, `cell_shape`, `nucleus_shape`,
   `shape_relational`, …) as collapsible groups with a whole-group toggle, plus a
   type-to-filter search. This is the lever that tames 50+ columns and applies to
   both the Select step and the Collapse group-by/aggregate pickers.
7. **A preview-only `/reduce` endpoint drives the live table.** It applies
   `steps[]` and returns the reduced table (capped) with no figure/stats render,
   so the preview works before any X/Y mapping is set and updates per keystroke.
   The spec still drives the real `analyze`; `/reduce` is display-only. (This is a
   narrow, preview-scoped exception to the prior unit's "no separate reduce
   endpoint" decision — it does not move reduction out of the spec.)

## Architecture

```
MASTER TABLE (schemaAtom / rowsAtom — one typed table)
      │  respect_exclusions removes excluded rows first
      ▼
  reduce.steps[]  (per plottable, ordered fold)
      step 1 ─▶ step 2 ─▶ … ─▶ REDUCED TIDY TABLE
      (select / filter / collapse, each consuming the prior step's output)
                                          │
   preview path:  POST /reduce ───────────┤────────▶ live Reduced-table view
                  (no render, capped)     │            + per-step row-count funnel
                                          ▼
   analyze path:  mappings → layers → compiler → FIGURE (svg)
                                       → stats → STATS
```

One master table, N plottables; each plottable owns `mappings`, `plotType`,
`override`, `style`, and its `reduce.steps`.

## 1. Spec schema (`src/types.ts`, `1.2 → 1.3`, additive)

```ts
export type FilterOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in";
export interface FilterCond {
  column: string;
  op: FilterOp;
  value: string | number | (string | number)[]; // array only for in / not-in
}
export type AggFn = "mean" | "median" | "count" | "sum" | "sem";

export type ReduceStep =
  | { kind: "select";   columns: string[] }                       // keep these, in order
  | { kind: "filter";   conditions: FilterCond[] }                // AND-ed
  | { kind: "collapse"; group_by: string[]; aggregate: Record<string, AggFn> };

export interface ReduceSpec { steps: ReduceStep[] }               // [] = full table
export const EMPTY_REDUCE: ReduceSpec = { steps: [] };
```

`AnalysisSpec.spec_version` becomes `"1.3"`. `AnalysisSpec.reduce` keeps its name
but its shape is now `{ steps }`.

**Migration shim** (loader): for any analysis at `1.0`/`1.1`/`1.2`, convert
`reduce` to steps —
```
steps = []
if old.reduce?.filter?.length      → steps.push({ kind: "filter",   conditions: old.reduce.filter })
if old.reduce?.collapse            → steps.push({ kind: "collapse", ...old.reduce.collapse })
```
— then stamp `spec_version: "1.3"`. Absent `reduce` → `{ steps: [] }`. Lossless;
a migrated spec analyzes identically (filter-then-collapse is just the two-step
pipeline). The unused legacy `data.filter` field is left untouched and ignored.

## 2. Engine (`engine/triad_engine/`)

`reduce.py` is reworked from a single filter+collapse pass into an ordered fold:

```python
def apply_reduction(df: pd.DataFrame, schema: Schema, steps: list[ReduceStep],
                    ) -> tuple[pd.DataFrame, Schema]:
    """Apply steps in order, threading (df, schema) through each. Exclusions are
    assumed already removed by the caller. [] returns the frame unchanged."""
```

Per step kind:
- **select** — project to `columns`, preserving the given order; deriving a fresh
  schema (subset of column defs). A column not present in the current (post-prior-
  step) schema → a clear `400`-style engine error (never a silent drop).
- **filter** — build a boolean mask from AND-ed `conditions`, honoring column
  type; unknown column / unparsable value → clear error (today's behavior).
- **collapse** — `df.groupby(group_by, observed=True).agg(...)`; `sem` →
  `scipy.stats.sem`, `count` → group size as a single `n` column; aggregated
  numerics keep label/unit, group-by categoricals keep type/levels; non-listed,
  non-group columns are dropped. (Today's collapse logic, unchanged.)

`analyze(table, spec)`, `/export`, and `/document/save` all call the same fold on
`spec.reduce.steps` before the existing pipeline. Stats stay honest by
construction: after a collapse, `n` = number of groups.

`AnalyzeResponse.reduced_table` is **removed** — the Reduced-table view now reads
the `/reduce` preview, so keeping a second copy on the analyze response would be a
redundant source of truth. (Stats/figure still compute on the reduced frame
internally; only the response field goes away.)

## 3. New `/reduce` preview endpoint (`main.py`)

```
POST /reduce  { table: Table, steps: ReduceStep[] }
  → {
      preview:   Table,            # final reduced rows, CAPPED to first 500
      n_total:   int,              # true final row count (e.g. 82242)
      trace:     [{ n_rows_out: int, schema_out: Schema }],  # one per step, in order
      summary:   [{ column: string, n: int, n_distinct: int, n_missing: int }]
    }
```

- **No matplotlib / no stats** — pandas only, fast enough for per-keystroke
  (debounced) calls.
- **Cap**: `preview` holds at most 500 rows; the UI shows "showing 500 of N".
- **`trace`** is the editor's source of truth for *what columns exist at each
  step*: a Collapse card at index `i` populates its group-by/aggregate pickers
  from `trace[i-1].schema_out` (or the master schema for `i = 0`). It also feeds
  the per-step **row-count funnel** badge (`82,242 → 4,500 → 12`).
- Exclusions are removed before step 1, same as `analyze`.

## 4. Frontend state (`src/state.ts`)

- `Plottable.reduce` type changes to `{ steps: ReduceStep[] }`;
  `makeDefaultPlottable` sets `reduce: { steps: [] }` (full table, today's
  default).
- `specAtom` emits `reduce: { steps }` and `spec_version: "1.3"`.
- New `reducePreviewAtom` keyed per plottable: a derived/async atom that POSTs the
  active plottable's `{ table, steps }` to `/reduce` (debounced, same 200 ms
  cadence as the analyze loop) and holds `{ preview, n_total, trace, summary }`.
  The analyze loop is unchanged and independent.
- Step CRUD helpers operating on the active plottable's `steps`: add (by kind,
  appended — Select appended with `columns: []`), remove, **reorder** (move
  up/down or drag index swap), and per-step field setters (reuse current filter
  and collapse edit logic, now scoped to one step).
- Loader migration shim (§1) runs in the `.viz` open path mapping `analyses[]` →
  `plottablesAtom`.

## 5. UI (`src/App.tsx`, `src/components/`)

Data mode is unchanged (maximized master `DataTable`). Analyses mode layout:

```
[ Plottable sidebar | ◧ Pipeline rail | Triad: ▾ Reduced table  ▾ Figure  ▾ Stats ]
```

- **Pipeline rail** — new collapsible left panel (collapses to a thin rail with an
  expand handle, IDE-tree style, to hand the triad full width). Contains the
  ordered **step cards** and an `+ Add step ▸ Select | Filter | Collapse` control.
  Each card: a drag/reorder handle, expand/collapse, remove (✕), and a live
  **"rows in → out"** badge from the `/reduce` trace.
  - **`StepSelect`** — prefix-grouped, searchable column checklist (collapsible
    groups + whole-group toggle + search box); **starts empty**; writes
    `columns` in pick order.
  - **`StepFilter`** — today's `column · op · value` condition rows, AND-ed,
    add/remove; column list from the step's input schema (`trace`).
  - **`StepCollapse`** — prefix-grouped group-by multiselect + per-remaining-
    numeric aggregate pickers, both from the step's input schema.
- **Reduced table** section (`ReducedTable`, reworked) — renders the `/reduce`
  `preview` live as steps change, with the "showing 500 of N" note. This is the
  view the user maximizes (collapse Figure + Stats) to inspect prep effects.
- `FigurePane` and `StatsPanel` are untouched; they read the active plottable via
  the unchanged `analyze` loop.
- The old flat `ReducePanel` is **removed**, replaced by the rail + step cards.

New components: `PipelineRail`, `StepSelect`, `StepFilter`, `StepCollapse`, and a
shared `ColumnPicker` (prefix-grouping + search) used by all three. Reused:
`ReducedTable` (now preview-driven), `PlottableSidebar`.

## 6. Document format (`.viz`)

No structural change. Each plottable serializes its `AnalysisSpec` as today, now
carrying `reduce.steps` and `spec_version: "1.3"`. Open path runs the migration
shim. Round-trip is lossless.

## 7. Test plan

Engine (pytest):
- `apply_reduction` ordered fold: `select` keeps/orders the right columns and
  drops the rest; `filter` masks correctly; `collapse` group stats match a hand
  calc; **Filter → Collapse → Filter** (keep groups with n>5) yields the right
  rows; a `select` then a step referencing a dropped column raises a clear error.
- Exclusions removed before step 1 (an excluded row changes neither a filter
  match nor a group mean).
- `/reduce`: returns `preview` capped at 500 with correct `n_total`; `trace` has
  one entry per step with correct `n_rows_out` and `schema_out`; `summary`
  counts are right; empty `steps` returns the full (capped) table.
- Migration: a `1.2` `{filter, collapse}` spec loads, becomes a two-step
  pipeline, and `analyze` is byte-identical to pre-change.

Frontend (vitest / Playwright `e2e/`):
- Step CRUD: add each kind; remove; **reorder** changes the preview; ≥0 steps
  fine (empty = full table).
- `StepSelect` starts empty; prefix group toggle selects a whole family; search
  filters; picked columns drive the preview columns.
- `/reduce` preview updates on edit; row-count funnel badges reflect `trace`;
  "showing 500 of N" appears on large results.
- Pipeline rail collapses/expands; Reduced-table maximizes with Figure + Stats
  collapsed.
- A two-plottable `.viz` (one with a select+filter pipeline, one with a collapse)
  round-trips and recomputes identical figures/stats.

Run: engine `pytest`; frontend `tsc` + Playwright e2e.

## 8. Implementation order

1. **Spec types + migration** (`types.ts`): `ReduceStep` union, `ReduceSpec.steps`,
   `1.3` bump, loader shim. Map old reduce → steps. No behavior change.
2. **Engine** (`reduce.py`): rewrite `apply_reduction` as an ordered fold over
   step kinds; wire into `analyze`/`export`/`save`; add the `/reduce` endpoint;
   remove `reduced_table` from `AnalyzeResponse`. Engine tests.
3. **Frontend state** (`state.ts`): `reduce.steps` shape; `reducePreviewAtom`;
   step CRUD + reorder helpers; `makeDefaultPlottable`. Keep UI minimal to land
   safely.
4. **UI**: `ColumnPicker` (prefix + search); `StepSelect`/`StepFilter`/
   `StepCollapse`; `PipelineRail` (collapsible, reorder, add-step); rework
   `ReducedTable` to read the preview; remove `ReducePanel`; wire into Analyses
   layout. Frontend e2e.
5. **Document**: confirm serialize/deserialize of `steps` through `analyses[]`;
   round-trip test. Update `ROADMAP.md`.

## Out of scope / follow-ons

- **Sort & limit (top-N / N-per-group)** — a clean new `ReduceStep` kind.
- **Derived/computed columns** (ratio, log, normalize-to-control) — the deferred
  `transform`/`derive` step kind.
- **Rename / relabel mid-pipeline.**
- **Saved pipeline presets** reusable across plottables.
- **Two-level / shared base reduction** across plottables — explicitly rejected
  here; revisit only if a real need appears.
