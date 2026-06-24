# Transformation Workbench — Phase 1: Graph Model + Annotate Edge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the stats→plot `"annotate"` edge to the graph model so the plot terminal gains its second input (significance brackets), derivable entirely from existing spec/style fields — no new spec field, no engine change.

**Architecture:** The graph builder `buildGraph` in `src/explorer/graph.ts` already emits the data-node + op-edge DAG. This phase adds one new `EdgeKind` (`"annotate"`) and one new edge (from the `stats` terminal to the `plot` terminal) emitted when a real test runs and significance annotation is enabled. The "enabled" decision reads the per-analysis `StyleOverrides.show_significance` flag that already exists. This is the only model change the later canvas/card phases depend on.

**Tech Stack:** TypeScript, Jotai, Vitest. Files: `src/explorer/graph.ts`, `src/explorer/graphAtom.ts`, and their `.test.ts` siblings.

**Branch note:** Work proceeds on `main` (this repo has no users and a concurrent thread also commits to `main`, per project convention). Do not create a feature branch unless the working tree is dirty with unrelated changes.

---

## Context for the implementer

`buildGraph(steps, spine, plan, layers, schema, stats, post)` returns `{ nodes, edges }`. It always pushes a `plot` node (`PLOT_ID = "plot"`) and a `stats` node (`STATS_ID = "stats"`), emits one `geom` edge per grain the plot reads (into `plot`), and one `test` edge (into `stats`). See `src/explorer/graph.ts:173-273`.

`StatsInput` is currently `{ test: string | null; describeOnly: boolean }` (`src/explorer/graph.ts:51`). It is built by the internal `statsInputAtom` in `src/explorer/graphAtom.ts:13-21` from the active `Plottable`.

The per-analysis annotation toggle already exists: `Plottable.style` is a `StyleOverrides` object whose `show_significance?: boolean` field (`src/types.ts:338`) means "draw significance brackets." There is **no** new spec field to add — this phase only reads what is already there.

**Why the annotate edge does not break `buildWorkspaceModel`:** that function (`src/explorer/workspace.ts`) walks the main chain from `source` (which never reaches `stats`) and builds the terminal fork only from `geom`/`test` edges (`BRANCH` set). An `"annotate"` edge from `stats`→`plot` is therefore inert there — neither traversed nor rendered — so existing `workspace.test.ts` stays green untouched. The Phase 2 canvas will consume the annotate edge explicitly.

---

## Task 1: Add the `annotate` edge to `buildGraph`

**Files:**
- Modify: `src/explorer/graph.ts:10-13` (EdgeKind union), `:51` (StatsInput), `:268-272` (after the test edge)
- Test: `src/explorer/graph.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/explorer/graph.test.ts`. Reuse the file's existing module-level `SPINE`, `PLAN`, `SCHEMA` fixtures (lines 16-17, 7). Note `layers` is defined *locally* inside other test blocks, so these tests pass their own empty `[]` — the annotate logic is independent of layers, and `[]` makes `buildGraph` emit its fallback `g:plain` geom edge into `plot`, which keeps the "two inbound edges" assertion valid:

```ts
describe("buildGraph: annotate edge (stats -> plot)", () => {
  it("emits an annotate edge when a test runs and annotation is enabled", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: "mann_whitney", describeOnly: false, annotate: true });
    const a = g.edges.filter((e) => e.kind === "annotate");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ fromId: "stats", toId: "plot" });
  });

  it("omits the annotate edge when annotation is disabled", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: "mann_whitney", describeOnly: false, annotate: false });
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });

  it("omits the annotate edge in describe-only mode (no test to bracket)", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: null, describeOnly: true, annotate: true });
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });

  it("omits the annotate edge when stats input is null", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA, null);
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });

  it("the plot node then has two inbound edges: geom and annotate", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: "mann_whitney", describeOnly: false, annotate: true });
    const intoPlot = g.edges.filter((e) => e.toId === "plot");
    expect(intoPlot.some((e) => e.kind === "geom")).toBe(true);
    expect(intoPlot.some((e) => e.kind === "annotate")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/explorer/graph.test.ts -t "annotate edge"`
Expected: FAIL — `annotate` is not a valid `StatsInput` property (TS error) and no `"annotate"` edge is produced.

- [ ] **Step 3: Extend the EdgeKind union and StatsInput**

In `src/explorer/graph.ts`, change the `EdgeKind` union (lines 10-13) to add `"annotate"`:

```ts
export type EdgeKind =
  | "filter" | "drop" | "derive" | "recode" | "join"
  | "pivot" | "grid_complete"
  | "collapse" | "geom" | "test" | "annotate";
```

