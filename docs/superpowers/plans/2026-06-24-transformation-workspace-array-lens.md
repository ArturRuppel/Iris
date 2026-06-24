# Transformation Workspace — Array-Shape Lens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the transformation-explorer graph as a labeled N-d array — nodes show their axes (identifier columns + level counts) and values (measured columns, coloured by type, tagged with their data-inferred grain), edges read as array operations — in a dedicated full-screen workspace.

**Architecture:** The array is a *display lens* over the existing pandas-long pipeline; `reduce.py` is untouched. The engine gains a per-node **array-shape descriptor** (`describe_shape`) computed from each already-materialized node frame and surfaced through `/shape_counts`, plus one new warn-only **join-key guard**. The frontend consumes the descriptor to relabel edges, restructure the graph into a DAG, and render the workspace.

**Tech Stack:** Python 3.13 + pandas + FastAPI + pytest (engine); TypeScript + React + Jotai + vitest/RTL (frontend).

**Spec:** `docs/superpowers/specs/2026-06-24-transformation-workspace-array-lens-design.md`

---

## Phasing (read first)

This plan is delivered in three phases. **Phase 1 is fully detailed below.** Phases 2
and 3 are roadmapped at the end and get their own full plans once Phase 1 lands —
they depend on Phase 1's descriptor being live.

- **Phase 1 — Engine foundation (this document).** `describe_shape` (axes + values +
  grain inference), wired into `/shape_counts`; the warn-only join-key guard.
  Ships: the API returns the descriptor and the guard fires. Testable with pytest
  alone, no UI.
- **Phase 2 — Frontend graph model.** `graph.ts` array-op edge labels, binary-join
  full-branch DAG topology, per-grain geom edges; `graphAtom.ts` consumes the
  descriptor and merges the join-key guard. Testable via `graph.test.ts` (vitest).
- **Phase 3 — Workspace rendering.** The node readout (axis/value chips, colour-by-
  type, grain tags, collapse strike-out, grain tint), the full-screen workspace
  layout, canned-schematic hovers, CSS.

Each phase leaves the app working: after Phase 1 the descriptor is available but
unused by the UI; after Phase 2 edge labels/topology improve in the existing
component; Phase 3 delivers the workspace.

---

## Phase 1 — Engine foundation

### File structure

- **Create** `engine/iris_engine/shape.py` — pure descriptor functions:
  `describe_shape(frame, schema, spine)` returning `{axes, values}`, plus helpers
  `_axis_is_ragged` and `value_grain`. One responsibility: turn a materialized
  `(frame, schema, spine)` into the array-shape descriptor. No FastAPI, no I/O.
- **Create** `engine/tests/test_shape_descriptor.py` — unit tests for `shape.py`.
- **Modify** `engine/iris_engine/hierarchy.py` — add `join_leaf_key(frame, schema,
  spine, steps)` returning a list of warn verdicts (lives with the other
  reduce/collapse guards `/shape_counts` surfaces).
- **Create** `engine/tests/test_guards_join_key.py` — unit tests for the guard.
- **Modify** `engine/iris_engine/main.py` (`/shape_counts`, ~lines 550-615) — call
  `describe_shape` per node, merge `axes`/`values` into each node's count object;
  add `join_leaf_key` to the `guards` block.
- **Modify** `engine/tests/test_shape_counts.py` — assert the descriptor + guard in
  the endpoint response.

### Data shapes (used across tasks)

The descriptor for one node:

```python
{
  "rows": 1240, "cols": 5,
  "axes":   [{"name": "experiment", "n_levels": 3, "ragged": False},
             {"name": "cell",       "n_levels": 122, "ragged": False},
             {"name": "frame",      "n_levels": 1830, "ragged": True}],
  "values": [{"name": "speed", "type": "numeric", "grain": None},
             {"name": "class", "type": "categorical", "grain": "cell"}],
}
```

