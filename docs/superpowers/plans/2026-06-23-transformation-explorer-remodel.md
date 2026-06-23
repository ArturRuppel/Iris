# Transformation Explorer Re-model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Re-model the transformation explorer as an honest dataflow graph
(nodes = data, edges = transformations), add a one-shot per-node count endpoint,
fix three review bugs, and relocate the explorer to a full-width strip.

**Architecture:** Pure view-model (`graph.ts`) emits typed nodes + first-class
edges; a shared derived atom builds it once; `TransformExplorer` draws every edge
as a colored, labeled SVG path; `DataTab` consumes the same atom; the engine gains
`/shape_counts` for per-node row×col counts.

**Tech Stack:** React + TypeScript + Jotai + AG Grid (frontend); FastAPI +
pandas (engine); vitest + pytest + Playwright (tests).

**Spec:** `docs/superpowers/specs/2026-06-23-transformation-explorer-remodel-design.md`

---

## File Structure

- `engine/iris_engine/main.py` — add `ShapeCountsRequest` + `POST /shape_counts`.
- `engine/tests/test_shape_counts.py` (create) — endpoint tests.
- `src/explorer/graph.ts` — re-modeled view-model (nodes + edges).
- `src/explorer/graph.test.ts` — ported + extended unit tests.
- `src/explorer/graphAtom.ts` (create) — shared `explorerGraphAtom` + counts atoms.
- `src/types.ts` — `engine.shapeCounts` client + `ShapeCounts` type.
- `src/components/TransformExplorer.tsx` — re-modeled rendering.
- `src/components/DataTab.tsx` — bug-fixes + consume shared atom.
- `src/state.ts` — remove dead `setPreviewLevelAtom`; re-export atom if needed.
- `src/App.tsx` — relocate explorer to full-width strip; rename section "Table".
- `src/index.css` — full-width bar, edge colors/labels, node counts.
- `e2e/_explorer_shot.mjs` (create, transient) — Playwright verification.

---

## Task 1: Engine `/shape_counts` endpoint

**Files:**
- Modify: `engine/iris_engine/main.py` (add request model near line 69; route near line 519)
- Create: `engine/tests/test_shape_counts.py`

Returns row×col counts for every explorer node in ONE call: the source (raw,
pre-step), the table after each step prefix, and each spine collapse level.
Mirrors `/reduce`'s slicing/materialize path exactly; column count excludes the
internal `row_ids`.

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_shape_counts.py
from fastapi.testclient import TestClient
from iris_engine.main import app

client = TestClient(app)

# 2 groups x 3 subjects x 3 reps = 18 rows; spine subject(coarse) -> rep(fine)
def _fixture():
    rows = []
    for g in ("ctrl", "drug"):
        for s in range(3):
            for r in range(3):
                rows.append({"group": g, "subject": f"{g}_s{s}", "rep": r, "value": 1.0 + s + r})
    schema = {"schema_version": "1.0", "columns": [
        {"name": "group", "label": "Group", "type": "classifier"},
        {"name": "subject", "label": "Subject", "type": "identifier"},
        {"name": "rep", "label": "Rep", "type": "identifier"},
        {"name": "value", "label": "Value", "type": "numeric"}]}
    return {"schema": schema, "rows": rows}

def test_shape_counts_source_steps_levels():
    table = _fixture()
    body = {
        "table": table,
        "steps": [
            {"kind": "filter", "conditions": [{"column": "value", "op": ">", "value": 0}]},
            {"kind": "drop", "columns": ["value"]},
        ],
        "hierarchy": {"spine": ["subject", "rep"], "fn": {}},
    }
    r = client.post("/shape_counts", json=body)
    assert r.status_code == 200
    d = r.json()
    # source = raw, all 18 rows, 4 columns
    assert d["source"] == {"rows": 18, "cols": 4}
    # after filter: still 18 rows (all value>0), 4 cols; after drop: 18 rows, 3 cols
    assert d["steps"] == [{"rows": 18, "cols": 4}, {"rows": 18, "cols": 3}]
    # collapse: 6 subjects, 18 reps (rep grain == raw cardinality here)
    assert d["levels"]["subject"]["rows"] == 6
    assert d["levels"]["rep"]["rows"] == 18

