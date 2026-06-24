# Transformation Workbench — Phase 5: interaction wiring + App.tsx cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the workbench the live analysis surface: clicking a node/edge opens its card, open cards float over the DAG, node nudges persist, and `App.tsx`'s old Analyses layout is replaced by the embedded `<WorkbenchCanvas/>`.

**Architecture:** All Phase 1–4 pieces exist (graph model, React Flow canvas, `FloatingCard` shell, card bodies, session-only atoms). Phase 5 connects them: React Flow `onNodeClick`/`onEdgeClick` → `targetToCardKind` → `openCardAtom`; `cardsAtom` rendered as a `FloatingCard` overlay; `onNodeDragStop` → `nodePositionsAtom` (tidy clears it); then App.tsx swaps the `viewMode === "analyses"` branch for the embedded canvas and the now-dead overlay/strip code is deleted. Nothing new is serialized.

**Tech Stack:** TypeScript, React 18.3, Jotai, `@xyflow/react` v12, Vitest 4 + @testing-library/react.

**Standing constraints:** No layout/card/position state is ever written to `.iris`. No backward-compat/migration (no users) — delete old paths outright. Commit trailers required on every commit:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM
```

---

## File structure

- Modify: `src/workbench/WorkbenchCanvas.tsx` — click→card wiring, cards overlay, collapse-all, node-nudge persistence, `onClose` made optional.
- Modify: `src/workbench/WorkbenchCanvas.test.tsx` — cover the new behaviors.
- Modify: `src/index.css` — `.txw-cards` overlay container.
- Modify: `src/App.tsx` — viewMode rename, embed the canvas, drop the strip/overlay, clear workbench on analysis switch, prune dead imports.
- Modify: `src/state.ts` — rename `viewModeAtom` literal; delete `workspaceOpenAtom`.
- Delete: `src/components/WorkspaceView.tsx` (+`.test.tsx`), `src/components/TransformWorkspace.tsx` (+`.test.tsx`), `src/components/TransformExplorer.tsx`.

Reused unchanged: `FloatingCard`, `cardRegistry` (`targetToCardKind`), `state.ts` atoms (`openCardAtom`, `cardsAtom`, `nodePositionsAtom`, `collapseAllCardsAtom`, `clearWorkbenchAtom`), `explorerGraphAtom`, `layoutGraph`.

`selectedNodeIdAtom` and `DataTab.tsx` are **kept** (DataTab is reused by the deferred Phase 4b TableCard; its `selectedNodeIdAtom` dependency stays defined).

---

## Task 1: Click a node/edge opens its card; open cards float over the canvas; collapse-all

**Files:**
- Modify: `src/workbench/WorkbenchCanvas.tsx`
- Modify: `src/workbench/WorkbenchCanvas.test.tsx`
- Modify: `src/index.css`

The `Canvas` component gains card wiring. It already runs inside the app's Jotai store (and tests wrap it in a `<Provider store>`); read/write the session atoms with `useSetAtom`/`useAtomValue`.

- [ ] **Step 1: Write failing tests** (replace `src/workbench/WorkbenchCanvas.test.tsx` body)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { WorkbenchCanvas } from "./WorkbenchCanvas";
import { cardsAtom } from "./state";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "step:0", kind: "table", label: "filtered", table: { via: "at_step", at_step: 0 } },
    { id: "plot", kind: "plot", label: "Plot", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "step:0" },
    { id: "g0", kind: "geom", label: "dots", fromId: "step:0", toId: "plot" },
  ],
};

function mount(g: ExplorerGraph = graph, onClose?: () => void) {
  const store = createStore();
  const utils = render(
    <Provider store={store}><WorkbenchCanvas graph={g} onClose={onClose} /></Provider>,
  );
  return { store, ...utils };
}

describe("WorkbenchCanvas", () => {
  it("renders one React Flow node per graph node, plus a tidy control", () => {
    const { container } = mount();
    expect(screen.getByRole("button", { name: /tidy/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
  });

  it("renders a close control only when onClose is provided", () => {
    const { rerender, store } = mount(graph, undefined);
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    let closed = false;
    rerender(
      <Provider store={store}>
        <WorkbenchCanvas graph={graph} onClose={() => { closed = true; }} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toBe(true);
  });

  it("clicking a node opens its card (node id -> table card)", () => {
    const { store, container } = mount();
    const node = container.querySelector('.react-flow__node[data-id="plot"]')!;
    fireEvent.click(node);
    const cards = store.get(cardsAtom);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cardKind: "plot", target: { kind: "node", id: "plot" } });
  });

  it("clicking an edge opens its editor card", () => {
    const { store, container } = mount();
    // the edge's interaction path carries data-id; clicking it fires onEdgeClick.
    const edge = container.querySelector('.react-flow__edge[data-id="e0"]')!;
    fireEvent.click(edge);
    const cards = store.get(cardsAtom);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cardKind: "op-editor", target: { kind: "edge", id: "e0" } });
  });

  it("renders an open card from the store as a floating card", () => {
    const store = createStore();
    store.set(cardsAtom, [{
      id: "node:plot", target: { kind: "node", id: "plot" }, cardKind: "plot",
      x: 30, y: 40, w: 300, h: 200, collapsed: false,
    }]);
    render(<Provider store={store}><WorkbenchCanvas graph={graph} /></Provider>);
    // FloatingCard's bar carries the card title; the plot card body mounts FigurePane.
    expect(screen.getByTestId("card-bar")).toBeInTheDocument();
  });

  it("collapse-all collapses every open card", () => {
    const store = createStore();
    store.set(cardsAtom, [{
      id: "node:plot", target: { kind: "node", id: "plot" }, cardKind: "plot",
      x: 0, y: 0, w: 300, h: 200, collapsed: false,
    }]);
    render(<Provider store={store}><WorkbenchCanvas graph={graph} /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(store.get(cardsAtom)[0].collapsed).toBe(true);
  });

  it("re-flows when the graph structure changes (adds a node)", () => {
    const { container, rerender, store } = mount();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    const bigger: ExplorerGraph = {
      nodes: [...graph.nodes,
        { id: "step:1", kind: "table", label: "derived", table: { via: "at_step", at_step: 1 } }],
      edges: [...graph.edges,
        { id: "e1", kind: "derive", label: "x = 1", fromId: "step:0", toId: "step:1" }],
    };
    rerender(<Provider store={store}><WorkbenchCanvas graph={bigger} /></Provider>);
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: FAIL (no node/edge click handlers, no card rendering, `onClose` still required so close button always shows).

- [ ] **Step 3: Wire the handlers, cards overlay, and collapse-all into `WorkbenchCanvas.tsx`**

Add imports at the top:
```tsx
import { useSetAtom, useAtomValue } from "jotai";
import { openCardAtom, collapseAllCardsAtom, cardsAtom } from "./state";
import { targetToCardKind, type Target } from "./cardRegistry";
import { FloatingCard } from "./FloatingCard";
```

Change the `Canvas` signature so `onClose` is optional:
```tsx
function Canvas({ graph, onClose }: { graph: ExplorerGraph; onClose?: () => void }) {
```

Inside `Canvas`, after the existing `tidy` callback, add the click + card glue:
```tsx
  const openCard = useSetAtom(openCardAtom);
  const collapseAll = useSetAtom(collapseAllCardsAtom);
  const cards = useAtomValue(cardsAtom);

  // resolve a click target to its card kind and open (or re-select) it. A stale
  // id (kind === null) is ignored — the structure changed under the click.
  const open = useCallback((target: Target) => {
    const kind = targetToCardKind(graph, target);
    if (kind) openCard({ target, cardKind: kind });
  }, [graph, openCard]);
```

Add these props to `<ReactFlow …>` (alongside the existing ones):
```tsx
          onNodeClick={(_e, n) => open({ kind: "node", id: n.id })}
          onEdgeClick={(_e, ed) => open({ kind: "edge", id: ed.id })}
```

Make the close button conditional, and add the collapse-all button to the top bar:
```tsx
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workbench</h1>
        <button className="txw-tidy" onClick={tidy}>⤢ Tidy</button>
        <button className="txw-collapse-all" onClick={() => collapseAll()}>⊟ Collapse all</button>
        {onClose && (
          <button className="txw-close" onClick={onClose} aria-label="Close workbench">✕</button>
        )}
      </div>
```

Render the cards overlay as a sibling of `.txw-rfcanvas` (inside the outer div, after the `.txw-rfcanvas` block):
```tsx
      <div className="txw-cards">
        {cards.map((c) => <FloatingCard key={c.id} card={c} />)}
      </div>
```

The Escape-closes effect must tolerate a missing `onClose`:
```tsx
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
```

Make the outer `WorkbenchCanvas` `onClose` optional too:
```tsx
export function WorkbenchCanvas({ graph, onClose }: { graph: ExplorerGraph; onClose?: () => void }) {
```

Keep `useCallback` imported (already is). The container keeps `role="dialog"` — it is acceptable for both embedded and overlay use; the close-button test no longer depends on the role.

- [ ] **Step 4: Add `.txw-cards` overlay styles to `src/index.css`** (near the existing `.txw-card` rules, ~line 760)

```css
/* cards float over the canvas; the layer itself is click-through so the DAG
   beneath stays interactive, while each card re-enables pointer events. */
.txw-cards { position: absolute; inset: 44px 0 0 0; pointer-events: none; }
.txw-cards > .txw-card { pointer-events: auto; }
.txw-card { position: absolute; }
.txw-collapse-all { margin-left: 8px; }
```
(If `.txw-card` already declares `position`, leave the existing rule and drop the duplicate line.)

- [ ] **Step 5: Run the workbench tests**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Full suite + types**

Run: `npm test -- --run && npx tsc --noEmit`
Expected: all green (TransformWorkspace still passes `onClose`, now optional — still fine).

- [ ] **Step 7: Commit**

```bash
git add src/workbench/WorkbenchCanvas.tsx src/workbench/WorkbenchCanvas.test.tsx src/index.css
git commit -m "feat(workbench): clicking nodes/edges opens cards; cards float over the canvas + collapse-all"
```

---

## Task 2: Node nudges persist to `nodePositionsAtom`; tidy clears them

**Files:**
- Modify: `src/workbench/WorkbenchCanvas.tsx`
- Modify: `src/workbench/WorkbenchCanvas.test.tsx`

Dragging a node should survive a structural re-flow until the user hits Tidy. `nodePositionsAtom` holds per-node overrides; `toRF` applies them on top of `layoutGraph`; `onNodeDragStop` records the dropped position; `tidy` clears the overrides.

- [ ] **Step 1: Add failing tests** (append to the `describe` block)

```tsx
  it("persists a node nudge to nodePositionsAtom on drag stop", async () => {
    const { store, container } = mount();
    const rf = container.querySelector('.react-flow__node[data-id="plot"]')!;
    // React Flow fires onNodeDragStop on pointer up after a drag; simulate the
    // drag lifecycle on the node element.
    fireEvent.mouseDown(rf, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 25, clientY: 15 });
    fireEvent.mouseUp(window, { clientX: 25, clientY: 15 });
    // assert via the atom rather than DOM transforms (jsdom has no layout):
    const pos = store.get(nodePositionsAtom);
    expect(Object.keys(pos)).toContain("plot");
  });

  it("tidy clears persisted node positions", () => {
    const store = createStore();
    store.set(nodePositionsAtom, { plot: { x: 999, y: 999 } });
    render(<Provider store={store}><WorkbenchCanvas graph={graph} /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: /tidy/i }));
    expect(store.get(nodePositionsAtom)).toEqual({});
  });
