# Transformation Workspace — Array-Shape Lens — Phase 2 Plan (Frontend graph model)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `graph.ts` produce **array-op edge labels** and a correct **binary-join DAG**, make geom edges **one-per-grain** (geom-annotated), and make `graphAtom.ts` + `App.tsx` **consume the Phase 1 array-shape descriptor** and **merge the warn-only join-key guard**. No rendering changes — the existing `TransformExplorer` keeps working; the workspace is Phase 3.

**Architecture:** `buildGraph` stays a pure function of the *spec* (steps, spine, plan, layers, schema, stats) — it owns labels and topology. The *descriptor* (axes/values/grain, ragged, the right-table shape, the join-key guard) arrives from `/shape_counts` and is merged onto nodes/edges in `explorerGraphAtom`/`mergeGuards`, keyed by node id. Phase 1 already returns the per-node descriptor + `join_leaf_key` guard; this phase adds one engine field (`joins`, the right-table descriptor) and consumes everything on the client.

**Tech Stack:** Python 3.13 + pandas + FastAPI + pytest (engine, Task 1); TypeScript + React + Jotai + vitest (frontend, Tasks 2–7).

**Spec:** `docs/superpowers/specs/2026-06-24-transformation-workspace-array-lens-design.md`
**Phase 1 plan (landed):** `docs/superpowers/plans/2026-06-24-transformation-workspace-array-lens.md`

---

## Context an implementer needs (read first)

**What Phase 1 already delivers (do not redo):** `/shape_counts` returns, for the
`source` node, every `steps[i]` node, and every `grains[key]` node, a descriptor
`{rows, cols, axes:[{name,n_levels,ragged}], values:[{name,type,grain}]}`; and a
`guards.join_leaf_key` list of warn verdicts `{dim, on, suggested, before, after,
severity:"caution", text}`. The frontend does **not yet read** either — that is this
phase.

**The two data paths, kept separate:**
- **Spec → labels/topology** lives in `src/explorer/graph.ts` (`buildGraph`). It has
  the steps/layers/schema synchronously and owns every edge label, the binary-join
  node, and the geom edges. Tasks 2–5.
- **Descriptor → node/edge enrichment** lives in `src/explorer/graphAtom.ts`
  (`explorerGraphAtom` merges counts by node id; `mergeGuards` places guard verdicts
  on edges) and `src/App.tsx` (fetches `/shape_counts`, builds the node-id-keyed
  counts map). Tasks 6–7.