def test_shape_counts_no_spine_no_levels():
    table = _fixture()
    r = client.post("/shape_counts", json={"table": table, "steps": [], "hierarchy": {"spine": [], "fn": {}}})
    assert r.status_code == 200
    assert r.json()["levels"] == {}
    assert r.json()["steps"] == []
    assert r.json()["source"]["rows"] == 18
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -q`
Expected: FAIL (404 / no route).

- [ ] **Step 3: Add the request model** (near line 81, after `ReduceRequest`)

```python
class ShapeCountsRequest(BaseModel):
    table: dict | None = None
    table_token: str | None = None
    steps: list[dict] = []
    hierarchy: dict | None = None
```

- [ ] **Step 4: Add the route** (after the `/reduce` route, ~line 519)

```python
@app.post("/shape_counts")
def shape_counts(req: ShapeCountsRequest):
    """Row x column counts for every explorer node in one call: the source
    (pre-step raw table), the table after each step prefix, and each spine
    collapse level. Same slicing/materialize path as /reduce; drives the
    per-node counts in the transformation explorer."""
    table = _resolve_table(req.table, req.table_token)
    df, schema = _load_frame(table)

    def _cols(frame):
        return len([c for c in frame.columns if c != "row_ids"])

    src, src_sch, _ = reduce_mod.reduce_with_trace(df, schema, [])
    out_source = {"rows": int(len(src)), "cols": _cols(src)}

    steps_counts = []
    for i in range(len(req.steps)):
        try:
            out, _sch, _ = reduce_mod.reduce_with_trace(df, schema, req.steps[: i + 1])
        except reduce_mod.ReduceError as e:
            raise HTTPException(422, f"reduction failed: {e}") from e
        steps_counts.append({"rows": int(len(out)), "cols": _cols(out)})

    try:
        full, full_sch, _ = reduce_mod.reduce_with_trace(df, schema, req.steps)
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e
    spine = hierarchy.spine_present(full, (req.hierarchy or {}).get("spine") or [])
    levels_out: dict[str, dict] = {}
    if spine:
        levels, _ = hierarchy.materialize_levels(
            full, full_sch, spine, (req.hierarchy or {}).get("fn"), [])
        for lvl in spine:
            lout, _lsch = hierarchy.resolve_level(levels, lvl)
            levels_out[lvl] = {"rows": int(len(lout)), "cols": _cols(lout)}
    return {"source": out_source, "steps": steps_counts, "levels": levels_out}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -q`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_shape_counts.py
git commit -m "feat(engine): /shape_counts — per-node row x col counts in one call"
```

---

## Task 2: Re-model `graph.ts` (nodes + first-class edges)

**Files:**
- Rewrite: `src/explorer/graph.ts`
- Rewrite: `src/explorer/graph.test.ts`

The view-model becomes nodes (datatypes) + edges (transformations). Node ids are
stable. Semantics fixed by the engine: spine is **coarse→fine** (`spine[0]`
coarsest); the collapse chain runs **finest→coarsest**; the test runs at the
coarsest grain the layers bind to.

- [ ] **Step 1: Write the failing tests** (full new `graph.test.ts`)

