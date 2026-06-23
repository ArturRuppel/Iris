# Transformation Explorer Re-model — Design

> Sub-project 1 of the "part 3" work. Re-models the just-merged transformation
> explorer so it is a correct dataflow graph, folds in three review bug-fixes,
> and relocates the explorer to a full-width strip. Inline-editing (sub-project 2)
> and un-forcing the nesting (sub-project 3) follow as their own specs.

**Date:** 2026-06-23
**Status:** design, pending implementation plan

---

## Principle

A dataflow graph has one honest shape: **nodes are data, edges are
transformations.** The merged explorer (Plan 2) inverted this — it drew the
transformations (`Filter`, `Drop`, `per subject`) as *nodes* and reduced the
edges between them to decorative `→` separators. This re-model flips it back so
the picture matches the thing it depicts. Everything the user asked to add
(arrow labels = transformation type, per-node row/column counts) then falls out
of the model instead of being bolted on.

This also pays a scientific dividend specific to Iris: when the statistical
test is an edge into a Stats node, that edge's *origin* is the grain the test
ran on. A t-test edge leaving the *per-subject* table (n=6) instead of the
*raw* table (n=48) makes pseudoreplication visible at a glance — the SuperPlot
lesson Iris exists to teach.

## The model

### Nodes — datatypes (three kinds)

| kind    | what it is                                              | inspect on click            |
| ------- | ------------------------------------------------------- | --------------------------- |
| `table` | source, the table after each reduce step, and the table at each collapse (spine) level | data tab shows the table |
| `plot`  | terminal — the figure (one node; figure+stats computed together but are distinct datatypes) | focuses the Figure section |
| `stats` | terminal — the statistical results table                | focuses the Statistics section |

Every `table` node carries a **row × column count** so the data is seen
collapsing down the chain (`Source 60×4 → 48×4 → 48×3 → per rep 18×3 → per
subject 6×3`). `plot` and `stats` carry no count.

### Edges — transformations (five types), colored + labeled

| edge       | color           | label                          | from → to                          |
| ---------- | --------------- | ------------------------------ | ---------------------------------- |
| `filter`   | rose `#e11d48`  | `filter (2)` (n = conditions)  | table → table                      |
| `drop`     | amber `#d97706` | `drop (1)` (n = columns)       | table → table                      |
| `collapse` | violet `#7c3aed`| `collapse`                     | table → table (the median-of-medians chain; the *node* is named by grain, "per subject") |
| `geom`     | teal `#0e7490`  | the layer geom — `dots`, `box`, `mean ± SD` | table → plot (one per layer; a SuperPlot draws several) |
| `test`     | indigo `#4f46e5`| the chosen test — `Welch's t-test`, `Mann–Whitney`, … (or `describe` when describe-only) | table → stats |

The color code that lived on node fills in Plan 2 moves onto the edges. Node
fill now encodes only the *datatype* (table vs plot vs stats), kept visually
quiet so the colored edges carry the meaning.

### Worked example (SuperPlot)

```
[Source 60×4] ─filter(2)→ [48×4] ─drop(1)→ [48×3] ─collapse→ [per rep 18×3] ─collapse→ [per subject 6×3]
                                                 │                                              │
                                                 └──── dots ───→ [ Plot ]          [ Stats ] ←─ Welch's t-test ─┘
                                                                    ▲                  (origin = per subject,
                                                          box / mean±SD ┘               n = 6, not 48)
```

- `dots` reads the finest reduced table (the last reduce-step node).
- `box` and `mean ± SD` read the `per subject` collapse node.
- the `test` edge originates from the coarsest collapse node (the analysis
  grain) — or the finest reduced table when there is no spine.

## Where each edge originates (resolution rules)

`buildGraph` must resolve every edge's `fromId`:

- **filter / drop** — sequential: `Source → step:0 → step:1 → …`. Each step
  node's incoming edge is that step's kind.
- **collapse** — one node per spine level, coarsest→finest mirroring the spine,
  chained off the last reduce-step node (or source if no steps). Each collapse
  node's incoming edge is `collapse`.
- **geom** — one edge per layer, from the node for that layer's `level`
  (`RAW_LEVEL` → the last reduce-step node; a spine level → its collapse node;
  a stale level not on the spine → skip), into the single `plot` node. Deduped:
  two layers at the same level with the same geom collapse to one edge; distinct
  geoms at the same level draw distinct edges (the geom is the label).
- **test** — one edge from the **coarsest spine collapse node** (the analysis
  grain) into the `stats` node, labeled by the chosen test. No spine → from the
  finest reduced table. Describe-only → label `describe`. The chosen-test label
  comes from the live `StatsResult.result.test` when present, else the spec's
  `stats.override ?? stats.test`.

A layer-less / not-yet-mapped analysis still draws the raw `geom`-less case
gracefully (the plot node with a single edge from the finest table, label
"plotted") so the figure never floats unconnected — same guard Plan 2 had.

## Per-node counts — engine support

Row counts at every node cannot be derived client-side (collapse changes row
*and* column counts non-trivially). Fetching each node separately is N
round-trips per edit. Add one endpoint that returns them all in a single call:

**`POST /shape_counts`** (engine) — body `{ token, steps, hierarchy }`,
response:

```json
{
  "steps":  [{ "rows": 48, "cols": 4 }, { "rows": 48, "cols": 3 }],
  "source": { "rows": 60, "cols": 4 },
  "levels": { "rep": { "rows": 18, "cols": 3 }, "subject": { "rows": 6, "cols": 3 } }
}
```

`rows`/`cols` are computed exactly as the existing `/reduce` slicing would
produce them (reuse the same `materialize`/slice path; just don't serialize the
rows). The frontend calls it once per pipeline change (debounced, keyed on
`steps + hierarchy + handle`), maps the numbers onto node ids, and renders them.
Counts are advisory chrome: if the call fails or is in flight, nodes render
without a count rather than blocking.

## Frontend shape

### `src/explorer/graph.ts` (re-modeled view-model)

- `NodeKind = "table" | "plot" | "stats"` (was source/filter/drop/flatten/outputs).
- `ExplorerNode { id; kind; label; table: NodeTable; count?: {rows; cols} }` —
  `table` field unchanged (drives the data tab fetch); `count` filled from
  `/shape_counts`.
- New first-class edges: `EdgeKind = "filter" | "drop" | "collapse" | "geom" | "test"`;
  `Edge { id; kind; label; fromId; toId }`. Replaces the old `FanInEdge`-only
  model — *all* connectors are edges now, including the sequential chain.
- `buildGraph(steps, hierarchy, layers, schema, stats)` returns
  `{ nodes, edges }`. Takes the stats config as a new arg (for the test edge).
- Pure, fully unit-tested (port + extend the existing `graph.test.ts`).

### `src/explorer/graphAtom.ts` (new) — shared derived atom

Plan 2 computed `buildGraph` independently in both `TransformExplorer` and
`DataTab` (review nit #8). Expose a single derived `explorerGraphAtom` both
consume, so the graph is built once and the two views cannot diverge.

### `src/components/TransformExplorer.tsx` (re-modeled rendering)

- Lay nodes left→right; draw **every** edge as an SVG path (the chain edges
  straight along the line, the geom/test edges bowing to the terminal nodes),
  each stroked in its edge color with an arrowhead and a **text label** at its
  midpoint.
- Node chrome: datatype-quiet fill, label, and (for `table`) the `rows × cols`
  count.
- Selection unchanged (`selectedNodeIdAtom`); clicking a `plot`/`stats` node
  scrolls/focuses the Figure/Statistics section instead of loading a table.
- Keep the measured-layout approach (refs + `ResizeObserver`) but redraw on
  graph change *and* selection-independent reflow; drop the dead
  `fromId === OUTPUTS_ID` guard (review nit #6).

### `src/components/DataTab.tsx` (bug-fixes + consume shared atom)

- **Fix loading-stuck** (review bug #1): the early-return when a node has no
  table must also `setLoading(false)`.
- **Fix stale-on-switch** (review bug #2): include the active plottable id in
  `fetchKey` so structurally-identical pipelines on different analyses refetch.
- Clear the previous table on node switch before the new fetch resolves
  (review bug #5) to remove the brief wrong-rows window.
- Consume `explorerGraphAtom` instead of recomputing `buildGraph`.

### `src/state.ts`

- Remove the dead `setPreviewLevelAtom` export (review bug #3); its only caller
  (`ReducedTable`) is gone. `previewLevel` stays pinned at `RAW_LEVEL` for the
  outputs/plot preview — that is correct, only the unused setter goes.
- Add `explorerGraphAtom` (or place in `graphAtom.ts`, imported here).

### `src/explorer/graph.ts` doc-fix

- The `FanInEdge` JSDoc names a field `targetId` that never existed (`toId`);
  the type is rewritten anyway, so the comment goes with it (review nit #4).

### Layout — `src/App.tsx` + `src/index.css`

- Lift `<TransformExplorer />` **out** of the `Transformation` `Section` in the
  `.iris` column to a **full-width strip directly under the header/error-bar**,
  spanning the viewport, shown in `analyses` mode only (it returns null without
  an active plottable, so other modes stay clean).
- The data tab stays exactly where it is; its `Section` is renamed from
  "Transformation" to **"Table"** and now contains only `<DataTab />`.
- New CSS for the full-width explorer bar, edge labels, edge colors, and the
  per-node count line; retire the Plan 2 node-fill color classes.

## Testing

- **`graph.test.ts`** — port the 8 existing cases to the node/edge model and add:
  edge `kind`+`label`+origin for filter/drop/collapse/geom/test; the test edge
  originates from the coarsest collapse node; describe-only → `describe` label;
  geom dedup (same level+geom = one edge, same level different geoms = two);
  stale level skipped; count merge onto node ids; no-spine and no-layer cases.
- **engine** — a `/shape_counts` test: rows/cols match what `/reduce` returns at
  each `at_step` and each `level` for a small fixture; bad token → 4xx.
- **e2e** — extend the Playwright shot: assert the strip renders full-width under
  the header, edges carry colored labels, table nodes show `r×c`, a SuperPlot
  draws geom + test edges, and clicking a table node loads its table.
- `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `pytest` all green.

## Out of scope (later sub-projects)

- **Inline editing** (sub-project 2): clicking an edge to edit that
  transformation in place; new `derive`/`recode`/`join` edge types.
- **Un-forcing the nesting** (sub-project 3): the collapse chain becomes a
  re-routable default with guard-warnings rather than an enforced spine.
