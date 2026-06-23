# Transformation Explorer — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the transformation-explorer UI over the engine surface Plan 1 ships. Render the data-shaping pipeline of the active analysis as a **linear, color-coded node line** (`source` → each `filter`/`drop` step → one `flatten` node per spine level → an `outputs` node with **fan-in provenance arrows** from each grain level its layers read), and a general **`DataTab`** (successor to `ReducedTable`) that shows the table *at the clicked node*. Wire both into App "analyses" mode, replacing the `Reduced table` section.

**Architecture:** A pure view-model function (`src/explorer/graph.ts`) maps `(reduce.steps, hierarchy, layers, schema)` → an ordered list of typed nodes plus the output fan-in edges — unit-tested with vitest (the repo's runner; `npm test`). A new `selectedNodeAtom` holds the clicked node id. `TransformExplorer` renders the node line and drives selection; `DataTab` reacts to selection by fetching the node's table from `/reduce` (via `at_step` for source/filter/drop nodes, via the existing `level` param for flatten nodes) and renders it with the AG Grid setup lifted from `ReducedTable`.

**Tech Stack:** TypeScript (strict), React 18, Jotai, AG Grid, vitest. No component-test harness exists for React views, so view components are verified by `npx tsc --noEmit` + `npm run build`; the pure graph view-model is unit-tested with vitest (matching `src/state.test.ts`).

**Context:** Work on branch `transformation-explorer` (already checked out). This is Plan 2 of 2. **Plan 1 is assumed merged first**, so the following already exist:
- The reduce step is named **`drop`** everywhere: `DropStep { kind: "drop"; columns: string[]; _key?: string }` in `src/types.ts`, `StepDrop` in `src/components/StepCards.tsx`, `ReduceStepKind = "drop" | "filter"`.
- `/reduce` accepts an **`at_step`** parameter (return the table AFTER step index *k*, slicing `steps[:k+1]`; `at_step = -1` → the raw table). The flatten-level table is already served by the existing `level` param.

**Scope decision:** Inline editing on node selection is **deferred to a follow-up (Plan 3)** — see the clearly-labeled section at the end. Plan 2 delivers rendering + navigation + the data tab, which is a coherent, shippable slice and keeps the task count bounded. The existing `PipelineSection` (step editors) and `HierarchyPanel` (level/aggregate editors) remain reachable in their current homes, so no editing capability is lost while the explorer lands.

---

### Task 1: Pure view-model — `src/explorer/graph.ts`

Map the active analysis's shaping config to an ordered list of typed nodes plus the output fan-in edges. This is plain TS with no React/Jotai imports, so it is unit-testable directly.

**Files:**
- Create: `src/explorer/graph.ts`
- Test: `src/explorer/graph.test.ts` (create)

- [ ] **Step 1: Write the view-model module**

Create `src/explorer/graph.ts`:

```typescript
import type { Hierarchy, Layer, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";

/* The transformation graph is rendered as a line for the MVP (one source, nested
   design), but it is modelled as typed nodes + edges from day one so branching
   (joins, crossed factors) plugs into the same frame later. */
export type NodeKind = "source" | "filter" | "drop" | "flatten" | "outputs";

/* A node in the explorer line. `id` is stable across renders (used by the
   selection atom). `table` describes HOW the data tab fetches this node's table:
   - source/filter/drop → `/reduce` with `at_step` (source = -1, the k-th step = k)
   - flatten            → `/reduce` with `level` (the spine column it collapses to)
   - outputs            → no table (terminal; the figure/stats render it). */
export type NodeTable =
  | { via: "at_step"; at_step: number }
  | { via: "level"; level: string }
  | { via: "none" };

export interface ExplorerNode {
  id: string;
  kind: NodeKind;
  label: string;
  table: NodeTable;
}

/* A fan-in edge into the outputs node: one per distinct grain level the layers
   read. `level` is the spine column ("" = raw); `targetId` is always the outputs
   node. Drawn as an incoming arrow so the figure's provenance is explicit (a
   SuperPlot reads several levels → several arrows). */
export interface FanInEdge {
  fromId: string;   // the source/flatten node the level resolves to
  toId: string;     // the outputs node
  level: string;    // "" = raw reduced rows
}

export interface ExplorerGraph {
  nodes: ExplorerNode[];
  fanIn: FanInEdge[];
}

const SOURCE_ID = "source";
const OUTPUTS_ID = "outputs";
const stepId = (i: number) => `step:${i}`;
const flattenId = (level: string) => `flatten:${level}`;

/* The id of the node a layer's `level` reads from: the raw reduced rows are the
   source node; a spine level is its flatten node. */
export function nodeIdForLevel(level: string): string {
  return level === RAW_LEVEL ? SOURCE_ID : flattenId(level);
}

const labelForCol = (schema: Schema | null, name: string): string =>
  schema?.columns.find((c) => c.name === name)?.label ?? name;

/* Build the ordered node line + fan-in edges from the active analysis's shaping
   config. Pure: no side effects, no atom/React reads. */
export function buildGraph(
  steps: ReduceStep[],
  hierarchy: Hierarchy,
  layers: Layer[],
  schema: Schema | null,
): ExplorerGraph {
  const nodes: ExplorerNode[] = [
    { id: SOURCE_ID, kind: "source", label: "Source",
      table: { via: "at_step", at_step: -1 } },
  ];

  steps.forEach((step, i) => {
    if (step.kind === "filter") {
      const n = step.conditions.length;
      nodes.push({
        id: stepId(i), kind: "filter",
        label: n === 0 ? "Filter" : `Filter (${n})`,
        table: { via: "at_step", at_step: i },
      });
    } else {
      const n = step.columns.length;
      nodes.push({
        id: stepId(i), kind: "drop",
        label: n === 0 ? "Drop" : `Drop (${n})`,
        table: { via: "at_step", at_step: i },
      });
    }
  });

  // one flatten node per spine level (coarsest → finest, mirroring the spine order)
  hierarchy.spine.forEach((level) => {
    nodes.push({
      id: flattenId(level), kind: "flatten",
      label: `per ${labelForCol(schema, level)}`,
      table: { via: "level", level },
    });
  });

  nodes.push({ id: OUTPUTS_ID, kind: "outputs", label: "Figure / stats",
    table: { via: "none" } });

  // fan-in: one edge per DISTINCT level the layer stack reads. A plain plot reads
  // one level (one arrow); a SuperPlot reads several. Only keep levels that have a
  // node (raw always exists; a spine level only if it is on the spine).
  const spineSet = new Set(hierarchy.spine);
  const seen = new Set<string>();
  const fanIn: FanInEdge[] = [];
  for (const layer of layers) {
    const level = layer.level;
    if (seen.has(level)) continue;
    if (level !== RAW_LEVEL && !spineSet.has(level)) continue;  // stale level: skip
    seen.add(level);
    fanIn.push({ fromId: nodeIdForLevel(level), toId: OUTPUTS_ID, level });
  }
  // a layer-less analysis still shows the raw arrow so the figure never floats.
  if (fanIn.length === 0) {
    fanIn.push({ fromId: SOURCE_ID, toId: OUTPUTS_ID, level: RAW_LEVEL });
  }

  return { nodes, fanIn };
}
```

- [ ] **Step 2: Write the unit tests**

Create `src/explorer/graph.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildGraph, nodeIdForLevel } from "./graph";
import type { Hierarchy, Layer, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";

const SCHEMA: Schema = {
  schema_version: "1.0",
  columns: [
    { name: "experiment", label: "Experiment", type: "identifier" },
    { name: "cell", label: "Cell", type: "identifier" },
    { name: "area", label: "Area", type: "numeric" },
  ],
} as unknown as Schema;

const HIER: Hierarchy = { spine: ["experiment", "cell"], fn: {} };

describe("buildGraph", () => {
  it("emits source → steps → flatten-per-level → outputs in order", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [] },
      { kind: "drop", columns: ["area"] },
    ];
    const layers: Layer[] = [{ geom: "dot", level: RAW_LEVEL }];
    const g = buildGraph(steps, HIER, layers, SCHEMA);
    expect(g.nodes.map((n) => n.kind)).toEqual([
      "source", "filter", "drop", "flatten", "flatten", "outputs",
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "source", "step:0", "step:1",
      "flatten:experiment", "flatten:cell", "outputs",
    ]);
  });

  it("maps each node to its fetch strategy", () => {
    const steps: ReduceStep[] = [{ kind: "drop", columns: ["area"] }];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.table]));
    expect(byId["source"]).toEqual({ via: "at_step", at_step: -1 });
    expect(byId["step:0"]).toEqual({ via: "at_step", at_step: 0 });
    expect(byId["flatten:experiment"]).toEqual({ via: "level", level: "experiment" });
    expect(byId["outputs"]).toEqual({ via: "none" });
  });

  it("labels flatten nodes from the schema and counts step conditions/columns", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [
        { column: "area", op: ">", value: 1 },
        { column: "area", op: "<", value: 9 }] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.label]));
    expect(byId["step:0"]).toBe("Filter (2)");
    expect(byId["step:1"]).toBe("Drop (1)");
    expect(byId["flatten:experiment"]).toBe("per Experiment");
    expect(byId["flatten:cell"]).toBe("per Cell");
  });

  it("draws one fan-in arrow for a plain plot (raw level)", () => {
    const g = buildGraph([], HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA);
    expect(g.fanIn).toEqual([{ fromId: "source", toId: "outputs", level: "" }]);
  });

  it("draws one arrow per distinct grain level for a SuperPlot", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },          // per-cell points
      { geom: "dot", level: "experiment" },       // per-experiment means
      { geom: "summary", level: "experiment" },   // duplicate level → no extra arrow
    ];
    const g = buildGraph([], HIER, layers, SCHEMA);
    expect(g.fanIn).toEqual([
      { fromId: "source", toId: "outputs", level: "" },
      { fromId: "flatten:experiment", toId: "outputs", level: "experiment" },
    ]);
  });

  it("skips fan-in for a level no longer on the spine", () => {
    const layers: Layer[] = [{ geom: "dot", level: "cell" }];
    const g = buildGraph([], { spine: ["experiment"], fn: {} }, layers, SCHEMA);
    // "cell" is not on this spine → dropped; falls back to the raw arrow
    expect(g.fanIn).toEqual([{ fromId: "source", toId: "outputs", level: "" }]);
  });

  it("nodeIdForLevel resolves raw to source and a spine level to its flatten node", () => {
    expect(nodeIdForLevel(RAW_LEVEL)).toBe("source");
    expect(nodeIdForLevel("experiment")).toBe("flatten:experiment");
  });
});
```

- [ ] **Step 3: Run the unit tests**

Run: `npm test -- src/explorer/graph.test.ts`
Expected: PASS (7 passed in the `buildGraph` suite).

> If `Schema`/`Layer`/`Hierarchy`/`ReduceStep`/`RAW_LEVEL` import paths are wrong, vitest names the file and line. Confirm against `src/types.ts` (`Layer` ~93, `Hierarchy` ~104, `RAW_LEVEL` ~106, `ReduceStep` ~204).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): pure transformation-graph view-model + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `at_step` on the `/reduce` protocol client

