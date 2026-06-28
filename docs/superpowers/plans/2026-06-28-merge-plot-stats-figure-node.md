# Merge Plot + Stats Terminals into one Figure Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the workbench graph's two terminal nodes (`Plot`, `Stats`) into one `Figure` node that shows both summaries, where left-clicking a section views it in the stash and right-clicking edits it.

**Architecture:** `buildGraph` emits a single `figure` terminal carrying two `sections` (plot, stats) instead of two nodes plus a `Stats→Plot` annotate back-edge. The node renderer draws the two sections; each section left-click pins its existing card (`FigurePane`/`StatsResults`) to the stash via a facet-scoped target; a node right-click opens an "Edit plot…/Edit test…" menu. The significance-bracket toggle moves from the retired annotate-edge editor into the Test picker. The `Plottable` data model and the engine are untouched.

**Tech Stack:** TypeScript, React, Jotai, @xyflow/react (React Flow), Vitest + Testing Library. CSS in `src/index.css`.

**Important — typecheck timing:** Vitest compiles per-test-file with esbuild (no cross-file type-checking), so each task's named test file goes green on its own. The project-wide `tsc` (`npm run build`) is intentionally run once at the end (Task 7); it may be red between tasks while the `NodeKind` narrowing ripples through. Commit per task regardless.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/explorer/graph.ts` | Build the node/edge graph from the spec | One `figure` terminal w/ `sections`; drop annotate edge; narrow `NodeKind`/`EdgeKind` |
| `src/explorer/graph.test.ts` | buildGraph unit tests | Single-terminal assertions; kind-scoped `edge()` helper |
| `src/workbench/cardRegistry.tsx` | Map a click target → card | `Target.facet`; figure→facet card; drop `annotate-editor` |
| `src/workbench/state.ts` | Session card/stash atoms | `cardId` keys on facet |
| `src/workbench/cardRegistry.test.tsx` | Registry/target tests | Figure fixture; facet expectations |
| `src/workbench/ArrayShapeRFNode.tsx` | ExplorerNode → RF node data + RF wrapper | `variantOf`/`accentKind`/`eyebrowText`; emit `sections`; section view handlers + badges; drop annotate handle |
| `src/components/ArrayShapeNode.tsx` | Presentational node | Render the two-section figure variant |
| `src/workbench/ArrayShapeRFNode.test.tsx` | Node-data unit tests | Figure sections; figure variant |
| `src/workbench/WorkbenchCanvas.tsx` | Canvas wiring (click/menu) | Figure right-click menu; figure left-click default facet |
| `src/workbench/NodeContextMenu.tsx` | Right-click menu | Generalize to an item list |
| `src/workbench/WorkbenchCanvas.test.tsx` | Canvas interaction tests | Figure menu test |
| `src/components/StatsPanel.tsx` | Stats readout + Test picker | `TestPicker` gains the significance toggle |
| `src/workbench/cards/AnnotateCard.tsx` | (retired) | Delete |
| `src/index.css` | Workbench node styles | `.txw-node.figure` two-section layout |

---

## Task 1: Graph builder emits one `figure` terminal with sections

**Files:**
- Modify: `src/explorer/graph.ts` (types ~L9–66; constants ~L85–86; terminal emission ~L251–323)
- Test: `src/explorer/graph.test.ts`

- [ ] **Step 1: Update the `edge()` test helper to optionally match on kind**

In `src/explorer/graph.test.ts`, replace the helper (L18–19):

```ts
const edge = (g: ReturnType<typeof buildGraph>, from: string, to: string, kind?: string) =>
  g.edges.find((e) => e.fromId === from && e.toId === to && (!kind || e.kind === kind));
```

- [ ] **Step 2: Rewrite the affected graph.test.ts assertions for the single terminal**

Apply these edits in `src/explorer/graph.test.ts`:

The "nodes are datatypes" test (~L22–33) — drop the second terminal from both arrays:

```ts
  it("nodes are datatypes: source/step tables, collapse tables, figure", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [] },
      { kind: "drop", columns: ["area"] },
    ] as unknown as ReduceStep[];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "source", "step:0", "step:1", "grain:experiment/cell", "grain:experiment", "figure",
    ]);
    expect(g.nodes.map((n) => n.kind)).toEqual([
      "table", "table", "table", "table", "table", "figure",
    ]);
  });
```

The `table.via` test (~L79–87) — replace the two terminal lines:

```ts
    expect(byId["figure"]).toEqual({ via: "none" });
```
(delete the `byId["plot"]` and `byId["stats"]` lines.)