```ts
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

// spine coarse->fine: experiment (coarse) -> cell (fine)
const HIER: Hierarchy = { spine: ["experiment", "cell"], fn: {} };
const edge = (g: ReturnType<typeof buildGraph>, from: string, to: string) =>
  g.edges.find((e) => e.fromId === from && e.toId === to);

describe("buildGraph", () => {
  it("nodes are datatypes: source/step tables, collapse tables, plot, stats", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "source", "step:0", "step:1", "level:cell", "level:experiment", "plot", "stats",
    ]);
    expect(g.nodes.map((n) => n.kind)).toEqual([
      "table", "table", "table", "table", "table", "plot", "stats",
    ]);
  });

  it("collapse chain runs finest -> coarsest after the last reduce step", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], HIER,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    // last reduce node -> finest spine (cell) -> coarsest (experiment)
    expect(edge(g, "step:0", "level:cell")?.kind).toBe("collapse");
    expect(edge(g, "level:cell", "level:experiment")?.kind).toBe("collapse");
    expect(g.nodes.find((n) => n.id === "level:experiment")?.label).toBe("per Experiment");
  });

  it("reduce-step edges carry the step kind and a count label", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [{ column: "area", op: ">", value: 1 },
                                     { column: "area", op: "<", value: 9 }] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "filter", label: "filter (2)" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "drop", label: "drop (1)" });
  });

  it("maps each node to its data-tab fetch strategy", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], HIER,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.table]));
    expect(byId["source"]).toEqual({ via: "at_step", at_step: -1 });
    expect(byId["step:0"]).toEqual({ via: "at_step", at_step: 0 });
    expect(byId["level:cell"]).toEqual({ via: "level", level: "cell" });
    expect(byId["plot"]).toEqual({ via: "none" });
    expect(byId["stats"]).toEqual({ via: "none" });
  });

  it("geom edge per layer into plot; raw reads the last reduce node", () => {
    const steps: ReduceStep[] = [{ kind: "drop", columns: ["area"] }];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "step:0", "plot")).toMatchObject({ kind: "geom", label: "dots" });
  });

  it("SuperPlot: distinct grains/geoms draw distinct geom edges; dups collapse", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },          // raw points
      { geom: "box", level: "experiment" },        // per-experiment box
      { geom: "box", level: "experiment" },        // duplicate -> no extra edge
    ];
    const g = buildGraph([], HIER, layers, SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(2);
    expect(edge(g, "source", "plot")?.label).toBe("dots");
    expect(edge(g, "level:experiment", "plot")?.label).toBe("box");
  });

  it("skips a geom edge for a level no longer on the spine", () => {
    const g = buildGraph([], { spine: ["experiment"], fn: {} },
      [{ geom: "dot", level: "cell" }], SCHEMA, null);  // cell not on spine
    // falls back to the plain raw->plot edge so the plot never floats
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toEqual([{ id: expect.any(String), kind: "geom",
      label: "plotted", fromId: "source", toId: "plot" }]);
  });

  it("test edge runs at the coarsest layer-bound grain, into stats", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: "experiment" },   // coarsest bound grain = experiment
    ];
    const g = buildGraph([], HIER, layers, SCHEMA, { test: "Welch's t-test", describeOnly: false });
    expect(edge(g, "level:experiment", "stats")).toMatchObject({
      kind: "test", label: "Welch's t-test" });
  });

  it("describe-only -> the test edge reads 'describe'", () => {
    const g = buildGraph([], HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: null, describeOnly: true });
    // no layer on the spine -> test runs on the raw reduced rows (source)
    expect(edge(g, "source", "stats")).toMatchObject({ kind: "test", label: "describe" });
  });

  it("nodeIdForLevel: raw -> given raw node (default source); spine level -> its collapse node", () => {
    expect(nodeIdForLevel(RAW_LEVEL)).toBe("source");
    expect(nodeIdForLevel(RAW_LEVEL, "step:2")).toBe("step:2");
    expect(nodeIdForLevel("experiment")).toBe("level:experiment");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL (new API absent).

- [ ] **Step 3: Rewrite `graph.ts`** (full new content)

```ts
import type { Hierarchy, Layer, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";

/* Nodes are DATA (a table at some grain, or a terminal plot/stats output);
   edges are TRANSFORMATIONS (filter/drop/collapse between tables, geom into the
   plot, test into stats). The view is a left->right line for the MVP but is
   modelled as typed nodes + edges so branching plugs into the same frame. */
export type NodeKind = "table" | "plot" | "stats";
export type EdgeKind = "filter" | "drop" | "collapse" | "geom" | "test";

/* How the data tab fetches a node's table:
   - table (source/step) -> /reduce with at_step (source = -1, k-th step = k)
   - table (collapse)    -> /reduce with level (the spine column)
   - plot/stats          -> no fetch (terminal; focus their section instead). */
export type NodeTable =
  | { via: "at_step"; at_step: number }
  | { via: "level"; level: string }
  | { via: "none" };

export interface NodeCount { rows: number; cols: number }

export interface ExplorerNode {
  id: string;
  kind: NodeKind;
  label: string;
  table: NodeTable;
  count?: NodeCount;   // table nodes only; filled from /shape_counts
}

export interface Edge {
  id: string;
  kind: EdgeKind;
  label: string;
  fromId: string;
  toId: string;
}

export interface ExplorerGraph {
  nodes: ExplorerNode[];
  edges: Edge[];
}

/* what the stats edge needs: the chosen test's display name (null = none yet)
   and whether the analysis is describe-only. */
export interface StatsInput { test: string | null; describeOnly: boolean }

const SOURCE_ID = "source";
const PLOT_ID = "plot";
const STATS_ID = "stats";
const stepId = (i: number) => `step:${i}`;
const levelId = (level: string) => `level:${level}`;

/* The id of the table a `level` reads from: a spine level is its collapse node;
   raw reduced rows are the OUTPUT of the reduce chain, so callers pass the last
   reduce-step node (or the source when there are no steps). */
export function nodeIdForLevel(level: string, rawNodeId: string = SOURCE_ID): string {
  return level === RAW_LEVEL ? rawNodeId : levelId(level);
}

const labelForCol = (schema: Schema | null, name: string): string =>
  schema?.columns.find((c) => c.name === name)?.label ?? name;

/* geom name -> edge label. Unknown geoms fall back to their raw name. */
const GEOM_LABEL: Record<string, string> = {
  dot: "dots", box: "box", violin: "violin", bar: "bars", line: "line",
  distribution: "distribution", summary: "mean ± SD", interval: "mean ± SD",
};
const geomLabel = (geom: string): string => GEOM_LABEL[geom] ?? geom;

export function buildGraph(
  steps: ReduceStep[],
  hierarchy: Hierarchy,
  layers: Layer[],
  schema: Schema | null,
  stats: StatsInput | null,
): ExplorerGraph {
  const nodes: ExplorerNode[] = [
    { id: SOURCE_ID, kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
  ];
  const edges: Edge[] = [];

  // --- reduce chain: source -> step:0 -> step:1 -> ... (edge = the step kind) ---
  let prev = SOURCE_ID;
  steps.forEach((step, i) => {
    const id = stepId(i);
    const n = step.kind === "filter" ? step.conditions.length : step.columns.length;
    nodes.push({ id, kind: "table", label: step.kind === "filter" ? "filtered" : "dropped",
      table: { via: "at_step", at_step: i } });
    edges.push({ id: `e:${prev}->${id}`, kind: step.kind,
      label: `${step.kind} (${n})`, fromId: prev, toId: id });
    prev = id;
  });
  const rawNodeId = prev;   // the finest reduced table (output of the reduce chain)

  // --- collapse chain: finest -> coarsest (spine is coarse->fine, so reverse) ---
  const spine = hierarchy.spine;
  let cprev = rawNodeId;
  for (let i = spine.length - 1; i >= 0; i--) {
    const level = spine[i];
    const id = levelId(level);
    nodes.push({ id, kind: "table", label: `per ${labelForCol(schema, level)}`,
      table: { via: "level", level } });
    edges.push({ id: `e:${cprev}->${id}`, kind: "collapse", label: "collapse",
      fromId: cprev, toId: id });
    cprev = id;
  }

  // --- terminals ---
  nodes.push({ id: PLOT_ID, kind: "plot", label: "Plot", table: { via: "none" } });
  nodes.push({ id: STATS_ID, kind: "stats", label: "Stats", table: { via: "none" } });

  // --- geom edges: one per (grain, geom) the layers read, into the plot ---
  const spineSet = new Set(spine);
  const seenGeom = new Set<string>();
  for (const layer of layers) {
    const level = layer.level;
    if (level !== RAW_LEVEL && !spineSet.has(level)) continue;   // stale level: skip
    const fromId = nodeIdForLevel(level, rawNodeId);
    const label = geomLabel(layer.geom);
    const key = `${fromId}:${label}`;
    if (seenGeom.has(key)) continue;
    seenGeom.add(key);
    edges.push({ id: `g:${key}`, kind: "geom", label, fromId, toId: PLOT_ID });
  }
  if (![...seenGeom].length) {
    // nothing plotted yet: a single plain edge so the plot never floats.
    edges.push({ id: "g:plain", kind: "geom", label: "plotted", fromId: rawNodeId, toId: PLOT_ID });
  }

  // --- test edge: at the coarsest spine grain the layers bind to, into stats ---
  const boundIdx = layers
    .map((l) => spine.indexOf(l.level))
    .filter((i) => i >= 0);
  const testFromId = boundIdx.length ? levelId(spine[Math.min(...boundIdx)]) : rawNodeId;
  edges.push({ id: "t:test", kind: "test",
    label: stats?.describeOnly ? "describe" : (stats?.test ?? "describe"),
    fromId: testFromId, toId: STATS_ID });

  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "refactor(explorer): re-model graph as nodes(data) + edges(transformations)"
```

---

## Task 3: `shape_counts` client + shared `explorerGraphAtom`

**Files:**
- Modify: `src/types.ts` (add `ShapeCounts` type + `engine.shapeCounts`, near line 604)
- Create: `src/explorer/graphAtom.ts`

- [ ] **Step 1: Add the client** in `src/types.ts`

```ts
// near the other response types
export interface ShapeCounts {
  source: { rows: number; cols: number };
  steps: { rows: number; cols: number }[];
  levels: Record<string, { rows: number; cols: number }>;
}
```
and in the `engine` object (after `reduce:`):
```ts
  shapeCounts: (t: TableRef, steps: ReduceStep[], hierarchy?: Hierarchy) =>
    post<ShapeCounts>("/shape_counts", { ...tableField(t), steps, hierarchy }),
```

- [ ] **Step 2: Create `src/explorer/graphAtom.ts`**

The base graph (no counts) is derived from the active plottable. Counts are
fetched separately (async) and merged. Both `TransformExplorer` and `DataTab`
consume `explorerGraphAtom` so the graph is built once.

```ts
import { atom } from "jotai";
import {
  activePlottableAtom, hierarchyAtom, effectiveSchemaAtom, analysisAtom,
} from "../state";
import { buildGraph, type ExplorerGraph, type StatsInput, type NodeCount } from "./graph";

/* the chosen test's display name + describe-only flag. The chosen test comes
   from the live analyze result (StatsResult.result.test); before a result lands
   it falls back to the user's pinned override, else null. `describeOnly` lives
   directly on the Plottable. Verified shapes (state.ts):
     analysisAtom -> AnalyzeResponse | null, with .stats.result.test: string
     Plottable.override: TestName | null ; Plottable.describeOnly: boolean */
const statsInputAtom = atom<StatsInput | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const res = get(analysisAtom);                       // AnalyzeResponse | null
  return {
    test: res?.stats?.result?.test ?? p.override ?? null,
    describeOnly: p.describeOnly,
  };
});

/* counts keyed by node id, fetched via /shape_counts; null until first load. */
export const shapeCountsAtom = atom<Record<string, NodeCount> | null>(null);

export const explorerGraphAtom = atom<ExplorerGraph | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const g = buildGraph(p.reduce.steps, get(hierarchyAtom), p.layers,
    get(effectiveSchemaAtom), get(statsInputAtom));
  const counts = get(shapeCountsAtom);
  if (!counts) return g;
  return { ...g, nodes: g.nodes.map((n) => counts[n.id] ? { ...n, count: counts[n.id] } : n) };
});
```

> NOTE for implementer: field paths above are verified against `state.ts`
> (analysisAtom → AnalyzeResponse; Plottable.override / .describeOnly). If
> `analysisAtom` or `activePlottableAtom` is not exported, export it. The
> contract: `test` = chosen test display name or null; `describeOnly` = boolean.

- [ ] **Step 3: typecheck**

Run: `npx tsc --noEmit`
Expected: clean (adapt atom field names until it is).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/explorer/graphAtom.ts
git commit -m "feat(explorer): shapeCounts client + shared explorerGraphAtom"
```

