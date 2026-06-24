# Transformation Workbench — Canvas Redesign

**Status:** Design (approved in brainstorming, 2026-06-24)
**Supersedes:** the Analyses tab and its fixed-panel layout (`PlottableSidebar` + `LayerRail` + `CollapseRoutingPanel` + stacked Table/Figure/Stats sections), and the read-only `WorkspaceView` overlay (Phase 3 of the array-shape lens).

---

## 1. Goal

Turn the analysis surface into a **direct-manipulation workbench**: a horizontal, auto-laid-out DAG of the pipeline where every clickable element opens an ephemeral, freely-arrangeable card. The graph *is* the analysis; cards are transient views and editors onto it. One sentence: **the graph is the document, edges configure, terminals display, and everything you open to inspect or edit is a throwaway card.**

This replaces the Analyses tab entirely. The **Data** and **Guide** tabs are unchanged.

## 2. Core principles

1. **The graph is the document.** The pipeline (reduce steps + collapse routing + layers + test + annotations) is the only persisted state. It already lives in the `AnalysisSpec` / `.iris` file. Nothing about canvas layout, card positions, or which cards are open is ever serialized.
2. **Edges configure, terminals display.** An edge is a *data dependency*: it consumes an upstream node's output. Clicking an edge opens its configuration. A terminal is a *sink*: clicking it shows the rendered result.
3. **Cards are ephemeral.** Move / resize / collapse / close. Session-only React state. Closing a card loses nothing — the spec is untouched; reopening recomputes from the engine.
4. **Reuse, don't rewrite.** Existing panel components (`FigurePane`, `StylePane`, `GuidedTestPicker`, `StatsPanel`, `CollapseRoutingPanel`, `DataTab`, the geom/encoding controls) are wrapped in cards, not reimplemented. The engine and the `.iris` format do not change.
5. **An edge means "this consumes that."** A constant decoration (reference line at y=0, threshold band, text label) depends on nothing upstream, so it is *not* an edge — it stays in the geom-edge config where it already lives. Only the stats→plot annotation is a real edge, because it consumes the stats node's output.

## 3. Shell layout

```
┌───────────────────────────────────────────────────────────────┐
│ Iris   [Data] [Workbench] [Guide]      … Save / Export …        │  app header
├──────┬────────────────────────────────────────────────────────┤
│ Super│  ⛁ SuperPlot   [⤢ tidy] [⊟ cards] … [− zoom +]          │  canvas top bar
│ Plot │                                                          │
│ ──── │   source → filter → collapse → per-cell ─ geom →  PLOT   │  auto-laid DAG
│ Mann │                                    └─ test → STATS ─┐    │  (left→right)
│  –W  │                                          annotate ─┘     │
│ ──── │      ┌─ floating cards (move/resize/collapse) ─┐         │
│ + new│      │  table · geom·encoding · plot · stats   │         │
└──────┴──────┴─────────────────────────────────────────┴────────┘
```

- **Left rail — analysis switcher.** Today's `PlottableSidebar`, reskinned as a slim vertical rail. One analysis is on the canvas at a time; clicking another swaps the graph. `+ new` adds a plottable (`addPlottableAtom`). Selecting an analysis clears `selectedNodeIdAtom` and all open cards (cards are per-analysis, session-only).
- **Canvas — the DAG.** Horizontal, source on the left, terminals on the right. Auto-laid out. Nodes are draggable (nudge only — no resize); **tidy** re-flows to the canonical layered layout. Pan + zoom. Edges keep their array-language labels and hover schematics from the existing `graph.ts` / `OpHoverExample` work.
- **Top bar.** Analysis title, **tidy**, **collapse-all-cards**, zoom. Save/Export stay in the app header (unchanged).
- **Cards.** Float above the canvas, tethered to their node/edge by a thin connector line.

The `viewMode` value `"analyses"` is renamed to `"workbench"` (string-literal change in `viewModeAtom` and its three call sites; no users, no migration). The `⤢ Workspace` button and inline `tx-strip` in `App.tsx` are deleted — the workbench is the view, not an overlay.

## 4. The graph model (mostly existing)

`buildGraph(...)` in `src/explorer/graph.ts` already emits the node/edge structure this needs. Node kinds: `table` (data states: source, each step, each grain, each join right-input), `plot`, `stats`. Edge kinds today: `filter | drop | derive | recode | join | pivot | grid_complete | collapse | geom | test`.

**New in this work:**

