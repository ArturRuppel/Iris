# Data hierarchy & per-layer levels — redesign

*Status: draft, 16 June 2026. Supersedes the Phase 5 superplot design
(`2026-06-16-superplots-design.md`): the `stat.per_unit` flag, the `repetition_key`
"n by" picker, and the "Build superplot" button are all removed and replaced by
the model below. Statistics are explicitly **out of scope** for this pass (see
"Deferred"). Likely a `spec_version` bump — this changes the data model, not just
optional fields.*

## The problem

Three things are wrong with the current shape:

1. **Collapse is inverted.** To *remove* a level you declare everything you want
   to *keep*: "average away frames" is expressed as "group by date, position,
   cell" (everything-but-frames). The user thinks in the nesting
   (frames ⊂ cells ⊂ positions ⊂ date) and wants to name the level, not its
   complement.
2. **The superplot is a canned preset, not a composition.** "Build superplot"
   *replaces* the layer stack with a fixed three-layer combo, and the per-unit
   reduction is a hidden draw-time transform (`stat.per_unit`) that duplicates
   the stats engine's collapse in a second, mirror code path. Two copies of "one
   source of truth."
3. **Nesting deeper than one level is unsupported.** Real data nests several deep
   (frame ⊂ cell ⊂ position ⊂ date); the current per-unit overlay only knows one
   unit. The original spec punted on this explicitly.

The fix is to make the **nesting hierarchy a first-class object** and let every
consumer — the data-table preview and each figure layer — *pick a level* from it.

## Two axes: the vertical spine and horizontal qualifiers