**Node-id conventions (already in code):** `source`; `step:${i}`; `source:${i}` (a
join's right input); `grain:${key}` where `key = dims.join("/")`; `post:${i}`;
`plot`; `stats`. `explorerGraphAtom` merges `counts[node.id]` onto each node — so
**any descriptor placed in the counts map under the matching id flows onto the node
with no extra wiring.** That is why Task 7's `App.tsx` change is tiny.

**The current join rendering (the thing Task 4 fixes):** `buildGraph` already draws a
join as binary — it pushes a `source:${i}` node (label `"join source"`, `via:"none"`)
and two `kind:"join"` edges (both labelled `"join (inner)"`) converging on the
`step:${i}` node. Task 4 only improves the **labels** (descriptive right-node name +
`join on <keys>`); the binary topology already exists and its test passes.

**Scope boundary — the right input is one node, not a sub-pipeline.** The engine's
`_apply_join` supports a right block carrying its own `reduce`/`collapse`
sub-pipeline, but the TypeScript `JoinStep` type models only `right: Table` (a flat
loaded table). So in this phase the right input is drawn as a **single descriptive
source node** carrying the right table's *source* descriptor. Spelling out a right
**sub-pipeline** as sibling source→reduce→collapse nodes (spec § *Topology*, "drawn
in full") needs the TS `JoinStep` type to first model `right.reduce`/`right.collapse`
— that is a data-model change, explicitly **out of scope** here (note it for a later
phase). Drawing a flat right table "in full" *is* one node, so this is consistent
with the spec, not a violation.

---

## File structure

- **Modify** `engine/iris_engine/main.py` (`/shape_counts`, ~lines 573–625) — build a
  `joins` field: per join step index, the right table's array descriptor. (Task 1)
- **Modify** `engine/tests/test_shape_counts.py` — assert the `joins` descriptor. (Task 1)
- **Modify** `src/explorer/graph.ts` — `stepEdgeLabel` array-op language (Task 2);
  collapse edge label (Task 3); binary-join descriptive labels (Task 4); one geom
  edge per grain (Task 5). Extend `NodeCount` with the descriptor (Task 6).
- **Modify** `src/explorer/graph.test.ts` — update the labels the above changes touch;
  add the new-behaviour assertions. (Tasks 2–5)
- **Modify** `src/types.ts` — `AxisDesc`/`ValueDesc`/`NodeShape`, extend `ShapeCounts`
  (descriptor on source/steps/grains + new `joins`), add `join_leaf_key` to
  `ShapeCountsGuards`, add `"join_leaf_key"` to the `GuardVerdict.id` union. (Task 6)
- **Modify** `src/explorer/graphAtom.ts` — `mergeGuards` gains a `join_leaf_key`
  branch. (Task 7)
- **Create** `src/explorer/graphAtom.test.ts` — unit-test `mergeGuards`'s new branch. (Task 7)
- **Modify** `src/App.tsx` (~lines 253–259) — widen the counts-map type; carry the
  `joins` descriptors under `source:${i}` ids. (Task 7)

## Commands (used across tasks)

- Engine test (one file): `cd engine && python -m pytest tests/test_shape_counts.py -q`
- Engine full suite: `cd engine && python -m pytest -q`
- Frontend unit (one file): `npx vitest run src/explorer/graph.test.ts`
- Frontend typecheck: `npx tsc --noEmit`

---

## Task 1: Engine — `joins`, the right-table descriptor in `/shape_counts`

**Files:**
- Modify: `engine/iris_engine/main.py` (`/shape_counts`)
- Test: `engine/tests/test_shape_counts.py`

**Why:** Task 4 draws the join's right input as its own node (`source:${i}`); Task 7
attaches a descriptor to it. The descriptor must come from the engine (grain/ragged
inference is Python-only). The right table rides inline on the join step
(`step.right = {schema, rows}`), so `/shape_counts` can describe it in the same call.
We describe the right table's **source** rows (its own identifier columns as the
spine), not any right sub-pipeline (see scope boundary above).

- [ ] **Step 1: Write the failing test**

```python
# add to engine/tests/test_shape_counts.py
def test_shape_counts_describes_join_right_table():
    table = _fixture()  # subjects ctrl_s0..2, drug_s0..2 (6 unique subjects)
    right = {
        "schema": {"schema_version": "1.0", "columns": [
            {"name": "subject",  "label": "Subject",  "type": "identifier"},
            {"name": "genotype", "label": "Genotype", "type": "categorical"}]},
        "rows": [
            {"subject": "ctrl_s0", "genotype": "wt"},
            {"subject": "ctrl_s1", "genotype": "wt"},
            {"subject": "ctrl_s2", "genotype": "ko"},
            {"subject": "drug_s0", "genotype": "wt"},
            {"subject": "drug_s1", "genotype": "ko"},
            {"subject": "drug_s2", "genotype": "ko"}],
    }
    body = {"table": table,
            "steps": [{"kind": "join", "on": ["subject"], "how": "inner", "right": right}],
            "hierarchy": {"spine": ["subject", "rep"], "fn": {}}}
    r = client.post("/shape_counts", json=body)
    assert r.status_code == 200
    joins = r.json()["joins"]
    assert "0" in joins                                   # keyed by step index
    assert (joins["0"]["rows"], joins["0"]["cols"]) == (6, 2)
    assert [a["name"] for a in joins["0"]["axes"]] == ["subject"]
    vals = {v["name"]: v for v in joins["0"]["values"]}
    assert vals["genotype"]["type"] == "categorical"

def test_shape_counts_joins_empty_without_a_join():
    body = {"table": _fixture(), "steps": [],
            "hierarchy": {"spine": ["subject", "rep"], "fn": {}}}
    assert client.post("/shape_counts", json=body).json()["joins"] == {}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -k join_right -q`
Expected: FAIL — `KeyError: 'joins'`.

- [ ] **Step 3: Write the minimal implementation**

In `main.py`, immediately after the `steps_counts` loop completes (right after the
`for i in range(len(req.steps)):` block, ~line 580) add:

```python
    # per-join right-table descriptor: the join's right input rides inline on the
    # step (step.right = {schema, rows}); describe its SOURCE shape (its own
    # identifier columns as the spine) for the binary-join node the UI draws. A
    # right sub-pipeline (right.reduce/right.collapse) is NOT spelled out here.
    joins: dict[str, dict] = {}
    for i, st in enumerate(req.steps):
        if st.get("kind") != "join":
            continue
        rblock = st.get("right") or {}
        r_rows = rblock.get("rows") or []
        if not r_rows:
            continue
        r_schema = rblock.get("schema") or {}
        r_df = pd.DataFrame(r_rows)
        r_spine = [c["name"] for c in r_schema.get("columns", [])
                   if c.get("type") == "identifier" and c["name"] in r_df.columns]
        joins[str(i)] = {"rows": int(len(r_df)), "cols": _cols(r_df),
                         **shape_mod.describe_shape(r_df, r_schema, r_spine)}
```

Then add `joins` to the return dict (~line 624):

```python
    return {"source": out_source, "steps": steps_counts,
            "levels": levels_out, "grains": grains, "joins": joins, "guards": guards}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -q`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 5: Run the full engine suite (no regressions)**

Run: `cd engine && python -m pytest -q`
Expected: PASS — all green.

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_shape_counts.py
git commit -m "feat(engine): /shape_counts returns per-join right-table descriptor"
```

---

## Task 2: `graph.ts` — array-op reduce/post edge labels

**Files:**
- Modify: `src/explorer/graph.ts` (`stepEdgeLabel`)
- Test: `src/explorer/graph.test.ts`

**Why:** Today edges read `filter (2)`, `drop (1)`, `pivot opp`. The spec's vocabulary
(§ *What an edge shows*) is array language: `mask: …`, `drop Area`, `q = expr`,
`relabel …`, `unstack … → {…}`, `densify … · fill 0`. `stepEdgeLabel` is called for
reduce-step edges and post-collapse-step edges; thread `schema` so labels use column
labels, not raw names.

- [ ] **Step 1: Update the existing label assertions + add new ones (RED)**

In `src/explorer/graph.test.ts`, replace the body of the test
`"reduce-step edges carry the step kind and a count label"` assertions with:

```ts
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "filter", label: "mask (2 conditions)" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "drop", label: "drop Area" });
```

In the test `"pivot and grid_complete are linear single-edge steps"` replace the two
`toMatchObject` label assertions with:

```ts
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "pivot", label: "unstack opp → {same, opp}" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "grid_complete", label: "densify Experiment × tt · fill 0" });
```

Add a new test for `derive`/single-condition `filter`:

```ts
  it("array-op labels: derive shows the expr, single filter inlines the condition", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [{ column: "area", op: ">", value: 1 }] },
      { kind: "derive", column: "q", expr: "perimeter / sqrt(area)" },
    ];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")?.label).toBe("mask: Area > 1");
    expect(edge(g, "step:0", "step:1")?.label).toBe("q = perimeter / sqrt(area)");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL — labels still read `filter (2)` / `pivot opp` / etc.

