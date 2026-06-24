# Transformation Workbench — Phase 2: React Flow Canvas + Auto-Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only `WorkspaceView` overlay with a live pan/zoom canvas (React Flow) that renders the existing graph horizontally left→right, with draggable nodes and a "tidy" re-flow — reachable today via the existing ⤢ Workspace button.

**Architecture:** A pure `layout.ts` turns the existing `ExplorerGraph` (from Phase 1) into positioned nodes + edges via a longest-path layered pass (forward edges only; the `annotate` back-edge is flagged, not ranked). `WorkbenchCanvas` feeds that into `@xyflow/react` with a custom node (`ArrayShapeNode` + handles) and a custom edge (label + the existing hover schematic). Node positions live in React Flow's own state (ephemeral, session-only); "tidy" resets them to the layout. No new Jotai atoms, no engine change, no `.iris` change.

**Tech Stack:** TypeScript, React 18, Jotai, `@xyflow/react` v12 (new dependency), Vitest + @testing-library/react (jsdom).

**Branch note:** Work on `main` (no users; concurrent thread also commits to `main`). Build on the current HEAD (Phase 1 complete: `809928a`).

---

## Context for the implementer

Phase 1 shipped the graph model. The live graph is `explorerGraphAtom` (`src/explorer/graphAtom.ts`) → an `ExplorerGraph` = `{ nodes: ExplorerNode[]; edges: Edge[] }` (`src/explorer/graph.ts`). Each `ExplorerNode` has `{ id, kind: "table"|"plot"|"stats", label, table, count? }` where `count?` carries `{ rows, cols, axes?, values? }`. Each `Edge` has `{ id, kind: EdgeKind, label, fromId, toId, guards?, onKeys? }`. `EdgeKind` includes `"annotate"` (the stats→plot back-edge).

Today the graph is shown two ways: the inline `TransformExplorer` strip (kept) and the `WorkspaceView` overlay opened by the ⤢ Workspace button (`src/components/TransformWorkspace.tsx`, gated by `workspaceOpenAtom`). **This phase swaps the overlay's body from `WorkspaceView` to the new `WorkbenchCanvas`.** `WorkspaceView.tsx` stays in the tree (unused) until Phase 5 deletes it — do not delete it now (its tests stay green).

`ArrayShapeNode` (`src/components/ArrayShapeNode.tsx`) is the existing presentational node: props `{ title, variant: "source"|"table"|"grain"|"hub", axes, values, removed?, onKeys?, rows?, cols? }`. Reuse it as the custom node body. The `removed` (collapsed-axis strike-through) and `onKeys` (join-key highlight) refinements are **out of scope for Phase 2** — pass `[]`/omit; they return in a later polish.

`cannedExample(kind)` (`src/explorer/cannedExamples.ts`) returns a before/after schematic or `null`; `OpHoverExample` (`src/components/OpHoverExample.tsx`) renders it. Reuse both on the custom edge's hover, exactly as `WorkspaceView`'s `OpEdge` does.

**Why no new atoms:** React Flow owns node positions via `useNodesState`. Positions are ephemeral (the overlay unmounts on close, resetting them) — which matches the spec's "session-only, nothing persisted." "Tidy" just reloads the layout positions. `selectedTargetAtom` (node/edge selection that cards read) is introduced in Phase 3, where it has a consumer.

---

## File structure

```
src/workbench/
  layout.ts              # NEW pure: ExplorerGraph -> positioned nodes + edges
  layout.test.ts         # NEW
  ArrayShapeRFNode.tsx   # NEW custom React Flow node (ArrayShapeNode + handles) + nodeShapeProps helper
  ArrayShapeRFNode.test.tsx  # NEW
  WorkbenchEdge.tsx      # NEW custom React Flow edge (label + hover schematic)
  WorkbenchEdge.test.tsx # NEW
  WorkbenchCanvas.tsx    # NEW assembles ReactFlow + layout + node/edge types + tidy
  WorkbenchCanvas.test.tsx # NEW
src/test-setup.ts        # MODIFY: add React Flow jsdom mocks
src/components/TransformWorkspace.tsx  # MODIFY: render WorkbenchCanvas instead of WorkspaceView
package.json             # MODIFY: add @xyflow/react
```