```
Add `nodePositionsAtom` to the `./state` import in the test file.

> Note: React Flow's drag in jsdom may not fire `onNodeDragStop` from raw mouse events. If the first test proves flaky/unfirable in jsdom, replace it with a direct unit test of the drag-stop handler: export a small pure helper `applyNudge(prev, id, x, y)` from `WorkbenchCanvas.tsx` and test that instead (it returns `{...prev, [id]: {x,y}}`). Keep the tidy test as-is. Pick whichever is reliable; do not weaken the tidy assertion.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement nudge persistence + tidy clear**

Add to imports: `nodePositionsAtom` from `./state`.

In `Canvas`, read and write the override map:
```tsx
  const setNodePositions = useSetAtom(nodePositionsAtom);
  const nodePositions = useAtomValue(nodePositionsAtom);
```

Have `toRF` apply overrides. Change `toRF` to take the overrides and prefer them:
```tsx
function toRF(graph: ExplorerGraph, overrides: Record<string, { x: number; y: number }>): { nodes: Node[]; edges: RFEdge[] } {
  const L = layoutGraph(graph);
  return {
    nodes: L.nodes.map((n) => ({
      id: n.id, type: "arrayShape",
      position: overrides[n.id] ?? { x: n.x, y: n.y },
      data: nodeShapeProps(n.node) as unknown as Record<string, unknown>,
    })),
    edges: L.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, type: "workbench",
      data: { kind: e.kind, label: e.label, back: e.back },
    })),
  };
}
```
Update every `toRF(graph)` call to `toRF(graph, nodePositions)` — the `useMemo` initial, the structural effect, and `tidy`. Add `nodePositions` to the relevant dep arrays. **Important:** in the structural-change effect, reading `nodePositions` for the data-only branch is fine, but do NOT add `nodePositions` as an effect dep that forces a full re-seed on every nudge (that would fight React Flow's own drag state). Seed overrides only on the structural branch and in the `useMemo` initial; the data-only branch leaves positions alone.

`tidy` clears the overrides first, then re-lays out from clean layout:
```tsx
  const tidy = useCallback(() => {
    setNodePositions({});
    const rf = toRF(graph, {});
    setNodes(rf.nodes);
    setEdges(rf.edges);
  }, [graph, setNodes, setEdges, setNodePositions]);