Plan 1 added `at_step` to the engine endpoint; the frontend client method must pass it through so `DataTab` can request intermediate tables. Wire it as an optional last arg so existing `engine.reduce(...)` calls (e.g. `src/App.tsx:216`) are unchanged.

**Files:**
- Modify: `src/types.ts:603` (the `reduce` client method)

- [ ] **Step 1: Add the `at_step` arg to the client method**

In `src/types.ts`, replace the `reduce` method (line 603):

```typescript
  reduce: (t: TableRef, steps: ReduceStep[], hierarchy?: Hierarchy, level?: string, at_step?: number) =>
    post<ReducePreview>("/reduce", { ...tableField(t), steps, hierarchy, level, at_step }),
```

> `post` serializes the body as JSON; an `undefined` `at_step` (the default for every existing caller) is omitted by `JSON.stringify`, so the engine sees no `at_step` and behaves exactly as today. When the data tab passes a number, the engine slices `steps[:at_step+1]` (Plan 1).

- [ ] **Step 2: Type-check (no caller breaks)**

Run: `npx tsc --noEmit`
Expected: PASS — the new arg is optional, so `src/App.tsx:216` (`engine.reduce({ token: handle.id }, steps, hierarchy, level)`) and any other 4-arg call still type-check.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(explorer): thread at_step through the /reduce client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `selectedNodeAtom` — the clicked node's id