---

## Task 4: Re-model `TransformExplorer.tsx` rendering

**Files:**
- Rewrite: `src/components/TransformExplorer.tsx`
- Modify: `src/App.tsx` (drive the `/shape_counts` fetch — see Step 3)

Draw nodes left→right; draw EVERY edge as an SVG path stroked in its edge color
with an arrowhead and a midpoint text label. Chain edges (filter/drop/collapse)
run roughly straight along the line; geom/test edges bow to the plot/stats nodes.
Table nodes show their `rows × cols` count. Clicking a table node selects it
(data tab); clicking plot/stats scrolls their section into view.

- [ ] **Step 1: Rewrite the component.** Consume `explorerGraphAtom`. Keep the
  measured-layout approach (refs Map + `ResizeObserver` on the container,
  recompute on graph change). For each edge, look up the from/to node rects,
  compute a path, and place a `<text>` at the path midpoint. Edge color by kind:

```ts
const EDGE_COLOR: Record<EdgeKind, string> = {
  filter: "#e11d48", drop: "#d97706", collapse: "#7c3aed",
  geom: "#0e7490", test: "#4f46e5",
};
```

  Node chrome: `<button class="tx-node tx-<kind>">` with `<span class="tx-node-label">`
  and, when `node.count`, `<span class="tx-node-count">{rows}×{cols}</span>`.
  Selection highlight via `selectedNodeIdAtom` (unchanged). For a `plot`/`stats`
  click, call `document.getElementById('section-figure'|'section-stats')?.scrollIntoView()`
  AND still set the selected node so the data tab shows its (terminal) state.

  Path math: for an edge whose from-node is immediately left of the to-node on
  the line, draw a near-straight cubic just above the row. For geom/test edges
  spanning to a terminal, bow below the line as Plan 2 did
  (`dip = max(sy, ty) + 22`). Use distinct vertical offsets per edge so labels
  don't overlap (e.g. stagger geom edges by index). Each edge: a `<path>` +
  a `<text class="tx-edge-label">` at the midpoint, both colored by kind.

  Remove the dead `fromId === OUTPUTS_ID` guard from Plan 2. Use `Edge.id` as the
  React key everywhere.

