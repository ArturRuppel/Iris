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
  categorical/classifier (violet), bool (amber). Axes are blue. A value that lives
  at a coarser grain than the node's rows may carry an `@grain` tag (e.g.
  `class @cell` after a cross-grain join) — see *Deferred* §, this tag is optional.
- A **collapse** strikes out the removed axis in the downstream node (visual
  continuity: you watch `frame` disappear).
- **grain nodes** (the output of a collapse) are tinted to distinguish them from
  reduce-step table nodes.

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
- **Nested join keys.** On nested data the key is the **full identifier path**
  (`experiment, position, cell`), not the leaf `cell` — leaf IDs aren't unique on
  their own. The right table therefore carries its full keying axes; it does not
  appear at a bare-leaf grain. (This was the bug fixed between full-workspace v1→v2.)
- **Terminal fork.** Plot and Stats can read **different grains** (a SuperPlot
  reads per-cell points *and* the per-replicate summary; the test reads the
  replicate grain). The end of the graph forks, and a terminal may have multiple
  incoming grain edges.

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
   `{ axes: [{name, n_levels, ragged}], values: [{name, type, grain?}] }`.
   Per-axis `n_levels` is a cheap `nunique` per identifier column per node; `ragged`
   is whether the inner axis has uneven counts. Today the engine returns only
   `rows × cols` per node (the `/shape_counts` endpoint → `ShapeCounts` in
   `src/types.ts`); extend it to carry the descriptor so the UI renders rather than
   re-derives. No logic change to `reduce.py`.

3. **Genuinely internal — DEFERRED.** Per-value **native-grain provenance** (the
   `@cell` tag) requires threading each value column's native grain through the
   reduce pipeline. Valuable because it makes the post-aggregate-derive guard's
   reasoning visible, but it is new internal state, not display. Ship the lens
   without it first; the `@grain` tag simply won't show until this lands.

**Explicitly NOT doing:** rewriting the engine to store labeled arrays internally.

## Open questions (resolve at plan time; none block understanding)

- **Join-key guard.** Joining on a leaf ID that isn't unique without its full path
  (`cell` without `experiment, position`) should raise a never-blocking caution —
  consistent with Iris's guard stance. Spec the guard with the plan.
- **Right-input drawing depth.** When the right input is itself a pipeline, draw it
  as a full sub-branch vs. a single collapsed node with click-to-expand. Lean:
  collapsed-by-default, expandable.
- **Multi-input terminal edges.** Draw the plot-reads-two-grains case as real
  convergent edges (like the join) or as an annotation. Lean: real edges, for
  consistency with the join confluence.
- **Node density at full-pipeline scale.** Full axes+values readout on every node
  vs. intermediate nodes showing only their *delta* with full shape on hover. Lean:
  full readout (the array shape IS the content); revisit if canvases get noisy.

## Out of scope

- The guide chapter / gallery showcase for these capabilities — covered separately
  by `2026-06-24-cov2d-capability-showcase-design.md`.
- Any change to statistics, collapse semantics, or the reduce vocabulary itself.
  This is a *rendering* of the existing pipeline.
