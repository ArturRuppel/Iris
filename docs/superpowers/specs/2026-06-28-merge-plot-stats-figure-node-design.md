# Merge the Plot and Stats terminals into one Figure node

**Date:** 2026-06-28
**Status:** Design approved, ready for planning

## Problem

In the workbench node-graph, an analysis ends in **two** terminal nodes — a
`Plot` node (carrying the geom chips) and a `Stats` node (carrying the test
chip) — joined by an `annotate` back-edge (`Stats → Plot`) that represents the
significance brackets drawn onto the figure. That back-edge is a cycle between
two terminals: it is the visible symptom that the plot and its test are not
really two things. A plot and the inferential test annotated on it are one
publishable artifact — a *figure*. The graph should say so.

The data model already agrees: a single `Plottable` object carries both the
plot config (mappings, layers, style) and the stats config (`override`,
`reference`, `describeOnly`), and the engine computes both in one pipeline over
one shared grain. The split is purely in the graph's *presentation*.

## Goal

Collapse the two terminal nodes into one **Figure** node that displays both the
plot and stats summaries, and change the interaction model on that node:

- **Left-click a section** → open that output (plot **or** stats) in the bottom
  viewer (the docked stash).
- **Right-click** → a menu whose items **edit** the plot or the test.

The card *contents* (`FigurePane`, `StatsResults`, `TestPicker`, `LayerRail`)
and the engine pipeline do **not** change. This is a graph-node + affordance
change only.

## Non-goals

- No change to the `Plottable` data model, `AnalysisSpec` wire format, or the
  engine (`render.py`, `stats.py`).
- No change to the reduce-step nodes/edges or their click-to-edit affordance.
  The new left=view / right=edit model applies to the **Figure node only**;
  reduce nodes keep their current behaviour.
- No change to what the plot/stats/test/geom editor panels render internally.

## Design

### 1. Graph model — one terminal node

File: `src/explorer/graph.ts` (`buildGraph`, terminal emission ~L250–326).

- Replace the two pushed terminals (`PLOT_ID` kind `"plot"`, `STATS_ID` kind
  `"stats"`) with **one** node: `FIGURE_ID = "figure"`, `kind: "figure"`,
  `phase: "terminal"`, `label: "Figure"`.
- The figure node carries **both** fact groups. Today each terminal has a flat
  `facts: string[]`; the figure node needs the geom facts and the test fact kept
  **distinct** so the renderer can label them as two sections. Add a structured
  field to `ExplorerNode` for terminal sections, e.g.:

  ```ts
  sections?: { kind: "plot" | "stats"; facts: string[] }[];
  ```

  Built as: `plot` section = the distinct geom labels (first-seen order);
  `stats` section = `[testFact]` (the test label, or `"describe"` when
  describe-only). The old shared `"significance"` / `"brackets on plot"` chips
  are dropped — the brackets are now an internal property, surfaced (if desired)
  as a small marker on the stats section rather than a separate fact.
- The `geom` edges (grain → figure) and the `test` edge (grain → figure) now
  both target `FIGURE_ID`. Provenance is preserved: the geoms' grain(s) and the
  test grain remain visible as incoming edges, even when they differ.
- **Delete** the `annotate` back-edge block (graph.ts ~L312–323). With one
  terminal there is nothing to connect; the relationship is internal to the
  node.
- `NodeKind` narrows from `"table" | "plot" | "stats"` to `"table" | "figure"`.

### 2. Node rendering — two labeled sections

Files: `src/workbench/ArrayShapeRFNode.tsx`, `src/components/ArrayShapeNode.tsx`.

- `variantOf`: `phase === "terminal"` → a single `"figure"` variant (replacing
  the `plot`/`stats` branch).
- `ArrayShapeNode` renders the figure variant as **two stacked, labeled
  sections** inside one node body:
  - **PLOT** section — existing geom accent (green), the geom chips.
  - **STATS** section — existing test accent (purple), the test chip.
  This is the layout in the approved mockup: the two of today's nodes, stacked,
  with the gap between them removed and one border around both.
- Each section is its own click target (see §3): the section element carries the
  hit handler and, when pinned, the numbered slot badge.
- Remove the `annotate-in` handle and its comment block from `ArrayShapeRFNode`
  (L133–139) — the back-edge it served is gone.
- `accentKind` / `eyebrowText`: replace the `plot`/`stats` cases with per-section
  derivation (each section supplies its own accent + label), since one node now
  owns both.

### 3. Left-click = view, section-targeted

Files: `src/workbench/WorkbenchCanvas.tsx`, `src/workbench/state.ts`,
`src/workbench/cardRegistry.tsx`.

- The figure node exposes **two view facets**: `plot` and `stats`. Left-clicking
  the PLOT section pins `FigurePane`; left-clicking the STATS section pins
  `StatsResults`.
- React Flow renders one node (`id: "figure"`), so the per-section click cannot
  rely on `onNodeClick` alone (which is whole-node). The section elements in
  `ArrayShapeNode` dispatch the pin directly, each with a **facet-specific
  target**, so the two cards get distinct stash ids and can coexist.
  Proposed target encoding: `{ kind: "node", id: "figure", facet: "plot" |
  "stats" }`, with the stash `cardId` keyed on `kind:id:facet`. (`Target` gains
  an optional `facet` field; existing single-facet targets leave it undefined.)
- `targetToCardKind`: a `figure` node with `facet === "stats"` → `"stats"` card;
  otherwise → `"plot"` card.
