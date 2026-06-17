# Time-series support — design

**Date:** 2026-06-17
**Status:** approved, ready for implementation plan

## Problem

Iris has no way to draw a measure over time. The default sample,
`cells_by_frame.csv`, is inherently a time series — each cell tracked across
`frame`, nested `date → position_id → cell_id → frame` and split by
`condition` — yet the geom registry has no geom that connects points across an
ordered x. Users need three shapes, flexibly and layerable:

- **Per-unit trajectories** ("spaghetti"): one thin, light curve per cell.
- **Mean-over-units per timepoint**: at each frame, average across cells within
  a condition; draw a center line + spread band.
- **A single series over time**: one value per timepoint, just connect the dots.

A time series is, formally, an x-vs-y plot where x is ordered and (usually)
equally spaced. In Iris's type system the time axis is a **numeric** column
(`frame`), so time series collides with the existing numeric-x/numeric-y case,
which today always means `correlation` (scatter/regression). The chosen geom
must break that tie.

## The aggregation tension (and why it dissolves)

The data hierarchy (`hierarchy.py`) aggregates by picking a **grain level**,
which is always a *prefix* of the spine (coarse → fine). A time-series mean line
needs to **keep `frame` (the finest level) while collapsing `cell_id` (a coarser
level)** — group by `(condition, frame)`, average over cells. That is *not* a
prefix, so the prefix-grain model cannot express it directly.

It dissolves because the aggregating geom does the grouping **internally**,
exactly as `summary` already computes mean ± error per category — only with
numeric x and the points connected. Operating on RAW rows, grouping by
`(x_value, split)` averages across units at each timepoint without touching the
hierarchy. The hierarchy is needed only to identify *per-unit trajectories*
(below).

## Approach (chosen: A)

Two new geoms mirroring the existing `dot` + `summary` pairing — the only
approach where the per-unit and aggregate cases stay cleanly separated (the
engine branches on `aggregates`), and the layered spaghetti+mean figure falls
out of stacking layers rather than a mode switch.

Rejected:
- **B — one `timeseries` geom with a render-mode param.** Bakes the
  `aggregates=True/False` distinction inside one geom (the flag the engine keys
  on for grain/stats), and prevents independently styling the two layers.
- **C — generalize `summary`/`scatter` with a "connect" param.** Overloads geoms
  whose identity is "unconnected"; the spaghetti case still has no clean home.

## Design

### 1. Two geoms (`geoms.py`)

New family label `"timeseries"`. Both are numeric-x/numeric-y, so they are
offered automatically wherever `scatter`/`regression` are (type-driven; no
offer-logic change).

```python
"line": GeomDef(
    "Trajectories", "timeseries", aggregates=False, needs=["x", "y"],
    x_type="numeric", y_type="numeric",
    params={"alpha": 0.35, "linewidth": 0.8},
    param_specs=[_num("alpha", "Opacity", lo=0.05, hi=1.0, step=0.05),
                 _num("linewidth", "Line width", lo=0.3, hi=3.0, step=0.1)],
    point_cap=POINT_CAP, aes=["color"]),

"trend": GeomDef(
    "Mean ± band", "timeseries", aggregates=True, needs=["x", "y"],
    x_type="numeric", y_type="numeric",
    params={"error_type": "ci95", "show_band": True},
    param_specs=[_err_select(), _bool("show_band", "Spread band")],
    aes=["color"]),
```