The geom-edge tests — point every `"plot"` target at `"figure"` and scope by kind where a test edge could also share the endpoints:

```ts
  // "geom edge per layer into figure; raw reads the last reduce node"
  expect(edge(g, "step:0", "figure", "geom")).toMatchObject({ kind: "geom", label: "dots" });

  // "SuperPlot: distinct grains/geoms draw distinct geom edges; dups collapse"
  expect(edge(g, "source", "figure", "geom")?.label).toBe("dots");
  expect(edge(g, "grain:experiment", "figure", "geom")?.label).toBe("box");

  // "two geoms at the same grain collapse to one comma-joined edge"
  expect(geoms[0].fromId).toBe("source");   // unchanged; geoms still filtered by kind

  // "skips a geom edge for a level no longer on the spine"
  expect(geoms).toEqual([{ id: expect.any(String), kind: "geom",
    label: "", fromId: "source", toId: "figure" }]);
```

The test-edge tests (~L128–141) — target `"figure"`, scope by `"test"`:

```ts
  // "test edge runs at the coarsest layer-bound grain, into figure"
  expect(edge(g, "grain:experiment", "figure", "test")).toMatchObject({
    kind: "test", label: "Welch's t-test" });

  // "describe-only -> the test edge reads 'describe'"
  expect(edge(g, "grain:experiment", "figure", "test")).toMatchObject({ kind: "test", label: "describe" });
```

- [ ] **Step 3: Add a test asserting the figure node's two sections and no annotate edge**

Append inside the `describe("buildGraph", …)` block in `src/explorer/graph.test.ts`:

```ts
  it("the single figure terminal carries a plot section and a stats section", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: "Welch's t-test", describeOnly: false });
    const fig = g.nodes.find((n) => n.id === "figure")!;
    expect(fig.kind).toBe("figure");
    expect(fig.sections).toEqual([
      { kind: "plot", facts: ["dots"] },
      { kind: "stats", facts: ["Welch's t-test"] },
    ]);
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });

  it("annotated test marks the stats section, not a back-edge", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: "Welch's t-test", describeOnly: false, annotate: true });
    const fig = g.nodes.find((n) => n.id === "figure")!;
    expect(fig.sections?.find((s) => s.kind === "stats")?.facts)
      .toEqual(["Welch's t-test", "on figure"]);
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });
```

- [ ] **Step 4: Run the graph tests to verify they fail**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL — `buildGraph` still emits `plot`/`stats` nodes and the `annotate` edge.

- [ ] **Step 5: Narrow `NodeKind`/`EdgeKind` and add `sections` to `ExplorerNode`**

In `src/explorer/graph.ts`:

Replace the `NodeKind` line (L9):
```ts
export type NodeKind = "table" | "figure";
```

Replace the `EdgeKind` union (L18–21) — drop `"annotate"`:
```ts
export type EdgeKind =
  | "filter" | "drop" | "derive" | "recode" | "join"
  | "pivot" | "grid_complete"
  | "collapse" | "geom" | "test";
```

In `ExplorerNode`, replace the `facts?: string[]` field + its comment (L60–64) with:
```ts
  /* terminal (figure) sections: the plot's geom chips and the stats' test chip,
     kept distinct so the node renders two labeled sections. Set only on the
     terminal; absent elsewhere. */
  sections?: { kind: "plot" | "stats"; facts: string[] }[];
```

- [ ] **Step 6: Replace the terminal constants**

In `src/explorer/graph.ts`, replace the two id constants (L85–86):
```ts
const FIGURE_ID = "figure";
```

- [ ] **Step 7: Emit one figure node with sections; remove the annotate back-edge**

Replace the terminal-emission block (graph.ts ~L251–268) with:

```ts
  // terminal facts: the plot's distinct geoms (first-seen order) and the stats'
  // test, kept as two sections on ONE figure node. A `stats` "on figure" marker
  // replaces the old Stats->Plot annotate back-edge when a real test is drawn
  // onto the figure. Derived here, where layers + stats are in hand.
  const geomFacts: string[] = [];
  for (const layer of layers) {
    const g = geomLabel(layer.geom);
    if (!geomFacts.includes(g)) geomFacts.push(g);
  }
  const testFact = stats?.describeOnly ? "describe"
    : (stats?.test ? testLabel(stats.test) : "describe");
  const annotated = !!(stats && !stats.describeOnly && stats.annotate);
  nodes.push({ id: FIGURE_ID, kind: "figure", phase: "terminal", label: "Figure",
    table: { via: "none" },
    sections: [
      { kind: "plot", facts: geomFacts },
      { kind: "stats", facts: [testFact, ...(annotated ? ["on figure"] : [])] },
    ] });
```