- **`"annotate"` EdgeKind.** A new edge from the `stats` node to the `plot` node, emitted by `buildGraph` whenever a test is configured *and* annotation is enabled. It carries the annotation config (which comparisons to bracket, p-value format, bracket style). This is the first edge whose source is a terminal — the plot node now has two inputs (`geom`, `annotate`). The graph becomes a DAG with a terminal→terminal edge; layout must tolerate this (the annotate edge routes stats→plot without implying stats is "before" plot in the left→right flow — it is drawn as a short back-link near the right edge).
- The plot node's `at the right` position is fixed as the global sink; the stats node sits just below/left of it so the annotate back-link is short.

Everything else in `graph.ts` (labels, join topology, per-grain geom grouping, `onKeys`, descriptors) is reused as-is.

## 5. Card catalog

Every clickable element maps to exactly one card kind. `selectedNodeIdAtom` is generalized to a `selectedTargetAtom` that can address a node **or** an edge (`{kind: "node" | "edge", id: string}`).

| Click target | Card kind | Card contents | Reuses |
|---|---|---|---|
| **Data node** (source / step / grain / join input) | `table` | The reduced table at that point (fetched via the existing `/reduce` preview, keyed by node) **+ an "Extend from here" menu**: add filter / derive / recode / drop / collapse / join, add plot, add stats. | `DataTab` / `DataTable`; `addStepAtom` |
| **Reduce edge** (`filter`/`derive`/`recode`/`drop`/`join`/`pivot`/`grid_complete`) | `op-editor` | That step's editor (conditions, expression, join keys…). Live-updates the spec; same 200 ms debounce as today. | `StepCards` field editors; `updateStepAtom`, `removeStepAtom` |
| **`collapse` edge** | `collapse-editor` | The aggregation routing (group-by grain, per-level fn, test grain). | `CollapseRoutingPanel`; `setCollapsePlanAtom`, `setTestGrainAtom` |
| **`geom` edge** | `geom-editor` | Geom type picker + encoding (x / y / color) + per-layer decorative annotations (reference lines, bands, text). | `EncodingsCard`, `LayerRail`, geom picker; `addLayerAtom`, `updateLayerAtom`, `removeLayerAtom` |
| **`test` edge** | `test-editor` | Test picker + grouping/pairing config. | `GuidedTestPicker`; spec test fields |
| **`annotate` edge** (stats→plot) | `annotate-editor` | Which comparisons to bracket, p-value format (stars vs numeric), bracket style. | new small editor; new spec field (see §7) |
| **`plot` terminal** | `plot` | The rendered figure **+ the style-spec editor**. No encoding here — encoding lives on the geom edge. | `FigurePane` + `StylePane` |
| **`stats` terminal** | `stats` | The test result readout only (statistic, p, effect size, n). No config here — config lives on the test edge. | `StatsPanel` (result view) |

`HierarchyPanel` (defining identifier columns / the spine) is a *data-preparation* concern and **stays in the Data tab** — it is not part of the workbench.

## 6. Interaction flows

- **Add an operation.** Data-node card → "Extend from here" → pick op → `addStepAtom` appends it → graph re-flows (auto-tidy on structural change) → the new edge's editor card opens (append-then-edit).
- **Edit an operation.** Click an edge → its editor card opens → edits flow through the existing `updateStepAtom` / collapse / layer atoms → the existing reactive loops in `App.tsx` recompute preview, figure, stats, and shape-counts (unchanged).
- **Add a plot / stats.** "Extend from here" → add plot/stats → the geom/test edge + terminal appear (a SuperPlot is two geom edges from two grains, already modeled). Adding stats with annotation enabled also creates the annotate edge.
- **Annotate the plot.** Click the annotate edge → choose comparisons + format → the figure re-renders with significance brackets.
- **Tidy / declutter.** Top-bar **tidy** re-runs auto-layout; **collapse-all-cards** minimizes every open card to its title bar.

All editing routes through existing atoms, so the existing `App.tsx` reactive effects (analyze loop, reduce-preview loop, shape-counts loop, background cache warmer) keep working untouched.

## 7. Engine / spec changes