---

## Task 1: `layout.ts` — pure graph → positioned nodes + edges

**Files:**
- Create: `src/workbench/layout.ts`, `src/workbench/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/workbench/layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layoutGraph, COL_GAP, ROW_GAP } from "./layout";
import type { ExplorerGraph } from "../explorer/graph";

/* a minimal linear pipeline that forks into plot (geom) + stats (test), with the
   stats->plot annotate back-edge. Hand-built so the layout is isolated from buildGraph. */
const forkGraph = (): ExplorerGraph => ({
  nodes: [
    { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "step:0", kind: "table", label: "filtered", table: { via: "at_step", at_step: 0 } },
    { id: "plot", kind: "plot", label: "Plot", table: { via: "none" } },
    { id: "stats", kind: "stats", label: "Stats", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "step:0" },
    { id: "g0", kind: "geom", label: "dots", fromId: "step:0", toId: "plot" },
    { id: "t0", kind: "test", label: "MW", fromId: "step:0", toId: "stats" },
    { id: "a:annotate", kind: "annotate", label: "significance", fromId: "stats", toId: "plot" },
  ],
});

const at = (L: ReturnType<typeof layoutGraph>, id: string) => L.nodes.find((n) => n.id === id)!;

describe("layoutGraph", () => {
  it("ranks the chain left->right by longest forward path (x = rank * COL_GAP)", () => {
    const L = layoutGraph(forkGraph());
    expect(at(L, "source").x).toBe(0);
    expect(at(L, "step:0").x).toBe(COL_GAP);
    // plot/stats are one column past their grain source (step:0)
    expect(at(L, "plot").x).toBe(2 * COL_GAP);
    expect(at(L, "stats").x).toBe(2 * COL_GAP);
  });

  it("does NOT let the annotate back-edge push the plot's rank", () => {
    // stats is at rank 2; if the stats->plot edge were ranked, plot would be 3.
    const L = layoutGraph(forkGraph());
    expect(at(L, "plot").x).toBe(2 * COL_GAP);
  });

  it("stacks same-rank nodes vertically in node order; the chain stays on y=0", () => {
    const L = layoutGraph(forkGraph());
    expect(at(L, "source").y).toBe(0);
    expect(at(L, "step:0").y).toBe(0);
    expect(at(L, "plot").y).toBe(0);          // first at rank 2
    expect(at(L, "stats").y).toBe(ROW_GAP);   // second at rank 2
  });

  it("flags the annotate edge as a back-edge and forward edges as not", () => {
    const L = layoutGraph(forkGraph());
    expect(L.edges.find((e) => e.id === "a:annotate")!.back).toBe(true);
    expect(L.edges.filter((e) => e.id !== "a:annotate").every((e) => !e.back)).toBe(true);
  });

  it("emits one layout edge per graph edge, carrying kind/label/source/target", () => {
    const L = layoutGraph(forkGraph());
    expect(L.edges).toHaveLength(4);
    const g0 = L.edges.find((e) => e.id === "g0")!;
    expect(g0).toMatchObject({ source: "step:0", target: "plot", kind: "geom", label: "dots" });
  });

  it("places a join right-input just left of the join node, not at column 0", () => {
    const g: ExplorerGraph = {
      nodes: [
        { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
        { id: "step:0", kind: "table", label: "joined", table: { via: "at_step", at_step: 0 } },
        { id: "source:0", kind: "table", label: "right", table: { via: "none" } },
      ],
      edges: [
        { id: "e0", kind: "join", label: "join", fromId: "source", toId: "step:0" },
        { id: "e1", kind: "join", label: "join", fromId: "source:0", toId: "step:0" },
      ],
    };
    const L = layoutGraph(g);
    // join node is rank 1; the right-input sits at rank 0... but re-ranked to join-1 = 0 here.
    // Make the chain longer so "join-1" differs from 0:
    expect(at(L, "step:0").x).toBe(COL_GAP);
    expect(at(L, "source:0").x).toBe(0);   // join(1) - 1 = 0, same column as source
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/workbench/layout.test.ts`
Expected: FAIL — `./layout` does not exist.