- [ ] **Step 2: typecheck + unit tests** (graph tests already cover the model)

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean / 100% pass.

- [ ] **Step 3: Wire the `/shape_counts` fetch** in `src/App.tsx`. Alongside the
  existing reduced-table preview effect (~line 209), add an effect that calls
  `engine.shapeCounts({ token: handle.id }, active.reduce.steps, hierarchy)`
  (debounced, keyed on `stepsKey + handle`), maps the response to
  `Record<nodeId, {rows,cols}>` (`source` → `"source"`, `steps[i]` → `"step:i"`,
  `levels[lvl]` → `"level:lvl"`), and writes `shapeCountsAtom`. On error, set
  `shapeCountsAtom` to `null` (counts are advisory; never block).

```ts
// mapping helper
const counts: Record<string, {rows:number;cols:number}> = { source: sc.source };
sc.steps.forEach((c, i) => { counts[`step:${i}`] = c; });
for (const [lvl, c] of Object.entries(sc.levels)) counts[`level:${lvl}`] = c;
```

- [ ] **Step 4: Commit**

```bash
git add src/components/TransformExplorer.tsx src/App.tsx
git commit -m "feat(explorer): draw edges as colored labeled arrows; node counts"
```

---

## Task 5: `DataTab.tsx` bug-fixes + consume shared atom; drop dead atom