- `line` carries `aes=["color"]` only — color picks *how lines look* (per
  condition), never *which rows form a line* (that's the spine, §2).
- `trend` reuses `_err_select` (ci95/sem/sd) plus a band on/off toggle.
- The layered figure = a `line` layer under a `trend` layer.

### 2. Trajectory derivation (`hierarchy.py`)

For `line`, "which rows form one curve" comes from the spine, not an aesthetic.
New helper:

> **`trajectory_units(df, spine, x_col, split_cols)`** → grouping keys, one per
> line. Unit = the spine columns **coarser than `x_col`'s home level**, plus any
> `split_cols` (color). Default spine `date → position_id → cell_id → frame` with
> `x=frame` ⇒ **one line per `(date, position_id, cell_id)`**, drawn in `frame`
> order. If `x` is off-spine, or there is no spine, the whole (reduced, split)
> frame is **one curve** — the "single series over time" case, for free.

Each curve is sorted by `x` ascending before drawing; missing x leaves a break.
`trend` ignores this entirely — it groups raw rows by `(x_value, *split_cols)`.

**Consequence:** `line` curves are **not** click-to-exclude targets (no per-row
`<use>`/`gid` nodes, like `box`/`violin`). Exclusion stays on the table or a
`dot` layer.

### 3. Rendering (`compiler.py`)

`build_figure` dispatch (`compiler.py:495`) gains:

```python
if family == "timeseries":
    return build_timeseries_figure(df, schema, spec, stats, level_tables)
```

`build_timeseries_figure` is modeled on `build_scatter_figure`: numeric x/y axes
(`_apply_axes(x_numeric=True)`), faceting via `_build_grid`, legend via
`_draw_legend`. Per-layer:

- **`_geom_line`** — group RAW rows by `trajectory_units(...)`; per unit, sort by
  x and `ax.plot(xs, ys, color=group_color, lw=linewidth, alpha=alpha)`. One
  color per `color` level (legend shows conditions, not units). No `gid` tags →
  returns an empty point-group.
- **`_geom_trend`** — per `color` level, group rows by x value, compute per-x
  mean and half-spread (reuse `_err_half` with `error_type`); `ax.plot` the mean
  line and, when `show_band`, `ax.fill_between(xs, mean-err, mean+err,
  alpha=0.2, color=...)`. Band drawn first so the line sits on top.

`POINT_CAP` on `line` blocks via the existing guard pass (`guards.py`), same as
`dot`/`scatter`.

### 4. Wiring

1. **Family inference (`statmodel.py`).** `infer()` resolves the
   numeric/numeric tie by the chosen geom. Pass the layers in; if any layer's
   geom has registry `family == "timeseries"`, set `family="timeseries"`,
   `test=None`, `chosen_by="describe_only"`, `design = f"{y} over {x}"`.
   Otherwise numeric/numeric still falls through to `correlation`. This makes the
   **geom's declared family authoritative when column types are ambiguous** —
   time series is the first case where geom-family and type-inferred family
   diverge.

2. **Grain.** `line`/`trend` bind to `RAW` (`hierarchy.RAW`): `trend` aggregates
   across units internally by x; `line` needs raw per-(unit, frame) rows.
   `coarsest_level` already returns `RAW` for layers not on a coarser spine
   level, and there is no inferential test to grain-match — no special case.

3. **Frontend.** The rail reads `registry_payload()` (`geoms.py:148`), so
   `line`/`trend` and their `param_specs` surface automatically; `channels.ts`
   offers them on numeric/numeric like scatter (no change). Only touch: the stats
   panel renders the `timeseries` family's describe-only message (it already
   handles `null` tests for `descriptive`/faceted — likely just a family label).

## Scope / non-goals (YAGNI)

- **Descriptive only.** No inferential test in the first cut. Comparing time
  courses properly needs mixed-effects / functional-data methods that don't fit
  the two-question picker; per-curve summary statistics (AUC, slope,
  time-to-peak) → group comparison is the natural follow-up.
- **Numeric x only.** Ordered-categorical and dedicated temporal/date types are
  deferred; the time axis is whatever numeric column is mapped to x, connected in
  sorted order. Equal spacing is not assumed — points plot at their actual x.
- **No interpolation of missing timepoints** — gaps render as breaks.

## Affected files

- `engine/iris_engine/geoms.py` — two `GeomDef`s, `timeseries` family.
- `engine/iris_engine/hierarchy.py` — `trajectory_units` helper.
- `engine/iris_engine/compiler.py` — `build_timeseries_figure`, `_geom_line`,
  `_geom_trend`, dispatch branch.
- `engine/iris_engine/statmodel.py` — geom-aware tie-break in `infer()`.
- `engine/iris_engine/guards.py` — confirm `line` honors `POINT_CAP` (likely
  automatic via the registry).
- Frontend stats panel — `timeseries` describe-only label.
- Tests: `engine/tests/test_geoms.py`, `test_compiler`/new, `test_statmodel.py`,
  plus an e2e (`e2e/timeseries_test.mjs`).