In the geom-edge loop, change both `toId: PLOT_ID` occurrences (the `geomByNode` loop body ~L284 and the empty-fallback ~L287) to `toId: FIGURE_ID`.

Change the test-edge push (~L308–310) `fromId: testFromId, toId: STATS_ID` to `toId: FIGURE_ID`.

Delete the annotate back-edge block entirely (graph.ts ~L312–323, the comment plus the `if (stats && !stats.describeOnly && stats.test) { edges.push({ … kind: "annotate" … }); }`).

- [ ] **Step 8: Verify no stale `facts`/`PLOT_ID`/`STATS_ID`/`annotate` refs remain in graph.ts**

Run: `grep -n "PLOT_ID\|STATS_ID\|\.facts\|\"annotate\"\|kind: \"plot\"\|kind: \"stats\"" src/explorer/graph.ts`
Expected: no matches.

- [ ] **Step 9: Run the graph tests to verify they pass**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(graph): emit one figure terminal with plot+stats sections

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0165oufX8eejnsovUt9ZPEYL"
```

---

## Task 2: Facet-scoped targets and card-registry mapping

**Files:**
- Modify: `src/workbench/cardRegistry.tsx`, `src/workbench/state.ts`
- Test: `src/workbench/cardRegistry.test.tsx`

- [ ] **Step 1: Update cardRegistry.test.tsx to the figure fixture and facet expectations**

In `src/workbench/cardRegistry.test.tsx`, replace the two terminal nodes in the `graph` fixture with one figure node, and drop the annotate edge:

```ts
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" },
      sections: [{ kind: "plot", facts: ["dots"] }, { kind: "stats", facts: ["MW"] }] },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "figure" },
    { id: "c0", kind: "collapse", label: "mean", fromId: "source", toId: "figure" },
    { id: "g0", kind: "geom", label: "dots", fromId: "source", toId: "figure" },
    { id: "t0", kind: "test", label: "MW", fromId: "source", toId: "figure" },
  ],
```

Replace the node-mapping test body:

```ts
  it("maps a table node to table and the figure facets to plot/stats", () => {
    expect(targetToCardKind(graph, { kind: "node", id: "source" })).toBe("table");
    expect(targetToCardKind(graph, { kind: "node", id: "figure", facet: "plot" })).toBe("plot");
    expect(targetToCardKind(graph, { kind: "node", id: "figure", facet: "stats" })).toBe("stats");
    expect(targetToCardKind(graph, { kind: "node", id: "figure" })).toBe("plot");
  });
```

In the edge-mapping test, delete the `a0`/annotate assertion line. In the `kinds` array of the "CARD registry" test, delete `"annotate-editor"`.

- [ ] **Step 2: Run the registry tests to verify they fail**

Run: `npx vitest run src/workbench/cardRegistry.test.tsx`
Expected: FAIL — `Target` has no `facet`; `targetToCardKind` doesn't know `figure`.

- [ ] **Step 3: Add `facet` to `Target` and key `cardId` on it**

In `src/workbench/cardRegistry.tsx`, replace the `Target` interface (L18):
```ts
/* A click target: a graph node or edge, addressed by id. For the figure node a
   `facet` picks which half (plot vs stats) the click addresses. */
export interface Target { kind: "node" | "edge"; id: string; facet?: "plot" | "stats"; }
```

In `src/workbench/state.ts`, replace the `cardId` helper (L17):
```ts
const cardId = (t: Target): string => `${t.kind}:${t.id}${t.facet ? `:${t.facet}` : ""}`;
```

- [ ] **Step 4: Drop the annotate-editor card kind and mapping**

In `src/workbench/cardRegistry.tsx`:

Remove `AnnotateCard` from the imports (L6).

Replace the `CardKind` union (L12–15) — drop `"annotate-editor"`:
```ts
export type CardKind =
  | "table" | "plot" | "stats"
  | "op-editor" | "collapse-editor" | "geom-editor"
  | "test-editor";
```

In `EDGE_CARD` (L22–28), delete the `test`/`annotate` line's `annotate` entry so it reads:
```ts
  collapse: "collapse-editor", geom: "geom-editor", test: "test-editor",
