# Reduce DAG (fan-out / fan-in data shaping) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the linear reduce pipeline into a small DAG so the workbench can author and render fan-out (one table into two reductions) and fan-in (merge two tables), converging to a single output node that feeds the existing collapse -> plot/stats path unchanged.

**Architecture:** The reduce spec stops being an ordered `steps[]` and becomes a node set: `sources[]` (root tables), `steps[]` (each carrying `id` + `inputs[]`), and a single `output` node id. The engine changes from a fold to a topological evaluation over these nodes. The client inlines each source's rows into the request exactly as it already inlines a join's right table, so the engine receives a self-contained DAG and needs no new table-resolution. The join's inline `right` sub-pipeline dissolves into ordinary DAG nodes: one uniform fan-in mechanism. Downstream of `output` (hierarchy, render, stats, layers) is untouched. Design doc: `docs/superpowers/specs/2026-07-12-reduce-dag-fanout-fanin-design.md`.

**Tech Stack:** Python 3 + pandas + FastAPI (engine, `engine/iris_engine/`), TypeScript + React + Jotai + @xyflow/react (app, `src/`), Vitest (TS tests), pytest (engine tests).

**Phases (each independently testable, in dependency order):**
- **A. Engine** — topological DAG evaluator + join-as-2-input, behind a `linear -> dag` adapter so the fold path keeps passing.
- **B. Spec + `.iris` 2.2** — `Plottable.reduce` becomes a DAG; load/save round-trips; degenerate linear specs still work.
- **C. buildGraph** — read adjacency from the DAG instead of threading `prev`.
- **D. Canvas** — `onConnect`, branch via `+`, merge, deletion rewiring.
- **E. §4 fixtures** — dissolve the join sub-pipeline; regenerate and verify the COV2D §4 `.iris`.

**Conventions:** No em-dashes in prose. Run the engine suite with `cd engine && python -m pytest`; the TS suite with `npm test`. Commit after every green step.

---

## Phase A — Engine: topological DAG evaluator

The engine gains a DAG evaluator that topologically evaluates nodes, caching each node's `(df, schema)`. A source node carries its rows inline; a step node names its `inputs`. Join becomes a two-input step reading two cached frames. The existing linear fold (`apply_reduction`, `iter_reduction`) stays until Phase B retires its callers, so a `linear_to_dag` adapter lets us prove the evaluator equals the fold on every existing fixture.

**Files (Phase A):**
- Create: `engine/iris_engine/dag.py` (the DAG evaluator + adapter)
- Modify: `engine/iris_engine/reduce.py` (extract a frame-pair join)
- Test: `engine/tests/test_dag.py` (create)

### Task A1: Extract a frame-pair join from `_apply_join`

Today `_apply_join` (`reduce.py:280-332`) reads `step["right"]` inline: it builds `right_df` from `right["rows"]`, optionally runs the right sub-pipeline, then merges. The DAG evaluator already has both frames in hand, so extract the merge-only tail into `_join_frames(left_df, left_schema, right_df, right_schema, on, how)` and have `_apply_join` call it after building `right_df`. No behavior change yet.

**Files:**
- Modify: `engine/iris_engine/reduce.py:280-332`
- Test: `engine/tests/test_reduce.py` (add one case)

- [ ] **Step 1: Write the failing test**

Add to `engine/tests/test_reduce.py`:

```python
def test_join_frames_merges_on_key():
    from iris_engine.reduce import _join_frames
    import pandas as pd
    left = pd.DataFrame({"cell": ["a", "b"], "speed": [1.0, 2.0]})
    left_schema = {"columns": [{"name": "cell", "type": "categorical"},
                               {"name": "speed", "type": "numeric"}]}
    right = pd.DataFrame({"cell": ["a", "b"], "het": [0.1, 0.2]})
    right_schema = {"columns": [{"name": "cell", "type": "categorical"},
                                {"name": "het", "type": "numeric"}]}
    out, schema = _join_frames(left, left_schema, right, right_schema, ["cell"], "inner")
    assert list(out.columns) >= ["cell", "speed", "het"]
    assert out.loc[out.cell == "a", "het"].iloc[0] == 0.1
    assert any(c["name"] == "het" for c in schema["columns"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_reduce.py::test_join_frames_merges_on_key -q`
Expected: FAIL with `ImportError` / `cannot import name '_join_frames'`.

- [ ] **Step 3: Extract `_join_frames`**

In `engine/iris_engine/reduce.py`, add above `_apply_join`:

```python
def _join_frames(df: pd.DataFrame, schema: dict,
                 right_df: pd.DataFrame, right_schema: dict,
                 on: list[str], how: str) -> tuple[pd.DataFrame, dict]:
    """Inner-merge two already-materialized frames on `on`. The one merge
    mechanism the fold and the DAG evaluator share: drops bookkeeping cols,
    rejects a non-unique right key (many-to-many deferred), appends only the
    right's new declared columns."""
    if how != "inner":
        raise ReduceError(f"join: only inner is supported, got {how!r}")
    if not on:
        raise ReduceError("join needs `on` keys")
    right_df = right_df.drop(columns=["id", "row_ids"], errors="ignore")
    missing = [k for k in on if k not in df.columns or k not in right_df.columns]
    if missing:
        raise ReduceError(f"join: key(s) {missing!r} absent from a side")
    if right_df.duplicated(subset=on).any():
        raise ReduceError("join: right table is not unique on the join key(s); "
                          "many-to-many is not yet supported")
    left_names = {c["name"] for c in schema["columns"]} | set(_meta_cols(df)) | set(on)
    add = [c for c in right_schema.get("columns", [])
           if c["name"] not in left_names and c["name"] in right_df.columns]
    keep = list(dict.fromkeys(on + [c["name"] for c in add]))
    right_df = right_df[[c for c in keep if c in right_df.columns]]
    try:
        out = df.merge(right_df, on=on, how="inner")
    except ValueError as e:
        raise ReduceError(f"join: merge failed — {e}") from e
    return out.reset_index(drop=True), {**schema, "columns": [*schema["columns"], *add]}
```

Then replace the tail of `_apply_join` (from `right_df = right_df.drop(columns=["id", "row_ids"]...` through the `return`) with:

```python
    on = step.get("on") or []
    how = step.get("how", "inner")
    return _join_frames(df, schema, right_df, right_schema, on, how)
```

Leave the inline-right materialization (`right_rows`, `right_steps`, `right_plan` block) intact above that call: it still serves the fold path until Phase E dissolves it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && python -m pytest tests/test_reduce.py -q`
Expected: PASS (the new test plus all existing join tests, unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/reduce.py engine/tests/test_reduce.py
git commit -m "refactor(engine): extract _join_frames from _apply_join"
```

### Task A2: `linear_to_dag` adapter

A degenerate DAG for a linear step list: a single source node, one step node per step chained by `inputs`, `output` = the last node (or the source if there are no steps). This is the bridge that lets the evaluator be tested against every existing fold fixture.

**Files:**
- Create: `engine/iris_engine/dag.py`
- Test: `engine/tests/test_dag.py`

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_dag.py`:

```python
from iris_engine.dag import linear_to_dag