Change `StatsInput` (line 51) to carry the optional annotate flag (optional so the 24 existing call sites compile unchanged; absent ⇒ off):

```ts
export interface StatsInput { test: string | null; describeOnly: boolean; annotate?: boolean }
```

- [ ] **Step 4: Emit the annotate edge after the test edge**

In `buildGraph`, immediately after the `edges.push({ id: "t:test", ... })` block (currently `src/explorer/graph.ts:268-270`) and before `return { nodes, edges };`, add:

```ts
  // the stats result drawn back onto the figure as significance brackets: an edge
  // because it CONSUMES the stats node's output (test -> comparisons -> brackets).
  // Emitted only when a real test runs (not describe-only) and the analysis has
  // significance annotation enabled. The plot node thereby gains a second input.
  if (stats && !stats.describeOnly && stats.annotate) {
    edges.push({ id: "a:annotate", kind: "annotate", label: "significance",
      fromId: STATS_ID, toId: PLOT_ID });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/explorer/graph.test.ts -t "annotate edge"`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full graph + workspace suites to confirm no regression**

Run: `npx vitest run src/explorer/graph.test.ts src/explorer/workspace.test.ts`
Expected: PASS — existing tests unchanged; `buildWorkspaceModel` ignores the new edge.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no error from the 24 existing `StatsInput` call sites, since `annotate` is optional).