```

Persist a drag on stop — add to `<ReactFlow …>`:
```tsx
          onNodeDragStop={(_e, n) =>
            setNodePositions((prev) => ({ ...prev, [n.id]: { x: n.position.x, y: n.position.y } }))}
```
(If you chose the `applyNudge` helper route from Step 1's note, define it as `export function applyNudge(prev, id, x, y) { return { ...prev, [id]: { x, y } }; }` and call `setNodePositions((prev) => applyNudge(prev, n.id, n.position.x, n.position.y))`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suite + types**

Run: `npm test -- --run && npx tsc --noEmit`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/workbench/WorkbenchCanvas.tsx src/workbench/WorkbenchCanvas.test.tsx
git commit -m "feat(workbench): node nudges persist to session state; tidy clears them"
```

---

## Task 3: App.tsx cutover — embed the canvas, rename viewMode, clear workbench on switch

**Files:**
- Modify: `src/state.ts` (line 216: `viewModeAtom` literal)
- Modify: `src/App.tsx`

This makes the workbench the live view. The reactive effects (analyze loop, reduce-preview, shape-counts, background warmer) are untouched.

- [ ] **Step 1: Rename the viewMode literal in `src/state.ts`**

Line 216, change:
```ts
export const viewModeAtom = atom<"data" | "analyses" | "guide">("data");
```
to:
```ts
export const viewModeAtom = atom<"data" | "workbench" | "guide">("data");
```