- Slot badge (`ArrayShapeRFNode` L107–109, `stash.findIndex`): match on
  `id + facet` so the badge lands on the pinned section. Both sections can show
  their own badge when both are pinned.

### 4. Right-click = edit

Files: `src/workbench/WorkbenchCanvas.tsx` (`onNodeContextMenu`),
`src/workbench/NodeContextMenu.tsx`.

- `NodeContextMenu` currently offers a single "Delete step" for reduce nodes.
  Generalize it to a small list of menu items.
- For the figure node, the menu items are **Edit plot…** and **Edit test…**:
  - *Edit plot…* opens the `geom-editor` card (`LayerRail`) — the same card the
    `geom` edge opens today.
  - *Edit test…* opens the `test-editor` card (`TestPicker`) — the same card the
    `test` edge opens today.
  Both open as floating editor cards via `openCardAtom`, exactly as the
  edge-click path does now.
- The figure node has **no Delete** — it is the pipeline's terminal output,
  consistent with today's non-deletable terminals.
- The reduce-node "Delete step" path is unchanged.
- The existing edge-click editors (clicking the `geom`/`test` edge) are **kept**
  — they already work and removing them buys nothing. Right-click on the node is
  the new, primary entry point.

### 5. The significance-bracket toggle moves into the Test editor

Files: `src/components/StatsPanel.tsx` (`TestPicker`),
`src/workbench/cards/AnnotateCard.tsx`, `src/workbench/cardRegistry.tsx`.

- The `annotate` edge is deleted, so its editor (`AnnotateCard`, which toggles
  whether significance brackets are drawn on the figure) loses its trigger.
- Fold the show-significance toggle into the **Test editor** (`TestPicker`):
  brackets are only meaningful when a real test runs, and they are how the test
  result is presented on the figure. The toggle binds to the same style field it
  binds to today (`style.show_significance` / the `annotate` flag — confirm exact
  field during implementation).
- Retire the standalone `annotate-editor` card and `AnnotateCard` component;
  remove the `annotate` entry from `EDGE_CARD` and the `"annotate-editor"` arm of
  `CardKind`.

### 6. Card registry, types, and tests

Files: `src/workbench/cardRegistry.tsx`, `src/workbench/cardRegistry.test.tsx`,
graph builder tests.

- `CardKind`: drop `"annotate-editor"`. `plot`/`stats` card kinds remain (the
  facet targets resolve to them).
- `EDGE_CARD`: drop the `annotate` mapping.
- `targetToCardKind`: handle the `figure` node kind + facet (per §3).
- Update `cardRegistry.test.tsx` and the `buildGraph` tests to expect a single
  `figure` terminal (no `PLOT_ID`/`STATS_ID`, no `annotate` edge), two sections,
  and the facet→card mapping.

## Data flow

```
table → reduce… → grain ──geom──▶ ┌─────────────┐
                       └──test───▶ │   Figure    │
                                   │  PLOT  ⟵ left-click → FigurePane (stash)
                                   │  STATS ⟵ left-click → StatsResults (stash)
                                   └─────────────┘
                                     right-click → Edit plot… / Edit test…
```

No back-edge; the test↔plot relationship lives inside the node.

## Affected files (summary)

| File | Change |
|------|--------|
| `src/explorer/graph.ts` | One `figure` terminal w/ `sections`; drop `annotate` edge; `NodeKind` narrows |
| `src/components/ArrayShapeNode.tsx` | Render figure variant as two labeled sections |
| `src/workbench/ArrayShapeRFNode.tsx` | `variantOf`/`accentKind`/`eyebrowText`; remove `annotate-in` handle; per-facet slot badge |
| `src/workbench/WorkbenchCanvas.tsx` | Section-targeted pin; figure right-click menu (Edit plot/test) |
| `src/workbench/NodeContextMenu.tsx` | Generalize to a menu-item list |
| `src/workbench/state.ts` / `cardRegistry.tsx` | `Target.facet`; `targetToCardKind` for `figure`; drop `annotate-editor` |
| `src/components/StatsPanel.tsx` | `TestPicker` gains the show-significance toggle |
| `src/workbench/cards/AnnotateCard.tsx` | Retired |
| `*.test.tsx` | Single-terminal graph shape; facet→card mapping |

## Testing

- **Graph builder unit tests:** `buildGraph` emits exactly one terminal
  (`figure`) with a `plot` section and a `stats` section; geom + test edges
  target it; no `annotate` edge.
- **cardRegistry tests:** `targetToCardKind` resolves the figure node's `plot`
  facet → `plot` card and `stats` facet → `stats` card; `annotate-editor` is
  gone.
- **Component/interaction:** left-click PLOT section pins `FigurePane`;
  left-click STATS section pins `StatsResults`; both can be pinned at once with
  matching slot badges; right-click → menu with Edit plot…/Edit test… opening
  the geom and test editors.
- **Significance toggle:** flipping it in `TestPicker` shows/hides brackets on
  the figure (same behaviour the retired `AnnotateCard` had).
- **E2E (Playwright/Chromium available):** a smoke pass over the merged node —
  view both facets, open both editors, toggle significance.

## Open implementation details (resolve during planning)

- Exact `Target.facet` encoding and the `cardId` key change — keep it minimal so
  non-figure targets are unaffected.
- Confirm the precise style/flag field the significance toggle binds to when
  moved into `TestPicker`.
- Whether the stats section shows a small "brackets on" marker now that the
  `"significance"` fact chip is dropped.
