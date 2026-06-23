# COV2D absorption — Tier A: the shape & motility SuperPlots

*Status: draft, 23 June 2026. The first concrete target for pulling the COV2D
report's pandas prep inside Iris's transformation graph
(`2026-06-23-transformation-explorer-design.md`). Tier A is the §1–§2 cell &
nucleus shape/motility SuperPlots — the cleanest absorption, because almost all
of their prep is the **default** nested-median flatten chain Iris already
proposes, and the stat (paired two-group + Hedges g) already exists. What Tier A
must add is the minimal first form of three named-deferred nodes — `derive`,
`recode`, `join` — proven end-to-end against the notebook's own numbers. The
full COV2D target map (Tiers A–D) lives in the Iris `TODO.md`.*

## Why this section first

§1–§2 produce a family of SuperPlots — cell/nucleus **size**, **shape factor**,
**speed**, and the MSD persistence exponent — each a violin of per-cell points
with per-experiment means overlaid, a paired t across the N=3 replicates, and a
Hedges g. They are the right first absorption target for three reasons:

1. **The collapse is already the default.** Their replicate statistic is the
   nested median `frame→cell→field→experiment` (median at each level so each
   replicate weights its fields equally) — *exactly* the canonical chain the
   transformation explorer proposes from the column roles. No deviation from the
   default path is needed.
2. **The stat already exists.** `paired_by_replicate` is a paired-t + Hedges g
   across the three replicate medians — Iris's two-group paired family, driven by
   the spine-derived pairing. Nothing new on the stats side.
3. **The only new prep is grain-safe and small.** Everything `per_frame_values`
   does beyond the flatten is a `drop`, a `filter`, one `recode`, one `join`, and
   (optionally) one `derive` — all at the raw frame grain, before any flatten, so
   the grain-safety guarantee holds trivially. These are the first three
   deferred nodes; §1–§2 is their minimal exercise and their equivalence test.

## What the notebook does today

`code/cov2d/figures.py`, the two functions behind every §1–§2 panel:

```python
def per_frame_values(shape_csv, value_col, class_csv, *, transform=None):
    df = pd.read_csv(shape_csv)[[*KEY, "frame", value_col]].dropna(subset=[value_col])
    df = df.rename(columns={value_col: "value"})
    if transform is not None:
        df["value"] = transform(df["value"])
    cls = pd.read_csv(class_csv)[[*KEY, "class_label"]].copy()
    cls["class_label"] = cls["class_label"].map(CLASS_LABELS).fillna(cls["class_label"])
    return df.merge(cls, on=KEY, how="inner")        # KEY = experiment_id, position_id, cell_id

def paired_by_replicate(pf, *, value="value", agg="median"):
    cell  = pf.groupby([*KEY, "class_label"])[value].agg(agg).reset_index()
    field = cell.groupby(["experiment_id","position_id","class_label"])[value].agg(agg).reset_index()
    piv   = field.groupby(["experiment_id","class_label"])[value].agg(agg).unstack()
    vk, nl = piv["VimentinKO"].to_numpy(), piv["NLS-mCherry"].to_numpy()
    t = ttest_rel(vk, nl); g = compute_effsize(vk, nl, paired=True, eftype="hedges")
    ...
```

The inputs are CellFlow's pooled `shape_tables` CSVs (`cell_shape.csv`,
`nucleus_shape.csv`, `cell_dynamics.csv`, …) plus `class_label.csv`. Each shape
table is at the **per-frame** grain (`id`, metadata, `cell_id`, `frame`, then
`<quantity_id>.<value>` columns); `class_label.csv` is one
`experiment_id, position_id, cell_id, class_label` row **per cell**.

## The target graph

```
source(cell_shape.csv)                         source(class_label.csv)
   │ drop  → keep [KEY, frame, <quantity>]         │ recode class_label
   │ filter→ drop rows where <quantity> is null     │   negative→VimentinKO
   │ derive→ (optional) value = log(value), q=…      │   positive→NLS-mCherry
   └──────────────── join on KEY (inner) ◄──────────┘   (broadcast cell→frame)
                          │
                  flatten frame→cell   (median)
                  flatten cell→field   (median)
                  flatten field→experiment (median)
                          │
        ┌─────────────────┴─────────────────┐
   SuperPlot (per-cell pts + per-exp means)   paired two-group t + Hedges g
   ↑ fan-in from the cell grain and           ↑ reads the experiment grain
     the experiment grain                       (spine-derived pairing, N=3)
```

### Node-by-node mapping

| notebook op | node | notes |
|---|---|---|
| `[[*KEY, "frame", value_col]]` | `drop` | keep grain keys + the one measure; everything else removed |
| `.dropna(subset=[value_col])` | `filter` | `value is not null` — a null-predicate filter |
| `transform=log` / `q = perimeter/√area` | `derive` | row-wise, raw grain; optional per panel |
| `class_label.map(CLASS_LABELS)` | `recode` | value relabel; the column becomes the classifier split on color/x |
| `.merge(cls, on=KEY, how="inner")` | `join` | spine-aligned, **coarse→fine broadcast**: a per-cell label onto per-frame rows; inner = drop unclassified |
| `frame→cell→field→experiment` medians | `flatten` ×3 | the canonical default chain — no authoring needed |
| violin + per-cell + per-exp dots | SuperPlot layers | fan-in arrows from cell and experiment grains |
| `ttest_rel` + Hedges g across N=3 | stats clause | existing paired two-group family on the spine pairing |