- `axes` — identifier columns present in the frame, **in spine order**.
- `ragged` — the axis's level-count-per-parent-group is non-constant.
- `value.grain` — deepest axis of the coarsest spine prefix on which the value is
  constant within group; `None` when it only becomes constant at the row grain.

---

### Task 1: `value_grain` — the coarsest-constant prefix

**Files:**
- Create: `engine/iris_engine/shape.py`
- Test: `engine/tests/test_shape_descriptor.py`

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_shape_descriptor.py
import pandas as pd
from iris_engine.shape import value_grain

# spine coarsest -> finest
SPINE = ["experiment", "position", "cell", "frame"]

def _frame():
    # 1 experiment, 2 cells, 2 frames each; class is constant within a cell,
    # speed varies per frame, treatment is constant everywhere.
    return pd.DataFrame({
        "experiment": ["E1"] * 4,
        "position":   ["P1"] * 4,
        "cell":       ["c1", "c1", "c2", "c2"],
        "frame":      [1, 2, 1, 2],
        "speed":      [2.1, 1.8, 3.4, 2.9],
        "class":      ["div", "div", "non", "non"],
        "treatment":  ["A", "A", "A", "A"],
    })

def test_value_grain_per_cell_value_tags_cell():
    assert value_grain(_frame(), SPINE, "class") == "cell"

def test_value_grain_per_frame_value_is_none():
    # speed varies frame-to-frame -> only constant at the row grain -> no tag
    assert value_grain(_frame(), SPINE, "speed") is None

def test_value_grain_global_constant_tags_coarsest():
    # constant everywhere -> constant within the coarsest group -> coarsest axis
    assert value_grain(_frame(), SPINE, "treatment") == "experiment"

def test_value_grain_ignores_spine_columns_absent_from_frame():
    df = _frame().drop(columns=["position"])
    assert value_grain(df, SPINE, "class") == "cell"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && python -m pytest tests/test_shape_descriptor.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'iris_engine.shape'`.

- [ ] **Step 3: Write the minimal implementation**

```python
# engine/iris_engine/shape.py
"""Array-shape descriptor for a materialized node frame (display lens only).

A tidy frame is the COO encoding of a labeled array: identifier columns are AXES,
measured columns are VALUES. These functions read that shape off a frame the engine
has already materialized — no change to how reductions compute. Pandas-only.
"""
from __future__ import annotations

import pandas as pd

_META = ("id", "row_ids")


def _present_spine(frame: pd.DataFrame, spine: list[str]) -> list[str]:
    """Spine columns actually in this frame, in spine (coarsest->finest) order."""
    return [s for s in spine if s in frame.columns]


def value_grain(frame: pd.DataFrame, spine: list[str], value: str) -> str | None:
    """Coarsest spine prefix on which `value` is constant within every group.

    Walk prefixes coarsest->finest; the native grain is the deepest axis of the
    first (shallowest) prefix where the value is constant within each group.
    Returns None when the value only becomes constant at the row grain — i.e. once
    a prefix already separates every row, constancy there is trivial (each group is
    a singleton), so there is no meaningful coarser grain to tag.
    """
    present = _present_spine(frame, spine)
    n = len(frame)
    for i in range(len(present)):
        prefix = present[: i + 1]
        g = frame.groupby(prefix, observed=True)
        if g.ngroups >= n:
            # this prefix fully separates rows and no coarser prefix was constant:
            # the value lives at the row grain -> no tag.
            return None
        if g[value].nunique(dropna=False).max() <= 1:
            return present[i]
    return None
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd engine && python -m pytest tests/test_shape_descriptor.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/shape.py engine/tests/test_shape_descriptor.py
git commit -m "feat(engine): value_grain — coarsest-constant spine prefix for a value"
```

---

### Task 2: `_axis_is_ragged` — uneven nesting detection

**Files:**
- Modify: `engine/iris_engine/shape.py`
- Test: `engine/tests/test_shape_descriptor.py`

- [ ] **Step 1: Write the failing test**

```python
# add to engine/tests/test_shape_descriptor.py
from iris_engine.shape import _axis_is_ragged