New UI state: which explorer node is selected. It drives the data tab. Default selection (and the fallback when the selected id is stale) is the **outputs** node so the data tab shows the final reduced table — today's `ReducedTable` default — when nothing is clicked.

**Files:**
- Modify: `src/state.ts` (append after `setPreviewLevelAtom`, ~line 822)

- [ ] **Step 1: Add the atom**

In `src/state.ts`, after the `setPreviewLevelAtom` definition (ends ~line 822), append:

```typescript
/* ---- transformation explorer: the selected node's id (UI-only) ---- */

/* The explorer node the data tab is showing. null = no explicit selection; the
   data tab then defaults to the final reduced table (the outputs node). Reset
   when the active plottable changes so a stale id from another analysis never
   sticks. UI-only: never persisted to a .iris. */
export const selectedNodeIdAtom = atom<string | null>(null);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Unit-test the atom default + set (matches `src/state.test.ts` style)**

Append to `src/state.test.ts` (inside the file, after the existing imports add `selectedNodeIdAtom` to the import from `./state`, then add a new `describe`):

First, extend the import block at the top of `src/state.test.ts` (the `from "./state"` import) to include `selectedNodeIdAtom`:

```typescript
import {
  activePlottableIdAtom, analysisByIdAtom, analysisKeyByIdAtom,
  analysisRecencyAtom, buildSpec, cacheBudgetAtom, cacheKey, estimateBytes,
  isSpecRenderable, makeDefaultPlottable, pickStaleSpec, plottableFromSpec,
  selectedNodeIdAtom, setAnalysisResultAtom,
} from "./state";
```

Then append at the end of the file:

```typescript
describe("selectedNodeIdAtom", () => {
  it("defaults to null and round-trips a set", () => {
    const store = createStore();
    expect(store.get(selectedNodeIdAtom)).toBeNull();
    store.set(selectedNodeIdAtom, "flatten:experiment");
    expect(store.get(selectedNodeIdAtom)).toBe("flatten:experiment");
  });
});
```

- [ ] **Step 4: Run the state tests**

Run: `npm test -- src/state.test.ts`
Expected: PASS (the new `selectedNodeIdAtom` test plus the existing suite).

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(explorer): selectedNodeIdAtom for node-driven data tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `DataTab` — the table at the selected node

The general successor to `ReducedTable`. It reads `selectedNodeIdAtom`, resolves the node from the graph (rebuilt from the active analysis), fetches that node's table from `/reduce` (`at_step` for source/filter/drop, `level` for flatten), and renders it with the AG-Grid setup lifted from `ReducedTable`. The outputs node has no table of its own, so selecting it (or selecting nothing) shows the **final reduced table** — i.e. the live `reducePreviewAtom`, exactly as `ReducedTable` does today.

**Files:**
- Create: `src/components/DataTab.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/DataTab.tsx`:

```typescript
import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef,
} from "ag-grid-community";
import {
  activePlottableAtom, effectiveSchemaAtom, hierarchyAtom, reducePreviewAtom,
  selectedNodeIdAtom, tableHandleAtom,
} from "../state";
import { buildGraph, type ExplorerNode } from "../explorer/graph";
import { engine, type Table } from "../types";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  accentColor: "#0e7490",
  fontFamily: "inherit",
  fontSize: 12,
  headerFontSize: 12,
  headerFontWeight: 500,
  borderColor: "#e2e8f0",
  headerBackgroundColor: "#f8fafc",
  rowVerticalPaddingScale: 0.7,
  wrapperBorder: false,
});

