# Transformation Workspace — Array-Shape Lens — Phase 3 Plan (Workspace rendering)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the array-shape lens. A dedicated **full-screen workspace** lays the pipeline out as a vertical dot-grid DAG: each node is an **array-shape readout** (axis chips with level counts + raggedness, value chips coloured by type with `@grain` tags, collapse strike-out), each edge an **array-op label**, the join a **confluence** (hub + right input), the end a **terminal fork** (plot + stats). Hovering an op shows a **canned before/after schematic**.

**Architecture:** Pure-presentation components driven by the existing `explorerGraphAtom` (whose nodes already carry the Phase-1/2 descriptor on `node.count = {rows, cols, axes?, values?}`). A pure `buildWorkspaceModel(graph)` turns the flat graph into a render-ready spine (main chain + join right-inputs + removed-axis diffs + terminal fork). `ArrayShapeNode` and `WorkspaceView` are prop-driven (RTL-testable with no store). A thin `TransformWorkspace` container reads the atom and mounts the view as a full-screen portal overlay. No engine changes; no change to `graph.ts`/`graphAtom.ts` logic.

**Tech Stack:** TypeScript + React + Jotai + vitest + @testing-library/react (jsdom). Run one test file: `npx vitest run <file>`; typecheck `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-06-24-transformation-workspace-array-lens-design.md`
**Mockups (open in a browser — the visual source of truth):** `docs/superpowers/specs/assets/2026-06-24-transformation-workspace-array-lens/` — `01-array-shape-nodes` (node readout), `04-full-workspace` (the whole layout), `02`/`05`/`06` (canned op schematics).
**Phase 1/2 plans (landed):** same directory, `…-array-lens.md` and `…-array-lens-phase2.md`.

---

## Context an implementer needs (read first)

**The data is already there.** `explorerGraphAtom` (`src/explorer/graphAtom.ts`) returns `ExplorerGraph { nodes: ExplorerNode[]; edges: Edge[] }`. After Phase 2, each node carries `count?: NodeCount` where `NodeCount = { rows, cols, axes?: AxisDesc[], values?: ValueDesc[] }`. `AxisDesc = { name, n_levels, ragged }`, `ValueDesc = { name, type, grain: string|null }` (`type` ∈ `"numeric"|"categorical"|"bool"|"identifier"`, defaulting numeric). Edges carry `{ id, kind: EdgeKind, label, fromId, toId, guards? }`. **Phase 3 only reads these — it adds no fields and changes no engine/graph logic.**