- [ ] **Step 3: Implement `layout.ts`**

Create `src/workbench/layout.ts`:

```ts
import type { Edge, EdgeKind, ExplorerGraph, ExplorerNode } from "../explorer/graph";

/* horizontal gap between ranks (columns) and vertical gap between same-rank nodes. */
export const COL_GAP = 240;
export const ROW_GAP = 130;

export interface PositionedNode { id: string; x: number; y: number; node: ExplorerNode }
export interface LayoutEdge {
  id: string; source: string; target: string;
  kind: EdgeKind; label: string; guards?: Edge["guards"]; back: boolean;
}
export interface GraphLayout { nodes: PositionedNode[]; edges: LayoutEdge[] }

/* the only back-edge in the model: stats -> plot (significance annotation). It is
   drawn but must not influence left->right ranking (it would otherwise push the
   plot a column past the stats node, or, in general, create a cycle). */
const isBack = (e: Edge): boolean => e.kind === "annotate";

export function layoutGraph(graph: ExplorerGraph): GraphLayout {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const forward = graph.edges.filter((e) => !isBack(e) && byId.has(e.fromId) && byId.has(e.toId));

  // longest-path rank over forward edges (Kahn relaxation). Roots start at 0.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  graph.nodes.forEach((n) => { indeg.set(n.id, 0); adj.set(n.id, []); });
  for (const e of forward) {
    adj.get(e.fromId)!.push(e.toId);
    indeg.set(e.toId, (indeg.get(e.toId) ?? 0) + 1);
  }
  const rank = new Map<string, number>();
  const work = new Map(indeg);
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  queue.forEach((id) => rank.set(id, 0));
  while (queue.length) {
    const id = queue.shift()!;
    const r = rank.get(id) ?? 0;
    for (const to of adj.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, r + 1));
      work.set(to, (work.get(to) ?? 0) - 1);
      if ((work.get(to) ?? 0) === 0) queue.push(to);
    }
  }

  // a join's right-input (`source:<i>`) is a forward root, so it lands at rank 0;
  // pull it to just left of the join node it feeds instead.
  for (const e of forward) {
    if (e.fromId.startsWith("source:")) {
      const jr = rank.get(e.toId);
      if (jr != null) rank.set(e.fromId, Math.max(0, jr - 1));
    }
  }

  // y: stack nodes sharing a rank in node order (deterministic, since buildGraph
  // emits nodes in a stable order). A node alone in its rank sits on y = 0.
  const order = new Map<number, number>();
  const yOf = new Map<string, number>();
  for (const n of graph.nodes) {
    const r = rank.get(n.id) ?? 0;
    const i = order.get(r) ?? 0;
    yOf.set(n.id, i * ROW_GAP);
    order.set(r, i + 1);
  }

  const nodes: PositionedNode[] = graph.nodes.map((n) => ({
    id: n.id, x: (rank.get(n.id) ?? 0) * COL_GAP, y: yOf.get(n.id) ?? 0, node: n,
  }));
  const edges: LayoutEdge[] = graph.edges.map((e) => ({
    id: e.id, source: e.fromId, target: e.toId,
    kind: e.kind, label: e.label, guards: e.guards, back: isBack(e),
  }));
  return { nodes, edges };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/workbench/layout.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/workbench/layout.ts src/workbench/layout.test.ts
git commit -m "feat(workbench): pure graph->positions layout (longest-path, back-edge aware)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM"
```

---

## Task 2: Add `@xyflow/react` + React Flow jsdom test mocks

**Files:**
- Modify: `package.json` (dependency), `src/test-setup.ts` (jsdom mocks)
- Test: `src/workbench/rf-smoke.test.tsx` (temporary smoke test, deleted at end of this task)

- [ ] **Step 1: Install the dependency**

Run: `npm install @xyflow/react`
Expected: adds `@xyflow/react` (v12.x) to `dependencies` in `package.json` and updates the lockfile.

- [ ] **Step 2: Add React Flow jsdom mocks to the test setup**