- [ ] **Step 2: Update `App.tsx` — imports**

Remove these now-unused imports: `FigurePane`, `LayerRail`, `CollapseRoutingPanel`, `DataTab`, `StatsPanel`, `TransformExplorer`, `TransformWorkspace`, and `workspaceOpenAtom` (from `./state`). Keep `PlottableSidebar` and `HierarchyPanel` / `DataTable` (Data tab). Add:
```tsx
import { WorkbenchCanvas } from "./workbench/WorkbenchCanvas";
import { explorerGraphAtom } from "./explorer/graphAtom";
import { clearWorkbenchAtom } from "./workbench/state";
```
Remove the unused `Section` helper (the `iris` Section stack is going away) if nothing else references it — grep first; delete the `Section` function definition only if unused after this task.

- [ ] **Step 3: Update `App.tsx` — the mode toggle button label and `setViewMode` call sites**

In the header toggle, change the middle button:
```tsx
<button className={viewMode === "workbench" ? "active" : ""} onClick={() => setViewMode("workbench")}>Workbench</button>
```
In `doLoad` and `handleOpenExample`, change `setViewMode(doc.analyses.length ? "analyses" : "data")` → `"workbench"`.

- [ ] **Step 4: Update `App.tsx` — clear workbench on analysis switch**

The effect at line ~280 currently clears `selectedNodeIdAtom` on `activeId` change. Add a `clearWorkbenchAtom` call so cards/selection/nudges from another analysis never carry over:
```tsx
  const setSelectedNode = useSetAtom(selectedNodeIdAtom);
  const clearWorkbench = useSetAtom(clearWorkbenchAtom);
  useEffect(() => { setSelectedNode(null); clearWorkbench(); }, [activeId, setSelectedNode, clearWorkbench]);
```
Delete the now-unused `const setWorkspaceOpen = useSetAtom(workspaceOpenAtom);` line.

- [ ] **Step 5: Update `App.tsx` — the render body**

Delete the `tx-strip` block and the `<TransformWorkspace />` line (the two blocks between the error bar and `<main>`). Read `explorerGraphAtom` near the other `useAtomValue`s:
```tsx
  const explorerGraph = useAtomValue(explorerGraphAtom);
```
Replace the `viewMode === "analyses"` checks with `"workbench"`, and replace the `analyses-mode` branch:
```tsx
        ) : (
          <div className="workbench-mode">
            <PlottableSidebar />
            {explorerGraph
              ? <WorkbenchCanvas graph={explorerGraph} />
              : <div className="analyses-empty"><span>Build a step or add a layer to see the graph.</span></div>}
          </div>
        )}
```
Keep the `dataLoading` and `!active` branches above it unchanged (they still gate on loading/empty). The class `analyses-mode` → `workbench-mode`; add a CSS alias or reuse — see Step 6.