/* Render a (schema, rows, n_total) triple as the AG grid — the body lifted from
   ReducedTable so the data tab looks identical regardless of which node it shows. */
function Grid({ table, total }: { table: Table; total: number }) {
  const shown = table.rows.length;
  const colDefs: ColDef[] = table.schema.columns.map((c) => ({
    field: c.name,
    headerName: c.label,
    editable: false,
    sortable: true,
    flex: 1,
    minWidth: 90,
    cellClass: c.type === "numeric" ? "mono" : undefined,
    ...(c.type === "numeric" && {
      valueFormatter: (p: { value: unknown }) => (p.value == null ? "NA" : String(p.value)),
    }),
  }));
  return (
    <div className="reduced-wrap">
      <div className="reduced-note">
        {shown < total
          ? `showing ${shown.toLocaleString()} of ${total.toLocaleString()} rows`
          : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
        {" · "}{table.schema.columns.length} column
        {table.schema.columns.length === 1 ? "" : "s"}
      </div>
      <div className="grid-host reduced-table">
        <AgGridReact
          theme={theme}
          rowData={table.rows}
          columnDefs={colDefs}
          /* family columns carry dots (cell_shape.area_um2); without this
             ag-grid reads `field` as a nested path and renders NA. */
          suppressFieldDotNotation
          headerHeight={30}
          rowHeight={26}
        />
      </div>
    </div>
  );
}

export function DataTab() {
  const active = useAtomValue(activePlottableAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const schemaFull = useAtomValue(effectiveSchemaAtom);
  const handle = useAtomValue(tableHandleAtom);
  const preview = useAtomValue(reducePreviewAtom);
  const selectedId = useAtomValue(selectedNodeIdAtom);

  /* the same graph TransformExplorer renders, so node ids line up exactly. */
  const graph = useMemo(
    () => active
      ? buildGraph(active.reduce.steps, hierarchy, active.layers, schemaFull)
      : null,
    [active, hierarchy, schemaFull],
  );

  /* the selected node, falling back to outputs (the final reduced table) when
     nothing is selected or the id is stale. */
  const node: ExplorerNode | null = useMemo(() => {
    if (!graph) return null;
    return graph.nodes.find((n) => n.id === selectedId)
      ?? graph.nodes.find((n) => n.kind === "outputs")
      ?? null;
  }, [graph, selectedId]);

  /* fetched intermediate table for source/filter/drop/flatten nodes. The outputs
     node uses the live reducePreviewAtom instead (no fetch). */
  const [table, setTable] = useState<Table | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchKey = node && node.table.via !== "none"
    ? JSON.stringify([node.table, active?.reduce.steps, hierarchy])
    : null;

  useEffect(() => {
    if (!handle || !active || !node || node.table.via === "none") {
      setTable(null); setErr(null); return;
    }
    let cancelled = false;
    const steps = active.reduce.steps;
    setLoading(true); setErr(null);
    void (async () => {
      try {
        const tbl = node.table;
        const res = tbl.via === "at_step"
          ? await engine.reduce({ token: handle.id }, steps, hierarchy, undefined, tbl.at_step)
          : await engine.reduce({ token: handle.id }, steps, hierarchy, tbl.level);
        if (cancelled) return;
        setTable(res.preview); setTotal(res.n_total);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // fetchKey captures node.table + steps + hierarchy; handle/active id gate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle?.id, handle?.version, fetchKey]);

  if (!active || !node) return <div className="reduced-empty">Building preview…</div>;

  // outputs (or a no-table node) → the live final reduced table.
  if (node.table.via === "none") {
    if (!preview) return <div className="reduced-empty">Building preview…</div>;
    return <Grid table={preview.preview} total={preview.n_total} />;
  }
  if (err) return <div className="reduced-empty">Could not load this node: {err}</div>;
  if (loading || !table) return <div className="reduced-empty">Loading {node.label}…</div>;
  return <Grid table={table} total={total} />;
}
```

- [ ] **Step 2: Confirm the `Table` type shape this component depends on**

Run: `grep -n "export interface Table\|export type Table" src/types.ts`
Expected: a `Table` type with `schema: Schema` and `rows: Row[]` (the same shape `ReducePreview.preview` uses at `src/types.ts:216`). The `Grid` helper reads `table.schema.columns` and `table.rows` exactly as `ReducedTable` reads `preview.preview.schema` / `.rows` (`src/components/ReducedTable.tsx:34`), so the shape matches.

> If `Table` is not exported, import the precise type `ReducePreview["preview"]` instead: change `import { engine, type Table } from "../types";` to `import { engine, type ReducePreview } from "../types";` and replace every `Table` annotation with `ReducePreview["preview"]`. Decide this from the grep output before editing further.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: PASS — Vite build completes.

- [ ] **Step 5: Commit**

```bash
git add src/components/DataTab.tsx
git commit -m "feat(explorer): DataTab renders the table at the selected node

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `TransformExplorer` — the color-coded node line

Render the graph from Task 1 as a horizontal line of color-coded nodes. Clicking a node sets `selectedNodeIdAtom` (driving `DataTab`). The outputs node shows fan-in arrows annotated with the grain levels its layers read.

**Files:**
- Create: `src/components/TransformExplorer.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/TransformExplorer.tsx`:

```typescript
import { useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  activePlottableAtom, effectiveSchemaAtom, hierarchyAtom, selectedNodeIdAtom,
} from "../state";
import { buildGraph, type NodeKind } from "../explorer/graph";

/* The spec's color code. derive/recode/join are reserved for later steps; the
   MVP only renders source/filter/drop/flatten/outputs. */
const KIND_CLASS: Record<NodeKind, string> = {
  source: "tx-source",
  filter: "tx-filter",
  drop: "tx-drop",
  flatten: "tx-flatten",
  outputs: "tx-outputs",
};

export function TransformExplorer() {
  const active = useAtomValue(activePlottableAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const schemaFull = useAtomValue(effectiveSchemaAtom);
  const [selectedId, setSelectedId] = useAtom(selectedNodeIdAtom);

  const graph = useMemo(
    () => active
      ? buildGraph(active.reduce.steps, hierarchy, active.layers, schemaFull)
      : null,
    [active, hierarchy, schemaFull],
  );
  if (!active || !graph) return null;

  // selection defaults to outputs (DataTab's fallback), so highlight it too.
  const outputsId = graph.nodes.find((n) => n.kind === "outputs")?.id ?? null;
  const effectiveId = graph.nodes.some((n) => n.id === selectedId)
    ? selectedId : outputsId;

  // levels feeding outputs, for the fan-in annotation under the outputs node.
  const fanInLabels = graph.fanIn.map((e) =>
    e.level === "" ? "raw" : (graph.nodes.find((n) => n.id === e.fromId)?.label ?? e.level));

  return (
    <div className="tx-explorer">
      <ol className="tx-line">
        {graph.nodes.map((node, i) => (
          <li key={node.id} className="tx-node-wrap">
            {i > 0 && <span className="tx-arrow" aria-hidden>→</span>}
            <button
              className={`tx-node ${KIND_CLASS[node.kind]}${effectiveId === node.id ? " on" : ""}`}
              title={node.kind === "outputs"
                ? `Figure / stats — reads: ${fanInLabels.join(", ")}`
                : `Show the table at this node (${node.kind})`}
              onClick={() => setSelectedId(node.id)}>
              <span className="tx-node-label">{node.label}</span>
              {node.kind === "outputs" && graph.fanIn.length > 1 && (
                <span className="tx-fanin" title="grain levels this figure reads">
                  {graph.fanIn.length} inputs
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

> The fan-in is rendered as a count + tooltip on the outputs node (`N inputs`, listing each consumed level) rather than drawn arrows, keeping the MVP a clean horizontal line while still making SuperPlot provenance explicit — exactly what the spec asks ("you can see, at a glance, exactly which data each layer is showing"). The edge data (`graph.fanIn`) is complete, so a later pass can upgrade this to literal arrows without touching the view-model.

- [ ] **Step 2: Add the explorer styles**

Run: `grep -n "\.reduced-wrap\|\.grid-host\|\.iris-section" src/styles.css src/App.css src/index.css 2>/dev/null | head`
Expected: this locates the stylesheet the app uses (the file that already defines `.reduced-wrap`). Append the explorer block to **that same file** (call it `<APP_CSS>` below). If the grep returns nothing, the styles live in `src/App.css` — append there.

Append to `<APP_CSS>`:

```css
/* ---- transformation explorer node line ---- */
.tx-explorer { padding: 8px 4px; overflow-x: auto; }
.tx-line { display: flex; align-items: center; gap: 6px; list-style: none; margin: 0; padding: 0; }
.tx-node-wrap { display: flex; align-items: center; gap: 6px; }
.tx-arrow { color: #94a3b8; font-size: 14px; user-select: none; }
.tx-node {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: 6px; font-size: 12px; line-height: 1;
  border: 1px solid transparent; cursor: pointer; white-space: nowrap;
}
.tx-node.on { outline: 2px solid #0e7490; outline-offset: 1px; }
.tx-node-label { font-weight: 500; }
.tx-fanin { font-size: 10px; opacity: 0.75; }
/* color code (spec): source=slate, filter=rose, drop=amber, flatten=violet,
   outputs=dashed-neutral. */
.tx-source  { background: #f1f5f9; border-color: #cbd5e1; color: #334155; }
.tx-filter  { background: #ffe4e6; border-color: #fda4af; color: #9f1239; }
.tx-drop    { background: #fef3c7; border-color: #fcd34d; color: #92400e; }
.tx-flatten { background: #ede9fe; border-color: #c4b5fd; color: #5b21b6; }
.tx-outputs { background: #f8fafc; border: 1px dashed #94a3b8; color: #475569; }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TransformExplorer.tsx <APP_CSS>
git commit -m "feat(explorer): TransformExplorer color-coded node line

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire the explorer into App "analyses" mode

Replace the `Reduced table` section (which renders `ReducedTable`) with the `TransformExplorer` node line plus the `DataTab` below it. Reset the selection when the active plottable changes so a stale node id from another analysis never sticks.

**Files:**
- Modify: `src/App.tsx:11` (imports), `src/App.tsx:20-23` (state imports), `src/App.tsx:435` (the section), and the active-plottable effect block (~line 208-223)

- [ ] **Step 1: Swap the component imports**

In `src/App.tsx`, replace line 11:

```typescript
import { DataTab } from "./components/DataTab";
import { TransformExplorer } from "./components/TransformExplorer";
```

> This removes the `ReducedTable` import. `ReducedTable` itself is left in the tree for now (no longer mounted); it is removed in Task 7.

- [ ] **Step 2: Import the selection atom and its reset**

In `src/App.tsx`, add `selectedNodeIdAtom` to the `from "./state"` import block (the block spanning lines 15-23). Insert it alongside the other atoms, e.g. after `schemaAtom` on line 20:

```typescript
  reducePreviewByIdAtom, renderErrorAtom, schemaAtom, selectedNodeIdAtom,
  setAnalysisByIdAtom,
```

- [ ] **Step 3: Reset the selection when the active plottable changes**

In `src/App.tsx`, the live-preview effect ends at line 223 with deps `[handle?.id, handle?.version, stepsKey, activeId]`. Immediately AFTER that `useEffect` (after its closing `}, [...]);` on line 223), add a small reset effect:

```typescript
  /* clear the explorer's selected node when the active analysis changes, so a
     node id from a different analysis never drives the wrong data tab. */
  const setSelectedNode = useSetAtom(selectedNodeIdAtom);
  useEffect(() => { setSelectedNode(null); }, [activeId, setSelectedNode]);
```

> `useSetAtom` is already imported at `src/App.tsx:1` (`import { useAtom, useAtomValue, useSetAtom } from "jotai";`). `activeId` is already in scope in this component (it is a dep of the preview effect on line 223).

- [ ] **Step 4: Replace the section**

In `src/App.tsx`, replace line 435:

```typescript
              <Section title="Transformation" defaultOpen>
                <TransformExplorer />
                <DataTab />
              </Section>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — note any unused-import error for `ReducedTable` (removed in Step 1) is already avoided since Step 1 deleted that import line.

- [ ] **Step 6: Production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual smoke check (optional but recommended)**

Run: `npm run dev` and open the app; import or open an example, switch to "Analyses" mode. Confirm: the node line renders `Source → … → per <level> … → Figure / stats`; clicking `Source` shows the raw table, clicking a `Drop`/`Filter` node shows the intermediate table, clicking a `per <level>` node shows the collapsed table, and clicking the outputs node (or nothing) shows the final reduced table. Stop the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(explorer): mount TransformExplorer + DataTab in analyses mode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Retire `ReducedTable`

`DataTab` now covers every case `ReducedTable` did (the final reduced table when the outputs node is selected, the per-level collapse via flatten nodes). Per the project's "no legacy, no users" rule, delete the now-dead component rather than keeping it around. The level dropdown that lived in `ReducedTable` is subsumed by the flatten nodes, so `setPreviewLevelAtom`/`previewLevel` are unaffected (still used by the layer-level pickers).

**Files:**
- Delete: `src/components/ReducedTable.tsx`

- [ ] **Step 1: Confirm nothing else imports it**

Run: `grep -rn "ReducedTable" src/`
Expected: NO matches (App stopped importing it in Task 6 Step 1). If any match remains, it is a stray import — remove it before deleting the file.

- [ ] **Step 2: Delete the file**

Run: `git rm src/components/ReducedTable.tsx`
Expected: the file is staged for deletion.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS — no dangling reference.

- [ ] **Step 4: Run the full vitest suite**

Run: `npm test`
Expected: PASS — `src/explorer/graph.test.ts`, `src/state.test.ts`, and every existing suite green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(explorer): remove ReducedTable, superseded by DataTab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Plan 3 / follow-up (deferred): inline editing on node selection

Out of scope for Plan 2 (rendering + navigation + data tab). Captured here so it is not lost:

- **Filter / drop nodes:** when a `filter`/`drop` node is selected, surface the existing `StepFilter` / `StepDrop` editors (`src/components/StepCards.tsx`) inline beneath the node line, wired to `updateStepAtom`/`removeStepAtom`/`moveStepAtom` (`src/state.ts:710-731`) — the same editors `PipelineSection` already mounts. The node's `at_step` index maps directly to the step index those atoms expect.
- **Flatten nodes:** when a `per <level>` node is selected, surface the level's aggregate-fn `<select>` (the `setLevelFnAtom` control from `src/components/HierarchyPanel.tsx:105-109`) inline, so the nested-median collapse is editable at the node.
- **Source / outputs nodes:** no inline editor (source is the input table; outputs is read-only provenance).
- Once inline editing lands, `PipelineSection` (the `LayerRail`'s "Data" section) becomes redundant with the explorer and can be retired in the same spirit as `ReducedTable` (Task 7) — evaluate then.
- **Engine pre-req:** none — `updateStepAtom`/`setLevelFnAtom`/`StepFilter`/`StepDrop` all already exist and are used elsewhere; this is pure UI composition.

Deferred per the prompt's guidance (keep Plan 2 at a bounded task count; editing is additive and risk-isolated).

---

## Self-Review

**Spec coverage (MVP, `docs/superpowers/specs/2026-06-23-transformation-explorer-design.md`):**
- "Linear, color-coded node line: source → filter/drop steps → one flatten node per spine level → outputs" → Task 1 (`buildGraph`) + Task 5 (`TransformExplorer`), color code matches the spec table (slate/rose/amber/violet/dashed-neutral; derive/recode/join reserved, not rendered). ✓
- "Fan-in provenance arrows from each distinct grain level the layers read; derived from `Layer.level`, no new authoring" → Task 1 (`fanIn` from the layer stack, deduped, stale-level-skipped) + Task 5 (count + per-level tooltip on the outputs node; full edge data available for a later literal-arrow upgrade). ✓
- "Pure view-model function mapping (reduce.steps, hierarchy, layers, schema) → ordered typed nodes + output fan-in edges, unit-tested" → Task 1, `src/explorer/graph.ts` + `src/explorer/graph.test.ts` (vitest, the repo's runner). ✓
- "DataTab (successor to ReducedTable) driven by a selectedNode atom; source/filter/drop via at_step, flatten via level; keep AG Grid" → Task 3 (`selectedNodeIdAtom`) + Task 4 (`DataTab`, AG Grid lifted from `ReducedTable`, `at_step` vs `level` per node). ✓
- "Wire into App analyses mode, replacing the Reduced table section; clicking a node selects it and drives the data tab" → Task 6. ✓
- "`select`→`drop` rename" → shipped by Plan 1 (referenced as `drop`/`DropStep` throughout). ✓
- Inline editors on node click → explicitly deferred to the Plan 3 / follow-up section (per the prompt's >~8-task guidance). ✓
- Out of scope (spec "Out"): derive/recode/join, drag-and-drop authoring, multi-table, editable-grain flatten, crossed factors, guard warnings — none attempted. ✓

**Placeholder scan:** No TBD/TODO in any code step. Every code block is complete TSX/TS; every command states its expected output. Two steps (Task 4 Step 2, Task 5 Step 2) are explicit *verification* steps with a stated grep + a precise fallback, not placeholders — the primary code path is fully written and the fallback is exact. ✓

**Type consistency:**
- `ExplorerNode`, `NodeKind`, `NodeTable`, `FanInEdge`, `ExplorerGraph`, `buildGraph`, `nodeIdForLevel` are all defined in Task 1 and consumed identically in Tasks 4 and 5.
- `NodeTable` is a discriminated union on `via` (`"at_step" | "level" | "none"`); `DataTab` (Task 4) narrows on `node.table.via` before reading `.at_step` / `.level`, and `buildGraph` only emits each variant with its required field — no field is read on the wrong variant.
- `engine.reduce(t, steps, hierarchy?, level?, at_step?)` (Task 2) is called two ways in `DataTab`: `(…, hierarchy, undefined, at_step)` and `(…, hierarchy, level)`. Both match the optional signature; existing callers (`src/App.tsx:216`, 4 args) stay valid. ✓
- `selectedNodeIdAtom: PrimitiveAtom<string | null>` (Task 3) — `useAtom` (read+set) in `TransformExplorer`, `useAtomValue` in `DataTab`, `useSetAtom` in `App`. Default `null` handled by both consumers (fallback to the outputs node). ✓
- `Layer.level`, `Hierarchy.spine`, `ReduceStep` (`DropStep | FilterStep`), `RAW_LEVEL`, `Schema`, `Table`/`ReducePreview["preview"]` are all pre-existing (`src/types.ts`, cited per use). Step-kind branching in `buildGraph` matches `ReduceStepKind = "drop" | "filter"` (Plan 1). ✓
- Node ids (`source`, `step:k`, `flatten:<level>`, `outputs`) are produced once in `buildGraph` and never re-derived elsewhere; `DataTab` and `TransformExplorer` both build the graph from the same `(steps, hierarchy, layers, schema)` inputs via the same `useMemo`, so their ids line up exactly. ✓