def test_linear_to_dag_chains_inputs():
    table = {"schema": {"columns": [{"name": "x", "type": "numeric"}]},
             "rows": [{"x": 1}, {"x": 2}]}
    steps = [{"kind": "filter", "conditions": []},
             {"kind": "derive", "column": "y", "expr": "x + 1"}]
    dag = linear_to_dag(table, steps)
    assert [n["id"] for n in dag["nodes"]] == ["src", "s0", "s1"]
    assert dag["nodes"][0]["kind"] == "source"
    assert dag["nodes"][1]["inputs"] == ["src"]
    assert dag["nodes"][2]["inputs"] == ["s0"]
    assert dag["output"] == "s1"


def test_linear_to_dag_no_steps_outputs_source():
    table = {"schema": {"columns": []}, "rows": []}
    dag = linear_to_dag(table, [])
    assert dag["output"] == "src"
    assert [n["id"] for n in dag["nodes"]] == ["src"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_dag.py -q`
Expected: FAIL with `ModuleNotFoundError: iris_engine.dag`.

- [ ] **Step 3: Write `linear_to_dag`**

Create `engine/iris_engine/dag.py`:

```python
"""Reduce DAG: a node set evaluated topologically, converging to one `output`
node whose frame feeds collapse -> plot/stats. A `source` node carries its rows
inline ({schema, rows}); a `step` node names the node id(s) it consumes in
`inputs` (one for the unary steps, two for join: [left, right]).

The linear pipeline is the degenerate DAG (one source, a straight input chain);
`linear_to_dag` builds it so the evaluator can be proven equal to the old fold."""
from __future__ import annotations


def linear_to_dag(table: dict, steps: list[dict] | None) -> dict:
    """A straight chain: source `src` -> `s0` -> `s1` -> ... . `output` is the
    last step, or the source when there are no steps."""
    nodes: list[dict] = [{"id": "src", "kind": "source", "table": table}]
    prev = "src"
    for i, step in enumerate(steps or []):
        nid = f"s{i}"
        nodes.append({"id": nid, "kind": "step", "step": step, "inputs": [prev]})
        prev = nid
    return {"nodes": nodes, "output": prev}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_dag.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/dag.py engine/tests/test_dag.py
git commit -m "feat(engine): linear_to_dag adapter for the reduce DAG"
```

### Task A3: Topological order + cycle guard

**Files:**
- Modify: `engine/iris_engine/dag.py`
- Test: `engine/tests/test_dag.py`

- [ ] **Step 1: Write the failing test**

Add to `engine/tests/test_dag.py`:

```python
from iris_engine.dag import topo_order, DagError
import pytest


def test_topo_order_respects_inputs():
    nodes = [{"id": "src", "kind": "source", "table": {}},
             {"id": "a", "kind": "step", "inputs": ["src"]},
             {"id": "b", "kind": "step", "inputs": ["src"]},
             {"id": "j", "kind": "step", "inputs": ["a", "b"]}]
    order = topo_order(nodes)
    assert order.index("src") < order.index("a") < order.index("j")
    assert order.index("b") < order.index("j")


def test_topo_order_rejects_cycle():
    nodes = [{"id": "a", "kind": "step", "inputs": ["b"]},
             {"id": "b", "kind": "step", "inputs": ["a"]}]
    with pytest.raises(DagError):
        topo_order(nodes)


def test_topo_order_rejects_missing_input():
    nodes = [{"id": "a", "kind": "step", "inputs": ["ghost"]}]
    with pytest.raises(DagError):
        topo_order(nodes)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_dag.py -q`
Expected: FAIL with `ImportError` for `topo_order` / `DagError`.

- [ ] **Step 3: Implement `topo_order`**

Add to `engine/iris_engine/dag.py`:

```python
class DagError(ValueError):
    """The reduce DAG is malformed (cycle, missing input, missing output)."""


def topo_order(nodes: list[dict]) -> list[str]:
    """Kahn topological sort over `inputs` edges. Raises DagError on a cycle or a
    reference to an undeclared node id."""
    ids = {n["id"] for n in nodes}
    deps = {n["id"]: [i for i in (n.get("inputs") or [])] for n in nodes}
    for nid, ins in deps.items():
        missing = [i for i in ins if i not in ids]
        if missing:
            raise DagError(f"node {nid!r} names unknown input(s) {missing!r}")
    indeg = {nid: 0 for nid in ids}
    children: dict[str, list[str]] = {nid: [] for nid in ids}
    for nid, ins in deps.items():
        for i in ins:
            indeg[nid] += 1
            children[i].append(nid)
    queue = sorted(nid for nid, d in indeg.items() if d == 0)
    order: list[str] = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for c in sorted(children[nid]):
            indeg[c] -= 1
            if indeg[c] == 0:
                queue.append(c)
    if len(order) != len(ids):
        raise DagError("reduce DAG contains a cycle")
    return order
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_dag.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/dag.py engine/tests/test_dag.py
git commit -m "feat(engine): topological order + cycle guard for the reduce DAG"
```

### Task A4: `evaluate_dag` — the evaluator

Evaluate nodes in topo order, caching `(df, schema)` per id. A source node loads its inline `{schema, rows}` via the existing `_load_frame`. A unary step applies `_apply_step` over its single input's cached frame. A join step (two inputs) calls `_join_frames` over the two cached frames. Returns the `output` node's `(df, schema)`.

**Files:**
- Modify: `engine/iris_engine/dag.py`
- Test: `engine/tests/test_dag.py`

- [ ] **Step 1: Write the failing test (evaluator equals the fold on a linear DAG, and a diamond joins branch outputs)**

Add to `engine/tests/test_dag.py`:

```python
from iris_engine.dag import evaluate_dag
from iris_engine.reduce import apply_reduction
from iris_engine.main import _load_frame


def _table():
    return {"schema": {"columns": [{"name": "cell", "type": "categorical"},
                                   {"name": "v", "type": "numeric"}]},
            "rows": [{"cell": "a", "v": 1.0}, {"cell": "b", "v": 3.0}]}


def test_evaluate_dag_equals_fold_on_linear():
    table, steps = _table(), [{"kind": "derive", "column": "w", "expr": "v * 2"}]
    dag = linear_to_dag(table, steps)
    dag_df, _ = evaluate_dag(dag)
    df0, sch0 = _load_frame(table)
    fold_df, _ = apply_reduction(df0, sch0, steps)
    assert dag_df["w"].tolist() == fold_df["w"].tolist()


def test_evaluate_dag_diamond_joins_two_branches():
    # src fans out to two derives, which join back on `cell`.
    table = _table()
    nodes = [
        {"id": "src", "kind": "source", "table": table},
        {"id": "hi", "kind": "step", "inputs": ["src"],
         "step": {"kind": "derive", "column": "hi", "expr": "v + 10"}},
        {"id": "lo", "kind": "step", "inputs": ["src"],
         "step": {"kind": "derive", "column": "lo", "expr": "v - 10"}},
        {"id": "j", "kind": "step", "inputs": ["hi", "lo"],
         "step": {"kind": "join", "on": ["cell"], "how": "inner"}},
    ]
    dag = {"nodes": nodes, "output": "j"}
    out, schema = evaluate_dag(dag)
    assert {"hi", "lo"} <= set(out.columns)
    assert out.loc[out.cell == "a", "hi"].iloc[0] == 11.0
    assert out.loc[out.cell == "a", "lo"].iloc[0] == -9.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_dag.py -q`
Expected: FAIL with `ImportError` for `evaluate_dag`.

- [ ] **Step 3: Implement `evaluate_dag`**

Add to `engine/iris_engine/dag.py` (import lazily to avoid a load cycle with `main`/`reduce`):

```python
def evaluate_dag(dag: dict) -> tuple:
    """Topologically evaluate `dag['nodes']`, returning the `output` node's
    (frame, schema). Source nodes load their inline {schema, rows}; unary step
    nodes fold one input through `_apply_step`; a join step merges its two inputs
    via `_join_frames`. Each node is evaluated once and cached by id."""
    from .main import _load_frame
    from .reduce import _apply_step, _join_frames

    by_id = {n["id"]: n for n in dag["nodes"]}
    output = dag.get("output")
    if output not in by_id:
        raise DagError(f"reduce DAG output {output!r} is not a node")
    cache: dict[str, tuple] = {}
    for nid in topo_order(dag["nodes"]):
        node = by_id[nid]
        if node.get("kind") == "source":
            cache[nid] = _load_frame(node["table"])
            continue
        step = node.get("step") or {}
        inputs = node.get("inputs") or []
        if step.get("kind") == "join":
            if len(inputs) != 2:
                raise DagError(f"join node {nid!r} needs exactly 2 inputs")
            left_df, left_schema = cache[inputs[0]]
            right_df, right_schema = cache[inputs[1]]
            out, schema = _join_frames(left_df, left_schema, right_df, right_schema,
                                       step.get("on") or [], step.get("how", "inner"))
        else:
            if len(inputs) != 1:
                raise DagError(f"step node {nid!r} needs exactly 1 input")
            in_df, in_schema = cache[inputs[0]]
            out, schema, _info = _apply_step(in_df, in_schema, step)
            out = out.reset_index(drop=True)
            if "id" not in out.columns:
                out = out.assign(id=[str(i + 1) for i in range(len(out))])
        cache[nid] = (out, schema)
    return cache[output]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_dag.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/dag.py engine/tests/test_dag.py
git commit -m "feat(engine): evaluate_dag topological evaluator (linear + diamond)"
```

### Task A5: Per-node trace/counts (`evaluate_dag_traced`)

`shape_counts` and the preview need a frame per node, not just the output. Add `evaluate_dag_traced` that returns the full `cache` (id -> (df, schema)) plus the topo order, so callers can report `n_rows` and axes for every node. This replaces `iter_reduction`'s per-step role for the DAG.

**Files:**
- Modify: `engine/iris_engine/dag.py`
- Test: `engine/tests/test_dag.py`

- [ ] **Step 1: Write the failing test**

```python
from iris_engine.dag import evaluate_dag_traced


def test_evaluate_dag_traced_returns_every_node_frame():
    table = _table()
    dag = linear_to_dag(table, [{"kind": "filter",
        "conditions": [{"column": "v", "op": ">", "value": 2.0}]}])
    cache, order = evaluate_dag_traced(dag)
    assert set(cache) == {"src", "s0"}
    assert len(cache["src"][0]) == 2      # source: both rows
    assert len(cache["s0"][0]) == 1       # after filter v > 2: one row
    assert order[0] == "src"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_dag.py::test_evaluate_dag_traced_returns_every_node_frame -q`
Expected: FAIL (`ImportError`).

- [ ] **Step 3: Refactor `evaluate_dag` onto a shared core**

In `engine/iris_engine/dag.py`, replace `evaluate_dag` with a thin wrapper over a traced core:

```python
def evaluate_dag_traced(dag: dict) -> tuple[dict, list[str]]:
    """Like evaluate_dag but returns (cache, order): every node's (df, schema)
    keyed by id, plus the topological order, for per-node counts/preview."""
    from .main import _load_frame
    from .reduce import _apply_step, _join_frames

    by_id = {n["id"]: n for n in dag["nodes"]}
    output = dag.get("output")
    if output not in by_id:
        raise DagError(f"reduce DAG output {output!r} is not a node")
    cache: dict[str, tuple] = {}
    order = topo_order(dag["nodes"])
    for nid in order:
        node = by_id[nid]
        if node.get("kind") == "source":
            cache[nid] = _load_frame(node["table"])
            continue
        step = node.get("step") or {}
        inputs = node.get("inputs") or []
        if step.get("kind") == "join":
            if len(inputs) != 2:
                raise DagError(f"join node {nid!r} needs exactly 2 inputs")
            ldf, lsch = cache[inputs[0]]
            rdf, rsch = cache[inputs[1]]
            out, schema = _join_frames(ldf, lsch, rdf, rsch,
                                       step.get("on") or [], step.get("how", "inner"))
        else:
            if len(inputs) != 1:
                raise DagError(f"step node {nid!r} needs exactly 1 input")
            idf, isch = cache[inputs[0]]
            out, schema, _info = _apply_step(idf, isch, step)
            out = out.reset_index(drop=True)
            if "id" not in out.columns:
                out = out.assign(id=[str(i + 1) for i in range(len(out))])
        cache[nid] = (out, schema)
    return cache, order


def evaluate_dag(dag: dict) -> tuple:
    """The `output` node's (frame, schema)."""
    cache, _ = evaluate_dag_traced(dag)
    return cache[dag["output"]]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && python -m pytest tests/test_dag.py -q`
Expected: PASS (all Phase A tests).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/dag.py engine/tests/test_dag.py
git commit -m "feat(engine): evaluate_dag_traced for per-node counts/preview"
```

---

## Phase B — Spec + `.iris` 2.2

The app-internal `Plottable.reduce` becomes a DAG; `.iris` bumps 2.1 -> 2.2. Because the client already inlines join right-tables, the *engine request* for render/preview carries the DAG with source rows inlined (built by a new `resolveEngineDag`), while the *saved* spec stores sources by table-id reference (like `right_table_id` today). No legacy shim: the reader/writer switch outright and in-repo fixtures regenerate (Phase E).

**Files (Phase B):**
- Modify: `src/types.ts` (DAG types, spec 2.2), `src/state.ts` (adapters, buildSpec/specForSave/plottableFromSpec/adoptStep/duplicate)
- Modify: `engine/iris_engine/document.py` (FORMAT_VERSION 2.2, guard), `engine/iris_engine/main.py` (accept a DAG request)
- Test: `src/state.dag.test.ts` (create), `engine/tests/test_document.py`

### Task B1: DAG types in `types.ts`

**Files:**
- Modify: `src/types.ts:249,277-294,388-449`
- Test: `src/state.dag.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/state.dag.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { linearizeReduce, dagFromLinear } from "./state";
import type { ReduceStepNode } from "./types";

describe("reduce DAG adapters", () => {
  it("dagFromLinear chains inputs and sets output to the last step", () => {
    const steps = [
      { kind: "filter", conditions: [], _key: "k0" },
      { kind: "derive", column: "y", expr: "x+1", _key: "k1" },
    ] as ReduceStepNode[];
    const dag = dagFromLinear("tbl", steps);
    expect(dag.sources).toEqual([{ id: "src", tableId: "tbl" }]);
    expect(dag.steps[0].inputs).toEqual(["src"]);
    expect(dag.steps[1].inputs).toEqual([dag.steps[0].id]);
    expect(dag.output).toBe(dag.steps[1].id);
  });

  it("linearize returns steps in topo order for a straight chain", () => {
    const dag = dagFromLinear("tbl", [
      { kind: "filter", conditions: [], _key: "k0" },
      { kind: "drop", columns: [], _key: "k1" },
    ] as ReduceStepNode[]);
    expect(linearizeReduce(dag).map((s) => s.kind)).toEqual(["filter", "drop"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- state.dag`
Expected: FAIL (no `linearizeReduce` / `dagFromLinear` / `ReduceStepNode` exports).

- [ ] **Step 3: Add the DAG types**

In `src/types.ts`, replace `JoinStep` (line 249) so join no longer carries `rightTableId` (its right input becomes a DAG input):

```ts
export interface JoinStep { kind: "join"; on: string[]; how: "inner"; _key?: string }
```

After the `ReduceSpec` block (around line 294) add:

```ts
/* A reduce node carries its own id and the ids of the nodes it consumes. The
   linear pipeline is the degenerate case: each step's input is its predecessor.
   Fan-out = two steps naming one input; fan-in = a step (join) naming two. */
export type ReduceStepNode = ReduceStep & { id: string; inputs: string[] };
export interface ReduceSource { id: string; tableId: string }
export interface ReduceDag {
  sources: ReduceSource[];
  steps: ReduceStepNode[];
  /* the single node whose frame feeds collapse -> plot/stats. */
  output: string;
  /* post-collapse steps stay a LINEAR chain (no input refs); out of scope here. */
  post?: ReduceStep[];
}
```

Bump `AnalysisSpec.spec_version` (line 389) to `"2.2"` and replace its `reduce` field type and `table_id` field:

```ts
  spec_version: "2.2";
  ...
  reduce: EngineReduceDag;   // was EngineReduceSpec
  ...
  // replaces the single table_id: the DAG's root tables by pool id.
  sources?: { id: string; table_id: string }[];
```

Add the engine-facing DAG type near `EngineReduceSpec` (line 257):

```ts
/* engine wire shape: source nodes carry inline {schema, rows}; step nodes carry
   the engine step + inputs. Built by resolveEngineDag (render) / resolveSaveDag (save). */
export interface EngineReduceDag {
  nodes: ({ id: string; kind: "source"; table?: { schema: unknown; rows: unknown[] };
            table_id?: string }
        | { id: string; kind: "step"; step: EngineReduceStep; inputs: string[] })[];
  output: string;
  post?: EngineReduceStep[];
}
```

- [ ] **Step 4: Add `dagFromLinear` / `linearizeReduce` to `state.ts`**

In `src/state.ts`, add (near the other reduce helpers, around line 264):

```ts
export function dagFromLinear(tableId: string, steps: ReduceStepNode[] | ReduceStep[]): ReduceDag {
  const withIds: ReduceStepNode[] = (steps as ReduceStep[]).map((s, i) => ({
    ...s,
    id: (s as ReduceStepNode).id ?? `n${i}_${s._key ?? i}`,
    inputs: [],
  }));
  let prev = "src";
  for (const node of withIds) { node.inputs = [prev]; prev = node.id; }
  return { sources: [{ id: "src", tableId }], steps: withIds, output: prev };
}

export function linearizeReduce(dag: ReduceDag): ReduceStepNode[] {
  // topo order over inputs, source(s) first; returns the step nodes in order.
  const byId = new Map(dag.steps.map((s) => [s.id, s]));
  const indeg = new Map<string, number>();
  const kids = new Map<string, string[]>();
  const ids = new Set<string>([...dag.sources.map((s) => s.id), ...byId.keys()]);
  for (const id of ids) { indeg.set(id, 0); kids.set(id, []); }
  for (const s of dag.steps) for (const i of s.inputs) {
    indeg.set(s.id, (indeg.get(s.id) ?? 0) + 1);
    kids.get(i)!.push(s.id);
  }
  const q = [...ids].filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const c of (kids.get(id) ?? []).sort()) {
      indeg.set(c, (indeg.get(c) ?? 0) - 1);
      if (indeg.get(c) === 0) q.push(c);
    }
  }
  return order.map((id) => byId.get(id)).filter((s): s is ReduceStepNode => !!s);
}
```

Add imports for the new types at the top of `state.ts` where the other `types` imports are: `ReduceDag, ReduceStepNode, ReduceSource`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- state.dag`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/state.ts src/state.dag.test.ts
git commit -m "feat(spec): reduce DAG types + linear<->dag adapters (spec 2.2)"
```

### Task B2: `Plottable.reduce` holds a DAG

Change the internal `Plottable.reduce` from `{ steps, post }` to a `ReduceDag`. Every authoring atom and serializer that touched `reduce.steps` updates to operate on `reduce` as a DAG, defaulting to the degenerate linear chain so existing behavior is preserved.

**Files:**
- Modify: `src/state.ts` (`Plottable` interface ~158-198; `makeStep`, `insertStepAtom`, `removeStepAtom`, `addStepAtom`; `plottableFromSpec`, `buildSpec`, `specForSave`, `duplicatePlottableAtom`; `runnableSteps`/`resolveEngineSteps`/`resolveSaveSteps`)
- Test: `src/state.dag.test.ts`, existing `src/state.test.ts`

- [ ] **Step 1: Write the failing test (a fresh plottable carries a degenerate DAG; insert appends a chained node)**

Add to `src/state.dag.test.ts`:

```ts
import { createStore } from "jotai";
import { plottablesAtom, activePlottableIdAtom, insertStepAtom, activePlottableAtom } from "./state";

it("insertStep appends a node chained to its predecessor", () => {
  const store = createStore();
  // assume a helper newPlottable("tbl") that seeds a degenerate DAG:
  const p = { id: "p1", name: "A", reduce: { sources: [{ id: "src", tableId: "tbl" }],
    steps: [], output: "src", }, layers: [], /* ...other required fields... */ } as any;
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, "p1");
  store.set(insertStepAtom, { afterIndex: -1, kind: "filter" });
  const dag = store.get(activePlottableAtom)!.reduce;
  expect(dag.steps).toHaveLength(1);
  expect(dag.steps[0].inputs).toEqual(["src"]);
  expect(dag.output).toBe(dag.steps[0].id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- state.dag`
Expected: FAIL (insertStep still splices a `steps` array on a `{steps,post}` shape).

- [ ] **Step 3: Update `Plottable` + the authoring atoms**

In `src/state.ts`:

Change the `Plottable.reduce` field type to `ReduceDag`.

`makeStep` (line 1071) stays returning a `ReduceStep` (id/inputs are assigned on insert). Add a node-stamping helper:

```ts
let _nid = 0;
const nextNodeId = () => `n_${Date.now().toString(36)}_${_nid++}`;

// splice a new step so it consumes `afterId` and becomes the new output when it
// was appended at the tip; a mid-chain insert rewires the old consumer onto it.
export const insertStepAtom = atom(null,
  (get, set, arg: { afterId: string; kind: ReduceStepKind }) =>
    updateActive(get, set, (p) => {
      const node: ReduceStepNode = { ...makeStep(arg.kind), id: nextNodeId(), inputs: [arg.afterId] };
      const consumers = p.reduce.steps.filter((s) => s.inputs.includes(arg.afterId));
      const steps = p.reduce.steps.map((s) =>
        consumers.includes(s) ? { ...s, inputs: s.inputs.map((i) => i === arg.afterId ? node.id : i) } : s);
      const output = p.reduce.output === arg.afterId && consumers.length === 0
        ? node.id : p.reduce.output;
      return { ...p, reduce: { ...p.reduce, steps: [...steps, node], output } };
    }));
```

Note: `afterIndex: number` becomes `afterId: string` (the node's id). Callers in the canvas pass the clicked node id (Phase C/D). For the source, `afterId` is the source id.

`removeStepAtom` (line 1137) rewires consumers of the removed node onto its input, then drops it:

```ts
export const removeStepAtom = atom(null, (get, set, nodeId: string) =>
  updateActive(get, set, (p) => {
    const removed = p.reduce.steps.find((s) => s.id === nodeId);
    if (!removed) return p;
    const feeder = removed.inputs[0] ?? p.reduce.sources[0]?.id ?? "src";
    const steps = p.reduce.steps
      .filter((s) => s.id !== nodeId)
      .map((s) => ({ ...s, inputs: s.inputs.map((i) => i === nodeId ? feeder : i) }));
    const output = p.reduce.output === nodeId ? feeder : p.reduce.output;
    return { ...p, reduce: { ...p.reduce, steps, output } };
  }));
```

(`removeStepAtom` now takes a node id, not an index. Update the canvas caller in Phase D.)

- [ ] **Step 4: Update the serializers to go through the adapters**

`plottableFromSpec` (line 710): build the DAG from the loaded spec. A 2.2 spec carries `reduce` as an `EngineReduceDag`; adopt it into the internal `ReduceDag` (adopt each step node, keep `inputs`/`output`, map sources). Replace the `reduce:` block:

```ts
    reduce: adoptReduceDag(spec.reduce, (spec.sources ?? []).map((s) => s.id)),
```

Add `adoptReduceDag` near `adoptStep`:

```ts
function adoptReduceDag(dag: EngineReduceDag, _srcIds: string[]): ReduceDag {
  const sources: ReduceSource[] = dag.nodes
    .filter((n): n is Extract<EngineReduceDag["nodes"][number], { kind: "source" }> => n.kind === "source")
    .map((n) => ({ id: n.id, tableId: (n as { table_id?: string }).table_id ?? "" }));
  const steps: ReduceStepNode[] = dag.nodes
    .filter((n): n is Extract<EngineReduceDag["nodes"][number], { kind: "step" }> => n.kind === "step")
    .map((n) => ({ ...adoptStep(n.step), id: n.id, inputs: n.inputs }));
  return { sources, steps, output: dag.output, ...(dag.post?.length ? { post: dag.post.map(adoptStep) } : {}) };
}
```

`buildSpec` (line 866) and `specForSave` (line 940): replace their `reduce:` blocks with DAG resolvers. Add:

```ts
// render path: inline every source's rows (from the pool cache) + each join's
// right lineage is already ordinary nodes, so no special-casing remains.
export function resolveEngineDag(dag: ReduceDag, tables: Map<string, WorkspaceTable>,
                                 cache: RightCache): EngineReduceDag {
  const nodes: EngineReduceDag["nodes"] = [
    ...dag.sources.map((s) => {
      const t = tables.get(s.tableId);
      return { id: s.id, kind: "source" as const,
               table: t ? { schema: t.schema, rows: t.rows } : { schema: { columns: [] }, rows: [] } };
    }),
    ...linearizeReduce(dag).map((n) => ({
      id: n.id, kind: "step" as const, inputs: n.inputs, step: stripStepKey(n) })),
  ];
  return { nodes, output: dag.output, ...(dag.post?.length ? { post: dag.post.map(stripStepKey) } : {}) };
}

// save path: store sources by table-id reference, steps by value; no inline rows.
export function resolveSaveDag(dag: ReduceDag): EngineReduceDag {
  const nodes: EngineReduceDag["nodes"] = [
    ...dag.sources.map((s) => ({ id: s.id, kind: "source" as const, table_id: s.tableId })),
    ...linearizeReduce(dag).map((n) => ({
      id: n.id, kind: "step" as const, inputs: n.inputs, step: stripStepKey(n) })),
  ];
  return { nodes, output: dag.output, ...(dag.post?.length ? { post: dag.post.map(stripStepKey) } : {}) };
}
```

In `buildSpec`, set `reduce: resolveEngineDag(p.reduce, get-tables-map, cache)` (thread the tables map in, mirroring how `cache` is threaded). In `specForSave`, set `reduce: resolveSaveDag(p.reduce)` and drop the separate `table_id` in favor of `sources: p.reduce.sources.map((s) => ({ id: s.id, table_id: s.tableId }))`.

`duplicatePlottableAtom` (line 1017): deep-clone `reduce` with fresh node ids, remapping `inputs` and `output`:

```ts
    reduce: cloneReduceDag(src.reduce),
```

with:

```ts
function cloneReduceDag(dag: ReduceDag): ReduceDag {
  const idMap = new Map<string, string>(dag.sources.map((s) => [s.id, s.id]));
  const steps = structuredClone(dag.steps).map((s) => {
    const nid = nextNodeId(); idMap.set(s.id, nid); return { ...s, id: nid, _key: nextStepKey() };
  });
  const relinked = steps.map((s) => ({ ...s, inputs: s.inputs.map((i) => idMap.get(i) ?? i) }));
  return { sources: dag.sources.map((s) => ({ ...s })), steps: relinked,
           output: idMap.get(dag.output) ?? dag.output,
           ...(dag.post?.length ? { post: structuredClone(dag.post).map((s) => ({ ...s, _key: nextStepKey() })) } : {}) };
}
```

Retire `runnableSteps`/`resolveEngineSteps`/`resolveSaveSteps` (join no longer carries `rightTableId`; the DAG resolvers replace them). Grep for their remaining callers and route them through the DAG resolvers or delete.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- state`
Expected: PASS (state.dag plus updated state.test.ts; fix any callers the compiler flags).

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/types.ts src/state.dag.test.ts src/state.test.ts
git commit -m "feat(spec): Plottable.reduce is a DAG; serializers go through adapters"
```

### Task B3: Engine accepts a DAG request

`main.py` gains DAG handling: when a request carries `reduce` as a DAG (`{nodes, output}`), evaluate it via `evaluate_dag`/`evaluate_dag_traced` instead of folding `steps`. Keep accepting the legacy linear `steps` list by wrapping it with `linear_to_dag` at the boundary, so old tests and any not-yet-migrated caller still work.

**Files:**
- Modify: `engine/iris_engine/main.py` (`ReduceRequest`, `ShapeCountsRequest`, `reduce_preview`, `shape_counts`, the analyze/render entry)
- Test: `engine/tests/test_main.py` (add DAG-request cases)

- [ ] **Step 1: Write the failing test**

Add to `engine/tests/test_main.py`:

```python
def test_reduce_accepts_a_dag_request(client):
    table = {"schema": {"columns": [{"name": "v", "type": "numeric"}]},
             "rows": [{"v": 1}, {"v": 5}]}
    dag = {"nodes": [
        {"id": "src", "kind": "source", "table": table},
        {"id": "s0", "kind": "step", "inputs": ["src"],
         "step": {"kind": "filter", "conditions": [{"column": "v", "op": ">", "value": 2}]}}],
        "output": "s0"}
    r = client.post("/reduce", json={"reduce": dag})
    assert r.status_code == 200
    assert r.json()["n_total"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_main.py::test_reduce_accepts_a_dag_request -q`
Expected: FAIL (ReduceRequest has no `reduce` field; 422 or KeyError).

- [ ] **Step 3: Add a `reduce` DAG field and branch on it**

In `ReduceRequest` (main.py:96) add:

```python
    reduce: dict | None = None          # a reduce DAG {nodes, output}; when present,
                                        # supersedes `table`+`steps` (which stay for
                                        # the legacy linear callers).
```

In `reduce_preview` (main.py:612), branch at the top:

```python
    from . import dag as dag_mod
    if req.reduce is not None:
        d = req.reduce
    else:
        d = dag_mod.linear_to_dag(_resolve_table(req.table, req.table_token), req.steps)
    cache, order = dag_mod.evaluate_dag_traced(d)
    out_df, out_schema = cache[d["output"]]
    # ... existing hierarchy.materialize_levels / materialize_plan runs on
    #     (out_df, out_schema) exactly as before; build the trace from `order`.
```

Do the equivalent in `shape_counts` (main.py:650): build the DAG (from `req.reduce` or `linear_to_dag`), call `evaluate_dag_traced`, and report per-node counts from the cache keyed by node id instead of per-step. The guards (`pseudoreplication`, `identity_merge`, `post_aggregate_derive`, `join_leaf_key`) run on the `output` frame as they do today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && python -m pytest tests/test_main.py -q`
Expected: PASS (new DAG case + existing linear cases via the adapter).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_main.py
git commit -m "feat(engine): /reduce and /shape_counts accept a reduce DAG"
```

### Task B4: `.iris` 2.2 round-trip

**Files:**
- Modify: `engine/iris_engine/document.py:21-29,81-109`
- Test: `engine/tests/test_document.py`

- [ ] **Step 1: Write the failing test**

```python
def test_document_roundtrips_a_dag_analysis():
    from iris_engine.document import save_document, load_document
    analyses = [{"spec_version": "2.2", "id": "p1", "title": "A",
        "reduce": {"nodes": [
            {"id": "src", "kind": "source", "table_id": "main"},
            {"id": "n0", "kind": "step", "inputs": ["src"],
             "step": {"kind": "filter", "conditions": []}}], "output": "n0"},
        "sources": [{"id": "src", "table_id": "main"}]}]
    tables = {"main": {"schema": {"columns": [{"name": "v", "type": "numeric"}]},
                       "hierarchy": {"spine": [], "fn": {}}, "rows": [{"v": 1}]}}
    blob = save_document(tables, analyses, {}, {})
    doc = load_document(blob)
    assert doc["analyses"][0]["reduce"]["output"] == "n0"
    assert doc["manifest"]["format_version"] == "2.2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_document.py::test_document_roundtrips_a_dag_analysis -q`
Expected: FAIL (`FORMAT_VERSION` is "2.1").

- [ ] **Step 3: Bump the format version**

In `engine/iris_engine/document.py`: set `FORMAT_VERSION = "2.2"` (line 29); add a short 2.2 note to the version history comment (line 21-28): "2.2: reduce is a DAG (nodes+output, per-node inputs); analysis carries `sources` (root tables by id); join no longer carries an inline right sub-pipeline." The load guard (`if ver < _version_tuple("2.1")`) stays; analyses are stored/read as opaque JSON dicts, so the DAG rides through unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_document.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/document.py engine/tests/test_document.py
git commit -m "feat(engine): .iris format 2.2 (reduce DAG + sources)"
```

---

## Phase C — buildGraph reads adjacency

`buildGraph` (`src/explorer/graph.ts:196-316`) stops threading a single `prev` cursor and instead walks the DAG's `sources` + `steps` adjacency. Source nodes become source `ExplorerNode`s; each step node emits edges from its `inputs`; a join emits two converging edges from real nodes (no synthetic `source:i`). The collapse chain, geom edges, and post chain are still synthesized downstream of `output` and are unchanged.

**Files:**
- Modify: `src/explorer/graph.ts:196-316`
- Test: `src/explorer/graph.test.ts` (create or extend)

### Task C1: Adjacency-driven source + step nodes

- [ ] **Step 1: Write the failing test**

Add to `src/explorer/graph.test.ts`:

```ts
import { buildGraph } from "./graph";
import type { ReduceDag } from "../types";

it("emits one edge per input; a fan-out node has two outgoing edges", () => {
  const dag: ReduceDag = {
    sources: [{ id: "src", tableId: "t" }],
    steps: [
      { kind: "derive", column: "hi", expr: "v+1", id: "hi", inputs: ["src"] },
      { kind: "derive", column: "lo", expr: "v-1", id: "lo", inputs: ["src"] },
    ] as any,
    output: "hi",
  };
  const g = buildGraph(dag, [], [], [], null, null);
  const fromSrc = g.edges.filter((e) => e.fromId === "src");
  expect(fromSrc).toHaveLength(2);       // fan-out: src -> hi, src -> lo
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- explorer/graph`
Expected: FAIL (`buildGraph`'s first arg is still `steps: ReduceStep[]`).

- [ ] **Step 3: Change `buildGraph`'s signature and reduce-node loop**

Replace the `steps` parameter (line 196-204) with `dag: ReduceDag`; replace the reduce-node loop (line 211-237) with an adjacency walk:

```ts
  const nodes: ExplorerNode[] = dag.sources.map((s, i) => ({
    id: s.id, kind: "table", phase: "source", stepIndex: i === 0 ? -1 : undefined,
    label: i === 0 ? "Source" : `Source ${i + 1}`, table: { via: "at_step", at_step: -1 },
  }));
  const edges: Edge[] = [];
  for (const node of linearize(dag)) {   // topo order (share the state.ts algorithm)
    const id = node.id;
    nodes.push({ id, kind: "table", phase: "reduce", stepIndex: undefined,
      label: STEP_NODE_LABEL[node.kind] ?? node.kind, table: { via: "at_step", at_step: -1 } });
    node.inputs.forEach((fromId) => edges.push({
      id: `e:${fromId}->${id}`, kind: node.kind,
      label: stepEdgeLabel(node, schema), fromId, toId: id }));
  }
  const rawNodeId = dag.output;          // the DAG sink feeds the collapse chain
```

Everything from the collapse chain onward (`let cprev = rawNodeId; ...`) stays as-is: it reads `rawNodeId` (now `dag.output`) exactly as before. Keep a local `linearize(dag)` (topo order) or import the one added in Task B1.

Note: the synthetic `source:i` join-input branch (old lines 217-230) is deleted; a join's second input is now a real node already in the walk.

- [ ] **Step 4: Update every `buildGraph` caller**

Grep `buildGraph(` across `src/`; update the call site (the `explorerGraphAtom`) to pass `p.reduce` (the DAG) instead of `p.reduce.steps`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- explorer/graph state`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts src/state.ts
git commit -m "feat(explorer): buildGraph walks DAG adjacency (fan-out/fan-in)"
```

---

## Phase D — Canvas: connect, branch, merge, delete-rewire

Enable authoring the DAG on the canvas: `onConnect` to wire nodes, the existing `+` to branch (create a second consumer), a merge gesture (drag a second edge into a step / fill a join's open input), and deletion that rewires consumers onto the deleted node's input.

**Files:**
- Modify: `src/workbench/WorkbenchCanvas.tsx` (add `onConnect`, `isValidConnection`, update delete + `+` dispatch), `src/workbench/ArrayShapeRFNode.tsx` (make handles connectable), `src/state.ts` (a `connectInputAtom`)
- Test: `src/workbench/WorkbenchCanvas.test.tsx`, `src/state.dag.test.ts`

### Task D1: `connectInputAtom` — wire one node's input to another

- [ ] **Step 1: Write the failing test**

Add to `src/state.dag.test.ts`:

```ts
import { connectInputAtom } from "./state";

it("connectInput sets a step's input to the dragged-from node", () => {
  const store = createStore();
  const p = { id: "p1", name: "A", layers: [],
    reduce: { sources: [{ id: "src", tableId: "t" }],
      steps: [{ kind: "join", on: [], how: "inner", id: "j", inputs: ["src"], _key: "k" }],
      output: "j" } } as any;
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, "p1");
  store.set(connectInputAtom, { targetId: "j", sourceId: "other", slot: 1 });
  expect(store.get(activePlottableAtom)!.reduce.steps[0].inputs).toEqual(["src", "other"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- state.dag`
Expected: FAIL (no `connectInputAtom`).

- [ ] **Step 3: Implement `connectInputAtom`**

In `src/state.ts`:

```ts
// wire a node's `slot`-th input to `sourceId` (a connect gesture). Rejects a
// self/cyclic wire by checking sourceId is not downstream of targetId.
export const connectInputAtom = atom(null,
  (get, set, arg: { targetId: string; sourceId: string; slot: number }) =>
    updateActive(get, set, (p) => {
      if (arg.sourceId === arg.targetId) return p;
      if (reaches(p.reduce, arg.targetId, arg.sourceId)) return p;  // would form a cycle
      const steps = p.reduce.steps.map((s) => {
        if (s.id !== arg.targetId) return s;
        const inputs = [...s.inputs];
        inputs[arg.slot] = arg.sourceId;
        return { ...s, inputs };
      });
      return { ...p, reduce: { ...p.reduce, steps } };
    }));

// does `from` reach `to` following inputs upward? Used to reject cyclic connects.
function reaches(dag: ReduceDag, from: string, to: string): boolean {
  const byId = new Map(dag.steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const i of byId.get(id)?.inputs ?? []) stack.push(i);
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- state.dag`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.dag.test.ts
git commit -m "feat(workbench): connectInputAtom wires a node input (cycle-guarded)"
```

### Task D2: Wire `onConnect` + connectable handles on the canvas

- [ ] **Step 1: Write the failing test**

Add to `src/workbench/WorkbenchCanvas.test.tsx` (the reducer is pure and unit-testable; RF connect events do not fire under jsdom, so test the handler delegate):

```ts
import { onConnectDelegate } from "./WorkbenchCanvas";

it("onConnectDelegate maps a React Flow connection to a connectInput arg", () => {
  const arg = onConnectDelegate(
    { source: "a", target: "j", targetHandle: "in-1" },
    (id) => (id === "j" ? { kind: "join" } as any : { kind: "filter" } as any));
  expect(arg).toEqual({ targetId: "j", sourceId: "a", slot: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- WorkbenchCanvas`
Expected: FAIL (no `onConnectDelegate`).

- [ ] **Step 3: Add the delegate + wire it in**

In `src/workbench/WorkbenchCanvas.tsx`, add the pure delegate near `applyNudge`:

```ts
/* Map a React Flow Connection to a connectInput arg. The target handle id encodes
   the input slot ("in" = slot 0, "in-1" = slot 1 for a join's right input). */
export function onConnectDelegate(
  conn: { source: string | null; target: string | null; targetHandle?: string | null },
  _nodeKind: (id: string) => { kind: string } | undefined,
): { targetId: string; sourceId: string; slot: number } | null {
  if (!conn.source || !conn.target) return null;
  const slot = conn.targetHandle === "in-1" ? 1 : 0;
  return { targetId: conn.target, sourceId: conn.source, slot };
}
```

Wire it in the `<ReactFlow>` (line 312): add `onConnect={(c) => { const a = onConnectDelegate(c, kindOf); if (a) connectInput(a); }}` where `connectInput = useSetAtom(connectInputAtom)`. Add `isValidConnection` that rejects a wire whose result would cycle (reuse the `reaches` guard by round-tripping through the atom, or return true and let the atom reject: the atom is the source of truth).

- [ ] **Step 4: Make handles connectable in `ArrayShapeRFNode.tsx`**

Remove the `opacity: 0` / `pointerEvents` suppression so the source (`out`) and target (`in`) handles accept drags; for a join node render a second target handle `id="in-1"` (the right input), visible when the join's second input is unfilled (`missing`). Keep the `+` click behavior on the `out` handle for branch (Task D3) by distinguishing click (menu) from drag (connect) with React Flow's connection state.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- WorkbenchCanvas && npx tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/workbench/WorkbenchCanvas.tsx src/workbench/ArrayShapeRFNode.tsx
git commit -m "feat(workbench): onConnect wires DAG inputs; join right-handle"
```

### Task D3: Branch via `+`, and delete-by-id rewiring

The `+` menu already splices a step; change it to pass the clicked node's id as `afterId` so a `+` from an already-consumed node creates a *second* consumer (fan-out). Update deletion to call `removeStepAtom(nodeId)` (Phase B changed it to take an id) and remove the `stepIndex`-based `deletableStep`.

**Files:**
- Modify: `src/workbench/WorkbenchCanvas.tsx:172-201,236-239`, `src/workbench/authoring.ts`, `src/workbench/ArrayShapeRFNode.tsx` (the `+` dispatch)
- Test: `src/workbench/authoring.test.ts`, `src/workbench/WorkbenchCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/workbench/authoring.test.ts`:

```ts
it("insert dispatch carries the clicked node id as afterId", () => {
  const arg = authorInsertArg({ nodeId: "n0", kind: "filter" });
  expect(arg).toEqual({ afterId: "n0", kind: "filter" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- workbench/authoring`
Expected: FAIL (`authorInsertArg` / afterId not present).

- [ ] **Step 3: Thread node ids through authoring**

In `src/workbench/authoring.ts`, change the insert dispatch to build `{ afterId, kind }` from the clicked node's id (the `RFNodeData` gains `nodeId`; source is the source node id). In `ArrayShapeRFNode.tsx`, pass `node.id` into the `+` menu dispatch. In `WorkbenchCanvas.tsx`, change `deletableStep`/`removeStep` to operate on `n.id` (a node is deletable when its phase is `reduce`), and the Delete/Backspace handler to call `removeStep(sel.id)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- workbench`
Expected: PASS.

- [ ] **Step 5: Manual smoke (documented, not automated)**

Run the app (`npm run tauri dev` or the web dev server), open the workbench on a table, and verify: (a) `+` from the source twice creates two branches; (b) dragging one branch's output onto a join's right handle fills it; (c) deleting a mid-chain node reconnects its consumer to its input; (d) the plot still renders from `output`.

- [ ] **Step 6: Commit**

```bash
git add src/workbench/authoring.ts src/workbench/ArrayShapeRFNode.tsx src/workbench/WorkbenchCanvas.tsx src/workbench/authoring.test.ts
git commit -m "feat(workbench): branch via + and delete-by-id rewiring"
```

---

## Phase E — Dissolve the join sub-pipeline; regenerate §4 fixtures

The engine's inline-right materialization (`_apply_join` lines 294-312) and the `_apply_join` inline path are no longer reachable once every caller sends a DAG (a join's right lineage is ordinary DAG nodes). Remove the inline-right handling, delete the now-dead fold callers, and regenerate the COV2D §4 `.iris` from the DAG path, verifying the committed r/p.

**Files:**
- Modify: `engine/iris_engine/reduce.py` (drop inline-right from `_apply_join` and `project_schema`), remove dead fold entry points if fully unreferenced
- Regenerate (data repo, private): `reports/COV2D/verify_s4.py` output
- Test: `engine/tests/test_reduce.py`, `engine/tests/test_dag.py`

### Task E1: Remove the inline-right join path

- [ ] **Step 1: Confirm no caller sends an inline `right` block**

Run: `cd engine && grep -rn '"right"' iris_engine/ ; grep -rn "step.right\|\.get(\"right\")" iris_engine/`
Expected: only `_apply_join` / `project_schema` reference it; no request builder still emits it (the frontend now sends `sources` + join-as-2-input). If a caller remains, migrate it before deleting.

- [ ] **Step 2: Delete the inline-right handling**

In `_apply_join` (reduce.py:280): remove the `right_rows`/`right_steps`/`right_plan` block (lines 289-312) and the `_apply_join` two-input inline form entirely; the join is now only reached through `evaluate_dag` -> `_join_frames`. If `_apply_step` still dispatches `"join"` to `_apply_join`, make that dispatch raise `ReduceError("join is a two-input DAG node; not valid in a linear fold")` so a stray linear join fails loudly rather than silently. In `project_schema` (reduce.py:498-510) drop the `rblock`/`rsteps` right-projection; a DAG join's columns are projected by the evaluator, not here.

- [ ] **Step 3: Update tests**

Any `test_reduce.py` case that exercised an inline-right join moves to `test_dag.py` as a two-node-join case (build a small DAG with a source for each side + a join node, assert the merged columns). Delete the linear inline-right assertions.

- [ ] **Step 4: Run the engine suite**

Run: `cd engine && python -m pytest -q`
Expected: PASS (the 482-green suite, minus the migrated join tests, plus the DAG join tests).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/reduce.py engine/tests/
git commit -m "refactor(engine): dissolve the inline-right join into DAG nodes"
```

### Task E2: Regenerate and verify the COV2D §4 `.iris`

- [ ] **Step 1: Rebuild the §4 files from the DAG path**

In the data repo, run `reports/COV2D/verify_s4.py` (it assembles the per-cell features and writes the four §4 correlation `.iris`). Update its assembly to emit the DAG spec (2.2): the N-way feature join becomes join nodes over per-feature source branches; the `opp` pivot and `het` derive are ordinary nodes.

- [ ] **Step 2: Verify the committed r/p reproduce**

Run: `python reports/COV2D/verify_s4.py`
Expected output (the acceptance check that the dissolution is correct): crowding_q r=-0.174 p=0.049, crowding_speed r=-0.122 p=0.008, het_q r=-0.088 p=0.396, het_speed r=-0.024 p=0.631.

- [ ] **Step 3: Commit (data repo)**

```bash
git add reports/COV2D/verify_s4.py reports/COV2D/*.iris
git commit -m "chore(cov2d): regenerate §4 .iris on the reduce DAG (2.2); r/p unchanged"
```

### Task E3: Update the TODO and design doc status

- [ ] **Step 1: Mark the feature landed**

In `TODO.md`, replace the "Transformation workbench: post-pipeline steps not authorable" and "multiple edges" discussion with a one-line "shipped" note pointing at this plan and the design doc; post-step authoring is now a branch of the DAG and no longer a separate tracked gap (confirm the post phase still round-trips).

- [ ] **Step 2: Commit**

```bash
git add TODO.md docs/superpowers/specs/2026-07-12-reduce-dag-fanout-fanin-design.md
git commit -m "docs: reduce DAG (fan-out/fan-in) shipped"
```

---

## Not in this plan (separate track)

The plot multi-layer render bug (raw individual + aggregate, same lineage, different grains, authorable via `addLayerAtom` but reportedly not rendering as two `geom` edges) is a `systematic-debugging` hunt, filed separately. Do not fold it into these tasks.

## Self-review notes

- **Spec coverage:** spec sections map to phases — DAG spec 2.2 (B), topological evaluation (A), join dissolution (E), buildGraph adjacency (C), canvas connect/branch/merge/delete (D), migration/fixtures (E), out-of-scope items restated above.
- **Ordering:** A is independent (adapter keeps the fold green); B depends on A; C depends on B's types; D depends on B+C; E depends on all (removes the transition scaffolding). Execute in order.
- **Type consistency:** `ReduceDag`/`ReduceStepNode`/`ReduceSource`/`EngineReduceDag` (types.ts, Task B1) are used identically in state.ts (B2), graph.ts (C1), and the atoms (D1-D3); `evaluate_dag`/`evaluate_dag_traced`/`topo_order`/`DagError`/`linear_to_dag`/`_join_frames` (dag.py, reduce.py) are used identically in main.py (B3) and the tests. `removeStepAtom` and `insertStepAtom` change signature (index -> id / afterId) in B2 and every caller updates in D3.