**Files:**
- Modify: `src/components/DataTab.tsx`
- Modify: `src/state.ts`

- [ ] **Step 1: `DataTab` — consume `explorerGraphAtom`.** Replace the local
  `buildGraph` `useMemo` with `useAtomValue(explorerGraphAtom)`. Resolve the
  selected node from that graph (fallback to the `plot` node — the final reduced
  table — when nothing/stale is selected). For plot/stats (`via:"none"`) keep the
  current behaviour: show the live `reducePreviewAtom` table.

- [ ] **Step 2: Fix bug #1 (loading stuck true).** In the fetch effect's
  early-return branch (node missing / `via:"none"`), also clear loading:

```ts
if (!handle || !active || !node || node.table.via === "none") {
  setTable(null); setErr(null); setLoading(false); return;
}
```

- [ ] **Step 3: Fix bug #2 (stale on analysis switch) + #5 (stale rows window).**
  Include the active plottable id in `fetchKey`, and clear the table on switch:

```ts
const fetchKey = node && node.table.via !== "none"
  ? JSON.stringify([active?.id, node.table, active?.reduce.steps, hierarchy])
  : null;
// at the top of the effect body, before the async fetch:
setTable(null); setLoading(true); setErr(null);
```

- [ ] **Step 4: Fix bug #3 — remove dead `setPreviewLevelAtom`** from
  `src/state.ts` (lines ~819-822). Confirm `grep -rn setPreviewLevelAtom src/`
  returns nothing after removal. `previewLevel` stays `RAW_LEVEL` for the
  outputs/plot preview (correct); only the unused setter is deleted.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean / pass. `grep -rn setPreviewLevelAtom src/` → empty.