def test_axis_ragged_when_child_count_varies_per_parent():
    # c1 has 3 frames, c2 has 1 -> frame is ragged within cell
    df = pd.DataFrame({
        "experiment": ["E1"] * 4,
        "position":   ["P1"] * 4,
        "cell":       ["c1", "c1", "c1", "c2"],
        "frame":      [1, 2, 3, 1],
    })
    spine = ["experiment", "position", "cell", "frame"]
    assert _axis_is_ragged(df, spine, 3) is True   # frame
    assert _axis_is_ragged(df, spine, 0) is False  # experiment (coarsest)

def test_axis_not_ragged_when_balanced():
    df = pd.DataFrame({
        "experiment": ["E1"] * 4,
        "cell":       ["c1", "c1", "c2", "c2"],
        "frame":      [1, 2, 1, 2],
    })
    spine = ["experiment", "cell", "frame"]
    assert _axis_is_ragged(df, spine, 2) is False  # 2 frames per cell, balanced
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && python -m pytest tests/test_shape_descriptor.py::test_axis_ragged_when_child_count_varies_per_parent -q`
Expected: FAIL — `ImportError: cannot import name '_axis_is_ragged'`.

- [ ] **Step 3: Write the minimal implementation**

```python
# add to engine/iris_engine/shape.py
def _axis_is_ragged(frame: pd.DataFrame, spine: list[str], idx: int) -> bool:
    """True when axis `present[idx]` has an uneven number of child levels across
    its parent groups (the COO array is ragged on this axis). The coarsest axis
    (no parent) is never ragged."""
    present = _present_spine(frame, spine)
    axis = present[idx]
    parent = present[:idx]
    if not parent:
        return False
    counts = frame.groupby(parent, observed=True)[axis].nunique()
    return bool(len(counts) and counts.min() != counts.max())
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd engine && python -m pytest tests/test_shape_descriptor.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/shape.py engine/tests/test_shape_descriptor.py
git commit -m "feat(engine): _axis_is_ragged — uneven-nesting detection per axis"
```

---

### Task 3: `describe_shape` — assemble the descriptor

**Files:**
- Modify: `engine/iris_engine/shape.py`
- Test: `engine/tests/test_shape_descriptor.py`

- [ ] **Step 1: Write the failing test**

```python
# add to engine/tests/test_shape_descriptor.py
from iris_engine.shape import describe_shape

SCHEMA = {"columns": [
    {"name": "experiment", "type": "identifier"},
    {"name": "position",   "type": "identifier"},
    {"name": "cell",       "type": "identifier"},
    {"name": "frame",      "type": "identifier"},
    {"name": "speed",      "type": "numeric"},
    {"name": "class",      "type": "categorical"},
]}

def test_describe_shape_axes_in_spine_order_with_levels():
    out = describe_shape(_frame(), SCHEMA, SPINE)
    assert [a["name"] for a in out["axes"]] == ["experiment", "position", "cell", "frame"]
    cell = next(a for a in out["axes"] if a["name"] == "cell")
    assert cell["n_levels"] == 2 and cell["ragged"] is False

def test_describe_shape_values_carry_type_and_grain():
    out = describe_shape(_frame(), SCHEMA, SPINE)
    vals = {v["name"]: v for v in out["values"]}
    assert vals["speed"]["type"] == "numeric" and vals["speed"]["grain"] is None
    assert vals["class"]["type"] == "categorical" and vals["class"]["grain"] == "cell"

def test_describe_shape_excludes_meta_columns():
    df = _frame().assign(id=["1", "2", "3", "4"], row_ids=[[1]] * 4)
    out = describe_shape(df, SCHEMA, SPINE)
    names = {v["name"] for v in out["values"]}
    assert "id" not in names and "row_ids" not in names