```
(`EDGE_CARD` is typed `Record<EdgeKind, CardKind>` and `EdgeKind` no longer includes `annotate`, so the key must be gone.)

In the `CARD` registry (L57–71), delete the `"annotate-editor"` entry (L70).

- [ ] **Step 5: Teach `targetToCardKind` the figure facets**

In `src/workbench/cardRegistry.tsx`, replace the node branch of `targetToCardKind` (L33–37):
```ts
  if (target.kind === "node") {
    const node = graph.nodes.find((n) => n.id === target.id);
    if (!node) return null;
    if (node.kind === "figure") return target.facet === "stats" ? "stats" : "plot";
    return "table";
  }
```

- [ ] **Step 6: Run the registry tests to verify they pass**

Run: `npx vitest run src/workbench/cardRegistry.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/workbench/cardRegistry.tsx src/workbench/state.ts src/workbench/cardRegistry.test.tsx
git commit -m "feat(workbench): facet-scoped targets; figure node maps to plot/stats cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0165oufX8eejnsovUt9ZPEYL"
```

---

## Task 3: Node-data mapping for the figure variant

**Files:**
- Modify: `src/workbench/ArrayShapeRFNode.tsx` (`variantOf`, `accentKind`, `eyebrowText`, `nodeShapeProps`, `RFNodeData`, annotate handle), `src/components/ArrayShapeNode.tsx` (`NodeVariant`, props)
- Test: `src/workbench/ArrayShapeRFNode.test.tsx`

- [ ] **Step 1: Update ArrayShapeRFNode.test.tsx for the figure node**

In `src/workbench/ArrayShapeRFNode.test.tsx`:

Change the `mk` helper's kind type in the "terminals key off kind" test (L35) from `"table" | "plot" | "stats"` to `"table" | "figure"`, and replace that test (L34–39) with:

```ts
  it("gives the source an eyebrow and no detail; a figure carries two sections", () => {
    const src: ExplorerNode =
      { id: "source", kind: "table", phase: "source", label: "source", table: { via: "none" } };
    expect(nodeShapeProps(src)).toMatchObject({ eyebrow: "Source", detail: "" });
    const fig: ExplorerNode = {
      id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" },
      sections: [{ kind: "plot", facts: ["dots"] }, { kind: "stats", facts: ["MW"] }],
    };
    expect(nodeShapeProps(fig)).toMatchObject({
      variant: "figure",
      sections: [
        { kind: "plot", label: "Plot", facts: ["dots"] },
        { kind: "stats", label: "Stats", facts: ["MW"] },
      ],
    });
  });
```

In the "a terminal node shows no + add handle" test (~L109–114), change the node to the figure node:

```ts
          data={nodeShapeProps({ id: "figure", kind: "figure", phase: "terminal", label: "Figure",
            table: { via: "none" },
            sections: [{ kind: "plot", facts: ["dots"] }, { kind: "stats", facts: ["MW"] }] })}
```
and its `id="plot"` prop (L113) → `id="figure"`.

- [ ] **Step 2: Run the node-data tests to verify they fail**

Run: `npx vitest run src/workbench/ArrayShapeRFNode.test.tsx`
Expected: FAIL — `nodeShapeProps` emits no `sections` and `variantOf` returns `"plot"`/`"stats"`.

- [ ] **Step 3: Add `"figure"` to `NodeVariant` and swap section props on `ArrayShapeNode`**

In `src/components/ArrayShapeNode.tsx`:

Replace the `NodeVariant` type (L7):
```ts
export type NodeVariant = "source" | "table" | "grain" | "hub" | "figure";
```

Replace the `facts?` prop in `ArrayShapeNodeProps` (L25) with the section props:
```ts
  /* terminal (figure) sections: plot + stats, each its own labeled, clickable
     block. Present only on the figure variant. */
  sections?: FigureSection[];