React Flow measures the DOM (ResizeObserver, DOMMatrix, SVG getBBox) which jsdom lacks. Append to `src/test-setup.ts`:

```ts
/* --- React Flow (@xyflow/react) needs these DOM APIs that jsdom lacks. Without
   them ReactFlow throws on mount in tests. Standard React Flow test shim. --- */
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;

class DOMMatrixReadOnlyMock {
  m22 = 1;
  constructor(_t?: string) {}
}
(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyMock;

Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return 100; } });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 100; } });
(globalThis as unknown as { SVGElement: { prototype: { getBBox?: unknown } } }).SVGElement.prototype.getBBox =
  () => ({ x: 0, y: 0, width: 0, height: 0 });
```

- [ ] **Step 3: Write a temporary smoke test that a minimal ReactFlow mounts**

Create `src/workbench/rf-smoke.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";

describe("@xyflow/react mounts under the jsdom shim", () => {
  it("renders an empty canvas without throwing", () => {
    const { container } = render(
      <ReactFlowProvider>
        <div style={{ width: 400, height: 300 }}>
          <ReactFlow nodes={[]} edges={[]} />
        </div>
      </ReactFlowProvider>,
    );
    expect(container.querySelector(".react-flow")).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `npx vitest run src/workbench/rf-smoke.test.tsx`
Expected: PASS — a `.react-flow` element is present and nothing threw. (If it throws about a missing DOM API, the mock in Step 2 needs that API added — report which one.)

- [ ] **Step 5: Delete the temporary smoke test, run the full suite**

The smoke test has served its purpose (it proved the mock works); the real canvas test in Task 5 supersedes it. Remove it:

```bash
rm src/workbench/rf-smoke.test.tsx
```

Run: `npx vitest run` → all green. Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/test-setup.ts
git commit -m "build(workbench): add @xyflow/react + jsdom test shim for React Flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM"
```

---

## Task 3: `ArrayShapeRFNode` custom node + `nodeShapeProps` helper

**Files:**
- Create: `src/workbench/ArrayShapeRFNode.tsx`, `src/workbench/ArrayShapeRFNode.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/workbench/ArrayShapeRFNode.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrayShapeRFNode, nodeShapeProps } from "./ArrayShapeRFNode";
import type { ExplorerNode } from "../explorer/graph";

describe("nodeShapeProps", () => {
  it("maps a grain node's descriptor to ArrayShapeNode props", () => {
    const node: ExplorerNode = {
      id: "grain:cell", kind: "table", label: "per Cell", table: { via: "grain", grain: "cell" },
      count: { rows: 3, cols: 2, axes: [{ name: "cell", n_levels: 3, ragged: false }], values: [] },
    };
    expect(nodeShapeProps(node)).toMatchObject({
      title: "per Cell", variant: "grain",
      axes: [{ name: "cell", n_levels: 3, ragged: false }], values: [], rows: 3, cols: 2,
    });
  });
  it("derives variant from id: source -> source, source:0 -> source, plain -> table", () => {
    const mk = (id: string): ExplorerNode => ({ id, kind: "table", label: id, table: { via: "none" } });
    expect(nodeShapeProps(mk("source")).variant).toBe("source");
    expect(nodeShapeProps(mk("source:0")).variant).toBe("source");
    expect(nodeShapeProps(mk("step:1")).variant).toBe("table");
  });
});

describe("ArrayShapeRFNode", () => {
  it("renders the node title from its data", () => {
    render(
      <ReactFlowProvider>
        <ArrayShapeRFNode
          id="grain:cell"
          data={nodeShapeProps({
            id: "grain:cell", kind: "table", label: "per Cell", table: { via: "grain", grain: "cell" },
            count: { rows: 3, cols: 2, axes: [], values: [] },
          })}
          selected={false}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("per Cell")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/workbench/ArrayShapeRFNode.test.tsx`
Expected: FAIL — `./ArrayShapeRFNode` does not exist.

- [ ] **Step 3: Implement the node + helper**