- [ ] **Step 3: Write the implementation**

In `src/explorer/graph.ts`, add a condition formatter above `stepEdgeLabel` and
rewrite `stepEdgeLabel` to take `schema`:

```ts
const condText = (c: { column: string; op: string; value?: unknown; bound?: string },
                  schema: Schema | null): string =>
  `${labelForCol(schema, c.column)} ${c.op} ${c.bound ?? String(c.value ?? "")}`.trim();

function stepEdgeLabel(step: ReduceStep, schema: Schema | null): string {
  switch (step.kind) {
    case "filter":
      return step.conditions.length === 1
        ? `mask: ${condText(step.conditions[0], schema)}`
        : `mask (${step.conditions.length} conditions)`;
    case "drop":
      return `drop ${step.columns.map((c) => labelForCol(schema, c)).join(", ")}`;
    case "derive":
      return `${step.column} = ${step.expr}`;
    case "recode":
      return `relabel ${labelForCol(schema, step.column)}`;
    case "join":
      return `join on ${step.on.join(", ")}`;
    case "pivot":
      return `unstack ${labelForCol(schema, step.column)} → {${Object.values(step.names).join(", ")}}`;
    case "grid_complete":
      return `densify ${step.by.map((c) => labelForCol(schema, c)).join(" × ")} × ` +
             `${labelForCol(schema, step.column)} · fill ${step.fill}`;
  }
}
```