- [ ] **Step 6: Commit**

```bash
git add src/components/DataTab.tsx src/state.ts
git commit -m "fix(explorer): DataTab loading/stale bugs; drop dead setPreviewLevelAtom"
```

---

## Task 6: Layout — full-width strip; table stays

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Relocate the explorer.** In `src/App.tsx`, remove
  `<TransformExplorer />` from the `Transformation` `Section` and render it as a
  full-width strip between the error-bar block and `<main>`, only in analyses
  mode with data:

```tsx
{viewMode === "analyses" && !dataLoading && active && (
  <div className="tx-strip"><TransformExplorer /></div>
)}
<main>
```
  Rename the section that now holds only the table:
```tsx
<Section title="Table" defaultOpen><DataTab /></Section>
```
  Add `id="section-figure"` / `id="section-stats"` to the Figure/Statistics
  `<Section>` wrappers (or the section element) so the plot/stats node click can
  scroll to them. (Give `Section` an optional `id` prop and pass it through to
  the `<section>`.)

- [ ] **Step 2: CSS** in `src/index.css`: a `.tx-strip` full-width bar
  (horizontal scroll if the line overflows, e.g. `overflow-x:auto`), padding,
  a subtle bottom border to separate it from `<main>`. Restyle `.tx-node` as a
  quiet datatype chip (neutral fill; a small kind accent via `.tx-plot`/`.tx-stats`),
  add `.tx-node-count` (smaller, muted), `.tx-edge-label` (small, colored per
  kind via inline `fill`), and ensure the SVG layer has enough bottom room for
  the bowing geom/test edges. Retire the Plan 2 node-fill color classes
  (`.tx-source/.tx-filter/.tx-drop/.tx-flatten/.tx-outputs`).

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/index.css
git commit -m "feat(explorer): full-width strip under header; table stays in column"
```

---

## Task 7: End-to-end verification

**Files:**
- Create (transient): `e2e/_explorer_shot.mjs`

- [ ] **Step 1: Write a Playwright script** that imports the SuperPlot fixture
  (group/subject/rep/value), switches to Analyses, maps X=group/Y=value, adds a
  Box layer bound to `subject` and a Dots layer at raw, then asserts:
  - `.tx-strip` exists and spans ~full viewport width (its bounding box width is
    within ~40px of the page width).
  - `.tx-node` count ≥ 6; at least one `.tx-node-count` shows `N×M`.
  - `.tx-edge-label` texts include a geom label (`dots`/`box`) and a `collapse`.
  - clicking a table node updates the data tab (`.reduced-note` text changes).
  - no `pageerror`s.
  Screenshot `.tx-strip` and the full analyses page for visual inspection.

- [ ] **Step 2: Run it** against the running app (start engine + vite first if
  needed). Read the screenshots; confirm the strip is full-width under the
  header, edges are colored + labeled, table nodes show counts.

- [ ] **Step 3: Full gate**

Run: `npx vitest run && npx tsc --noEmit && npm run build && (cd engine && python -m pytest -q)`
Expected: all green.

- [ ] **Step 4: Delete the transient script, commit any test-only additions**

```bash
rm e2e/_explorer_shot.mjs
```

---

## Done criteria

- Explorer renders nodes=data / edges=transformations: colored, labeled edges
  (filter/drop/collapse/geom/test); table nodes show row×col counts.
- Full-width strip under the header; only the table remains in the column.
- Three review bugs fixed; `setPreviewLevelAtom` gone; graph built once.
- `/shape_counts` covered by pytest; `graph.ts` covered by vitest; e2e green.
- `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `pytest` all pass.