```
and add this exported type just above `ArrayShapeNodeProps` (after L7):
```ts
export interface FigureSection {
  kind: "plot" | "stats";
  label: string;          // "Plot" | "Stats"
  facts: string[];        // geom chips / test chip
  onView?: () => void;    // left-click → pin this facet's card (wired by the RF node)
  slotNum?: number | null;// stash slot badge, when this facet is pinned
}
```

(The actual two-section *rendering* lands in Task 4; this step only changes the prop surface. Leave the existing `facts` rendering branch — it will read `props.facts` which is now always undefined for the figure node — that's fine until Task 4 replaces it.)

- [ ] **Step 4: Map `variantOf`, accents, and `sections` in nodeShapeProps**

In `src/workbench/ArrayShapeRFNode.tsx`:

Replace `variantOf` (L20–27):
```ts
function variantOf(node: ExplorerNode): NodeVariant {
  switch (node.phase) {
    case "terminal": return "figure";
    case "source": case "join-input": return "source";
    case "grain": return "grain";
    default: return "table";   // reduce / post
  }
}
```

Replace `accentKind` (L48–53) and `eyebrowText` (L54–59):
```ts
function accentKind(node: ExplorerNode, delta?: NodeDelta): string {
  if (node.kind === "figure") return "geom";
  if (isSource(node)) return "source";
  return delta?.inEdge?.kind ?? "table";
}
function eyebrowText(node: ExplorerNode, delta?: NodeDelta): string {
  if (node.kind === "figure") return "Figure";
  if (isSource(node)) return "Source";
  return delta?.inEdge ? (EDGE_TYPE[delta.inEdge.kind] ?? "Step") : node.label;
}
```

Add `sections` to the `RFNodeData` type (L33–40) — add after `stepIndex?: number;`:
```ts
  /* figure-terminal sections (label + facts), built pure here; the RF node wraps
     each with an onView handler + slot badge before rendering. */
  sections?: { kind: "plot" | "stats"; label: string; facts: string[] }[];
```

Add `FigureSection` to the `ArrayShapeNode` import (L5) — append `type FigureSection` to the existing import list.

In `nodeShapeProps` (L65–84), replace `const isTerminal = node.kind === "plot" || node.kind === "stats";` with `const isTerminal = node.kind === "figure";`, replace the `facts: node.facts ?? [],` line with:
```ts
    sections: node.sections?.map((s) => ({
      kind: s.kind, label: s.kind === "plot" ? "Plot" : "Stats", facts: s.facts,
    })),