## What Tier A must add (minimal forms only)

The flatten chain, `drop`, and `filter` are MVP. Tier A lands the *first,
smallest* version of three deferred nodes — only what §1–§2 needs:

- **`recode` (value relabel).** A level→level lookup over a categorical column,
  with a pass-through for unmapped levels (the notebook's `.fillna(original)`).
  `ColumnDef.labels` already carries a display mapping; Tier A needs the
  affordance to set it *and* to have it rewrite the stored category so it can be
  split on. **Defer:** function/parser recodes (§5's `_ttype`), level merging.
- **`join` (spine-aligned, inner, coarse→fine broadcast).** Attach a table's
  columns onto another by shared identifiers, broadcasting a coarser-grain
  attribute (per-cell `class_label`) onto finer-grain rows (per-frame). Inner
  semantics drop rows with no match (the notebook's unclassified-cell exclusion).
  **Defer:** outer joins, many-to-many, non-spine keys, general relational joins.
- **`derive` (row-wise, raw grain).** A scalar expression over existing columns:
  `log(value)`, `perimeter/√area`. Evaluated before any flatten, so grain-safe.
  **Defer:** post-aggregate derive (Tier C), conditionals, string ops.

Everything else §1–§2 needs is already built.

## Architecture & data flow

- **Multi-source from day one.** §1–§2 is already two sources (a shape table +
  `class_label.csv`) converging at a `join`, so Tier A is the first real
  exercise of the graph's fan-in. The MVP's single-`source` assumption is
  relaxed exactly here; the rest of the graph (drop/filter/flatten) is unchanged.
- **The join sits before the flatten.** Because the class label is a raw per-cell
  attribute, the join is at the raw grain and the default flatten chain runs on
  the joined table untouched. This is why Tier A needs no editable-grain flatten.
- **Engine.** `reduce.py` gains `derive` and `join` step kinds; `recode` is a
  categorical relabel that can ride `specnorm`/`ColumnDef.labels` or a dedicated
  step (decide in the engine plan). The node→table surface from the explorer MVP
  must return the right rows at the new nodes (post-join, post-recode, post-derive).
- **Spec.** Likely the `spec_version` bump the transformation-explorer spec
  anticipates, since the pipeline gains a second source and non-linear fan-in.

## Equivalence test — the acceptance bar

Tier A is done when the absorbed graph reproduces the notebook **exactly**, on a
checked-in COV2D-shaped fixture (a small synthetic stand-in for the pooled
`cell_shape.csv` + `class_label.csv`, with a known nesting and known per-class
medians).

- **Engine:** for each §1–§2 descriptor, the graph's experiment-grain values and
  the resulting paired-t `p`, Hedges `g`, pooled medians, ratio, and per-replicate
  sign string match `paired_by_replicate`'s output to full float precision.
- **Default-chain identity:** the graph derived from the column roles
  (`experiment_id, position_id, cell_id, frame` identifiers; `class_label`
  classifier; the measure) yields the same flatten chain as today's
  `materialize_levels` — i.e. absorbing §1–§2 changes *no* numbers.
- **Join/recode/derive units:** the broadcast join produces one row per frame
  carrying the cell's label; inner drops unclassified cells; the recode relabels
  and leaves unmapped levels intact; `log`/`q` derive matches numpy.
- **Round-trip:** the resulting `.iris` (two sources, a join, the flatten chain,
  a SuperPlot, a paired stat) saves and reloads losslessly.

Run: engine `pytest`; frontend `tsc` + Vite build (+ the explorer render test
from the MVP, now showing two source nodes converging).

## Scope

**In (Tier A):** the §1–§2 shape & motility SuperPlots end-to-end inside the
graph; the minimal `derive` / `recode` / `join` forms above; a two-source fan-in
graph; the COV2D-shaped fixture + equivalence test; the explorer rendering the
join as two source lines converging.

**Out (later tiers, see `TODO.md`):** §3's count-pooled `log2(Σobs/Σexp)` and
§4's `het` (post-aggregate derive — Tier C); §4's `per_cell_features`
multi-table union (Tier B/C); §5's grid-completion, data-dependent tail-clip,
and the rate family wiring (Tier C); the upstream feature extraction
(`nls_classification`, `neighborhood`, `msd_alpha`, `coordination`) which stays
out by nature (Tier D); guard *warnings* on dangerous grains (incremental).

## Dependencies & risks

- **Depends on the transformation-explorer MVP** (the graph data model + node→
  table surface) being in place; Tier A is its first non-default, multi-source
  user.
- **`msd_alpha` is the one §2 panel that does not absorb.** The MSD persistence
  exponent is a per-track log-log slope over a fixed lag window — a windowed
  regression *feature*, not a group aggregate, even though it lands one value per
  cell. It stays upstream (Tier D); its `.iris` is fed a per-cell α table exactly
  as today. Tier A covers size/shape/speed; α rides in pre-computed.
- **Risk: the broadcast join is where pseudoreplication hides.** Broadcasting a
  per-cell label onto per-frame rows then testing at the per-frame grain would
  inflate N massively. Tier A is safe because the default flatten chain runs
  *after* the join, but this is exactly the case the guard pass must catch once
  editable-grain flatten lands — flag it in the guard backlog now.