def test_describe_shape_unknown_value_type_defaults_numeric():
    df = _frame().assign(extra=[1.0, 2.0, 3.0, 4.0])  # not in SCHEMA
    out = describe_shape(df, SCHEMA, SPINE)
    extra = next(v for v in out["values"] if v["name"] == "extra")
    assert extra["type"] == "numeric"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && python -m pytest tests/test_shape_descriptor.py -k describe_shape -q`
Expected: FAIL — `ImportError: cannot import name 'describe_shape'`.

- [ ] **Step 3: Write the minimal implementation**

```python
# add to engine/iris_engine/shape.py
def _coltype(schema: dict, name: str) -> str:
    for c in schema.get("columns", []):
        if c["name"] == name:
            return c.get("type", "numeric")
    return "numeric"   # conservative default, mirrors reduce._apply_derive


def describe_shape(frame: pd.DataFrame, schema: dict, spine: list[str]) -> dict:
    """The array-shape descriptor for one materialized node frame:
    {axes:[{name,n_levels,ragged}], values:[{name,type,grain}]}.
    Axes are the spine identifier columns present, in spine order; values are the
    remaining (non-meta) columns."""
    present = _present_spine(frame, spine)
    axes = [
        {"name": a,
         "n_levels": int(frame[a].nunique(dropna=False)),
         "ragged": _axis_is_ragged(frame, spine, i)}
        for i, a in enumerate(present)
    ]
    axis_names = set(present)
    values = [
        {"name": c, "type": _coltype(schema, c), "grain": value_grain(frame, spine, c)}
        for c in frame.columns
        if c not in axis_names and c not in _META
    ]
    return {"axes": axes, "values": values}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd engine && python -m pytest tests/test_shape_descriptor.py -q`
Expected: PASS (10 passed).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/shape.py engine/tests/test_shape_descriptor.py
git commit -m "feat(engine): describe_shape — per-node axes+values array descriptor"
```

---

### Task 4: `join_leaf_key` guard — warn on a non-unique leaf join key

**Files:**
- Modify: `engine/iris_engine/hierarchy.py` (add function near the other reduce
  guards: `identity_merge`, `post_aggregate_derive`)
- Test: `engine/tests/test_guards_join_key.py`

**Behaviour:** for each `join` step, look at its `on` keys. If the deepest `on` key
is a spine identifier whose ancestors in the spine are NOT all included in `on`, and
that key's value recurs across different ancestor groups (so it isn't unique on its
own), emit a warn verdict suggesting the full path. Never blocks.

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_guards_join_key.py
import pandas as pd
from iris_engine.hierarchy import join_leaf_key

SPINE = ["experiment", "position", "cell", "frame"]
SCHEMA = {"columns": [{"name": n, "type": "identifier"}
                      for n in SPINE]}

def _left():
    # cell ids c1/c2 recur across BOTH positions -> 'cell' alone is not unique
    return pd.DataFrame({
        "experiment": ["E1"] * 4,
        "position":   ["P1", "P1", "P2", "P2"],
        "cell":       ["c1", "c2", "c1", "c2"],
        "frame":      [1, 1, 1, 1],
    })

def test_warns_when_joining_on_bare_leaf():
    steps = [{"kind": "join", "on": ["cell"], "right": {}}]
    out = join_leaf_key(_left(), SCHEMA, SPINE, steps)
    assert len(out) == 1
    assert out[0]["severity"] == "caution"
    assert "experiment" in out[0]["text"] and "position" in out[0]["text"]

def test_no_warn_when_full_path_supplied():
    steps = [{"kind": "join", "on": ["experiment", "position", "cell"], "right": {}}]
    assert join_leaf_key(_left(), SCHEMA, SPINE, steps) == []