```

- [ ] **Step 5: Remove the dead annotate-in handle**

In `src/workbench/ArrayShapeRFNode.tsx`, delete the annotate-handle comment + `<Handle id="annotate-in" …>` block (L133–139).

- [ ] **Step 6: Run the node-data tests to verify they pass**

Run: `npx vitest run src/workbench/ArrayShapeRFNode.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/workbench/ArrayShapeRFNode.tsx src/components/ArrayShapeNode.tsx src/workbench/ArrayShapeRFNode.test.tsx
git commit -m "feat(workbench): map figure node to a two-section variant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0165oufX8eejnsovUt9ZPEYL"
```

---

## Task 4: Render the two sections; left-click pins the facet

**Files:**
- Modify: `src/components/ArrayShapeNode.tsx` (render), `src/workbench/ArrayShapeRFNode.tsx` (wire onView + badges), `src/index.css`
- Test: `src/workbench/ArrayShapeRFNode.test.tsx`

- [ ] **Step 1: Add a test that the figure renders two clickable sections that pin their facet**

Append to `src/workbench/ArrayShapeRFNode.test.tsx` a test that mirrors the existing render harness used by the "shows no + add handle" test (same `Provider`/`ReactFlowProvider` wrapper). Use:

```ts
  it("a figure node renders Plot + Stats sections; clicking one pins its facet", () => {
    const store = createStore();
    const figure: ExplorerNode = {
      id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" },
      sections: [{ kind: "plot", facts: ["dots"] }, { kind: "stats", facts: ["MW"] }],
    };
    render(
      <Provider store={store}>
        <ReactFlowProvider>
          <ArrayShapeRFNode id="figure" data={nodeShapeProps(figure)} />
        </ReactFlowProvider>
      </Provider>,
    );
    expect(screen.getByText("Plot")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();

    screen.getByRole("button", { name: /Plot summary/i }).click();
    expect(store.get(stashAtom)).toEqual([
      expect.objectContaining({ target: { kind: "node", id: "figure", facet: "plot" }, cardKind: "plot" }),
    ]);

    screen.getByRole("button", { name: /Stats summary/i }).click();
    expect(store.get(stashAtom).map((e) => e.target.facet)).toEqual(["plot", "stats"]);
  });
```

Add the imports this test needs at the top of the file if absent: `createStore` from `jotai`, `ReactFlowProvider` from `@xyflow/react`, `stashAtom` from `./state`, and `screen` from `@testing-library/react`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/workbench/ArrayShapeRFNode.test.tsx`
Expected: FAIL — no section buttons render and no `onView` is wired.

- [ ] **Step 3: Render the two-section figure variant in ArrayShapeNode**

In `src/components/ArrayShapeNode.tsx`:

Widen `NodeIcon` to accept a section kind — change its signature (L39) to:
```ts
function NodeIcon({ variant }: { variant: NodeVariant | "plot" | "stats" }): ReactElement {
```
(the `switch` already has `plot`/`stats` cases; they now serve sections.)

At the very top of the `ArrayShapeNode` function body (right after the `props` destructure, ~L68), add the figure short-circuit:
```ts
  if (variant === "figure" && props.sections) {
    return (
      <div className="txw-node figure">
        <div className="txw-nbar" aria-hidden />
        <div className="txw-nbody txw-figsections">
          {props.sections.map((sec) => (
            <button
              key={sec.kind}
              type="button"
              className={`txw-figsec k-${sec.kind === "plot" ? "geom" : "test"}${sec.slotNum ? " pinned" : ""}`}
              onClick={sec.onView ? (e) => { e.stopPropagation(); sec.onView!(); } : undefined}
            >
              {sec.slotNum && <span className="txw-node-badge" aria-hidden>{sec.slotNum}</span>}
              <span className="txw-figsec-head">
                <span className="txw-nicon" aria-hidden><NodeIcon variant={sec.kind} /></span>
                <span className="txw-eyebrow-text">{sec.label}</span>
              </span>
              <span className="txw-facts" role="list" aria-label={`${sec.label} summary`}>
                {sec.facts.map((f) => (
                  <span key={f} className="txw-fact" role="listitem">{f}</span>
                ))}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }
```

Remove the now-dead `facts` rendering block (the `{facts.length > 0 && …}` block, old L144–150) and the `facts = []` entry in the destructure (L68), since no non-figure node carries facts anymore. Leave the `rows×cols` fallback but drop its `facts.length === 0` clause (old L152) so it reads `{!hasGrain && !hasVals && rows != null && cols != null && (`.

- [ ] **Step 4: Wire onView handlers + per-section slot badges in the RF node**

In `src/workbench/ArrayShapeRFNode.tsx`:

Add `pushStashAtom` to the `./state` import (L9). Inside `ArrayShapeRFNode`, after `const openCard = useSetAtom(openCardAtom);` (L97), add:
```ts
  const pushStash = useSetAtom(pushStashAtom);
```

Before the `return`, build the section view handlers + badges from the pure `shape.sections`:
```ts
  const sections = shape.sections?.map((sec) => {
    const slot = stash.findIndex(
      (e) => e.target.kind === "node" && e.target.id === id && e.target.facet === sec.kind);
    return {
      ...sec,
      slotNum: slot >= 0 ? slot + 1 : null,
      onView: () => pushStash({
        target: { kind: "node", id: id!, facet: sec.kind },
        cardKind: sec.kind,
      }),
    };
  });
```

Pass them to `ArrayShapeNode` — change the render (L140) to:
```tsx
      <ArrayShapeNode {...shape} sections={sections} onEdit={onEdit} />
```
(`shape` already spreads `sections` without handlers; the explicit prop overrides it with the wired version.)

- [ ] **Step 5: Add the figure node CSS**

In `src/index.css`, after the `.txw-node.plot .txw-nbody, .txw-node.stats .txw-nbody { … }` rule (~L712), add:
```css
.txw-node.figure { height:auto; min-height:150px; }
.txw-figsections { display:flex; flex-direction:column; gap:0; padding:0; }
.txw-figsec {
  display:flex; flex-direction:column; align-items:flex-start; gap:6px;
  width:100%; padding:11px 13px; background:none; border:none; cursor:pointer;
  text-align:left; font:inherit; color:inherit; position:relative;
  --accent:#64748b;
}
.txw-figsec.k-geom { --accent:#0e8a8a; }
.txw-figsec.k-test { --accent:#4f46e5; }
.txw-figsec + .txw-figsec { border-top:1px dashed var(--txw-border, #d0d0d8); }
.txw-figsec:hover { background:color-mix(in srgb, var(--accent) 7%, transparent); }
.txw-figsec .txw-figsec-head { display:flex; align-items:center; gap:6px; color:var(--accent); }
.txw-figsec.pinned { background:color-mix(in srgb, var(--accent) 12%, transparent); }
```
(If `--txw-border` isn't a defined token, use the literal border colour the sibling `.txw-nhr` rule uses — check `.txw-nhr` near L760 and match it.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/workbench/ArrayShapeRFNode.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ArrayShapeNode.tsx src/workbench/ArrayShapeRFNode.tsx src/index.css src/workbench/ArrayShapeRFNode.test.tsx
git commit -m "feat(workbench): render figure sections; left-click pins the facet card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0165oufX8eejnsovUt9ZPEYL"
```

---

## Task 5: Right-click the figure node to edit plot / test

**Files:**
- Modify: `src/workbench/NodeContextMenu.tsx`, `src/workbench/WorkbenchCanvas.tsx`
- Test: `src/workbench/WorkbenchCanvas.test.tsx`

- [ ] **Step 1: Add a test: right-clicking the figure node opens an Edit plot…/Edit test… menu**

In `src/workbench/WorkbenchCanvas.test.tsx`, mirror the existing render harness (the file already mounts `WorkbenchCanvas` with its providers/graph). Update the existing delete-menu test to the new items API if it asserts `onDelete`, and add:

```ts
  it("right-clicking the figure node offers Edit plot and Edit test", async () => {
    // …render the canvas with a graph that has a figure node (reuse this file's
    // existing setup helper)…
    const figure = screen.getByText("Figure").closest(".txw-rfnode")!;
    fireEvent.contextMenu(figure);
    expect(screen.getByRole("menuitem", { name: /Edit plot/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Edit test/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /Edit test/i }));
    expect(screen.getByTestId("test-card")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: FAIL — the figure node has no context menu items.

- [ ] **Step 3: Generalize `NodeContextMenu` to an item list**

Replace `src/workbench/NodeContextMenu.tsx` with:
```tsx
import { useEffect } from "react";

export interface MenuItem { label: string; danger?: boolean; onClick: () => void; }
export interface NodeMenu { x: number; y: number; items: MenuItem[]; }

/* The right-click menu on a graph node. Items are caller-supplied: a reduce step
   offers Delete (removes that step; the linear steps array auto-heals); the
   figure terminal offers Edit plot…/Edit test…. Closes on outside-click/Escape. */
export function NodeContextMenu(
  { menu, onClose }: { menu: NodeMenu; onClose: () => void },
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="txw-ctxmenu-scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="txw-ctxmenu" role="menu" style={{ left: menu.x, top: menu.y }}>
        {menu.items.map((it, i) => (
          <button key={i} role="menuitem" className={it.danger ? "danger" : undefined}
            onClick={() => { it.onClick(); onClose(); }}>
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Build the figure menu and route the editors in WorkbenchCanvas**

In `src/workbench/WorkbenchCanvas.tsx`:

Replace `onNodeContextMenu` (L138–142) with:
```tsx
  const onNodeContextMenu = useCallback((e: ReactMouseEvent, n: Node) => {
    e.preventDefault();
    const d = n.data as unknown as RFNodeData;
    if (d.variant === "figure") {
      setMenu({ x: e.clientX, y: e.clientY, items: [
        { label: "Edit plot…", onClick: () =>
          openCard({ target: { kind: "node", id: n.id, facet: "plot" }, cardKind: "geom-editor" }) },
        { label: "Edit test…", onClick: () =>
          openCard({ target: { kind: "node", id: n.id, facet: "stats" }, cardKind: "test-editor" }) },
      ] });
      return;
    }
    const del = deletableStep(n);
    setMenu(del ? { x: e.clientX, y: e.clientY, items: [
      { label: `Delete ${del.label.toLowerCase()}`, danger: true, onClick: () => removeStep(del.index) },
    ] } : null);
  }, [openCard, removeStep]);
```

Update the `NodeContextMenu` render site (~L271) to the new props — drop `onDelete`:
```tsx
          <NodeContextMenu menu={menu} onClose={() => setMenu(null)} />
```

Make the whole-node left-click on a figure default to its plot facet — replace `pinNode` (L113–116):
```tsx
  const pinNode = useCallback((target: Target) => {
    const node = graph.nodes.find((n) => n.id === target.id);
    const t: Target = node?.kind === "figure" && !target.facet
      ? { ...target, facet: "plot" } : target;
    const kind = targetToCardKind(graph, t);
    if (kind) pushStash({ target: t, cardKind: kind });
  }, [graph, pushStash]);
```

- [ ] **Step 5: Run the canvas tests to verify they pass**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workbench/NodeContextMenu.tsx src/workbench/WorkbenchCanvas.tsx src/workbench/WorkbenchCanvas.test.tsx
git commit -m "feat(workbench): right-click the figure node to edit plot/test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0165oufX8eejnsovUt9ZPEYL"
```

---

## Task 6: Move the significance toggle into the Test picker; retire AnnotateCard

**Files:**
- Modify: `src/components/StatsPanel.tsx` (`TestPicker`)
- Delete: `src/workbench/cards/AnnotateCard.tsx`
- Test: `src/workbench/cardRegistry.test.tsx`

- [ ] **Step 1: Assert the picker shows the significance toggle; the readout does not**

In `src/workbench/cardRegistry.test.tsx`, extend the "test shows the picker" test with:
```ts
    expect(screen.getByText(/significance brackets/i)).toBeInTheDocument();
```
and extend the "stats shows the results readout" test with:
```ts
    expect(screen.queryByText(/significance brackets/i)).toBeNull();
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/workbench/cardRegistry.test.tsx`
Expected: FAIL — `TestPicker` has no significance toggle yet.

- [ ] **Step 3: Add the toggle to TestPicker**

In `src/components/StatsPanel.tsx`, inside `TestPicker`'s returned JSX, immediately after the vs-reference `</label>` block (after L321), insert:
```tsx
        {!active?.describeOnly && s.result.test !== "descriptive" && (
          /* significance brackets drawn onto the figure — folded in from the
             retired annotate edge. Only meaningful when a real test runs. Binds
             the same style.show_significance flag the graph reads. */
          <label className="describe-toggle">
            <input type="checkbox" checked={!!active?.style.show_significance}
              onChange={(e) => active &&
                setActive({ ...active, style: { ...active.style, show_significance: e.target.checked } })} />
            Draw significance brackets on the figure
            <InfoTip k="significance_stars" />
          </label>
        )}
```

- [ ] **Step 4: Delete AnnotateCard**

Run: `git rm src/workbench/cards/AnnotateCard.tsx`

Verify nothing still imports it: `grep -rn "AnnotateCard" src/`
Expected: no matches.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/workbench/cardRegistry.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/StatsPanel.tsx src/workbench/cardRegistry.test.tsx
git commit -m "feat(stats): fold the significance toggle into the test picker; retire AnnotateCard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0165oufX8eejnsovUt9ZPEYL"
```

---

## Task 7: Whole-project typecheck, full suite, and e2e smoke

**Files:** none new — this is the green-everywhere gate.

- [ ] **Step 1: Typecheck the whole project**

Run: `npm run build`
Expected: `tsc` passes (no `plot`/`stats` NodeKind leftovers, no missing `AnnotateCard`, no stale `facts`). Fix any reported reference — likely candidates: any other consumer of `node.kind === "plot"`/`"stats"`, `EdgeKind` `"annotate"`, or `Target` without `facet`. Run `grep -rn '"plot"\|"stats"\|annotate' src/workbench src/explorer` to find stragglers and update them to the figure model.

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: all green. Pay attention to `graphAtom.test.ts`, `Stash.test.tsx`, and `WorkbenchEdge.test.tsx` — if any asserted the old `plot`/`stats` nodes or the `annotate` edge, update them to the single `figure` terminal the same way Task 1/2 did.

- [ ] **Step 3: E2E smoke (Playwright/Chromium is available)**

Run the project's e2e command (check `package.json`/`playwright.config` for the exact script; e.g. `npx playwright test`). If a workbench spec exists, exercise: open the workbench, see one Figure node with Plot + Stats sections, left-click each section (figure and stats results dock in the stash), right-click → Edit test… opens the picker, toggle "Draw significance brackets" and confirm brackets appear/disappear on the figure. If no automated workbench e2e exists, do a manual pass via `npm run dev` and confirm the same flow.

- [ ] **Step 4: Final commit (only if Steps 1–2 required fixups)**

```bash
git add -A
git commit -m "fix(workbench): finish figure-node migration across remaining consumers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0165oufX8eejnsovUt9ZPEYL"
```

---

## Self-Review Notes (author)

- **Spec §1 (one terminal, drop annotate edge):** Task 1.
- **Spec §2 (two labeled sections, remove annotate handle):** Tasks 3–4.
- **Spec §3 (section-targeted left-click view):** Tasks 2 (`facet` target) + 4 (handlers).
- **Spec §4 (right-click Edit plot/test, no Delete):** Task 5 (figure branch returns before `deletableStep`, so no Delete item).
- **Spec §5 (significance toggle → Test editor; retire AnnotateCard):** Task 6.
- **Spec §6 (card registry, types, tests):** Tasks 2 + 7.
- **Open detail "stats section marker":** resolved — annotated test appends an `"on figure"` chip to the stats section (Task 1, Step 7), replacing the old back-edge.
- **Type consistency:** `Target.facet`, `FigureSection`, `sections` shape, and `NodeKind="table"|"figure"` are used identically across Tasks 1–6; `tsc` in Task 7 is the backstop.