The engine is unchanged. The `AnalysisSpec` gains **one optional field** to carry annotation config (the stats→plot edge's parameters), e.g.:

```ts
// added to the plot/encoding portion of AnalysisSpec
annotation?: {
  enabled: boolean;
  comparisons: "all-pairs" | "vs-control" | "explicit";
  explicitPairs?: [string, string][];
  pFormat: "stars" | "numeric";
  bracketStyle?: "line" | "bracket";
};
```

Rendering significance brackets from the test result is an existing capability area (the render layer already produces figures from the spec); this field feeds it. If bracket rendering is not yet implemented in `render.py`, that is a **separate, scoped follow-up** and the annotate edge degrades gracefully (config stored, no overlay drawn) — it does not block the canvas work.

**No layout/position/card state is added to the spec or the `.iris` file.** The format stays as lean as today.

## 8. Tech approach

- **Canvas:** adopt **React Flow (`@xyflow/react`)** for pan / zoom / node drag / custom node + edge types. `buildWorkspaceModel(graph)` (existing) is adapted to emit React Flow `nodes`/`edges`; auto-layout via a small layered left→right pass (hand-rolled or `dagre`). Custom node component = `ArrayShapeNode` (existing). Custom edge component carries the existing label + `OpHoverExample` hover.
- **Cards:** one generic `<FloatingCard>` (drag title bar, corner resize, collapse, close) that wraps a card body chosen by `kind`. Bodies are the existing panel components.
- **State (all session-only, new):**
  - `cardsAtom: Card[]` where `Card = { id; target: {kind,id}; cardKind; x; y; w; h; collapsed }`.
  - `nodePositionsAtom: Record<nodeId, {x,y}>` — overrides for nudged nodes; cleared by tidy.
  - `selectedTargetAtom` — generalizes `selectedNodeIdAtom` to nodes *and* edges.
  - `workspaceOpenAtom` is **removed** (the workbench is no longer a modal overlay).
- **Reuse:** `explorerGraphAtom`, `shapeCountsAtom`, `guardsAtom`, and every editing atom listed in §5 are unchanged.

## 9. Component / file structure

```
src/workbench/
  WorkbenchCanvas.tsx     # React Flow canvas: nodes, edges, pan/zoom, tidy
  layout.ts               # left→right layered auto-layout (graph → positions)
  FloatingCard.tsx        # generic move/resize/collapse/close shell
  cardRegistry.tsx        # target → card kind → body component
  cards/
    TableCard.tsx         # data node: table + Extend menu
    OpEditorCard.tsx      # reduce-step edges
    CollapseCard.tsx      # collapse edge (wraps CollapseRoutingPanel)
    GeomCard.tsx          # geom edge (encoding + geom picker + decorations)
    TestCard.tsx          # test edge (wraps GuidedTestPicker)
    AnnotateCard.tsx      # annotate edge (new small editor)
    PlotCard.tsx          # plot terminal (FigurePane + StylePane)
    StatsCard.tsx         # stats terminal (StatsPanel result view)
  state.ts                # cardsAtom, nodePositionsAtom, selectedTargetAtom
```

`WorkspaceView.tsx`, `ArrayShapeNode.tsx`, `OpHoverExample.tsx`, `cannedExamples.ts`, `workspace.ts` are reused/adapted; the read-only overlay framing of `WorkspaceView` is replaced by `WorkbenchCanvas`.

`App.tsx` shrinks: the entire `viewMode === "analyses"` branch (PlottableSidebar + LayerRail + CollapseRoutingPanel + the iris Section stack + tx-strip + TransformWorkspace) is replaced by `<WorkbenchCanvas/>`. The reactive effects stay.

## 10. Testing strategy

- **Pure units (vitest + RTL, no store):** `layout.ts` (graph → deterministic positions, handles the annotate back-edge), `cardRegistry` (target → correct body), `FloatingCard` (move/resize/collapse/close emit the right state), each card body in isolation with props.
- **Graph model:** `buildGraph` emits the `annotate` edge iff a test + annotation are configured; plot node has two inbound edges; existing graph tests stay green.
- **Interaction (RTL):** clicking a node opens a table card; clicking an edge opens its editor; "Extend from here" appends a step and opens its card; switching analyses clears cards.
- **Engine:** unchanged suite stays green; one new test that the spec round-trips the `annotation` field through save/load.
- **E2E (Playwright, available):** open workbench → click collapse edge → change grain → figure updates; add stats → annotate → bracket appears (or config persists if render-side is deferred).

## 11. Out of scope (separate follow-ups)

- **Significance-bracket rendering in `render.py`** if not already present — the annotate edge stores config and degrades gracefully meanwhile.
- **Persisting canvas layout** to `.iris` — explicitly rejected; session-only forever unless a concrete need appears.
- **Multiple analyses as one unified canvas** — rejected in favor of one-analysis-at-a-time with the switcher rail.
- **Manual node placement without auto-layout** (blank-whiteboard mode) — rejected; auto-layout keeps the array-op reading legible.

## 12. Risks

- **React Flow adoption** is the largest single change (new dependency, new rendering substrate). Mitigation: it is the standard tool for exactly this, and the graph *model* (`graph.ts`) is already built and tested — only the rendering swaps.
- **Card clutter** on small screens. Mitigation: collapse-all + tidy; cards open near their node and are closable; only one card per distinct target.
- **The annotate back-edge** complicates layout. Mitigation: pin plot as the global right-most sink and stats just inside it; route the annotate edge as a short back-link, not a flow edge.
```
