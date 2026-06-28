# Workbench Landing Redesign — Hero Cards + Guided Plot Wizard

**Date:** 2026-06-29
**Status:** Design — approved for planning

## Problem

Arriving at the Transformation Workbench drops the user onto an abstract
node-graph (the DAG) with no obvious next move. The geom/encoding affordance is
buried behind a DAG edge and exposes the whole `LayerRail` + `EncodingsCard`
surface at once, with no guided entry point. There is no clear "start here," and
the column pickers offer columns that can never produce a valid plot (ID-only
columns, single-value categories).

The goal: land on the **outputs** — the source Table, the Plot, and the Stats —
as three first-class cards, with Plot and Stats clearly disabled until they
exist, and replace the geom/encoding affordance with a guided **add-plot
wizard** that only ever offers valid choices.

This is a **front-end-only** effort. The data model (`Plottable`/`Layer`), the
`AnalysisSpec`, and the Python engine are unchanged. See §6 for why.

## Scope

In scope:

1. New landing layout: a compact DAG band on top, three hero cards below.
2. Card enabled/disabled states (Table always on; Plot/Stats gated).
3. A guided add-plot wizard replacing `LayerRail` as the *entry* surface.
4. Validity gating: hide columns that cannot produce a valid plot.
5. Relocating the stats picker/results into the Stats hero card.

Out of scope (explicitly):

- Per-layer aesthetics / any engine or `AnalysisSpec` change (see §6).
- Multi-plot canvas (single-plot model holds — one figure, many layers).
- Changes to the reduce-step editors, collapse routing, or the DAG's edit
  semantics (delete/undo/focus from the prior UX effort all stay).

## The encoding model (decided, unchanged)

Encoding is **two-tier**, and this redesign keeps the current tiering:

- **Figure-level (shared by every layer):** `X`, `Y` (required), `Color`,
  `Shape`, `Size`, `Facet Row`, `Facet Col`. These live on `Plottable`.
  Color/Shape are categorical groupings that *drive the statistical model*
  (`statmodel.py` reads `color` as a grouping/second factor; faceting builds one
  panel grid for the whole figure), so they must be shared and consistent across
  layers. Size is numeric/continuous and rides with the block for coherence.
- **Per-layer:** `geom` + `level` (grain), plus existing cosmetic style
  overrides keyed by `Layer.id`. This is exactly today's `Layer` shape.

We explored moving Color/Shape/Size onto `Layer` (per-layer aesthetics) and
rejected it: a categorical color is a declaration of subgroups, and subgroups
change the one figure-level test (two-way comparison; stratified correlation).
Per-layer color would make "which layer feeds the test?" ambiguous. Keeping them
figure-level is both the principled choice and the one that requires no engine
change.

## 1. Landing layout

The workbench overlay splits vertically:

- **Top — DAG band (~25% height, always visible).** The existing React Flow
  graph (`WorkbenchCanvas`'s `ReactFlow`) rendered compact. It remains the live
  projection of the active analysis spec; all current DAG behaviors (node/edge
  click → cards, right-click delete, undo/redo, tidy, grain legend) are
  preserved. It is no longer the landing focus, just a persistent overview.
- **Bottom — three hero cards (~75% height): `Table · Plot · Stats`.** Always
  present, side by side. These are *fixed* cards, distinct from the ephemeral
  stash/floating cards that DAG clicks still open.

The existing stash + floating-card machinery (`Stash`, `FloatingCard`,
`pushStashAtom`, focus mode) is unchanged and continues to serve DAG-click
interactions. The three hero cards are a new, always-on row — not stash tiles.

Rough heights are tiling-resizable via the existing `workbenchLayoutAtom` /
`WorkbenchResize` mechanism (reuse, don't reinvent).

## 2. Card states

The three hero cards each have an enabled and a disabled (greyed/hatched)
presentation.

- **Table** — always enabled. Renders the source table (`TableCard` body bound
  to the source node, or the active table). A source table always exists.
- **Plot** — enabled iff `isSpecRenderable(activeSpec, effectiveSchema)` (the
  existing predicate: a `Y` mapping, `≥1` layer, mapped axes survive the
  post-reduction schema). When disabled, the card shows a single primary
  call-to-action: **`+ add plot`**. Clicking the disabled card *or* the button
  launches the wizard (§3). When enabled, it renders `FigurePane` plus a small
  layer strip (the layer list + `+ add layer`, lifted from `LayerRail`).
- **Stats** — enabled iff the Plot is enabled. When disabled it reads
  "needs a plot." When enabled it **auto-derives** the default test from the
  figure's X/Y types (today's behavior — family is derived, not chosen) and
  renders `StatsResults` plus a compact control to change the test / set
  describe-only (`TestPicker`). There is no separate "add test" step.

Disabled cards use a consistent greyed + hatched treatment (a shared
`.txw-card-disabled` style) so the row reads as "one done, two waiting."

## 3. The add-plot wizard

A new component (working name `PlotWizard`) replaces `LayerRail` as the *entry*
surface. It is a small stepwise card (Next / Back) rendered into the Plot hero
card region while adding. It reuses the existing add/encoding atoms
(`addLayerAtom`, `updateLayerAtom`, `activePlottableAtom` writes,
`moveLayerAtom`, `removeLayerAtom`) — it is a new *shell* over existing state,
not new state.

### First layer

- **Step 1 — Plot type.** A gallery of geoms that are *valid for the data*
  (`geomAddable` gating from `channels.ts`, plus validity gating from §4).
  Picking a geom advances.
- **Step 2 — Map data.** `X` and `Y` are required (figure-level). `Color`,
  `Shape`, `Size`, `Facet Row`, `Facet Col` are optional refinements behind the
  existing `+ encoding` adder (figure-level). All dropdowns show only valid
  columns (§4). The currently-mapped column is never hidden.
- **Done.** The plot renders in the Plot hero card; the wizard collapses to the
  layer strip.

### Add layer (re-entry)

Because Color/Shape/Size/Facet and X/Y are figure-level, adding a layer never
re-asks them. The "+ add layer" wizard asks only:

- **Step 1 — geom** (gallery, validity-gated against the existing encoding).
- **Step 2 — grain/level** (the `level` for this layer; default the coarsest /
  raw as today).
- The figure's X/Y (+ facet/color/shape/size) are shown **read-only** with a
  "change for the whole figure" link that re-opens the figure-level encoding
  editor (Step 2 of the first-layer flow, operating on the shared block).

Incompatible-with-this-geom shared encodings (e.g. numeric Color on a box) are
surfaced as disabled-with-reason, matching today's `EncodingsCard`/`renderStatus`
behavior — they are not silently rendered.

## 4. Validity gating

A column is **hidden entirely** (the chosen treatment — no struck-through
rows) from a channel when it cannot produce a valid plot on that channel:

- **Identifier columns** (`ColumnDef.type === "identifier"`) — already excluded
  from non-facet channels by `colType`/`offeredColumns`; keep that, and ensure
  the wizard's pickers go through the same `offeredColumns` path.
- **Single-value categoricals** — a categorical column with `≤ 1` distinct level
  is useless for any grouping channel (X of a boxplot, Color, Shape, Facet).
  Detect via `ColumnDef.levels` (length `≤ 1`) when present, else
  `TableCounts.n_distinct` (`≤ 1`). Add this as a new predicate in `channels.ts`
  and apply it inside `offeredColumns` for grouping channels.
- **Geom-type incompatibility** — unchanged: `geomAddable` / `geomGateReason`
  continue to gate the geom gallery and the axis offers.

The gallery in Step 1 hides geoms that no valid column assignment could
satisfy (e.g. nothing categorical for a boxplot X), reusing the same predicates.

## 5. Stats card relocation

`TestPicker` and `StatsResults` move from their current home into the Stats hero
card body (the `stats` card kind in `cardRegistry`). No behavioral change to the
stats engine or family derivation — purely where the components mount. The card's
enabled/disabled state follows §2.

## 6. Why no engine change

The earlier draft considered per-layer Color/Size/Shape, which would have
required: moving those fields from `Plottable` onto `Layer`; splitting them out
of `AnalysisSpec.encodings` into `layers[]`; threading per-layer aesthetics
through `render.py` (today reads `enc["color"]` once); and resolving which
layer's color feeds the figure-level `statmodel.py` test. Keeping Color/Shape/Size
figure-level removes all of that. The engine, the `AnalysisSpec`, the frozen
`.iris` v1.0 export format, and the `Plottable`/`Layer` types are **untouched**.

## Components & files (rough)

- **New:** `src/components/PlotWizard.tsx` (stepwise add-plot/add-layer shell).
- **New:** the three-hero-card layout region + disabled-card styling, in
  `WorkbenchCanvas.tsx` (band/hero split) and `cardRegistry.tsx` / CSS.
- **Changed:** `WorkbenchCanvas.tsx` — vertical split (DAG band + hero row),
  wire the Plot card's `+ add plot` to the wizard.
- **Changed:** `cardRegistry.tsx` — Plot/Stats card bodies gain enabled/disabled
  states; Stats body hosts `TestPicker` + `StatsResults`.
- **Changed:** `channels.ts` — add the single-value-category predicate; route the
  wizard's pickers through `offeredColumns`.
- **Changed/replaced:** `LayerRail.tsx` — its entry role is taken by the wizard;
  the always-on layer strip (list + `+ add layer`) is retained, either trimmed in
  place or extracted into the Plot card.
- **Reused as-is:** `EncodingsCard.tsx` (the figure-level Step-2 body),
  `FigurePane`, `StatsResults`/`TestPicker`, `isSpecRenderable`, the add/encoding
  atoms, stash/focus/undo machinery.

## Testing

- **Unit (vitest):** card enabled/disabled selection from `isSpecRenderable`;
  the single-value-category predicate; the wizard step state machine (geom →
  map → done; add-layer skips X/Y); `offeredColumns` hides ID + single-value
  columns for grouping channels.
- **Component:** wizard renders only valid geoms in the gallery; Step 2 dropdowns
  omit invalid columns; add-layer shows X/Y read-only.
- **E2E (Playwright, Chromium available):** land on workbench → Plot & Stats
  greyed → `+ add plot` → pick box → map X/Y → plot renders, Stats ungreys and
  shows a test → `+ add layer` → points → second layer renders. (The committed
  e2e suite is stale per prior notes; this flow likely needs fresh specs.)

## Open questions

None blocking. Size-channel placement (figure-level vs per-layer) was decided
figure-level; revisit only if a concrete per-layer-size need appears.