Create `src/workbench/ArrayShapeRFNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrayShapeNode, type ArrayShapeNodeProps, type NodeVariant } from "../components/ArrayShapeNode";
import type { ExplorerNode } from "../explorer/graph";

/* id -> node variant (mirrors workspace.ts's variantOf; removed/onKeys highlighting
   is deferred to a later phase, so they are not derived here). */
function variantOf(id: string): NodeVariant {
  if (id === "source" || id.startsWith("source:")) return "source";
  if (id.startsWith("grain:")) return "grain";
  return "table";
}

/* an ExplorerNode -> the presentational ArrayShapeNode props. Pure + exported so
   the mapping is unit-tested without React Flow. */
export function nodeShapeProps(node: ExplorerNode): ArrayShapeNodeProps {
  const c = node.count;
  return {
    title: node.label, variant: variantOf(node.id),
    axes: c?.axes ?? [], values: c?.values ?? [], rows: c?.rows, cols: c?.cols,
  };
}

/* React Flow custom node: the existing presentational node, flanked by hidden
   connection handles (left = target, right = source) so edges attach. */
export function ArrayShapeRFNode({ data }: NodeProps<{ data: ArrayShapeNodeProps }> | { id: string; data: ArrayShapeNodeProps; selected: boolean }) {
  const props = data as unknown as ArrayShapeNodeProps;
  return (
    <div className="txw-rfnode">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <ArrayShapeNode {...props} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
```

Note: the loose `NodeProps` typing above is deliberate — React Flow v12's generic `NodeProps` is awkward to satisfy exactly for a custom data shape; casting `data` to `ArrayShapeNodeProps` is the pragmatic, type-safe-at-use choice. If `tsc` rejects the union type in the signature, simplify the signature to `({ data }: { data: ArrayShapeNodeProps })` — React Flow passes `data` through regardless.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/workbench/ArrayShapeRFNode.test.tsx`
Expected: PASS (3 tests). If the `NodeProps` signature trips `tsc`, apply the fallback signature noted above and re-run.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/workbench/ArrayShapeRFNode.tsx src/workbench/ArrayShapeRFNode.test.tsx
git commit -m "feat(workbench): ArrayShapeRFNode custom node + nodeShapeProps mapping

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM"
```

---

## Task 4: `WorkbenchEdge` custom edge (label + hover schematic)

**Files:**
- Create: `src/workbench/WorkbenchEdge.tsx`, `src/workbench/WorkbenchEdge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/workbench/WorkbenchEdge.test.tsx`. The edge uses React Flow's `EdgeLabelRenderer`, which portals the label into a node that only exists inside a real `<ReactFlow>` — so mount a minimal full canvas with one edge (default node type is fine; no custom node needed) rather than the edge in isolation:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, type Node, type Edge } from "@xyflow/react";
import { WorkbenchEdge } from "./WorkbenchEdge";

const edgeTypes = { workbench: WorkbenchEdge };
const nodes: Node[] = [
  { id: "a", position: { x: 0, y: 0 }, data: {} },
  { id: "b", position: { x: 200, y: 0 }, data: {} },
];
const edges: Edge[] = [
  { id: "g0", source: "a", target: "b", type: "workbench",
    data: { kind: "geom", label: "dots", back: false } },
];

describe("WorkbenchEdge", () => {
  it("renders the edge label inside a canvas", () => {
    render(
      <ReactFlowProvider>
        <div style={{ width: 400, height: 300 }}>
          <ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} />
        </div>
      </ReactFlowProvider>,
    );
    expect(screen.getByText("dots")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/workbench/WorkbenchEdge.test.tsx`
Expected: FAIL — `./WorkbenchEdge` does not exist.

- [ ] **Step 3: Implement the custom edge**

Create `src/workbench/WorkbenchEdge.tsx`:

```tsx
import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cannedExample } from "../explorer/cannedExamples";
import { OpHoverExample } from "../components/OpHoverExample";
import type { EdgeKind } from "../explorer/graph";

export interface WorkbenchEdgeData { kind: EdgeKind; label: string; back: boolean }

/* a graph edge: a bezier path with a centred, hover-expandable label. The label's
   colour class keys off the edge kind (reusing the existing .<kind> styles). A
   back-edge (annotate) gets extra curvature so the stats->plot link reads as an
   overlay, not a flow step. */
export function WorkbenchEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY } = props;
  const data = props.data as unknown as WorkbenchEdgeData;
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    curvature: data?.back ? 0.6 : 0.25,
  });
  const ex = data ? cannedExample(data.kind) : null;
  return (
    <>
      <BaseEdge id={id} path={path} className={`txw-rfedge ${data?.kind ?? ""}${data?.back ? " back" : ""}`} />
      <EdgeLabelRenderer>
        <div
          className={`txw-rfedge-label ${data?.kind ?? ""}`}
          style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          tabIndex={0}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
        >
          {data?.label}
          {hover && ex && <OpHoverExample example={ex} />}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/workbench/WorkbenchEdge.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/workbench/WorkbenchEdge.tsx src/workbench/WorkbenchEdge.test.tsx
git commit -m "feat(workbench): WorkbenchEdge custom edge with hover schematic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM"
```

---

## Task 5: `WorkbenchCanvas` + mount in the overlay

**Files:**
- Create: `src/workbench/WorkbenchCanvas.tsx`, `src/workbench/WorkbenchCanvas.test.tsx`
- Modify: `src/components/TransformWorkspace.tsx`
- Modify: `src/index.css` (minimal canvas styles)

- [ ] **Step 1: Write the failing test**

Create `src/workbench/WorkbenchCanvas.test.tsx`. Assert on robust signals: the dialog role + topbar buttons (plain DOM, always present) and the React Flow node count via the `.react-flow__node` class (one wrapper per graph node — `onlyRenderVisibleElements` defaults to false, so all render). The edge label is rendered by the full canvas too:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkbenchCanvas } from "./WorkbenchCanvas";
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

describe("WorkbenchCanvas", () => {
  it("renders one React Flow node per graph node, plus a tidy control", () => {
    const { container } = render(<WorkbenchCanvas graph={graph} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tidy/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
  });

  it("closes on the close control", () => {
    let closed = false;
    render(<WorkbenchCanvas graph={graph} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toBe(true);
  });
});
```

If the `.react-flow__node` count comes back 0 in jsdom (React Flow occasionally defers node rendering until a measured viewport), fall back to asserting `container.querySelector(".react-flow")` is present plus the two topbar buttons — the node-count assertion is the nice-to-have, the canvas-mounts + controls assertions are the contract. Report which path you used.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: FAIL — `./WorkbenchCanvas` does not exist.

- [ ] **Step 3: Implement the canvas**

Create `src/workbench/WorkbenchCanvas.tsx`:

```tsx
import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState, type Node, type Edge as RFEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ExplorerGraph } from "../explorer/graph";
import { layoutGraph } from "./layout";
import { ArrayShapeRFNode, nodeShapeProps } from "./ArrayShapeRFNode";
import { WorkbenchEdge } from "./WorkbenchEdge";

const nodeTypes = { arrayShape: ArrayShapeRFNode };
const edgeTypes = { workbench: WorkbenchEdge };

function toRF(graph: ExplorerGraph): { nodes: Node[]; edges: RFEdge[] } {
  const L = layoutGraph(graph);
  return {
    nodes: L.nodes.map((n) => ({
      id: n.id, type: "arrayShape", position: { x: n.x, y: n.y },
      data: nodeShapeProps(n.node),
    })),
    edges: L.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, type: "workbench",
      data: { kind: e.kind, label: e.label, back: e.back },
    })),
  };
}