Update both call sites to pass `schema`. The reduce-step branch (~line 154):

```ts
      edges.push({ id: `e:${prev}->${id}`, kind: step.kind,
        label: stepEdgeLabel(step, schema), fromId: prev, toId: id });
```

The post-step branch (~line 207):

```ts
    edges.push({ id: `e:${id}`, kind: step.kind, label: stepEdgeLabel(step, schema),
      fromId: testFromId, toId: id, guards });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: PASS (all `buildGraph` tests, including the updated labels).

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): array-op edge labels for reduce/post steps"
```

---

## Task 3: `graph.ts` — collapse edge label reads as a reduction

**Files:**
- Modify: `src/explorer/graph.ts` (collapse edge in `buildGraph`)
- Test: `src/explorer/graph.test.ts`

**Why:** The collapse edge label is the literal string `"collapse"`; the array
operation (`median over frame`) lives only in the `flatten_info` *guard* text. Spec
§ *What an edge shows* makes the operation the **primary label**. Keep the
`flatten_info` guard (it adds the "grouped per …" detail as a badge). The forced-chain
first step removes nothing (raw→full-spine identity); label that case `group per …`.

- [ ] **Step 1: Write the failing test**

Add to `src/explorer/graph.test.ts`:

```ts
  it("collapse edge label reads as the reduction; identity regroup reads 'group per'", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    // real collapse: experiment/cell -> experiment removes Cell
    expect(edge(g, "grain:experiment/cell", "grain:experiment")?.label).toBe("mean over Cell");
    // first chain edge keeps the full spine (removes nothing): a regroup, not a collapse
    expect(edge(g, "source", "grain:experiment/cell")?.label).toBe("group per Experiment × Cell");
    // the flatten-info guard is still attached
    expect(edge(g, "grain:experiment/cell", "grain:experiment")
      ?.guards?.some((gd) => gd.id === "flatten_info")).toBe(true);
  });
```