- [ ] **Step 6: CSS — `workbench-mode` layout**

In `src/index.css`, add (next to `.analyses-mode`):
```css
.workbench-mode { display: flex; gap: 0; height: 100%; min-height: 0; }
.workbench-mode .txw-rfcanvas { position: absolute; inset: 44px 0 0 0; }
```
The embedded `WorkbenchCanvas` keeps its own `.txw-rfcanvas`/`.txw-cards` absolute framing relative to its container; ensure its root (currently `.txw-overlay` with `position:fixed; inset:0`) does NOT stay fixed when embedded. Change the canvas root class usage: in `WorkbenchCanvas.tsx` the outer div uses `className="txw-overlay"` — for embedded use it must be a flex child that fills its area. Set its root to `className="txw-overlay txw-embedded"` and add:
```css
.txw-embedded { position: relative; inset: auto; flex: 1; min-width: 0; }
```
so the same component works embedded (relative, fills the flex slot) — the `position:fixed` overlay rule is overridden by `.txw-embedded`. (When still used as a modal elsewhere it would omit `txw-embedded`; but after Task 4 there is no modal user, so this is purely defensive.)

- [ ] **Step 7: Run full suite + types + lint**

Run: `npm test -- --run && npx tsc --noEmit && npm run lint`
Expected: green. tsc will flag any missed dead import — remove it.

- [ ] **Step 8: Manual smoke (build only — no test exists for App)**

Run: `npm run build`
Expected: succeeds with no unused-import / type errors.

- [ ] **Step 9: Commit**

```bash
git add src/state.ts src/App.tsx src/index.css
git commit -m "feat(workbench): cut App over to the embedded workbench; rename viewMode analyses->workbench"
```

---

## Task 4: Delete the dead overlay/strip code

**Files:**
- Delete: `src/components/WorkspaceView.tsx`, `src/components/WorkspaceView.test.tsx`
- Delete: `src/components/TransformWorkspace.tsx`, `src/components/TransformWorkspace.test.tsx`
- Delete: `src/components/TransformExplorer.tsx`
- Modify: `src/state.ts` (remove `workspaceOpenAtom`)

- [ ] **Step 1: Confirm nothing imports them**

Run:
```bash
grep -rn "WorkspaceView\|TransformWorkspace\|TransformExplorer\|workspaceOpenAtom" src/ --include=*.ts --include=*.tsx | grep -v -E "WorkspaceView\.|TransformWorkspace\.|TransformExplorer\.tsx:"
```
Expected: only the definition lines remain (the `workspaceOpenAtom` definition in `state.ts`, and the self-references inside the files being deleted). If `App.tsx` still references any, Task 3 missed it — fix before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/WorkspaceView.tsx src/components/WorkspaceView.test.tsx \
       src/components/TransformWorkspace.tsx src/components/TransformWorkspace.test.tsx \
       src/components/TransformExplorer.tsx
```

- [ ] **Step 3: Remove `workspaceOpenAtom` from `src/state.ts`**

Delete line 861 `export const workspaceOpenAtom = atom(false);` and any adjacent comment that only describes it.

- [ ] **Step 4: Full suite + types + lint + build**

Run: `npm test -- --run && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green; test file count drops by the two deleted tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(workbench): delete the dead workspace overlay + transform strip"
```

---

## Final review (phase end)

After Task 4, dispatch a holistic reviewer over `git diff <phase5-base>..HEAD`. Confirm:
- Clicking nodes/edges opens the right card kind; cards float and collapse-all works; nudges persist and tidy clears them.
- App renders the embedded canvas under the renamed `workbench` view; the analyze/preview/shape-counts/background effects are untouched.
- `workspaceOpenAtom`, `WorkspaceView`, `TransformWorkspace`, `TransformExplorer` are gone with no dangling references.
- No layout/card/position state is serialized anywhere (`.iris`/`AnalysisSpec` untouched).
- `DataTab`/`selectedNodeIdAtom` remain (reserved for Phase 4b TableCard).

## Out of scope (later)

- TableCard / OpEditorCard / Test-card split (the 3 stub cards) — **Phase 4b**.
- Left-rail reskin (`PlottableSidebar` → slim vertical rail) — cosmetic; deferred.
- The `annotation` AnalysisSpec field + bracket rendering in `render.py` — separate follow-up; the annotate edge already degrades gracefully via the existing `show_significance`.
