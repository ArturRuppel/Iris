# Transformation Workspace — the array-shape lens — Design

**Date:** 2026-06-24
**Status:** approved (brainstorm), pending implementation plan

## Goal

Make the transformation-explorer graph **legible** by rendering the data and every
reduction step the way a scientist already pictures them: as a **labeled
N-dimensional array** and operations on it. Today a node says `filtered` + `1240×5`
and an edge says `collapse` — which hides what actually happened. We replace that
with a node that shows its **array shape** (the identifier *axes* and the measured
*values*) and an edge labelled as an **array operation** (`median over frame`,
`unstack feature → {perimeter, area}`). The feature gets its own **dedicated
full-screen workspace** rather than the cramped side panel.

Reference mockups (open in a browser):
`docs/superpowers/specs/assets/2026-06-24-transformation-workspace-array-lens/`
— `01-array-shape-nodes`, `02-join-explained`, `03-join-binary-topology`,
`04-full-workspace`, `05-pivot-explained`, `06-grid-complete-explained`.

## The framing (why this is the right model)

A tidy/long table is the **coordinate-list (COO) encoding of a labeled array**:

- **identifier** columns (the nesting spine, coarsest→finest) are the array's
  **axes / dimensions**;
- **measured** columns are the **values / data variables** sitting in the cells.

Two refinements keep the model honest:

1. **It's an xarray `Dataset`, not raw numpy.** The array is *labeled* (named axes
   that ARE the statistical design) and *multi-variable* (`speed`, `area`, `class`
   share axes). That is exactly what makes `pivot`/`join` legible.
2. **The array is ragged, and that is the point.** `condition ▸ experiment ▸
   position ▸ cell ▸ frame` is nested, not crossed — cell A has 30 frames, cell B
   12. The raggedness lives on the **inner axes that get aggregated away**; after
   collapse the outer array (e.g. `condition ▸ experiment`) is the rectangular
   factorial design the figure and the test read.

**Crucial scope decision — the array is a LENS, not a new internal model.**
`reduce.py` stays pandas-long. The long table is the *correct* internal
representation precisely because the inner axes are ragged; an xarray rewrite would
force NaN-padding and fight the stats layer (which reads tidy frames). Everything
below is **display + a thin descriptive descriptor the engine hands up**.

## What a node shows

Two rows, replacing `rows × cols`:

```
axes:   condition(2) ▸ experiment(3) ▸ position(12) ▸ cell(122) ▸ frame(~)
values: speed   area   class @cell
```

- **axes** — the identifier columns in spine order, each a chip with its
  **distinct-level count**; a **ragged** inner axis renders dashed with `~`.
- **values** — the measured columns, **coloured by type**: numeric (green),
  categorical/classifier (violet), bool (amber). Axes are blue. A value carries an
  `@grain` tag (e.g. `class @cell`) when it lives at a coarser grain than the node's
  rows — see *Value grain* below. A value at the finest (row) grain shows no tag.
- A **collapse** strikes out the removed axis in the downstream node (visual
  continuity: you watch `frame` disappear).
- **grain nodes** (the output of a collapse) are tinted to distinguish them from
  reduce-step table nodes.

### Value grain — inferred from the data, not tracked