(The existing test `"each collapse edge carries the white #3 flatten-info guard"`
stays as-is and must keep passing.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL — label is `"collapse"`, not `"mean over Cell"`.

- [ ] **Step 3: Write the implementation**

In `src/explorer/graph.ts` add a label helper near `flattenInfo`:

```ts
/* the collapse edge's primary label: the reduction in array language. A chain step
   that removes no dim (the raw -> full-spine identity) is a regroup, not a collapse. */
const collapseEdgeLabel = (schema: Schema | null, fn: string,
                           removed: string[], kept: string[]): string =>
  removed.length
    ? `${fn} over ${removed.map((d) => labelForCol(schema, d)).join(", ")}`
    : `group per ${kept.map((d) => labelForCol(schema, d)).join(" × ")}`;
```

Replace the collapse edge push (~line 170) with:

```ts
    edges.push({ id: `e:${cprev}->${id}`, kind: "collapse",
      label: collapseEdgeLabel(schema, step.fn, removed, kept),
      fromId: cprev, toId: id, guards: [flattenInfo(schema, step.fn, removed, kept)] });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): collapse edge label reads as the reduction (median over …)"
```

---

## Task 4: `graph.ts` — binary join: descriptive right node + `join on <keys>`

**Files:**
- Modify: `src/explorer/graph.ts` (join branch in `buildGraph`)
- Test: `src/explorer/graph.test.ts`

**Why:** The binary topology already exists (Task-context note above), but the right
node reads `"join source"` and both edges read `"join (inner)"`. Spec § *Topology*
wants the right input named for what it carries and the edge to state the key path
(`join on experiment, position, cell`). The descriptor (axes/values) is attached
later in Task 7; this task is the **label**, derivable from the step synchronously.

- [ ] **Step 1: Write the failing test**

Replace the existing test `"a join emits a second source node and two converging
join edges"` body with an extended version (keep the topology asserts, add labels):

```ts
  it("a join emits a named right node and two 'join on <keys>' edges", () => {
    const right: Table = {
      schema: { schema_version: "1.0", columns: [
        { name: "cell_id", type: "identifier", label: "Cell" },
        { name: "class_label", type: "categorical", label: "Class" },
      ] },
      rows: [{ id: "1", cell_id: "c1", class_label: "negative" }],
    };
    const steps: ReduceStep[] = [{ kind: "join", on: ["cell_id"], how: "inner", right }];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const sources = g.nodes.filter((n) => n.kind === "table" && n.id.startsWith("source"));
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const incoming = g.edges.filter((e) => e.toId === "step:0" && e.kind === "join");
    expect(incoming.length).toBe(2);
    // right node is named for the value column(s) it brings in, not "join source"
    expect(g.nodes.find((n) => n.id === "source:0")?.label).toBe("Class");
    // both converging edges state the key path, using the right schema's label
    expect(incoming.every((e) => e.label === "join on Cell")).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL — right node label is `"join source"`, edges are `"join (inner)"`.

- [ ] **Step 3: Write the implementation**

In `src/explorer/graph.ts` add two helpers near `STEP_NODE_LABEL`:

```ts
/* a join's `on` key, labelled — prefer the left schema, fall back to the right
   table's own schema (its keys often aren't columns of the left), else the raw name. */
const joinKeyLabel = (schema: Schema | null, right: { schema: Schema }, k: string): string => {
  const left = labelForCol(schema, k);
  if (left !== k) return left;
  return right.schema.columns.find((c) => c.name === k)?.label ?? k;
};

/* the right input's node label: the value column(s) it contributes (non-identifier),
   by label; falls back to "right table". */
const joinSourceLabel = (right: { schema: Schema }): string => {
  const vals = right.schema.columns.filter((c) => c.type !== "identifier");
  return vals.length ? vals.map((c) => c.label ?? c.name).join(", ") : "right table";
};
```

Replace the join branch inside the `steps.forEach` loop (~lines 144–152) with:

```ts
    if (step.kind === "join") {
      // a second source feeds the join: draw it converging into this node
      const srcId = `source:${i}`;
      const onLabel = step.on.map((k) => joinKeyLabel(schema, step.right, k)).join(", ");
      nodes.push({ id: srcId, kind: "table", label: joinSourceLabel(step.right),
        table: { via: "none" } });
      edges.push({ id: `e:${prev}->${id}`, kind: "join", label: `join on ${onLabel}`,
        fromId: prev, toId: id });
      edges.push({ id: `e:${srcId}->${id}`, kind: "join", label: `join on ${onLabel}`,
        fromId: srcId, toId: id });
    } else {
```

(`step.right` is typed `Table` inside the `step.kind === "join"` narrow; `Table` is
already importable from `../types`. If `Table` is not yet in the `graph.ts` import
list, add it: `import type { …, Table } from "../types";`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): binary join draws a named right node + 'join on <keys>' edges"
```

---

## Task 5: `graph.ts` — one geom edge per grain (geom-annotated)

**Files:**
- Modify: `src/explorer/graph.ts` (geom-edge loop in `buildGraph`)
- Test: `src/explorer/graph.test.ts`

**Why:** Spec § *Settled decisions* #3: a plot is composable over any number of
grains; draw **one edge per grain**, labelled with the geom(s) at that grain,
comma-separated when several geoms share a grain. Today the loop de-dupes by
`grain:geom`, so two *different* geoms at one grain produce two edges. Group by grain
node instead, collect distinct geom labels per grain, emit one edge each.

- [ ] **Step 1: Write the failing test**

Add to `src/explorer/graph.test.ts`:

```ts
  it("two geoms at the same grain collapse to one comma-joined edge", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: RAW_LEVEL },
    ];
    const g = buildGraph([], SPINE, PLAN, layers, SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(1);
    expect(geoms[0].label).toBe("dots, box");
    expect(geoms[0].fromId).toBe("source");
  });
```

(The existing tests `"SuperPlot: distinct grains/geoms draw distinct geom edges; dups
collapse"`, `"geom edge per layer into plot"`, and `"skips a geom edge for a level no
longer on the spine"` must all keep passing — distinct grains still get distinct
edges, a single geom still reads `"dots"`, and the no-grain fallback still reads
`"plotted"`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL — two edges produced (`"dots"` and `"box"`), expected one `"dots, box"`.

- [ ] **Step 3: Write the implementation**

Replace the geom loop (~lines 179–191) with a group-by-grain build:

```ts
  // one edge per grain the plot reads, labelled with the geom(s) at that grain
  // (distinct, in first-seen order, comma-joined). A plot is composable over any
  // number of grains. § Topology / Settled decisions #3.
  const geomByNode = new Map<string, string[]>();
  for (const layer of layers) {
    const fromId = levelGrainNode(layer.level, plan, rawNodeId);
    if (!fromId) continue;
    const label = geomLabel(layer.geom);
    const list = geomByNode.get(fromId) ?? [];
    if (!list.includes(label)) list.push(label);
    geomByNode.set(fromId, list);
  }
  for (const [fromId, labels] of geomByNode) {
    edges.push({ id: `g:${fromId}`, kind: "geom", label: labels.join(", "),
      fromId, toId: PLOT_ID });
  }
  if (geomByNode.size === 0) {
    edges.push({ id: "g:plain", kind: "geom", label: "plotted", fromId: rawNodeId, toId: PLOT_ID });
  }
```

(`seenGeom` is now unused — remove its `const seenGeom = new Set<string>();`
declaration.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: PASS — including the unchanged SuperPlot/fallback tests.

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): one geom edge per grain, geom-annotated"
```

---

## Task 6: `types.ts` + `graph.ts` — descriptor & join-key-guard type substrate

**Files:**
- Modify: `src/types.ts`
- Modify: `src/explorer/graph.ts` (`NodeCount`)
- Verify: `npx tsc --noEmit`

**Why:** Task 7 consumes the Phase 1 descriptor (`axes`/`values`), the new `joins`
field (Task 1), and the `join_leaf_key` guard. The types must model all three before
the consuming code can compile. Type-only task — the gate is `tsc`.

- [ ] **Step 1: Extend `src/types.ts`**

Add the descriptor types (near `ShapeCounts`, ~line 475):

```ts
export interface AxisDesc { name: string; n_levels: number; ragged: boolean }
export interface ValueDesc { name: string; type: string; grain: string | null }
/* a node's row×col count plus its array-shape descriptor (Phase 1 /shape_counts). */
export interface NodeShape {
  rows: number;
  cols: number;
  axes?: AxisDesc[];
  values?: ValueDesc[];
}
```

Replace the `ShapeCounts` interface (~lines 475–483) with:

```ts
export interface ShapeCounts {
  source: NodeShape;
  steps: NodeShape[];
  /* grain-keyed counts: key "" = raw, else dims joined by "/" — matches the
     graph's grain node ids (`grain:<key>`). */
  grains: Record<string, NodeShape>;
  /* per-join (step-index-keyed) right-table descriptor; {} when no join. */
  joins: Record<string, NodeShape>;
  /* the integrity guard verdicts the frontend places on graph edges. */
  guards: ShapeCountsGuards;
}
```

Add `join_leaf_key` to `ShapeCountsGuards` (~line 132):

```ts
export interface ShapeCountsGuards {
  pseudoreplication: { risk: boolean; n_test: number; n_coarsest: number; coarsest_grain: GrainKey } | null;
  pairing_flip: { flipped: boolean; from: string | null; to: string | null; across: string | null } | null;
  identity_merge: { dim: string; kept: string[]; before: number; after: number }[];
  post_aggregate_derive: { step_index: number; grain: GrainKey; reason: string }[];
  join_leaf_key: { dim: string; on: string[]; suggested: string[]; before: string; after: string; severity: string; text: string }[];
}
```

Add `"join_leaf_key"` to the `GuardVerdict.id` union (~line 124):

```ts
export interface GuardVerdict {
  id: "pseudoreplication" | "pairing_flip" | "identity_merge" | "post_aggregate_derive" | "flatten_info" | "join_leaf_key";
  severity: "caution" | "info";
  text: string;
}
```

- [ ] **Step 2: Extend `NodeCount` in `src/explorer/graph.ts`**

Replace the `NodeCount` interface (~line 21) and the import line (~line 1):

```ts
import type { AxisDesc, CollapsePlan, GuardVerdict, Layer, ReduceStep, Schema, Table, ValueDesc } from "../types";
```

```ts
export interface NodeCount {
  rows: number;
  cols: number;
  axes?: AxisDesc[];
  values?: ValueDesc[];
}
```

(If Task 4 already added `Table` to the import, keep one copy.)

- [ ] **Step 3: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: PASS — no errors. (`App.tsx` still compiles because its local counts map is
`Record<string, { rows; cols }>`, structurally assignable from `NodeShape`; Task 7
widens it.)

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/explorer/graph.ts
git commit -m "feat(types): array-shape descriptor + joins + join-key guard types"
```

---

## Task 7: `graphAtom.ts` + `App.tsx` — consume descriptor, merge join-key guard

**Files:**
- Modify: `src/explorer/graphAtom.ts` (`mergeGuards`)
- Create: `src/explorer/graphAtom.test.ts`
- Modify: `src/App.tsx` (counts map)
- Test: `npx vitest run src/explorer/graphAtom.test.ts`, then `npx tsc --noEmit`

**Why:** Two consumption wires remain. (a) The descriptor (`axes`/`values`) already
rides on each `NodeShape` the response returns; `explorerGraphAtom`'s existing
`counts[n.id]` merge will attach it to every node **once `App.tsx` stops narrowing the
map** and carries the `joins` descriptors under `source:${i}` ids. (b) The
`join_leaf_key` guard needs a `mergeGuards` branch to land its caution on the join
edge.

- [ ] **Step 1: Write the failing test for `mergeGuards`**

Create `src/explorer/graphAtom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeGuards } from "./graphAtom";
import type { Edge } from "./graph";
import type { ShapeCountsGuards } from "../types";

const NO_GUARDS: ShapeCountsGuards = {
  pseudoreplication: null, pairing_flip: null,
  identity_merge: [], post_aggregate_derive: [], join_leaf_key: [],
};

const joinEdges = (): Edge[] => [
  { id: "e:source->step:0", kind: "join", label: "join on Cell", fromId: "source", toId: "step:0" },
  { id: "e:source:0->step:0", kind: "join", label: "join on Cell", fromId: "source:0", toId: "step:0" },
];

describe("mergeGuards: join_leaf_key", () => {
  it("lands one caution on the join, derived from the guard text", () => {
    const guards: ShapeCountsGuards = {
      ...NO_GUARDS,
      join_leaf_key: [{
        dim: "cell", on: ["cell"], suggested: ["experiment", "position", "cell"],
        before: "cell", after: "experiment, position, cell", severity: "caution",
        text: "Joining on cell alone, but cell isn't unique without experiment, position …",
      }],
    };
    const out = mergeGuards(joinEdges(), guards);
    const flagged = out.filter((e) => e.guards?.some((g) => g.id === "join_leaf_key"));
    expect(flagged).toHaveLength(1);
    expect(flagged[0].guards?.find((g) => g.id === "join_leaf_key"))
      .toMatchObject({ severity: "caution", text: guards.join_leaf_key[0].text });
  });

  it("no join_leaf_key entries -> no badge added", () => {
    const out = mergeGuards(joinEdges(), NO_GUARDS);
    expect(out.some((e) => e.guards?.some((g) => g.id === "join_leaf_key"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/explorer/graphAtom.test.ts`
Expected: FAIL — `mergeGuards` ignores `join_leaf_key`, so no edge is flagged.

- [ ] **Step 3: Add the `mergeGuards` branch**

In `src/explorer/graphAtom.ts`, inside `mergeGuards`, after the collapse-edges block
and before `return out;` (~line 93), add:

```ts
  /* --- join edges: join-key guard (one caution per offending join) --- */
  const joinTargets = [...new Set(out.filter((e) => e.kind === "join").map((e) => e.toId))];
  (guards.join_leaf_key ?? []).forEach((m, i) => {
    const toId = joinTargets[i];
    if (!toId) return;
    const edge = out.find((e) => e.kind === "join" && e.toId === toId);
    if (edge) append(edge, { id: "join_leaf_key", severity: "caution", text: m.text });
  });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/explorer/graphAtom.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Carry the descriptor + joins through `App.tsx`**

In `src/App.tsx`, widen the counts-map type and add the `joins` mapping. Replace the
map-build block (~lines 253–259) with:

```ts
        const counts: Record<string, NodeShape> = { source: sc.source };
        sc.steps.forEach((c, i) => { counts[`step:${i}`] = c; });
        /* grain-keyed counts map onto the graph's `grain:<key>` nodes. The raw
           grain ("") is the source/last-step node, already counted above. */
        for (const [key, c] of Object.entries(sc.grains ?? {})) {
          if (key !== "") counts[`grain:${key}`] = c;
        }
        /* per-join right-table descriptors map onto the binary-join `source:<i>`
           nodes the graph draws. */
        for (const [i, c] of Object.entries(sc.joins ?? {})) {
          counts[`source:${i}`] = c;
        }
```

Add `NodeShape` to the `App.tsx` type import from `./types` (find the existing
`import type { … } from "./types";` and add `NodeShape`). The `setShapeCounts(counts)`
call already follows; `shapeCountsAtom` is typed `Record<string, NodeCount> | null`
and `NodeShape` is structurally assignable to `NodeCount` (both `{rows, cols, axes?,
values?}`), so no atom retype is needed. The existing `explorerGraphAtom` line
`counts[n.id] ? { ...n, count: counts[n.id] } : n` now carries `axes`/`values` onto
every matched node — no change there.

- [ ] **Step 6: Verify typecheck + full frontend suite**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npx vitest run`
Expected: PASS — `graph.test.ts` and `graphAtom.test.ts` green, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/explorer/graphAtom.ts src/explorer/graphAtom.test.ts src/App.tsx
git commit -m "feat(explorer): consume array descriptor on nodes + merge join-key guard"
```

---

## Phase 2 self-check

- [ ] **Edge labels** read in array language for every reduce/post op (Task 2) and the
  collapse (Task 3) — spec § *What an edge shows*.
- [ ] **Binary join** draws a named right node and `join on <keys>` edges (Task 4); the
  pre-existing two-parent topology is preserved (existing test still green).
- [ ] **Geom edges** are one-per-grain, geom-annotated, comma-joined within a grain
  (Task 5) — § *Settled decisions* #3. Distinct grains still get distinct edges;
  the no-grain fallback still reads `"plotted"`.
- [ ] **Descriptor consumed**: `axes`/`values` (source/steps/grains, Phase 1) and the
  right-table descriptor (`joins`, Task 1) ride onto nodes via the node-id-keyed
  counts merge (Tasks 6–7). No re-derivation on the client.
- [ ] **Join-key guard** is warn-only and lands one caution on the join edge (Task 7)
  — § *Settled decisions* (join-key guard, warn only).
- [ ] **Scope honoured**: no rendering changes (the workspace, node chips, colour-by-
  type, grain tags, and canned-schematic hovers are Phase 3); the right input is one
  descriptive node, not a spelled-out sub-pipeline (data-model boundary documented).
- [ ] App still works after this phase: edge labels and topology improve in the
  existing `TransformExplorer`; nothing new is rendered yet.

---

## Out of scope (deferred)

- **Right sub-pipeline rendering.** Spelling a join's right input out as sibling
  source→reduce→collapse nodes (spec § *Topology*, "drawn in full") requires the TS
  `JoinStep` type to model `right.reduce`/`right.collapse` (the engine already
  supports it) and the engine to return per-stage right descriptors. Data-model
  change — a later phase.
- **All rendering** (Phase 3): `TransformWorkspace`, `ArrayShapeNode` (axis/value
  chips, colour-by-type, `@grain` tags, ragged-dashed, collapse strike-out, grain
  tint), canned-schematic hovers (`cannedExamples.ts`/`OpHoverExample.tsx`), CSS.
- Any change to statistics, collapse semantics, or the reduce vocabulary.