- [ ] **Step 8: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(graph): stats->plot annotate edge (plot's second input)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM"
```

---

## Task 2: Wire the annotate flag from the analysis's style

**Files:**
- Modify: `src/explorer/graphAtom.ts:13-21` (statsInputAtom) + a new exported pure helper
- Test: `src/explorer/graphAtom.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/explorer/graphAtom.test.ts`:

```ts
import { annotateEnabled } from "./graphAtom";
import type { StyleOverrides } from "../types";

describe("annotateEnabled", () => {
  it("is true when show_significance is set", () => {
    expect(annotateEnabled({ show_significance: true } as StyleOverrides)).toBe(true);
  });
  it("is false when show_significance is unset or false", () => {
    expect(annotateEnabled({} as StyleOverrides)).toBe(false);
    expect(annotateEnabled({ show_significance: false } as StyleOverrides)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/explorer/graphAtom.test.ts -t "annotateEnabled"`
Expected: FAIL — `annotateEnabled` is not exported.

- [ ] **Step 3: Add the helper and use it in statsInputAtom**

In `src/explorer/graphAtom.ts`, add the import of `StyleOverrides` to the existing `../types` import, add the exported helper above `statsInputAtom`, and set `annotate` in the returned object:

```ts
/* significance annotation is enabled per-analysis via the style override the
   render layer already reads. Pure so the graph wiring is unit-testable without
   a store. */
export const annotateEnabled = (style: StyleOverrides): boolean =>
  !!style.show_significance;

const statsInputAtom = atom<StatsInput | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const res = get(analysisAtom);
  return {
    test: res?.stats?.result?.test ?? p.override ?? null,
    describeOnly: p.describeOnly,
    annotate: annotateEnabled(p.style),
  };
});
```

(`StyleOverrides` is exported from `src/types.ts`; add it to the `import type { ShapeCountsGuards, GuardVerdict } from "../types";` line.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/explorer/graphAtom.test.ts -t "annotateEnabled"`
Expected: PASS (1 test, 3 assertions).

- [ ] **Step 5: Run the full graphAtom suite + typecheck**

Run: `npx vitest run src/explorer/graphAtom.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/explorer/graphAtom.ts src/explorer/graphAtom.test.ts
git commit -m "feat(graph): enable annotate edge from per-analysis show_significance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM"
```

---

## Phase 1 done-check

- [ ] `npx vitest run` — full frontend suite green.
- [ ] `npx tsc --noEmit` — clean.
- [ ] The graph now contains an `annotate` edge `stats`→`plot` exactly when the active analysis runs a test and has `show_significance` on; the plot node has two inbound edges. Nothing else changed; engine and `.iris` format untouched.

---

# Phases 2–5 roadmap (each expanded into its own dated plan before execution)

These are scoped here so the whole arc is visible, but **each becomes its own full bite-sized plan** (like the array-lens phase2/phase3 plans) written just before it runs — because the exact React Flow API surface and card props firm up as the prior phase lands. Each phase is independently green.

## Phase 2 — React Flow canvas + auto-layout

**Goal:** Replace the read-only `WorkspaceView` overlay with a live pan/zoom canvas that renders the existing graph horizontally, left→right, with draggable nodes and a "tidy" re-flow.

**New deps/files:** add `@xyflow/react`; `src/workbench/WorkbenchCanvas.tsx` (canvas), `src/workbench/layout.ts` (graph → deterministic left→right layered positions; the annotate edge routes as a short stats→plot back-link, not a flow edge), `src/workbench/state.ts` (`nodePositionsAtom`, `selectedTargetAtom`). Reuse `ArrayShapeNode` as the custom node, `OpHoverExample`/`cannedExamples` on a custom edge.

**Key tasks:** (1) `layout.ts` pure function: graph → `{nodes:{id,x,y}, edges}` with the annotate back-edge handled — unit-tested for determinism and that `plot` is the right-most sink. (2) Custom React Flow node = `ArrayShapeNode`. (3) Custom edge with label + hover schematic. (4) `WorkbenchCanvas` wiring pan/zoom/drag + "tidy" (clears `nodePositionsAtom`). (5) RTL smoke test: graph renders all nodes/edges. **Independently green:** mount the canvas behind the existing Expand button until Phase 5 cutover.

## Phase 3 — Generic FloatingCard + card registry + card state

**Goal:** The ephemeral card shell and the machinery that maps a clicked target to a card, with session-only state.

**New files:** `src/workbench/FloatingCard.tsx` (move/resize/collapse/close), `src/workbench/cardRegistry.tsx` (target → card kind → body), extend `src/workbench/state.ts` with `cardsAtom: Card[]` (`{id, target:{kind:"node"|"edge", id}, cardKind, x, y, w, h, collapsed}`).

**Key tasks:** (1) `FloatingCard` pure component — drag title bar, corner resize, collapse, close emit state callbacks (RTL). (2) `cardsAtom` + add/move/resize/collapse/close reducers (unit-tested). (3) `cardRegistry` maps each `EdgeKind`/`NodeKind` target to a card kind (unit-tested: every clickable target resolves). (4) Selecting a node/edge on the canvas opens its card; switching analyses clears `cardsAtom`. **Independently green:** cards render placeholder bodies until Phase 4.

## Phase 4 — The individual cards (wrap existing panels)

**Goal:** Fill each card kind with the real, existing panel — no rewrites.

**New files (thin wrappers):** `src/workbench/cards/{TableCard,OpEditorCard,CollapseCard,GeomCard,TestCard,AnnotateCard,PlotCard,StatsCard}.tsx`.

**Mapping (one task each, each green on its own):**
- `TableCard` ← `DataTab`/`DataTable` + an "Extend from here" menu (`addStepAtom`).
- `OpEditorCard` ← `StepCards` field editors (`updateStepAtom`/`removeStepAtom`).
- `CollapseCard` ← `CollapseRoutingPanel` (`setCollapsePlanAtom`/`setTestGrainAtom`).
- `GeomCard` ← `EncodingsCard` + `LayerRail` + geom picker + decorative annotations (`addLayerAtom`/`updateLayerAtom`).
- `TestCard` ← `GuidedTestPicker`.
- `AnnotateCard` ← new small editor over the existing `show_significance` / `annotations.significance_brackets` / `style` fields (comparisons, p-format).
- `PlotCard` ← `FigurePane` + `StylePane`.
- `StatsCard` ← `StatsPanel` (result view only).

Each task: render the wrapper in a card with fixture props/atoms (RTL), assert the reused panel mounts and edits route through its existing atom.

## Phase 5 — Interaction flows + App.tsx cutover

**Goal:** Make the workbench the Analyses view and delete the old layout.

**Key tasks:** (1) Rename `viewModeAtom` value `"analyses"` → `"workbench"` (3 call sites in `App.tsx`, the toggle label). (2) Replace the entire `viewMode === "analyses"` branch in `App.tsx:475-508` (PlottableSidebar + LayerRail + CollapseRoutingPanel + Section stack + tx-strip + `<TransformWorkspace/>`) with `<WorkbenchCanvas/>` + the switcher rail. (3) Delete `workspaceOpenAtom`, the `tx-expand` button, `TransformWorkspace.tsx`, and the now-dead overlay framing of `WorkspaceView.tsx`. (4) "Extend from here" append-then-edit flow opens the new edge's card. (5) Keep all reactive effects in `App.tsx` (analyze / reduce-preview / shape-counts / background warmer) — they depend on atoms, not layout. (6) E2E (Playwright): open workbench → click collapse edge → change grain → figure updates; add stats → enable annotation → annotate edge appears.

**Out of scope (per spec §11):** bracket rendering in `render.py` (annotate edge degrades gracefully — config stored, overlay drawn only if/when the render side supports it); persisting layout to `.iris`; unified multi-analysis canvas; blank-whiteboard manual node placement.