The key modelling insight (the user's): a dataset's categorical columns play two
different roles, and they behave differently under aggregation.

- **Hierarchy levels (the vertical spine):** an ordered nesting of grouping
  columns, coarsest → finest. For this dataset: **date › position › cell ›
  frame**. Each level *contains* the ones below it (a date has many positions, a
  position has many cells, a cell has many frames). These define **grain**.
- **Qualifiers (horizontal branches):** categorical attributes that label units
  but do not nest — here **condition** and **class label**. A qualifier attaches
  to the spine at some depth but is orthogonal to it: `condition` is a property of
  a position (or date); `class` is a property of a cell. They split the data
  sideways rather than deepening it.

Mapping to today's column types: spine levels are typically `identifier` columns
(plus a date), qualifiers are `categorical`. The importer already distinguishes
these, so role assignment has a sensible default to start from.

### Grain = a cut of the spine

Selecting a **level** L means: keep the columns from the root down to and
including L, and **aggregate away everything finer** (numeric measures combined by
the level's `fn`, default `mean`). So with spine `date › position › cell ›
frame`:

| selected level | grain (one row per…)            | what's averaged away |
|----------------|----------------------------------|----------------------|
| `frame`        | date × position × cell × frame   | nothing (raw)        |
| `cell`         | date × position × cell           | frame                |
| `position`     | date × position                  | frame, cell          |
| `date`         | date                             | frame, cell, position|

"Average away frames" is now just **pick level = cell**. No complement, no
group-by gymnastics.

### Qualifiers under collapse: carry, split, or drop

When the grain is coarsened, a qualifier is in one of three states:

- **Carries along** — if it is single-valued within the grain. `condition` is
  constant within a position, so at grain `position` (or finer) it rides along and
  stays available for color/facet. Its **home level** is the coarsest grain at
  which it is still single-valued (here, `position`).
- **Splits** — if the user maps it to an encoding (x / color / facet / its own
  retained key), it becomes part of the grain: one row per (grain × qualifier).
  This is the *horizontal branch* — mapping `condition` to x at grain `date`
  groups by (date × condition) even though `condition` was multi-valued per date.
  A split *resolves* the multi-valued problem by refining the grain.
- **Dropped** — if it is multi-valued at the grain and not used as a split, it is
  simply removed from that level's table (you can't average a category). It
  becomes unavailable to layers reading that level, with a teaching note rather
  than a silent disappearance.

So the **effective grain of a layer = chosen spine level (vertical) + every
qualifier used as a split (horizontal).** Everything else inside that grain is
aggregated. This single rule subsumes today's collapse, the per-unit overlay, and
faceting/color.

### Pairing follows from the spine

A horizontal comparison is **paired** or **unpaired**, and this is *readable off
the IDs* — not something the user declares. When a qualifier `Q` is used as the
comparison split, the relationship is:

- **Paired** over the spine levels **coarser than `Q`'s home level** — the units
  big enough to contain more than one `Q` value (the same unit appears under every
  level of `Q`).
- **Unpaired** at `Q`'s home level or finer — each such unit only ever sees one
  level of `Q`, so there is nothing to pair.

Worked on this dataset: `condition`'s home is `position` (constant within a
position, varies across positions in a date), so a condition comparison can only
be paired at **`date`** — iff every date carries both conditions. A
before/after qualifier that varies *within* a cell has home `frame`, so it pairs
across **`cell`**. The structural rule and the user's "same ID columns on both
sides" are the same statement: **group by the spine columns coarser than `Q`'s
home; the design is paired iff every group carries every level of `Q`.**

Real data has holes, so the surfaced verdict is three-valued — **paired /
partially paired / unpaired** — where *partially paired* means most but not all
units span `Q` (the test pass decides how to handle drop-outs; we only detect and
display here). This is computed per (comparison qualifier × grain) and shown as a
badge next to the encoding (e.g. "condition: paired across date"). It is purely
derived — never stored — and is surfaced **now**, even though it changes nothing
about the figure, because it is the structural fact that will pick the test
(paired vs. unpaired t / Wilcoxon vs. Mann–Whitney) in the deferred stats pass.

## Consumers pick a level

The hierarchy is **defined once** (a property of the table); **level selection is
per-consumer**:

- **The reduced-table preview** gains a level dropdown — inspect "the per-cell
  table" vs "the per-position table" directly. This replaces the destructive
  collapse step in the reduce pipeline (`filter` and `select` stay as-is).
- **Each figure layer** gains a level dropdown. A `dot` at `frame` is the faint
  raw cloud; a `dot` at `date` is one bold mark per experiment; a `summary` at
  `date` is mean ± spread across dates. The superplot is now *composed*, not
  summoned.

### Geoms become level-agnostic

A geom no longer needs a per-unit branch. It draws whatever level it is bound to:

- `dot` at level L → one point per L-grain row (row_ids = that row's raw
  descendants — see provenance).
- `box` / `violin` at level L → the distribution of L-grain values.
- `summary` / `bar` at level L → per x-group center + error computed from the
  **L-grain rows' spread** (so binding the summary to `date` gives error across
  dates, i.e. the honest n, for free). The old `_unit_summary` / `_layer_units`
  special-casing disappears.

### The canonical superplot, re-expressed

With `condition` on x and a numeric readout on y:

```
[ dot     level: cell ]            faint raw replicates (per cell)
[ dot     level: date ]            one bold mark per experiment (the units)
[ summary level: date ]            mean ± SEM across experiments
```

Fully composable: any geom, any level, reorder/retype/restyle. No preset family.

## What this removes

- `Layer.stat = { per_unit }` and the registry's `accepts_stat`.
- `reduce.collapse` as a destructive step (replaced by the hierarchy + level
  selection). `select` and `filter` remain.
- `stats.repetition_key` / the **"n by"** picker — the inferential unit becomes
  "which level the prominent marks read," handled when stats return (deferred).
- The **"Build superplot"** button and `buildSuperplotAtom`.
- The compiler's `_layer_units`, `_unit_summary`, `_stat_per_unit`,
  `_draw_unit_dots`.

## Data model

```ts
// column role, declared once (defaulted from importer type)
type ColumnRole = "measure" | "level" | "qualifier";

interface Hierarchy {
  spine: string[];     // level columns, coarsest → finest: ["date","position","cell","frame"]
  fn: Record<string, AggFn>;  // per-level aggregate of finer measures; default "mean"
}

interface Layer {
  geom: Geom;
  params: Record<string, unknown>;
  level: string;       // which spine column's grain this layer reads ("" = raw/finest)
  // encodings that map qualifiers/levels to x/color/facet act as splits
}
```

The hierarchy lives on the plottable (or table); each layer carries a `level`.
Engine-side, one function `materialize_levels(df, hierarchy)` produces the level
tables **once**, consumed by the preview and every layer — killing the
double-collapse mirror. The compiler selects `df_level[layer.level]` and draws.

### Provenance: ids chain up the spine

Today's collapse mints fresh `g{i}` ids and severs the link to raw rows. The new
materialization must instead carry, on every coarse row, the **list of raw row
ids it aggregates** (`row_ids`), built by unioning children level by level. Then
click-to-exclude on a per-`date` mark still drops that date's raw frames, at any
depth. This is the one genuinely fiddly correctness bit and it has tests of its
own (exclusion round-trips through 3+ levels).

Each collapse is recorded in provenance as a **described derivation** ("level
`cell`: mean over `frame`"), distinct from the user's `filter`/`select` steps — it
is a view of the data, not a mutation of the master table.

## Deferred (stats — a later pass)

Per the user: get plotting right first. So this spec does **not** decide:

- Which level is the *inferential* unit, how the test counts n across nesting
  depth, or per-facet correction. The hooks (`level` on layers, the spine) are
  enough to add this without another model change — the inferential level is just
  a tagged spine level whose grain the test reads.
- **Test selection** (paired vs. unpaired, and how to handle *partially paired*
  drop-outs). Note: the paired/unpaired/partially-paired **detection is not
  deferred** — it is derived from the spine and surfaced in this pass (see
  "Pairing follows from the spine"); only the choice of test that consumes it is.
- Aggregate functions beyond `mean` per level are *allowed* in the model (`fn`)
  but the UI may expose only `mean` first.
- Mixed-resolution qualifiers across facets, paired designs.

## Migration

- A legacy `reduce.collapse(group_by=G)` step → a hierarchy whose spine is the
  ordered `G` (coarsest-first by cardinality) with all finer columns as the raw
  level; preview defaults to the coarsest level (matching the old destructive
  output). Lossless for the common single-collapse case; multi-collapse pipelines
  flatten to one spine.
- `repetition_key: [u]` → no hierarchy change; it informed stats only, which is
  deferred. Recorded as a note for the stats pass.
- Layers without `level` default to `""` (raw/finest) = today's behaviour.

## Where it lives: the Data tab (defined fully, visualized)

The hierarchy is a property of the **data**, so it is defined in the **Data tab**
(table-level, shared by every analysis), not per-plottable. It is defined
*completely*: every non-numeric column has an explicit role —

- **identifier** → a nesting level on the spine (ordered, coarsest → finest);
- **classifier** → a categorical qualifier (orthogonal to the spine).

(Numeric columns are measures.) Toggling a column's role flips its schema type
and reconciles the spine; the order is the one extra fact beyond type.

**Classifiers attach at their home level**, and the editor *shows* this — the
spine is drawn as a vertical tree with each classifier branching at the coarsest
grain where it stays single-valued (`/hierarchy` returns home levels + per-level
grain cardinalities). On the demo data:

```
nesting (coarse → fine)
● date          3   ┤ condition
│ position_id  27
│ cell_id    1726   ┤ class_label
│ frame     82241
```

so `condition` (one per date) reads as a date-level branch and `class_label`
(one per cell) as a cell-level branch — making the two axes (vertical nesting,
horizontal qualifiers) literally visible. The analyses tab shows a compact
read-only echo of the spine plus the pairing badge for the current comparison.

## Decisions (settled)

1. **Role assignment UX** — auto-derive spine order from column cardinality
   (`date` coarsest … `frame` finest), user can drag to reorder.
2. **Qualifier home detection** — auto-detect each qualifier's home level by
   testing single-valuedness within each grain; surfaced read-only ("condition
   varies at: position"). This same detection feeds the pairing verdict.
3. **Spine scope** — one spine per table; level selection per consumer (preview +
   each layer).
4. **`spec_version` bump** — yes; saved documents migrate (legacy `collapse` →
   flattened spine).

## Incremental rollout

Even though the model is N-level, ship in slices so the schema-per-level UI work
is de-risked:

1. **Engine:** `Hierarchy` + `materialize_levels` with id-chaining + tests;
   `/reduce` preview takes a `level`. (No UI yet; pure model.)
2. **Layer binding:** `Layer.level`, compiler reads the bound level, geoms go
   level-agnostic. Remove `stat.per_unit` & friends.
3. **UI:** hierarchy editor (reusing the reduce-steps interaction), level dropdown
   on the preview and each layer card. Remove "n by" + "Build superplot".
4. **Stats pass (separate spec):** tag the inferential level, restore the test.
```