def test_no_warn_when_leaf_is_globally_unique():
    df = _left().assign(cell=["c1", "c2", "c3", "c4"])  # cell now unique on its own
    steps = [{"kind": "join", "on": ["cell"], "right": {}}]
    assert join_leaf_key(df, SCHEMA, SPINE, steps) == []

def test_ignores_non_join_steps():
    steps = [{"kind": "filter", "conditions": []}]
    assert join_leaf_key(_left(), SCHEMA, SPINE, steps) == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && python -m pytest tests/test_guards_join_key.py -q`
Expected: FAIL — `ImportError: cannot import name 'join_leaf_key'`.

- [ ] **Step 3: Write the minimal implementation**

```python
# add to engine/iris_engine/hierarchy.py (near identity_merge / post_aggregate_derive)
def join_leaf_key(df, schema, spine, steps) -> list[dict]:
    """Warn (never block) when a `join` keys on a leaf identifier without its spine
    ancestors and that leaf isn't unique on its own — the merge may mismatch units.
    Returns [{dim, on, suggested, before, after, severity, text}] per offending join."""
    ids = {c["name"] for c in schema.get("columns", []) if c.get("type") == "identifier"}
    present = [s for s in spine if s in df.columns]
    out: list[dict] = []
    for step in (steps or []):
        if step.get("kind") != "join":
            continue
        on = list(step.get("on") or [])
        # the deepest spine identifier among the join keys
        leaves = [k for k in on if k in ids and k in present]
        if not leaves:
            continue
        leaf = max(leaves, key=lambda k: present.index(k))
        ancestors = present[: present.index(leaf)]
        missing = [a for a in ancestors if a not in on]
        if not missing:
            continue
        # is the leaf actually ambiguous on its own? (same value across ancestors)
        if leaf not in df.columns:
            continue
        per_leaf = df.groupby(leaf, observed=True)[missing].nunique()
        ambiguous = bool((per_leaf.max(axis=1) > 1).any())
        if not ambiguous:
            continue
        full = ", ".join(present[: present.index(leaf) + 1])
        out.append({
            "dim": leaf, "on": on, "suggested": present[: present.index(leaf) + 1],
            "before": leaf, "after": full, "severity": "caution",
            "text": (f"Joining on {leaf} alone, but {leaf} isn't unique without "
                     f"{', '.join(missing)} — did you mean the full path {full}?"),
        })
    return out
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd engine && python -m pytest tests/test_guards_join_key.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/hierarchy.py engine/tests/test_guards_join_key.py
git commit -m "feat(engine): join_leaf_key guard — warn on a non-unique leaf join key"
```

---

### Task 5: Surface the descriptor + guard through `/shape_counts`

**Files:**
- Modify: `engine/iris_engine/main.py` (`/shape_counts`, ~lines 550-615)
- Test: `engine/tests/test_shape_counts.py`

The endpoint already materializes each node frame for counts. Attach a descriptor to
each node's count object, and add `join_leaf_key` to the `guards` block.

- [ ] **Step 1: Write the failing test**

First read the existing `test_shape_counts.py` to reuse its request fixture/helper
(it posts to `/shape_counts` via the FastAPI `TestClient`). Add:

```python
# add to engine/tests/test_shape_counts.py — reuse the module's existing client +
# request helpers; this test assumes a body with a spine and at least one step.
def test_shape_counts_carries_array_descriptor(client):  # adapt fixture name
    body = _basic_body()  # reuse the helper already in this file
    r = client.post("/shape_counts", json=body)
    assert r.status_code == 200
    data = r.json()
    # source node gains axes + values alongside rows/cols
    assert "axes" in data["source"] and "values" in data["source"]
    assert all("n_levels" in a and "ragged" in a for a in data["source"]["axes"])
    assert all({"name", "type", "grain"} <= set(v) for v in data["source"]["values"])
    # guards block exposes the join-key guard list (possibly empty)
    assert "join_leaf_key" in data["guards"]