**Node id conventions** (from `graph.ts`): `source`; `step:<i>`; `source:<i>` (a join's right input); `grain:<key>`; `post:<i>`; `plot`; `stats`. Edge kinds: `filter|drop|derive|recode|join|pivot|grid_complete|collapse` (the "op" edges, along the main chain) and `geom|test` (the "branch" edges into the terminals).

**The layout (study `04-full-workspace.html`).** A vertical spine, top→bottom: `source` node, then alternating `edge`(op label) / `node` down the chain; a **join** renders as a `joinwrap` — the join node (hub, showing the `on` keys) with the **right-input** source node beside it and a `←` between; the chain continues through the **grain** nodes (tinted), ending in a **fork** of terminal boxes (plot + stats), each annotated with the geom(s)/test it reads. It is pure flexbox — **no SVG measuring** (unlike the inline `TransformExplorer`).

**Colour-by-type (settled in the spec).** axis = blue; join-key = amber; value numeric = green, categorical = violet, bool = amber; grain node = violet tint. The mockup CSS encodes these exactly — port it.

**Why a separate `WorkspaceView`.** The container reads a *derived* atom (`explorerGraphAtom`) whose upstream is large; seeding it in a test is heavy. So presentation is a pure `WorkspaceView` that takes a `graph` prop (RTL-testable with a fixture, no store), and `TransformWorkspace` is a 10-line container that reads the atom + owns open/close. Same split for `ArrayShapeNode` (pure props).

**Scope discipline.** No changes to `graph.ts`, `graphAtom.ts`, the engine, stats, or reduce. The existing inline `TransformExplorer` strip stays as-is (the workspace is an *additional* surface opened from a button). New files only, plus CSS additions to `src/index.css` and one button + mount in `App.tsx`.

---

## File structure

- **Create** `src/components/ArrayShapeNode.tsx` — pure node readout (axis/value chips). (Task 1)
- **Create** `src/components/ArrayShapeNode.test.tsx` — RTL. (Task 1)
- **Create** `src/explorer/workspace.ts` — `buildWorkspaceModel(graph)` + model types. (Task 2)
- **Create** `src/explorer/workspace.test.ts` — vitest. (Task 2)
- **Create** `src/components/WorkspaceView.tsx` — pure full-screen view (topbar/legend/canvas/spine/join/fork). (Task 3)
- **Create** `src/components/WorkspaceView.test.tsx` — RTL. (Task 3)
- **Create** `src/components/TransformWorkspace.tsx` — atom container + portal + open/close. (Task 4)
- **Create** `src/components/TransformWorkspace.test.tsx` — RTL. (Task 4)
- **Modify** `src/state.ts` — `workspaceOpenAtom`. (Task 4)
- **Modify** `src/App.tsx` — an "Expand" button by the strip + mount `<TransformWorkspace/>`. (Task 4)
- **Create** `src/explorer/cannedExamples.ts` — per-op canned before/after rows. (Task 5)
- **Create** `src/explorer/cannedExamples.test.ts` — vitest. (Task 5)
- **Create** `src/components/OpHoverExample.tsx` — renders a canned schematic. (Task 6)
- **Create** `src/components/OpHoverExample.test.tsx` — RTL. (Task 6)
- **Modify** `src/index.css` — `.txw-*` workspace/chip/edge styles (added incrementally by Tasks 1, 3, 6).

## Commands (used across tasks)

- One test file: `npx vitest run src/components/ArrayShapeNode.test.tsx`
- Full frontend suite: `npx vitest run`
- Typecheck: `npx tsc --noEmit`

---

## Task 1: `ArrayShapeNode` — the array-shape node readout

**Files:**
- Create: `src/components/ArrayShapeNode.tsx`, `src/components/ArrayShapeNode.test.tsx`
- Modify: `src/index.css` (chip styles)

**Why:** This is the core of the lens — one node showing its axes (blue chips, level count, dashed when ragged, struck-through when a downstream collapse removed it, amber when a join key) and values (coloured by type, with an `@grain` tag). Pure props → directly RTL-testable. Visual reference: `01-array-shape-nodes.html` and the `.node`/`.ax`/`.val` rules in `04-full-workspace.html`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ArrayShapeNode.test.tsx
import { render, screen } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { ArrayShapeNode } from "./ArrayShapeNode";
import type { AxisDesc, ValueDesc } from "../types";

const axes: AxisDesc[] = [
  { name: "experiment", n_levels: 3, ragged: false },
  { name: "cell", n_levels: 122, ragged: false },
  { name: "frame", n_levels: 1830, ragged: true },
];
const values: ValueDesc[] = [
  { name: "speed", type: "numeric", grain: null },
  { name: "class", type: "categorical", grain: "cell" },
];

describe("ArrayShapeNode", () => {
  it("renders axis chips with level counts; ragged axis is dashed and shows ~", () => {
    render(<ArrayShapeNode title="filtered" variant="table" axes={axes} values={values} />);
    const exp = screen.getByText("experiment").closest(".txw-ax")!;
    expect(exp).not.toHaveClass("ragged");
    expect(exp).toHaveTextContent("3");
    const frame = screen.getByText("frame").closest(".txw-ax")!;
    expect(frame).toHaveClass("ragged");
    expect(frame).toHaveTextContent("~");
  });

  it("colours value chips by type and shows the @grain tag", () => {
    render(<ArrayShapeNode title="x" variant="table" axes={axes} values={values} />);
    expect(screen.getByText("speed").closest(".txw-val")).toHaveClass("num");
    const cls = screen.getByText("class").closest(".txw-val")!;
    expect(cls).toHaveClass("catg");
    expect(cls).toHaveTextContent("@cell");
  });

  it("renders removed axes struck-through (collapse), and join keys highlighted", () => {
    render(<ArrayShapeNode title="per cell" variant="grain"
      axes={axes.slice(0, 2)} values={[]} removed={["frame"]} onKeys={["experiment"]} />);
    expect(screen.getByText("frame").closest(".txw-ax")).toHaveClass("gone");
    expect(screen.getByText("experiment").closest(".txw-ax")).toHaveClass("keyhi");
  });

  it("applies the variant class and falls back to rows×cols when no descriptor", () => {
    const { container } = render(
      <ArrayShapeNode title="source" variant="source" axes={[]} values={[]} rows={1240} cols={5} />);
    expect(container.querySelector(".txw-node")).toHaveClass("source");
    expect(screen.getByText("1240×5")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/ArrayShapeNode.test.tsx`
Expected: FAIL — module `./ArrayShapeNode` not found.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/ArrayShapeNode.tsx
import type { AxisDesc, ValueDesc } from "../types";

export type NodeVariant = "source" | "table" | "grain" | "hub";

export interface ArrayShapeNodeProps {
  title: string;
  variant: NodeVariant;
  axes: AxisDesc[];
  values: ValueDesc[];
  removed?: string[];   // axis names a downstream collapse removed (struck-through)
  onKeys?: string[];    // join-key axis names (amber highlight)
  rows?: number;        // fallback when the descriptor hasn't loaded
  cols?: number;
}

const VAL_CLASS: Record<string, string> = {
  numeric: "num", categorical: "catg", bool: "bool",
};

export function ArrayShapeNode(
  { title, variant, axes, values, removed = [], onKeys = [], rows, cols }: ArrayShapeNodeProps,
) {
  const hasDescriptor = axes.length > 0 || values.length > 0;
  return (
    <div className={`txw-node ${variant}`}>
      <div className="txw-ntitle">{title}</div>

      {axes.length > 0 && (
        <div className="txw-row">
          <span className="txw-rk">axes</span>
          {axes.map((a, i) => (
            <span key={a.name} className="txw-axwrap">
              <span className={`txw-ax${a.ragged ? " ragged" : ""}${onKeys.includes(a.name) ? " keyhi" : ""}`}>
                {a.name}
                <span className="txw-n">{a.ragged ? "~" : a.n_levels}</span>
              </span>
              {(i < axes.length - 1 || removed.length > 0) && <span className="txw-caret">▸</span>}
            </span>
          ))}
          {removed.map((name) => (
            <span key={name} className="txw-ax gone">{name}</span>
          ))}
        </div>
      )}

      {values.length > 0 && (
        <div className="txw-row">
          <span className="txw-rk">values</span>
          {values.map((v) => (
            <span key={v.name} className={`txw-val ${VAL_CLASS[v.type] ?? "num"}`}>
              {v.name}
              {v.grain && <span className="txw-grain">@{v.grain}</span>}
            </span>
          ))}
        </div>
      )}

      {!hasDescriptor && rows != null && cols != null && (
        <div className="txw-count">{rows}×{cols}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the chip CSS to `src/index.css`**

Append (ported from the mockups; `.txw-` prefixed to avoid clashing with the existing `.tx-*` strip):

```css
/* ── Array-shape workspace: node + chips (Phase 3) ───────────────────────── */
.txw-node { background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px;
  padding:7px 11px; box-shadow:0 1px 2px rgba(15,23,42,.05); display:inline-block; }
.txw-node.source { background:#fff; border-style:dashed; }
.txw-node.hub { background:#cffafe; border-color:#67e8f9; }
.txw-node.grain { background:#f5f3ff; border-color:#ddd6fe; }
.txw-ntitle { font:600 10px/1; letter-spacing:.04em; text-transform:uppercase;
  color:#64748b; margin-bottom:6px; }
.txw-node.grain .txw-ntitle { color:#6d28d9; }
.txw-node.hub .txw-ntitle { color:#0e7490; }
.txw-row { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin:2px 0; }
.txw-rk { font:600 9px/1; text-transform:uppercase; letter-spacing:.05em;
  color:#94a3b8; width:34px; flex:none; }
.txw-axwrap { display:inline-flex; align-items:center; gap:5px; }
.txw-ax { display:inline-flex; align-items:center; gap:3px; background:#e0f2fe;
  border:1px solid #7dd3fc; color:#0369a1; border-radius:4px; padding:1px 6px; font-size:11px; }
.txw-ax .txw-n { font:600 9px/1 ui-monospace,monospace; color:#0284c7;
  background:#fff; border-radius:2px; padding:1px 3px; }
.txw-ax.ragged { border-style:dashed; }
.txw-ax.gone { opacity:.3; text-decoration:line-through; }
.txw-ax.keyhi { background:#fef3c7; border-color:#fcd34d; color:#b45309; }
.txw-ax.keyhi .txw-n { color:#b45309; }
.txw-val { display:inline-flex; align-items:center; gap:4px; border-radius:4px;
  padding:1px 6px; font-size:11px; border:1px solid; }
.txw-val.num  { background:#dcfce7; border-color:#86efac; color:#15803d; }
.txw-val.catg { background:#f3e8ff; border-color:#d8b4fe; color:#7e22ce; }
.txw-val.bool { background:#fef3c7; border-color:#fcd34d; color:#b45309; }
.txw-val .txw-grain { font:9px/1 ui-monospace,monospace; opacity:.75; }
.txw-caret { color:#cbd5e1; font-size:11px; }
.txw-count { font-size:12px; color:#64748b; font-variant-numeric:tabular-nums; }
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/components/ArrayShapeNode.test.tsx`
Expected: PASS (4 passed). Then `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ArrayShapeNode.tsx src/components/ArrayShapeNode.test.tsx src/index.css
git commit -m "feat(workspace): ArrayShapeNode — array-shape node readout (axes + values chips)"
```

---

## Task 2: `buildWorkspaceModel` — flat graph → render-ready spine

**Files:**
- Create: `src/explorer/workspace.ts`, `src/explorer/workspace.test.ts`

**Why:** The view needs the graph reshaped into a vertical spine: the main chain (each node + its incoming op edge), a join's right-input attached to its hub with the `on` keys, the axes a collapse removed (for strike-out), and the terminal fork (plot/stats + the geom/test edges that read into them). All pure and unit-testable, keeping the view dumb.

- [ ] **Step 1: Write the failing test**

```ts
// src/explorer/workspace.test.ts
import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph";
import { buildWorkspaceModel } from "./workspace";
import type { Layer, ReduceStep, Schema, Table } from "../types";
import { RAW_LEVEL } from "../types";
import { defaultPlan } from "../collapse";

const SCHEMA = { schema_version: "1.0", columns: [
  { name: "experiment", label: "Experiment", type: "identifier" },
  { name: "cell", label: "Cell", type: "identifier" },
  { name: "area", label: "Area", type: "numeric" },
] } as unknown as Schema;
const SPINE = ["experiment", "cell"];
const PLAN = defaultPlan(SPINE, {});

/* attach a minimal descriptor to nodes the way explorerGraphAtom would, so the
   model can compute removed axes. */
function withCounts(g: ReturnType<typeof buildGraph>) {
  const axesFull = [
    { name: "experiment", n_levels: 3, ragged: false },
    { name: "cell", n_levels: 122, ragged: false },
  ];
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id === "grain:experiment") {
        return { ...n, count: { rows: 3, cols: 1, axes: axesFull.slice(0, 1), values: [] } };
      }
      if (n.kind === "table") {
        return { ...n, count: { rows: 99, cols: 3, axes: axesFull, values: [
          { name: "area", type: "numeric", grain: null }] } };
      }
      return n;
    }),
  };
}

describe("buildWorkspaceModel", () => {
  it("walks the main spine source→…→grain, attaching each node's in-edge op label", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const m = buildWorkspaceModel(withCounts(g));
    const ids = m.spine.map((s) => s.node.id);
    expect(ids[0]).toBe("source");
    expect(ids).toContain("grain:experiment");
    // a collapse node's in-edge carries the op label
    const grain = m.spine.find((s) => s.node.id === "grain:experiment")!;
    expect(grain.inEdge?.kind).toBe("collapse");
    expect(grain.inEdge?.op).toBe("mean over Cell");
  });

  it("computes removed axes from the parent for a collapse node", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const m = buildWorkspaceModel(withCounts(g));
    const grain = m.spine.find((s) => s.node.id === "grain:experiment")!;
    expect(grain.removed).toEqual(["cell"]);
  });

  it("attaches a join's right input + on-keys to the hub, off the main spine", () => {
    const right: Table = { schema: { schema_version: "1.0", columns: [
      { name: "cell", type: "identifier", label: "Cell" },
      { name: "class", type: "categorical", label: "Class" }] }, rows: [{ id: "1", cell: "c1", class: "x" }] };
    const g = buildGraph([{ kind: "join", on: ["cell"], how: "inner", right }], SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const m = buildWorkspaceModel(withCounts(g));
    const join = m.spine.find((s) => s.node.kind === "table" && s.rightInput)!;
    expect(join.rightInput?.id).toBe("source:0");
    expect(join.onKeys).toEqual(["Cell"]);
    // the right-input source node is NOT a separate main-spine entry
    expect(m.spine.some((s) => s.node.id === "source:0")).toBe(false);
  });

  it("collects the terminal fork: plot + stats with their incoming branch edges", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: "Welch's t-test", describeOnly: false });
    const m = buildWorkspaceModel(withCounts(g));
    const plot = m.fork.find((f) => f.terminal.kind === "plot")!;
    expect(plot.edges.some((e) => e.kind === "geom")).toBe(true);
    const stats = m.fork.find((f) => f.terminal.kind === "stats")!;
    expect(stats.edges.some((e) => e.kind === "test" && e.op === "Welch's t-test")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/explorer/workspace.test.ts`
Expected: FAIL — module `./workspace` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/explorer/workspace.ts
import type { AxisDesc, ValueDesc } from "../types";
import type { Edge, EdgeKind, ExplorerGraph, ExplorerNode, NodeKind } from "./graph";

export type WsVariant = "source" | "table" | "grain" | "hub";

export interface WsNode {
  id: string;
  kind: NodeKind;
  title: string;
  variant: WsVariant;
  axes: AxisDesc[];
  values: ValueDesc[];
  rows?: number;
  cols?: number;
}
export interface WsEdge { id: string; kind: EdgeKind; op: string; guards?: Edge["guards"] }
export interface SpineEntry {
  node: WsNode;
  inEdge?: WsEdge;
  removed: string[];
  rightInput?: WsNode;
  onKeys?: string[];
}
export interface ForkEntry { terminal: WsNode; edges: (WsEdge & { fromTitle: string })[] }
export interface WorkspaceModel { spine: SpineEntry[]; fork: ForkEntry[] }

const BRANCH: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["geom", "test"]);
const isTerminal = (n?: ExplorerNode) => n?.kind === "plot" || n?.kind === "stats";

function variantOf(node: ExplorerNode, isHub: boolean): WsVariant {
  if (isHub) return "hub";
  if (node.id === "source" || node.id.startsWith("source:")) return "source";
  if (node.id.startsWith("grain:")) return "grain";
  return "table";
}

function toWsNode(node: ExplorerNode, isHub = false): WsNode {
  const c = node.count;
  return {
    id: node.id, kind: node.kind, title: node.label, variant: variantOf(node, isHub),
    axes: c?.axes ?? [], values: c?.values ?? [], rows: c?.rows, cols: c?.cols,
  };
}

const parseOnKeys = (label: string): string[] =>
  label.startsWith("join on ") ? label.slice("join on ".length).split(", ") : [];

export function buildWorkspaceModel(graph: ExplorerGraph): WorkspaceModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const opEdges = graph.edges.filter((e) => !BRANCH.has(e.kind));

  // right inputs: a `source:<i>` node feeds a join; map join node -> {right, keys}
  const rightOf = new Map<string, { node: ExplorerNode; keys: string[] }>();
  for (const e of opEdges) {
    if (e.fromId.startsWith("source:")) {
      const r = byId.get(e.fromId);
      if (r) rightOf.set(e.toId, { node: r, keys: parseOnKeys(e.label) });
    }
  }

  // walk the main chain from `source` via outgoing op edges (skipping edges into a
  // right-input or a terminal); each step's edge is the NEXT node's in-edge.
  const spine: SpineEntry[] = [];
  let curId: string | null = "source";
  let prevEdge: Edge | undefined;
  const seen = new Set<string>();
  while (curId && byId.has(curId) && !seen.has(curId)) {
    seen.add(curId);
    const node = byId.get(curId)!;
    const ws = toWsNode(node, rightOf.has(curId));
    const parent = prevEdge ? byId.get(prevEdge.fromId) : undefined;
    const removed = (parent?.count?.axes ?? [])
      .map((a) => a.name)
      .filter((n) => !ws.axes.some((a) => a.name === n));
    const right = rightOf.get(curId);
    spine.push({
      node: ws,
      inEdge: prevEdge ? { id: prevEdge.id, kind: prevEdge.kind, op: prevEdge.label, guards: prevEdge.guards } : undefined,
      removed,
      rightInput: right ? toWsNode(right.node) : undefined,
      onKeys: right ? right.keys : undefined,
    });
    const out: Edge | undefined = opEdges.find(
      (e) => e.fromId === curId && !e.toId.startsWith("source:") && !isTerminal(byId.get(e.toId)),
    );
    prevEdge = out;
    curId = out ? out.toId : null;
  }

  // terminal fork: each plot/stats node + its incoming branch (geom/test) edges
  const fork: ForkEntry[] = graph.nodes
    .filter((n) => isTerminal(n))
    .map((t) => ({
      terminal: toWsNode(t),
      edges: graph.edges
        .filter((e) => e.toId === t.id && BRANCH.has(e.kind))
        .map((e) => ({ id: e.id, kind: e.kind, op: e.label, guards: e.guards,
          fromTitle: byId.get(e.fromId)?.label ?? "" })),
    }))
    .filter((f) => f.edges.length > 0);

  return { spine, fork };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/explorer/workspace.test.ts`
Expected: PASS (4 passed). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/explorer/workspace.ts src/explorer/workspace.test.ts
git commit -m "feat(workspace): buildWorkspaceModel — flat graph to render-ready spine"
```

---

## Task 3: `WorkspaceView` — the full-screen surface

**Files:**
- Create: `src/components/WorkspaceView.tsx`, `src/components/WorkspaceView.test.tsx`
- Modify: `src/index.css` (workspace/canvas/edge/join/fork styles)

**Why:** The presentational full-screen view: a topbar with the type legend, a dot-grid canvas, the vertical spine of `ArrayShapeNode`s joined by coloured op-edge labels, the join confluence, and the terminal fork. Pure (`graph` prop) → RTL-testable with a fixture. Visual reference: `04-full-workspace.html`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/WorkspaceView.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { WorkspaceView } from "./WorkspaceView";
import { buildGraph } from "../explorer/graph";
import type { Schema } from "../types";
import { RAW_LEVEL } from "../types";
import { defaultPlan } from "../collapse";

const SCHEMA = { schema_version: "1.0", columns: [
  { name: "experiment", label: "Experiment", type: "identifier" },
  { name: "cell", label: "Cell", type: "identifier" },
  { name: "area", label: "Area", type: "numeric" },
] } as unknown as Schema;
const SPINE = ["experiment", "cell"];

function graphWithCounts() {
  const g = buildGraph([{ kind: "drop", columns: ["area"] }], SPINE, defaultPlan(SPINE, {}),
    [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, { test: "Welch's t-test", describeOnly: false });
  const axes = [{ name: "experiment", n_levels: 3, ragged: false },
                { name: "cell", n_levels: 122, ragged: false }];
  return { ...g, nodes: g.nodes.map((n) => n.kind === "table"
    ? { ...n, count: { rows: 99, cols: 3, axes, values: [{ name: "area", type: "numeric", grain: null }] } } : n) };
}

describe("WorkspaceView", () => {
  it("renders the legend and the op-edge labels", () => {
    render(<WorkspaceView graph={graphWithCounts()} onClose={() => {}} />);
    expect(screen.getByText(/numeric/i)).toBeInTheDocument();   // legend swatch label
    expect(screen.getByText("drop Area")).toBeInTheDocument();   // op-edge label
    expect(screen.getByText("mean over Cell")).toBeInTheDocument();
  });

  it("renders the terminal fork (plot + stats) with their read labels", () => {
    render(<WorkspaceView graph={graphWithCounts()} onClose={() => {}} />);
    expect(screen.getByText("dots")).toBeInTheDocument();        // geom edge into plot
    expect(screen.getByText("Welch's t-test")).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", () => {
    let closed = false;
    render(<WorkspaceView graph={graphWithCounts()} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/WorkspaceView.test.tsx`
Expected: FAIL — module `./WorkspaceView` not found.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/WorkspaceView.tsx
import { useEffect } from "react";
import type { ExplorerGraph } from "../explorer/graph";
import { buildWorkspaceModel, type SpineEntry, type WsEdge } from "../explorer/workspace";
import { ArrayShapeNode } from "./ArrayShapeNode";

const LEGEND: { cls: string; label: string }[] = [
  { cls: "axis", label: "axis" }, { cls: "key", label: "join key" },
  { cls: "num", label: "numeric" }, { cls: "catg", label: "categorical" },
  { cls: "grain", label: "grain" },
];

function OpEdge({ edge }: { edge: WsEdge }) {
  return (
    <div className="txw-edge">
      <span className={`txw-arr ${edge.kind}`}>↓</span>
      {edge.op && <span className={`txw-op ${edge.kind}`}>{edge.op}</span>}
    </div>
  );
}

function SpineRow({ entry }: { entry: SpineEntry }) {
  const { node, rightInput, onKeys, removed } = entry;
  const main = (
    <ArrayShapeNode title={node.title} variant={node.variant} axes={node.axes}
      values={node.values} removed={removed} onKeys={onKeys}
      rows={node.rows} cols={node.cols} />
  );
  if (!rightInput) return main;
  return (
    <div className="txw-joinwrap">
      {main}
      <div className="txw-into">←</div>
      <div className="txw-rightin">
        <div className="txw-inlbl">right input ↓</div>
        <ArrayShapeNode title={rightInput.title} variant="source"
          axes={rightInput.axes} values={rightInput.values} onKeys={onKeys}
          rows={rightInput.rows} cols={rightInput.cols} />
      </div>
    </div>
  );
}

export function WorkspaceView({ graph, onClose }: { graph: ExplorerGraph; onClose: () => void }) {
  const model = buildWorkspaceModel(graph);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txw-overlay" role="dialog" aria-label="Transformation workspace">
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workspace</h1>
        <div className="txw-legend">
          {LEGEND.map((l) => (
            <span key={l.cls}><b className={`txw-sw ${l.cls}`} />{l.label}</span>
          ))}
        </div>
        <button className="txw-close" onClick={onClose} aria-label="Close workspace">✕</button>
      </div>
      <div className="txw-canvas">
        <div className="txw-spine">
          {model.spine.map((entry) => (
            <div key={entry.node.id} className="txw-spine-item">
              {entry.inEdge && <OpEdge edge={entry.inEdge} />}
              <SpineRow entry={entry} />
            </div>
          ))}
          {model.fork.length > 0 && (
            <>
              <div className="txw-edge"><span className="txw-arr">↓</span></div>
              <div className="txw-fork">
                {model.fork.map((f) => (
                  <div key={f.terminal.id} className="txw-forkcol">
                    <div className={`txw-forklabel ${f.terminal.kind}`}>
                      {f.terminal.kind === "plot" ? "geom" : "test"}
                    </div>
                    <div className="txw-term">
                      <div className="txw-tt">{f.terminal.title}</div>
                      {f.edges.map((e) => (
                        <div key={e.id} className="txw-ts">{e.op} <span className="txw-multiin">← {e.fromTitle}</span></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the workspace CSS to `src/index.css`**

```css
/* ── Array-shape workspace: surface, edges, join, fork (Phase 3) ──────────── */
.txw-overlay { position:fixed; inset:0; z-index:50; background:#f8fafc;
  display:flex; flex-direction:column; overflow:auto; }
.txw-topbar { position:sticky; top:0; display:flex; align-items:center;
  justify-content:space-between; gap:16px; padding:10px 20px; background:#fff;
  border-bottom:1px solid #e2e8f0; }
.txw-title { font-size:14px; margin:0; font-weight:600; }
.txw-legend { display:flex; gap:14px; font-size:11px; color:#64748b; margin-left:auto; }
.txw-legend span { display:inline-flex; align-items:center; }
.txw-sw { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:4px; }
.txw-sw.axis { background:#7dd3fc; } .txw-sw.key { background:#fcd34d; }
.txw-sw.num { background:#86efac; } .txw-sw.catg { background:#d8b4fe; }
.txw-sw.grain { background:#c4b5fd; }
.txw-close { border:1px solid var(--line); background:#fff; border-radius:6px;
  width:28px; height:28px; cursor:pointer; color:#475569; }
.txw-canvas { padding:30px 20px 60px; flex:1;
  background-image:radial-gradient(#e2e8f0 1px, transparent 1px); background-size:22px 22px; }
.txw-spine { display:flex; flex-direction:column; align-items:center; gap:0; }
.txw-spine-item { display:flex; flex-direction:column; align-items:center; }
.txw-edge { display:flex; flex-direction:column; align-items:center; padding:3px 0; }
.txw-arr { font-size:18px; line-height:.7; color:#475569; }
.txw-op { font:600 11px/1 ui-monospace,monospace; padding:2px 8px; border-radius:5px; margin-top:1px; }
.txw-op.derive{background:#dcfce7;color:#166534} .txw-arr.derive{color:#16a34a}
.txw-op.filter{background:#ffe4e6;color:#9f1239} .txw-arr.filter{color:#e11d48}
.txw-op.drop{background:#ffedd5;color:#9a3412} .txw-arr.drop{color:#d97706}
.txw-op.recode{background:#fef9c3;color:#854d0e} .txw-arr.recode{color:#ca8a04}
.txw-op.collapse{background:#ede9fe;color:#5b21b6} .txw-arr.collapse{color:#7c3aed}
.txw-op.join{background:#cffafe;color:#155e75} .txw-arr.join{color:#0891b2}
.txw-op.pivot{background:#ccfbf1;color:#115e59} .txw-arr.pivot{color:#0d9488}
.txw-op.grid_complete{background:#f3e8ff;color:#6b21a8} .txw-arr.grid_complete{color:#9333ea}
.txw-joinwrap { display:flex; align-items:flex-end; gap:16px; }
.txw-rightin { display:flex; flex-direction:column; align-items:center; }
.txw-inlbl { font:600 9px/1; text-transform:uppercase; letter-spacing:.05em; color:#94a3b8; margin-bottom:4px; }
.txw-into { font-size:22px; color:#0891b2; line-height:1; padding-bottom:14px; }
.txw-fork { display:flex; gap:60px; margin-top:6px; }
.txw-forkcol { display:flex; flex-direction:column; align-items:center; gap:4px; }
.txw-forklabel { font:600 10px/1 ui-monospace,monospace; color:#64748b; }
.txw-forklabel.plot { color:#0e7490; } .txw-forklabel.stats { color:#4f46e5; }
.txw-term { background:#f8fafc; border:1px dashed #94a3b8; border-radius:8px;
  padding:9px 16px; text-align:center; color:#475569; }
.txw-tt { font:600 12px/1; } .txw-ts { font-size:10px; color:#64748b; margin-top:3px; }
.txw-multiin { color:#94a3b8; font-style:italic; }
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/components/WorkspaceView.test.tsx`
Expected: PASS (3 passed). Then `npx tsc --noEmit` → clean.

(If `@testing-library/user-event` is not installed, the third test's dynamic import will fail — in that case replace the click with `fireEvent.click(screen.getByRole("button", { name: /close/i }))` from `@testing-library/react`, which is already a dependency.)

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceView.tsx src/components/WorkspaceView.test.tsx src/index.css
git commit -m "feat(workspace): WorkspaceView — full-screen array-shape DAG surface"
```

---

## Task 4: `TransformWorkspace` container — open/close + mount

**Files:**
- Create: `src/components/TransformWorkspace.tsx`, `src/components/TransformWorkspace.test.tsx`
- Modify: `src/state.ts` (`workspaceOpenAtom`), `src/App.tsx` (button + mount)

**Why:** A thin container reads `explorerGraphAtom` + a `workspaceOpenAtom` and mounts `WorkspaceView` via a portal when open; an "Expand" button by the inline strip opens it. Keeps the heavy atom-wiring out of the pure view.

- [ ] **Step 1: Add the atom to `src/state.ts`**

Find where small UI atoms live (e.g. near `selectedNodeIdAtom`) and add:

```ts
/* whether the full-screen transformation workspace overlay is open. */
export const workspaceOpenAtom = atom(false);
```

(Confirm `atom` is already imported from `jotai` in `state.ts`; it is used throughout.)

- [ ] **Step 2: Write the failing test**

```tsx
// src/components/TransformWorkspace.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { Provider, createStore } from "jotai";
import { TransformWorkspace } from "./TransformWorkspace";
import { workspaceOpenAtom } from "../state";
import { shapeCountsAtom } from "../explorer/graphAtom";

/* The container reads explorerGraphAtom (derived from the active plottable). With
   no active plottable the graph is null, so the overlay renders nothing even when
   open — assert the closed/open gating contract that does not need a full store. */
describe("TransformWorkspace", () => {
  it("renders nothing when closed", () => {
    const store = createStore();
    const { container } = render(<Provider store={store}><TransformWorkspace /></Provider>);
    expect(container.querySelector(".txw-overlay")).toBeNull();
  });

  it("renders nothing when open but there is no graph (no active analysis)", () => {
    const store = createStore();
    store.set(workspaceOpenAtom, true);
    void shapeCountsAtom;   // ensure the atom module is wired
    const { container } = render(<Provider store={store}><TransformWorkspace /></Provider>);
    expect(container.querySelector(".txw-overlay")).toBeNull();
  });
});
```

(Note: a full render-with-graph path is already covered by `WorkspaceView.test.tsx`; this task's test pins the container's open/closed + null-graph gating, which is all the container adds.)

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/components/TransformWorkspace.test.tsx`
Expected: FAIL — module `./TransformWorkspace` not found.

- [ ] **Step 4: Write the implementation**

```tsx
// src/components/TransformWorkspace.tsx
import { createPortal } from "react-dom";
import { useAtom, useAtomValue } from "jotai";
import { workspaceOpenAtom } from "../state";
import { explorerGraphAtom } from "../explorer/graphAtom";
import { WorkspaceView } from "./WorkspaceView";

export function TransformWorkspace() {
  const [open, setOpen] = useAtom(workspaceOpenAtom);
  const graph = useAtomValue(explorerGraphAtom);
  if (!open || !graph) return null;
  return createPortal(
    <WorkspaceView graph={graph} onClose={() => setOpen(false)} />,
    document.body,
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/components/TransformWorkspace.test.tsx`
Expected: PASS (2 passed).

- [ ] **Step 6: Wire the button + mount into `src/App.tsx`**

`App.tsx` imports and renders the inline strip at ~line 473:
```tsx
      {viewMode === "analyses" && !dataLoading && active && (
        <div className="tx-strip"><TransformExplorer /></div>
      )}
```
(a) Add the imports near the other component imports (TransformExplorer is imported at line 13):
```tsx
import { TransformWorkspace } from "./components/TransformWorkspace";
```
and add `workspaceOpenAtom` to the existing `from "./state"` import, plus `useSetAtom` if not already imported from jotai.

(b) Replace the strip block with one that adds an Expand button and mounts the container:
```tsx
      {viewMode === "analyses" && !dataLoading && active && (
        <div className="tx-strip">
          <TransformExplorer />
          <button className="tx-expand" title="Open the full transformation workspace"
            onClick={() => setWorkspaceOpen(true)}>⤢ Workspace</button>
        </div>
      )}
      <TransformWorkspace />
```
where `const setWorkspaceOpen = useSetAtom(workspaceOpenAtom);` is declared with the other hooks in the `App` component body.

(c) Add a small style to `src/index.css`:
```css
.tx-expand { margin-left:8px; align-self:flex-start; border:1px solid var(--line);
  background:#fff; border-radius:6px; padding:3px 9px; font-size:12px; cursor:pointer; color:#475569; }
.tx-strip { display:flex; align-items:flex-start; }
```
(If `.tx-strip` already sets `display`, merge rather than duplicate — check the existing rule first and adjust in place.)

- [ ] **Step 7: Verify typecheck + full suite**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all pass (report the summary).

- [ ] **Step 8: Commit**

```bash
git add src/components/TransformWorkspace.tsx src/components/TransformWorkspace.test.tsx src/state.ts src/App.tsx src/index.css
git commit -m "feat(workspace): TransformWorkspace container + Expand trigger + portal mount"
```

---

## Task 5: `cannedExamples.ts` — per-op before/after schematics

**Files:**
- Create: `src/explorer/cannedExamples.ts`, `src/explorer/cannedExamples.test.ts`

**Why:** Hovering an op shows a fixed, authored before/after rows mini-table (§ *Hover*). Chosen over rendering the user's real rows because it's predictable and doubles as documentation. One example pair per op kind. Reference the `02`/`05`/`06` mockups for the pivot/grid/join tables.

- [ ] **Step 1: Write the failing test**

```ts
// src/explorer/cannedExamples.test.ts
import { describe, it, expect } from "vitest";
import { cannedExample, CANNED } from "./cannedExamples";
import type { EdgeKind } from "./graph";

describe("cannedExamples", () => {
  it("has an authored before/after pair for every op edge kind", () => {
    const ops: EdgeKind[] = ["filter", "drop", "derive", "recode", "join", "pivot", "grid_complete", "collapse"];
    for (const k of ops) {
      const ex = cannedExample(k);
      expect(ex, k).toBeTruthy();
      expect(ex!.before.cols.length).toBeGreaterThan(0);
      expect(ex!.after.cols.length).toBeGreaterThan(0);
      expect(ex!.before.rows.length).toBeGreaterThan(0);
      expect(ex!.after.rows.length).toBeGreaterThan(0);
      expect(ex!.caption.length).toBeGreaterThan(0);
    }
  });

  it("returns null for the non-op terminal edges (geom/test)", () => {
    expect(cannedExample("geom")).toBeNull();
    expect(cannedExample("test")).toBeNull();
  });

  it("pivot widens (after has more cols than before)", () => {
    const ex = CANNED.pivot!;
    expect(ex.after.cols.length).toBeGreaterThan(ex.before.cols.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/explorer/cannedExamples.test.ts`
Expected: FAIL — module `./cannedExamples` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/explorer/cannedExamples.ts
import type { EdgeKind } from "./graph";

export interface MiniTable { cols: string[]; rows: (string | number)[][] }
export interface CannedExample { before: MiniTable; after: MiniTable; caption: string }

/* Fixed, authored before/after schematics — identical every render, no curation
   logic. One pair per op kind; doubles as documentation. Mirrors the 02/05/06
   mockup tables. */
export const CANNED: Partial<Record<EdgeKind, CannedExample>> = {
  filter: {
    before: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c2", 98.0], ["c3", 1.7]] },
    after: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c3", 1.7]] },
    caption: "Keep only rows passing the predicate (here a p99 cap drops c2).",
  },
  drop: {
    before: { cols: ["cell", "area", "speed"], rows: [["c1", 540, 2.1], ["c2", 610, 1.8]] },
    after: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c2", 1.8]] },
    caption: "Remove a column; rows are untouched.",
  },
  derive: {
    before: { cols: ["cell", "perimeter", "area"], rows: [["c1", 88, 540], ["c2", 102, 610]] },
    after: { cols: ["cell", "perimeter", "area", "q"], rows: [["c1", 88, 540, 3.8], ["c2", 102, 610, 4.1]] },
    caption: "Add a column computed elementwise from existing ones (q = perimeter/√area).",
  },
  recode: {
    before: { cols: ["cell", "class"], rows: [["c1", 0], ["c2", 1], ["c3", 0]] },
    after: { cols: ["cell", "class"], rows: [["c1", "non-div"], ["c2", "dividing"], ["c3", "non-div"]] },
    caption: "Relabel a categorical's levels (0→non-div, 1→dividing); unmapped pass through.",
  },
  join: {
    before: { cols: ["experiment", "cell", "speed"], rows: [["E1", "c1", 2.1], ["E1", "c2", 1.8]] },
    after: { cols: ["experiment", "cell", "speed", "class"], rows: [["E1", "c1", 2.1, "non-div"], ["E1", "c2", 1.8, "dividing"]] },
    caption: "Align a second table on the shared axis path and add its columns.",
  },
  pivot: {
    before: { cols: ["cell", "feature", "measure"], rows: [["c1", "perimeter", 88], ["c1", "area", 540], ["c2", "perimeter", 102], ["c2", "area", 610]] },
    after: { cols: ["cell", "perimeter", "area"], rows: [["c1", 88, 540], ["c2", 102, 610]] },
    caption: "Unstack a categorical axis: each level becomes a named column (long→wide).",
  },
  grid_complete: {
    before: { cols: ["position", "transition"], rows: [["p1", "A→B"], ["p1", "A→B"], ["p1", "B→C"], ["p2", "A→B"]] },
    after: { cols: ["position", "transition", "count"], rows: [["p1", "A→B", 2], ["p1", "B→C", 1], ["p1", "C→A", 0], ["p2", "A→B", 1], ["p2", "B→C", 0], ["p2", "C→A", 0]] },
    caption: "Densify a ragged axis to the full declared grid; absent combos become honest 0s.",
  },
  collapse: {
    before: { cols: ["cell", "frame", "speed"], rows: [["c1", 1, 2.0], ["c1", 2, 2.2], ["c2", 1, 1.7]] },
    after: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c2", 1.7]] },
    caption: "Aggregate over the innermost axis (median over frame), one value per group.",
  },
};

export function cannedExample(kind: EdgeKind): CannedExample | null {
  return CANNED[kind] ?? null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/explorer/cannedExamples.test.ts`
Expected: PASS (3 passed). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/explorer/cannedExamples.ts src/explorer/cannedExamples.test.ts
git commit -m "feat(workspace): canned per-op before/after schematics"
```

---

## Task 6: `OpHoverExample` — show the canned schematic on op hover

**Files:**
- Create: `src/components/OpHoverExample.tsx`, `src/components/OpHoverExample.test.tsx`
- Modify: `src/components/WorkspaceView.tsx` (wire hover on the op edge), `src/index.css` (hover/table styles)

**Why:** § *Hover* — hovering an op reveals its authored before/after rows table. `OpHoverExample` renders a `CannedExample`; `WorkspaceView`'s `OpEdge` shows it on hover (mouse enter/leave or focus).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/OpHoverExample.test.tsx
import { render, screen } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { OpHoverExample } from "./OpHoverExample";
import { cannedExample } from "../explorer/cannedExamples";

describe("OpHoverExample", () => {
  it("renders the before/after columns, rows, and caption for an op", () => {
    render(<OpHoverExample example={cannedExample("pivot")!} />);
    expect(screen.getByText(/long→wide|named column/i)).toBeInTheDocument();   // caption
    expect(screen.getByText("feature")).toBeInTheDocument();   // a before column
    expect(screen.getByText("perimeter")).toBeInTheDocument(); // an after column
    expect(screen.getAllByRole("table")).toHaveLength(2);      // before + after
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/OpHoverExample.test.tsx`
Expected: FAIL — module `./OpHoverExample` not found.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/OpHoverExample.tsx
import type { CannedExample, MiniTable } from "../explorer/cannedExamples";

function Mini({ table, caption }: { table: MiniTable; caption: string }) {
  return (
    <table className="txw-mini" aria-label={caption}>
      <thead><tr>{table.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function OpHoverExample({ example }: { example: CannedExample }) {
  return (
    <div className="txw-hover">
      <div className="txw-hover-tables">
        <div><div className="txw-hcap">before</div><Mini table={example.before} caption="before" /></div>
        <div className="txw-hover-arrow">→</div>
        <div><div className="txw-hcap">after</div><Mini table={example.after} caption="after" /></div>
      </div>
      <div className="txw-hover-note">{example.caption}</div>
    </div>
  );
}
```

- [ ] **Step 4: Wire hover into `WorkspaceView.tsx`**

Replace the `OpEdge` component with a hover-aware version (add a `useState` import to the file):

```tsx
function OpEdge({ edge }: { edge: WsEdge }) {
  const [hover, setHover] = useState(false);
  const ex = cannedExample(edge.kind);
  return (
    <div className="txw-edge"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className={`txw-arr ${edge.kind}`}>↓</span>
      {edge.op && (
        <span className={`txw-op ${edge.kind}`} tabIndex={0}
          onFocus={() => setHover(true)} onBlur={() => setHover(false)}>{edge.op}</span>
      )}
      {hover && ex && <OpHoverExample example={ex} />}
    </div>
  );
}
```

Add the imports at the top of `WorkspaceView.tsx`:
```tsx
import { useEffect, useState } from "react";
import { cannedExample } from "../explorer/cannedExamples";
import { OpHoverExample } from "./OpHoverExample";
```
(Merge the `useEffect`/`useState` import with the existing React import line.)

- [ ] **Step 5: Add hover CSS to `src/index.css`**

```css
/* ── Array-shape workspace: op-hover canned schematic (Phase 3) ───────────── */
.txw-edge { position:relative; }
.txw-hover { position:absolute; left:100%; top:0; z-index:5; margin-left:10px;
  background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px;
  box-shadow:0 6px 24px rgba(15,23,42,.12); width:max-content; max-width:420px; }
.txw-hover-tables { display:flex; align-items:center; gap:12px; }
.txw-hover-arrow { font-size:18px; color:#94a3b8; }
.txw-hcap { font:600 9px/1 ui-sans-serif; text-transform:uppercase; letter-spacing:.05em;
  color:#94a3b8; margin-bottom:4px; }
.txw-mini { border-collapse:collapse; font-size:11px; }
.txw-mini th { background:#f1f5f9; border:1px solid #cbd5e1; padding:2px 7px; color:#334155; font-weight:600; }
.txw-mini td { border:1px solid #e2e8f0; padding:2px 7px; text-align:center; font-variant-numeric:tabular-nums; }
.txw-hover-note { font-size:11px; color:#64748b; margin-top:8px; max-width:380px; }
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run src/components/OpHoverExample.test.tsx`
Expected: PASS. Then re-run the view test to confirm no regression:
`npx vitest run src/components/WorkspaceView.test.tsx` → PASS.

- [ ] **Step 7: Verify typecheck + full suite**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all pass (report the summary).

- [ ] **Step 8: Commit**

```bash
git add src/components/OpHoverExample.tsx src/components/OpHoverExample.test.tsx src/components/WorkspaceView.tsx src/index.css
git commit -m "feat(workspace): op-hover canned before/after schematic"
```

---

## Phase 3 self-check

- [ ] **Node readout** (§ *What a node shows*): axis chips with level counts, ragged dashed (`~`), collapse strike-out, join-key highlight; value chips coloured by type (numeric green / categorical violet / bool amber) with `@grain` tags. (Task 1)
- [ ] **Topology** (§ *Topology*): vertical spine; binary **join confluence** (hub + right input + on-keys); **flat graph** (right input drawn as its own node — single node, per the Phase-2 data-model boundary); **terminal fork** with one annotated entry per geom/test edge. (Tasks 2–3)
- [ ] **Workspace** (§ *The workspace*): dedicated full-screen surface, dot-grid canvas, top legend; opened from an Expand button, closed via ✕/Esc. (Tasks 3–4)
- [ ] **Hover** (§ *Hover*): canned before/after schematic per op kind. (Tasks 5–6)
- [ ] **Scope held:** no engine/`graph.ts`/`graphAtom.ts` logic change; the inline `TransformExplorer` strip is untouched; the workspace reads the existing descriptor only.
- [ ] Full frontend suite green; `tsc --noEmit` clean.

## Out of scope (deferred)

- **Right sub-pipeline drawn in full** — still one node (needs the TS `JoinStep` to model `right.reduce`/`right.collapse`; documented in Phase 2).
- **Node click → data tab in the workspace** — the inline strip already wires node→data-tab; replicating it inside the overlay is a follow-up, not required by the spec's workspace section.
- The `@grain` aggregation-function tag (the mockup's `speed med`) — the descriptor carries the structural grain (`@cell`), not the collapse fn; showing the fn is a later enhancement.
- Any change to statistics, collapse semantics, or the reduce vocabulary.