function Canvas({ graph, onClose }: { graph: ExplorerGraph; onClose: () => void }) {
  const initial = useMemo(() => toRF(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, , onEdgesChange] = useEdgesState(initial.edges);

  // re-flow when the graph changes structurally; "tidy" reuses the same reset.
  const tidy = useCallback(() => setNodes(toRF(graph).nodes), [graph, setNodes]);
  useEffect(() => { setNodes(toRF(graph).nodes); }, [graph, setNodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txw-overlay" role="dialog" aria-label="Transformation workbench">
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workbench</h1>
        <button className="txw-tidy" onClick={tidy}>⤢ Tidy</button>
        <button className="txw-close" onClick={onClose} aria-label="Close workbench">✕</button>
      </div>
      <div className="txw-rfcanvas">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          fitView proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export function WorkbenchCanvas({ graph, onClose }: { graph: ExplorerGraph; onClose: () => void }) {
  return (
    <ReactFlowProvider>
      <Canvas graph={graph} onClose={onClose} />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: PASS (2 tests). (React Flow renders nodes in jsdom via the Task 2 shim; node labels appear in the DOM.)

- [ ] **Step 5: Mount the canvas in the overlay**

Replace the body of `src/components/TransformWorkspace.tsx` to render `WorkbenchCanvas` instead of `WorkspaceView` (keep the `workspaceOpenAtom` gate and the portal):

```tsx
import { useAtom, useAtomValue } from "jotai";
import { createPortal } from "react-dom";
import { workspaceOpenAtom } from "../state";
import { explorerGraphAtom } from "../explorer/graphAtom";
import { WorkbenchCanvas } from "../workbench/WorkbenchCanvas";

export function TransformWorkspace() {
  const [open, setOpen] = useAtom(workspaceOpenAtom);
  const graph = useAtomValue(explorerGraphAtom);
  if (!open || !graph) return null;
  return createPortal(
    <WorkbenchCanvas graph={graph} onClose={() => setOpen(false)} />,
    document.body,
  );
}
```

- [ ] **Step 6: Add minimal canvas styles**

Append to `src/index.css`:

```css
/* React Flow canvas inside the workbench overlay */
.txw-rfcanvas { position: absolute; inset: 44px 0 0 0; }
.txw-rfnode { /* let ArrayShapeNode own its look; the wrapper is just a handle anchor */ }
.txw-tidy { margin-left: auto; }
.react-flow__attribution { display: none; }
```

(If `.txw-overlay`/`.txw-topbar`/`.txw-title`/`.txw-close` are already defined from Phase 3 of the array-lens work, reuse them — do not duplicate. Only add what is missing.)

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx vitest run` → all green. Note: the existing `src/components/TransformWorkspace.test.tsx` only asserts the gating contract (`!open || !graph` → no `.txw-overlay`), which the swap preserves identically — so it stays green WITHOUT modification. Do not edit it.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 8: Manual smoke (optional but recommended)**

Run `./dev.sh`, open the app, open an analysis, click **⤢ Workspace**. Confirm: the React Flow canvas opens, nodes are laid out left→right, you can pan/zoom/drag nodes, **Tidy** re-flows them, **✕**/Escape closes.

- [ ] **Step 9: Commit**

```bash
git add src/workbench/WorkbenchCanvas.tsx src/workbench/WorkbenchCanvas.test.tsx src/components/TransformWorkspace.tsx src/index.css
git commit -m "feat(workbench): React Flow canvas replaces the read-only overlay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM"
```

---

## Phase 2 done-check

- [ ] `npx vitest run` — full frontend suite green.
- [ ] `npx tsc --noEmit` — clean.
- [ ] ⤢ Workspace opens an interactive React Flow canvas: nodes laid out left→right by `layoutGraph`, draggable, pan/zoom, **Tidy** re-flows, Escape/✕ closes. The annotate edge renders as a curved back-link without distorting the column layout.
- [ ] `WorkspaceView.tsx` still exists but is now unused (Phase 5 deletes it). No engine or `.iris` change.

## Out of scope for Phase 2 (later phases)

- **Clicking a node/edge opens a card** — Phase 3 (`selectedTargetAtom` + `FloatingCard`).
- **`removed` strike-through + `onKeys` join-key highlight** on canvas nodes — deferred polish (compute from edge context as `buildWorkspaceModel` does).
- **Distinct terminal styling** for plot/stats nodes (they render as plain `ArrayShapeNode` title-only for now) — Phase 4 cards make terminals rich.
- **App.tsx cutover** (workbench as the Analyses view, deleting the old layout) — Phase 5.
- **Persisting node positions** across overlay open/close — intentionally not done (ephemeral, per spec).