```

If `test_shape_counts.py` has no reusable body helper, construct a minimal body
inline mirroring `ShapeCountsRequest` (table, steps, hierarchy with a spine).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -k descriptor -q`
Expected: FAIL — `KeyError: 'axes'` (descriptor not yet attached).

- [ ] **Step 3: Write the minimal implementation**

In `main.py`, import the new module at the top with the other engine imports:

```python
from . import shape as shape_mod
```

Replace the count-only node objects with count+descriptor. The spine is already
computed as `spine` (and `present`). Update the three producers:

```python
# source node (was: out_source = {"rows":..., "cols":...})
out_source = {"rows": int(len(src)), "cols": _cols(src),
              **shape_mod.describe_shape(src, src_sch, spine)}

# per-step (inside the existing loop, replace the append)
steps_counts.append({"rows": int(len(out)), "cols": _cols(out),
                     **shape_mod.describe_shape(out, _sch, spine)})

# grains (inside the existing `for key, (gdf, _gsch) in gmats.items()` loop)
grains[key] = {"rows": int(len(gdf)), "cols": _cols(gdf),
               **shape_mod.describe_shape(gdf, _gsch, present)}
```

Note: `spine` is computed at line ~587 (`hierarchy.spine_present(...)`) but
`out_source`/`steps_counts` are built *before* it. Move the `spine =
hierarchy.spine_present(full, ...)` computation up so it is available for the source
and step descriptors (it depends only on `full`, computed at line ~584 — reorder so
`full`/`spine` precede the step loop, or compute `spine` from `df` + the request
hierarchy directly: `spine = hierarchy.spine_present(df, (req.hierarchy or {}).get("spine") or [])`).
Use the latter (compute `spine` from `df` early) to avoid reordering the materialize
block.

Add the guard to the `guards` dict initialization and population:

```python
guards = {"pseudoreplication": None, "pairing_flip": None,
          "identity_merge": [], "post_aggregate_derive": [],
          "join_leaf_key": hierarchy.join_leaf_key(full, full_sch, spine, req.steps)}
```

(Compute it unconditionally from `full` — it does not depend on a collapse plan.)

- [ ] **Step 4: Run it to verify it passes**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -q`
Expected: PASS (existing tests still pass + the new one).

- [ ] **Step 5: Run the full engine suite (no regressions)**

Run: `cd engine && python -m pytest -q`
Expected: PASS — all green. Pay attention to `test_reduce_*`, `test_guards*`,
`test_hierarchy.py`.

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_shape_counts.py
git commit -m "feat(engine): /shape_counts returns the array descriptor + join-key guard"
```

---

### Phase 1 self-check

- [ ] `describe_shape` covers axes (spec § *What a node shows*) and values with
  type + grain (§ *Value grain*).
- [ ] `value_grain` is data-inferred, no `reduce.py` change (§ *Implementation*
  tier 2; the data-dependent caveat is inherent and documented in the spec).
- [ ] **Deliberate edge-case choice:** when a value's coarsest-constant prefix
  *equals* the row identity (e.g. degenerate one-row-per-cell data), `value_grain`
  returns `None` (no tag), rather than the spec's "show @cell anyway" lean. This is
  the cleaner, less-noisy reading and is required for the non-degenerate
  `speed → None` case; not a bug.
- [ ] `join_leaf_key` is warn-only and never blocks (§ *Settled decisions*).
- [ ] Endpoint returns descriptor per node + guard; full engine suite green.

---

## Phase 2 — Frontend graph model (roadmap; full plan after Phase 1)

**Goal:** `graph.ts` produces array-op edge labels and a correct DAG; `graphAtom.ts`
consumes the descriptor and merges the join-key guard. Testable via
`src/explorer/graph.test.ts` (vitest), no rendering changes required.

**File structure:**
- Modify `src/types.ts` — extend `NodeCount`/`ShapeCounts` with `axes` + `values`
  (mirror the engine descriptor); add `join_leaf_key` to `ShapeCountsGuards`.
