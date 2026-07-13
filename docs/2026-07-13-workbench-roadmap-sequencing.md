# Workbench roadmap — sequencing the active thrust (2026-07-13)

_Purpose: put the reduce-DAG work, multi-lineage plot routing (spec 2.3), and the
approved-but-unstarted workbench-UX cluster into one dependency-ordered sequence, so we
finish threads before opening new ones. This is a sequencing overlay on the tiered
backlog in the root `ROADMAP.md` and `TODO.md`; it does not replace them._

## Where we are

- **Reduce DAG (spec 2.2)** is the current centre of gravity and is *almost* closed:
  engine (Phase A), spec + `.iris` 2.2 (B), `buildGraph` adjacency (C), and canvas
  connect/branch/merge (D) have all landed; the gallery is regenerated (E2). What is
  *not* closed: E1 (remove the now-redundant inline-right join path), E3 (update `TODO.md`
  and move the design Status off "awaiting review"), and a tail of figure-node edge
  polish still committing on top (`942fe2e`, `005ac9d`, `75d402a`).
- **An uncommitted app/import visual redesign** sits in the working tree (`src/index.css`,
  `App.tsx`, `ImportWizard.tsx`, `DataEntry.tsx`, `gridTheme.ts`, plus 21 selector/timing
  touch-ups to `e2e/*.mjs`, and an `App redesign request.zip`). It is unfinished, nothing
  staged. It overlaps the workbench-UX cluster's files and touches `state.ts`.
- **The e2e suite is broadly stale** (per prior audit) — a real-browser verification pass
  is owed regardless of which item is next.

## The sequence

Each item lists: what, why here, what it depends on, rough size.

### 1. Close spec 2.2 cleanly
**What:** finish E1 (dissolve the inline-right join path so there is one fan-in
mechanism, not two), E3 (update `TODO.md`, set the design Status to implemented), land
the in-flight figure-node edge polish, and run a real-browser verification of the DAG
canvas (connect/branch/merge, deletion rewiring).
**Why here:** everything downstream builds on the DAG. Two coexisting join mechanisms is
exactly the incoherence 2.2 set out to remove; leaving it half-done taxes every later
change. A design left "awaiting review" is an open loop.
**Depends on:** nothing. This is the first thing.
**Size:** S–M.

### 2. Reconcile the uncommitted app/import redesign
**What:** land (or explicitly park on a branch) the working-tree redesign, and reconcile
its `e2e` touch-ups with the stale suite.
**Why here:** it overlaps the UX-cluster files and `state.ts`. Starting plans that edit
those files on top of a large uncommitted diff invites conflicts and muddies review. It
does not need to be *finished*, but it needs to be *off the shared working tree* before
items 5–7. (Not our design to drive — flag to Artur for a decision on land-vs-park.)
**Depends on:** nothing; can run in parallel with 1.
**Size:** unknown (someone else's WIP); treat as a gate, not a task.

### 3. Stage 0 of 2.3 — the multi-layer render bug
**What:** a `systematic-debugging` hunt on why same-lineage different-grain multi-layer
plots (raw dots + group means) do not render, despite being authorable
(`2026-07-12-reduce-dag-fanout-fanin-design.md:171`).
**Why here:** it is cheap, it is quarantined as a standalone track, and it de-risks the
whole layer-stack story — layers must render reliably before we add layer *sources*.
Likely delivers the superplot half of the reported screenshot on its own. Doing it first
tells us how much of 2.3 the user actually still needs.
**Depends on:** 1 (works against the settled DAG).
**Size:** S (a bug, not a feature) — but scope is unknown until reproduced.

### 4. Stage 1 of 2.3 — a layer pins to a node (overlay in one plot)
**What:** `LayerSource` gains `nodeId`; the geom edge roots at the pinned node; the layer
source picker is compatibility-gated; `+`→Plot on a compatible node offers "add as
layer." Delivers the raw-vs-filtered overlay from the screenshot.
**Why here:** it is the direct answer to the reported gap and it needs **no** architecture
inversion — both nodes already live in the plot's own DAG. High value, contained blast
radius.
**Depends on:** 1, 3. Design: `specs/2026-07-13-multi-lineage-plot-routing-design.md`.
**Size:** M.

### 5. Workbench-UX cluster
**What:** the approved-but-unstarted specs, sequenced among themselves:
`merge-plot-stats-figure-node` (partly underway via `942fe2e`/`005ac9d`),
`workbench-node-organised-by-values`, `workbench-landing-redesign`,
`workbench-connection-authoring`, `multi-table-input` (plan-a-frontend + plan-b-engine).
**Why here:** these polish the same canvas 2.3 Stage 2 will extend, and
`merge-plot-stats-figure-node` in particular defines the figure-terminal shape that Stage 2
hangs multiple plots off. Doing the figure-node merge before Stage 2 avoids reworking the
terminal twice.
**Depends on:** 2 (shared files clear). `merge-plot-stats-figure-node` is the natural
first sub-item and a Stage 2 prerequisite.
**Size:** L (a batch; each spec is its own plan).

### 6. Enabling refactor — split the `state.ts` god-module
**What:** the decomposition deferred in the 2026-06-28 audit (`state.ts`, ~1.6k lines,
~38 importers) and the `StatsResult` discriminated union, done only now that they bite.
**Why here:** 2.3 Stage 2 hoists `reduce` out of `Plottable` and adds consumer pinning —
material surgery on `state.ts`. The audit's rule was "leave both unless they start to
bite." Stage 2 is where they bite. Do the split as the enabling move, not tangled into
the feature.
**Depends on:** 5 (so the UX churn on `state.ts` has settled).
**Size:** M–L.

### 7. Stage 2 + Stage 3 of 2.3 — multi-plot shared DAG, then arrangement
**What:** promote `reduce` to a table-scoped shared pipeline; plottables carry
`sourceNodeId`; `buildGraph` projects one shared DAG with a terminal per plot; then
figure arrangement (side / on top).
**Why here:** the structural inversion, cleanest after the figure-node merge (5) and the
`state.ts` split (6) are in hand.
**Depends on:** 5, 6.
**Size:** L.

## Dependency sketch

```
1 close 2.2 ──┬─> 3 render bug ──> 4 Stage 1 overlay
              │
2 reconcile redesign ──> 5 UX cluster ──> 6 state.ts split ──> 7 Stage 2 + 3
   (gate, parallel to 1)     (merge-figure-node first)
```

Items 1–4 are the near-term spine and deliver the reported gap. Items 5–7 are the larger
workbench build-out; 2.3 Stage 2 deliberately waits behind the figure-node merge and the
`state.ts` split so we invert the model once, on settled ground.

## Parked (tracked, not scheduled here)

Deliberately out of this sequence; they live in `ROADMAP.md` / `TODO.md`:

- **Stats breadth:** McNemar, Poisson-rate minimal slice, paired plots, distribution/rate
  curves, shared-metric/repeated geoms.
- **Draft UX specs:** style sheets, stats info boxes, guided-test-picker UI,
  rationalize-plot-style.
- **Post-pipeline (`reduce.post`) authoring from the UI** — round-trip works; authoring
  needs its own brainstorm → spec → plan.
- **Transformation-explorer backend SVG render** of the lineage graph — side feature.
- **Identifier-vs-time-on-X friction** — `frame`/`time` columns default to `identifier`;
  flagged, no change made.
- **COV2D Part-2 §4/§4A** — closed on a separate thread; no in-repo plan.
- **DAG-ifying `reduce.post`, many-to-many join, append/union/concat vocabulary** —
  deferred by the 2.2 design.