A value's native grain is the **coarsest prefix of the spine at which it is constant
within every group**. Walk axes coarsest→finest and find where the value stops
varying: `class` is constant within each `cell` group → `@cell`; `speed` varies
frame-to-frame → no tag (finest grain). It's a `groupby(prefix)[v].nunique().max()
== 1` check, and "constant within group" is monotone as groups get finer, so the
threshold is well-defined; the tag is the deepest axis of that prefix.

This is a **uniform property of `(value, current frame)`** — it applies to *every*
value, not just joined/derived ones (a raw per-cell source column gets `@cell` too).
It is therefore preferable to provenance tracking: it reflects the actual data,
**survives later ops correctly** (a tracked tag would go stale when a collapse
changes a value's grain), and needs **no state threaded through `reduce.py`** — it
folds into the per-node descriptor pass (§ *Implementation*, tier 2).

*Caveat to record:* the inferred grain is "constant *on this data*," not declared
intent. On degenerate data (e.g. one frame per cell) a genuinely per-frame value
can *look* constant at `@cell`. For the display that is the truthful thing to show;
but a guard built on it (post-aggregate-derive) is then data-dependent, not
declaration-based.

## What an edge shows — every op as an (axes, values) edit

Each operation is an edit to two things: the **axes** and the **values**. The edge
label states it in array language; this is the unifying vocabulary.

| op | axes Δ | values Δ | edge reads as |
|---|---|---|---|
| `filter` | a level set may shrink | — | `mask: \|speed\| ≤ p99` |
| `drop` | axis removed (if identifier) | value removed | `drop area` |
| `derive` | — | value **added** (elementwise) | `speed = √(dx²+dy²)` |
| `recode` | axis relabelled / levels merged | — | `relabel class: 0→non-div` |
| **collapse** | innermost axis **reduced away** | values become aggregates | `median over frame` |
| `join` | align on a shared axis path | values **added** from the right | `join on experiment, position, cell` |
| `pivot` | axis **removed** (unstacked) | one value **per level** | `unstack feature → {perimeter, area}` |
| `grid_complete` | axis **densified** (ragged→dense) | count value added | `densify position × transition · fill 0` |

`pivot` and `grid_complete` are the **dimension-changers** and are exactly where
`rows × cols` misleads most (pivot shrinks rows / grows cols; grid_complete grows
rows with zeros). The engine already half-encodes this split: ops that re-stamp
`id` in `reduce_with_trace` (pivot, grid_complete) are the dimension-changers;
id-preserving ops are the rest.

## Topology — the graph is a DAG, not a chain

`join` is **binary**: two inputs, one output. It is the first node with **two
parents**, and the builder/layout must handle a second incoming edge.

- The join renders as a **confluence**: the main pipeline as the left input, the
  second table as the right input, funnelling into a `⨝ join` hub, one arrow out.
  (`03-join-binary-topology`, `04-full-workspace`.)
- **Multiple loaded input tables are first-class.** A join's right input can be
  **either** a separately loaded source **or** a derived/collapsed sibling branch
  of an existing source — the graph shows whichever it is. No special-casing.
- **Flat graph — no collapsing.** The right input is **always drawn in full**: if
  it is a pipeline, its source → reduce → collapse nodes are all spelled out as a
  sibling branch. No collapsed/expandable nodes anywhere — every node is visible.
- **Nested join keys.** On nested data the key is the **full identifier path**
  (`experiment, position, cell`), not the leaf `cell` — leaf IDs aren't unique on
  their own. The right table therefore carries its full keying axes; it does not
  appear at a bare-leaf grain. (This was the bug fixed between full-workspace v1→v2.)
- **Terminal fork — one edge per grain, annotated with geoms.** A plot is
  **composable** and may read several grains (a SuperPlot reads per-cell points
  *and* the per-replicate summary, but it can be any number of grains). Draw it as
  **one incoming edge per grain**, each edge **labelled with the geom(s) drawn at
  that grain**, comma-separated when several geoms share a grain (e.g. a per-cell
  edge `points, density`; a per-replicate edge `mean ± CI`). The test terminal
  likewise has one edge from the grain it reads. These are real convergent edges,
  consistent with the join confluence — not annotations.

## The workspace

A **dedicated full-screen workspace** (not the side panel): a dot-grid canvas, a
top bar with the type legend, the DAG laid out with room for the array-shape nodes
(which are taller than today's chips). `04-full-workspace` is the reference layout.

## Hover — canned schematic example per op

Hovering an operation shows a **fixed, canned before/after rows mini-table** for
that op kind (the `02`/`05`/`06` style tables: `c1/c2`, 2–4 clean rows). Chosen over
rendering the user's real rows because it is **predictable** — identical every time,
no curation logic — and each op's authored example pair doubles as documentation.

## Implementation scope (tiers)

1. **Pure display — data already exists, render differently.**
   - Edge relabelling. The collapse op-language already exists: the verdict text in
     `src/explorer/graphAtom.ts` computes `"${fn} over ${removed}; grouped per
     ${kept}"` — promote it from hover-verdict to the primary edge label. Reduce-step
     edges are built from spec fields the client already holds (`src/explorer/graph.ts`).
   - Join confluence / right-input branch: `join.right` is already in the spec.
   - Axis ordering, collapse strike-out, grain-node tint: client-side.
   - Touch points: `src/explorer/graph.ts` (buildGraph → DAG with two-parent join),
     `src/components/TransformExplorer.tsx` (node readout + workspace layout + hover),
     `src/explorer/graphAtom.ts`, `src/index.css`.

2. **Thin additive engine change — new descriptive numbers, no change to how
   reductions compute.** Emit a per-node **array-shape descriptor**:
   `{ axes: [{name, n_levels, ragged}], values: [{name, type, grain}] }`.
   Per-axis `n_levels` is a cheap `nunique` per identifier column per node; `ragged`
   is whether the inner axis has uneven counts; per-value `grain` is the
   coarsest-constant prefix (§ *Value grain*) — both are groupbys in the same pass.
   Today the engine returns only `rows × cols` per node (the `/shape_counts`
   endpoint → `ShapeCounts` in `src/types.ts`); extend it to carry the descriptor so
   the UI renders rather than re-derives. No logic change to `reduce.py`. The
   `@grain` tag is in this tier, not deferred — it is data inference, not state.

**Explicitly NOT doing:** rewriting the engine to store labeled arrays internally,
or threading per-value grain provenance through the reduce pipeline (the data
inference above replaces the need for it).

## Settled decisions (were open questions)

- **Join-key guard — warn only.** Joining on a leaf ID that isn't unique without its
  full path (`cell` without `experiment, position`) raises a **never-blocking
  caution** — "did you mean the full path?" — consistent with Iris's guard stance.
  The only new *behaviour* in this spec; everything else is rendering. Lives with
  the other reduce/collapse guards that `/shape_counts` surfaces (in
  `engine/iris_engine/hierarchy.py`, alongside `identity_merge` etc. — *not* the
  geom-level `guards.py`), returned in the `guards` block and attached to the join
  edge by `mergeGuards`. Spec the wording with the plan; it never blocks.
- **Flat graph, no collapsing.** Every node is always fully drawn, including a
  join's right-input pipeline. No collapsed/expandable nodes. (Folded into
  *Topology*.)
- **Plot edges — one per grain, geom-annotated.** Plots are composable over any
  number of grains; draw one real edge per grain, labelled with the geom(s) at that
  grain (comma-separated when several share a grain). (Folded into *Topology*.)
- **Full node readout.** Every node shows its complete axes+values readout — no
  delta-only intermediate nodes. The array shape IS the content.

## Out of scope

- The guide chapter / gallery showcase for these capabilities — covered separately
  by `2026-06-24-cov2d-capability-showcase-design.md`.
- Any change to statistics, collapse semantics, or the reduce vocabulary itself.
  This is a *rendering* of the existing pipeline.