- Modify `src/App.tsx` (~lines 252-259) — carry `axes`/`values` through the node-id
  keyed map (the objects already key by node id; just stop discarding the new fields).
- Modify `src/explorer/graph.ts`:
  - `stepEdgeLabel` → array-op language: `filter`→`mask: <cond>`, `derive`→`<col> =
    <expr>`, `pivot`→`unstack <col> → {<names>}`, `grid_complete`→`densify <by> ×
    <col> · fill <n>`, `recode`→`relabel <col>`, `join`→`join on <on…>`.
  - Collapse edge label: replace `"collapse"` with the existing `flattenInfo` phrase
    promoted to the label (`median over <removed>`), keeping the verdict as the badge.
  - Binary join: replace the stub `source:${i}` node (`via:"none"`, label "join
    source") with a node carrying the right side's descriptor; draw the right side's
    own reduce/collapse sub-branch in full (no collapsing — § *Topology*).
  - Per-grain geom edges: stop globally de-duping geoms; emit **one edge per grain**,
    its label the comma-joined geom(s) at that grain (§ *Settled decisions* #3).
- Modify `src/explorer/graphAtom.ts` — attach `axes`/`values` to nodes (extend the
  `counts[n.id]` merge at line ~108); add a `join_leaf_key` branch in `mergeGuards`
  that appends the verdict to the matching `join` edge.

**Engine follow-on for Phase 2:** the right-input node needs its own descriptor.
Extend `/shape_counts` (or a sibling field) to describe each join step's right table
(materialized through `right.reduce`/`right.collapse` as `_apply_join` already does).
Spec this as the first task of the Phase 2 plan.

**Key tests (graph.test.ts):** edge labels read in array language; a join step yields
two parents into the join node; multiple geoms at one grain produce one comma-joined
edge; two grains produce two edges.

---

## Phase 3 — Workspace rendering (roadmap; full plan after Phase 2)

**Goal:** the dedicated full-screen workspace with array-shape nodes.

**File structure:**
- New `src/components/TransformWorkspace.tsx` — the full-screen DAG canvas
  (dot-grid, top legend, tall nodes), reusing the edge-measuring approach in
  `TransformExplorer.tsx` but laying nodes as a DAG, not a single line. Decide
  whether to evolve `TransformExplorer.tsx` in place or add a workspace surface; the
  side-panel explorer may remain as a compact view.
- New `src/components/ArrayShapeNode.tsx` — the node readout: axis chips (name +
  `n_levels`, dashed when `ragged`, struck-through when removed by the downstream
  collapse), value chips coloured by `type` (numeric/categorical/bool) with an
  `@grain` suffix when `grain != null`. RTL-testable against descriptor fixtures.
- New `src/explorer/cannedExamples.ts` — the fixed before/after rows mini-table per
  op kind (§ *Hover*); one authored example pair each, doubling as documentation.
- New `src/components/OpHoverExample.tsx` — renders a canned example on op hover.
- Modify `src/index.css` — `.tx-*` workspace/node/chip styles (axis blue, numeric
  green, categorical violet, bool amber, grain-node tint, canvas dot-grid).

**Key tests (RTL):** a node fixture with a ragged axis renders a dashed chip with its
count; a value with `grain:"cell"` renders `@cell`; a numeric value renders in the
numeric class; a collapse-removed axis renders struck-through. Canned-example hover
shows the authored before/after rows.

**Settled decisions honoured here:** flat graph (no collapsing); full node readout
on every node; one geom-annotated edge per grain; warn-only join-key badge on the
join edge.

---

## Out of scope (all phases)

- Guide chapter / gallery showcase — separate spec
  (`2026-06-24-cov2d-capability-showcase-design.md`).
- Any change to statistics, collapse semantics, or the reduce vocabulary. This is a
  rendering of the existing pipeline; the only new behaviour is the warn-only
  `join_leaf_key` guard.
