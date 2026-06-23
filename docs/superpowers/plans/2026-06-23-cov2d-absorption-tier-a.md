# COV2D Absorption — Tier A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull the COV2D report's §1–§2 shape & motility SuperPlots inside Iris's transformation graph by adding the minimal first forms of three reduce-step kinds — `derive`, `recode`, `join` (plus null-predicate `filter` ops) — and prove the absorbed graph reproduces the notebook's `paired_by_replicate` numbers to full float precision.

**Architecture:** All three new transformations are **reduce step kinds** in `engine/iris_engine/reduce.py`, folded by the existing `reduce_with_trace` over a single frame. The second source (`class_label`) rides **inside the `join` step** as an inline `{schema, rows}` table — so the linear `spec.reduce.steps` model and the single-table request shape are both preserved, `render.render` flows the new steps through untouched, and the embedded table round-trips through `.iris` save/load for free. `recode` runs **after** the inner join (a row-wise relabel is identical before or after a key-based broadcast), keeping one linear pipeline. The flatten chain, the paired-t + Hedges g stat, and the node→table preview surface already exist and are not modified. The frontend change is purely the explorer *rendering* the join as two converging source lines (no inline-editing UI — that is a deferred follow-up).

**Tech Stack:** Python 3 / pandas / pingouin / scipy / pytest (engine); TypeScript / Vitest / Vite (frontend).

**Spec:** `docs/superpowers/specs/2026-06-23-cov2d-absorption-tier-a-design.md`

**Key decisions locked in (rationale in the spec's "Architecture & data flow"):**
- **No `spec_version` bump.** The join's second source rides inside a `reduce.steps` entry, so the top-level `AnalysisSpec` shape is unchanged — only the `ReduceStep` union and `EdgeKind` union grow. (Spec says a bump is "likely … decide in the engine plan"; the embed-in-step design makes it unnecessary, and per project memory there are no users/legacy to migrate.)
- **`recode` is a dedicated reduce step**, not `ColumnDef.labels`. It must *rewrite the stored category values* (and `schema.levels`) so the column can be split/compared on — a display-only label mapping would not change what `materialize_levels`/`group_comparison` group by. (Spec offers both; this picks the step.)
- **`recode` after `join`.** The notebook recodes `class_label` on the per-cell table *then* inner-merges; because an inner join on `KEY` does not depend on the label value, recoding the broadcast per-frame column afterward yields identical rows. One linear fold instead of a sub-pipeline on the right table.

## File Structure

**Engine (modify):**
- `engine/iris_engine/reduce.py` — add null-predicate filter ops; add `derive`, `recode`, `join` step kinds + their helpers and a safe AST expression evaluator. This file owns all row/column transforms; the new kinds belong here next to `_apply_drop`/`_apply_filter`.

**Engine (create):**
- `engine/tests/test_reduce_derive.py` — `derive` step unit tests.
- `engine/tests/test_reduce_recode.py` — `recode` step unit tests.
- `engine/tests/test_reduce_join.py` — `join` step unit tests.
- `engine/tests/test_reduce_filter_null.py` — null-predicate filter unit tests.
- `engine/tests/cov2d_fixture.py` — the synthetic COV2D-shaped fixture builder + the independent `paired_by_replicate` reference reimplementation (importable by the equivalence tests; not a test module itself).
- `engine/tests/test_cov2d_tier_a.py` — the end-to-end equivalence test, the default-chain identity test, and the `.iris` round-trip test.
- `engine/validation/cases/cov2d-tier-a/data.csv` + `engine/validation/cases/cov2d-tier-a/case.py` — the shipped validation-corpus case (real `.iris`, real engine path, figure assertions).

**Frontend (modify):**
- `src/types.ts` — extend `FilterOp`, `ReduceStep` union (`DeriveStep`/`RecodeStep`/`JoinStep`), and `EdgeKind`.
- `src/explorer/graph.ts` — `buildGraph` handles the new step kinds; a `join` step emits a second source node + two converging `join` edges.
- `src/explorer/graph.test.ts` — assertions for the new edge kinds and the two-source convergence.

---

## Task 1: Null-predicate filter ops (`is-null` / `not-null`)

The notebook's `.dropna(subset=[value_col])` maps to a null-predicate `filter` (spec node table). The current `_apply_filter` has no value-less op, so add two.

**Files:**
- Modify: `engine/iris_engine/reduce.py:47-67` (`_apply_filter`)
- Test: `engine/tests/test_reduce_filter_null.py`

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_reduce_filter_null.py
"""Null-predicate filter ops — the notebook's .dropna(subset=[value])."""
import numpy as np
import pandas as pd

from iris_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "g", "type": "categorical", "label": "G", "levels": ["a", "b"]},
        {"name": "value", "type": "numeric", "label": "Value"},
    ],
}


def frame():
    return pd.DataFrame([
        {"id": "r1", "g": "a", "value": 1.0},
        {"id": "r2", "g": "a", "value": np.nan},
        {"id": "r3", "g": "b", "value": 3.0},
    ])


def test_not_null_drops_missing_rows():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        {"kind": "filter", "conditions": [{"column": "value", "op": "not-null"}]}])
    assert out["id"].tolist() == ["r1", "r3"]


def test_is_null_keeps_only_missing_rows():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        {"kind": "filter", "conditions": [{"column": "value", "op": "is-null"}]}])
    assert out["id"].tolist() == ["r2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_reduce_filter_null.py -v`
Expected: FAIL with `ReduceError: unknown filter op 'not-null'`.

- [ ] **Step 3: Add the null branch to `_apply_filter`**

In `engine/iris_engine/reduce.py`, inside the `for cond in conds:` loop in `_apply_filter`, add a branch **before** the `if op in ("in", "not-in"):` block (so it short-circuits before reading `cond["value"]`):

```python
        if op in ("is-null", "not-null"):
            m = series.isna()
            mask &= m if op == "is-null" else ~m
            continue
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_reduce_filter_null.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the existing reduce suite (no regressions)**

Run: `cd engine && python -m pytest tests/test_reduce.py tests/test_reduce_drop.py -v`
Expected: PASS (all existing reduce tests still green).

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/reduce.py engine/tests/test_reduce_filter_null.py
git commit -m "feat(reduce): null-predicate filter ops (is-null/not-null)"
```

---

## Task 2: `derive` step kind (row-wise scalar expression)

A grain-safe row-wise expression over existing columns (`log(value)`, `perimeter / sqrt(area)`). Evaluated with a small, explicit AST whitelist — no `eval`. Defers conditionals/string ops (spec).

**Files:**
- Modify: `engine/iris_engine/reduce.py` (add `import ast`, `import numpy as np`, the evaluator, `_apply_derive`, and a dispatch branch in `_apply_step:89-97`)
- Test: `engine/tests/test_reduce_derive.py`

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_reduce_derive.py
"""derive: a row-wise scalar expression over existing columns, grain-safe."""
import numpy as np
import pandas as pd
import pytest

from iris_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "perimeter", "type": "numeric", "label": "Perimeter"},
        {"name": "area", "type": "numeric", "label": "Area"},
    ],
}


def frame():
    return pd.DataFrame([
        {"id": "r1", "perimeter": 12.0, "area": 9.0},
        {"id": "r2", "perimeter": 20.0, "area": 16.0},
    ])


def derive(column, expr):
    return {"kind": "derive", "column": column, "expr": expr}


def test_derive_log_matches_numpy():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        derive("area", "log(area)")])           # overwrite in place
    assert out["area"].tolist() == pytest.approx(np.log([9.0, 16.0]).tolist())
    # overwriting an existing numeric column leaves the schema unchanged
    assert [c["name"] for c in schema["columns"]] == ["perimeter", "area"]


def test_derive_ratio_adds_numeric_column():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        derive("q", "perimeter / sqrt(area)")])
    assert out["q"].tolist() == pytest.approx(
        (np.array([12.0, 20.0]) / np.sqrt([9.0, 16.0])).tolist())
    q = next(c for c in schema["columns"] if c["name"] == "q")
    assert q == {"name": "q", "type": "numeric", "label": "q"}


def test_derive_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [derive("q", "nope * 2")])


def test_derive_unsupported_function_raises():
    # string ops / arbitrary calls are deferred (Tier C); reject loudly
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [derive("q", "min(area, 1)")])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_reduce_derive.py -v`
Expected: FAIL with `ReduceError: unknown step kind 'derive'`.

- [ ] **Step 3: Add the evaluator + `_apply_derive`**

At the top of `engine/iris_engine/reduce.py`, add to the imports (after `import pandas as pd`):

```python
import ast

import numpy as np
```

Then add, above `_apply_step`:

```python
# derive: a deliberately small expression language — arithmetic over column
# names plus a whitelist of element-wise numpy funcs. No eval/exec; an explicit
# AST walk so an unsupported construct fails loudly rather than silently.
_DERIVE_FUNCS = {"log": np.log, "log2": np.log2, "log10": np.log10,
                 "sqrt": np.sqrt, "exp": np.exp, "abs": np.abs}
_DERIVE_BINOPS = {
    ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a ** b,
}


def _eval_derive(node, df: pd.DataFrame):
    if isinstance(node, ast.Expression):
        return _eval_derive(node.body, df)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in df.columns:
            raise ReduceError(f"derive: unknown column {node.id!r}")
        return df[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _DERIVE_BINOPS:
        return _DERIVE_BINOPS[type(node.op)](
            _eval_derive(node.left, df), _eval_derive(node.right, df))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_derive(node.operand, df)
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in _DERIVE_FUNCS
            and len(node.args) == 1 and not node.keywords):
        return _DERIVE_FUNCS[node.func.id](_eval_derive(node.args[0], df))
    raise ReduceError("derive: unsupported expression")


def _apply_derive(df: pd.DataFrame, schema: dict,
                  step: dict) -> tuple[pd.DataFrame, dict]:
    col, expr = step.get("column"), step.get("expr")
    if not col or not expr:
        raise ReduceError("derive needs a `column` and an `expr`")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ReduceError(f"derive: malformed expr {expr!r}") from e
    series = _eval_derive(tree, df)
    out = df.copy()
    out[col] = series
    names = {c["name"] for c in schema["columns"]}
    if col in names:                       # overwrite: type stays whatever it was
        return out, schema
    new_cols = [*schema["columns"], {"name": col, "type": "numeric", "label": col}]
    return out, {**schema, "columns": new_cols}
```

- [ ] **Step 4: Add the dispatch branch**

In `_apply_step` (`engine/iris_engine/reduce.py:89-97`), add before the final `raise`:

```python
    if kind == "derive":
        return _apply_derive(df, schema, step)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_reduce_derive.py -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/reduce.py engine/tests/test_reduce_derive.py
git commit -m "feat(reduce): derive step (safe row-wise scalar expression)"
```

---

## Task 3: `recode` step kind (categorical value relabel)

A level→level lookup over a categorical column with pass-through for unmapped levels (the notebook's `.map(CLASS_LABELS).fillna(original)`). Rewrites both the stored values and `schema.levels` so the column can be split/compared on. Defers function/parser recodes and level merging (spec).

**Files:**
- Modify: `engine/iris_engine/reduce.py` (add `_apply_recode` + dispatch branch)
- Test: `engine/tests/test_reduce_recode.py`

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_reduce_recode.py
"""recode: relabel a categorical column's values, pass through the unmapped."""
import pandas as pd
import pytest

from iris_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "class_label", "type": "categorical", "label": "Class",
         "levels": ["negative", "positive", "other"]},
        {"name": "value", "type": "numeric", "label": "Value"},
    ],
}


def frame():
    return pd.DataFrame([
        {"id": "r1", "class_label": "negative", "value": 1.0},
        {"id": "r2", "class_label": "positive", "value": 2.0},
        {"id": "r3", "class_label": "other", "value": 3.0},
    ])


def recode(column, mapping):
    return {"kind": "recode", "column": column, "map": mapping}


def test_recode_relabels_values_and_passes_unmapped_through():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        recode("class_label", {"negative": "VimentinKO", "positive": "NLS-mCherry"})])
    assert out["class_label"].tolist() == ["VimentinKO", "NLS-mCherry", "other"]


def test_recode_rewrites_schema_levels_dedup_order_preserving():
    _, schema = rd.apply_reduction(frame(), SCHEMA, [
        recode("class_label", {"negative": "VimentinKO", "positive": "NLS-mCherry"})])
    col = next(c for c in schema["columns"] if c["name"] == "class_label")
    assert col["levels"] == ["VimentinKO", "NLS-mCherry", "other"]


def test_recode_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [recode("nope", {"a": "b"})])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_reduce_recode.py -v`
Expected: FAIL with `ReduceError: unknown step kind 'recode'`.

- [ ] **Step 3: Add `_apply_recode`**

In `engine/iris_engine/reduce.py`, above `_apply_step`:

```python
def _apply_recode(df: pd.DataFrame, schema: dict,
                  step: dict) -> tuple[pd.DataFrame, dict]:
    col = step.get("column")
    mapping = step.get("map") or {}
    if not col:
        raise ReduceError("recode needs a `column`")
    if col not in df:
        raise ReduceError(f"recode: unknown column {col!r}")
    out = df.copy()
    # relabel mapped values; leave the rest intact (the notebook's .fillna(original))
    out[col] = out[col].map(lambda v: mapping.get(v, v))
    new_cols = []
    for c in schema["columns"]:
        if c["name"] == col and c.get("type") == "categorical":
            relabeled = [mapping.get(v, v) for v in (c.get("levels") or [])]
            new_cols.append({**c, "levels": list(dict.fromkeys(relabeled))})
        else:
            new_cols.append(c)
    return out, {**schema, "columns": new_cols}
```

- [ ] **Step 4: Add the dispatch branch**

In `_apply_step`, add before the final `raise`:

```python
    if kind == "recode":
        return _apply_recode(df, schema, step)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_reduce_recode.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/reduce.py engine/tests/test_reduce_recode.py
git commit -m "feat(reduce): recode step (categorical relabel, pass-through unmapped)"
```

---

## Task 4: `join` step kind (spine-aligned inner broadcast)

Attach a second table's columns onto the frame by shared keys, broadcasting a coarser-grain attribute (per-cell `class_label`) onto finer rows (per-frame); inner drops unmatched rows. The right table rides **inline in the step** (`{schema, rows}`). Defers outer/many-to-many/non-spine/general joins (spec).

**Files:**
- Modify: `engine/iris_engine/reduce.py` (add `_apply_join` + dispatch branch)
- Test: `engine/tests/test_reduce_join.py`

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_reduce_join.py
"""join: inner, spine-aligned, coarse->fine broadcast; right table inline."""
import pandas as pd
import pytest

from iris_engine import reduce as rd

KEY = ["experiment_id", "position_id", "cell_id"]

LEFT_SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
        {"name": "position_id", "type": "identifier", "label": "Position"},
        {"name": "cell_id", "type": "identifier", "label": "Cell"},
        {"name": "frame", "type": "identifier", "label": "Frame"},
        {"name": "value", "type": "numeric", "label": "Value"},
    ],
}


def left():
    # two cells (c1, c2) x two frames each; c2 has NO class label in the right table
    rows = [
        {"id": "r1", "experiment_id": "E1", "position_id": "P1", "cell_id": "c1", "frame": 0, "value": 1.0},
        {"id": "r2", "experiment_id": "E1", "position_id": "P1", "cell_id": "c1", "frame": 1, "value": 2.0},
        {"id": "r3", "experiment_id": "E1", "position_id": "P1", "cell_id": "c2", "frame": 0, "value": 3.0},
        {"id": "r4", "experiment_id": "E1", "position_id": "P1", "cell_id": "c2", "frame": 1, "value": 4.0},
    ]
    return pd.DataFrame(rows)


def right_table():
    return {
        "schema": {
            "schema_version": "1.0",
            "columns": [
                {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
                {"name": "position_id", "type": "identifier", "label": "Position"},
                {"name": "cell_id", "type": "identifier", "label": "Cell"},
                {"name": "class_label", "type": "categorical", "label": "Class",
                 "levels": ["negative"]},
            ],
        },
        # only c1 is labelled; c2 is unclassified
        "rows": [
            {"experiment_id": "E1", "position_id": "P1", "cell_id": "c1",
             "class_label": "negative"},
        ],
    }


def join_step(on, right, how="inner"):
    return {"kind": "join", "on": on, "how": how, "right": right}


def test_join_broadcasts_label_onto_frames_inner_drops_unmatched():
    out, schema = rd.apply_reduction(left(), LEFT_SCHEMA, [
        join_step(KEY, right_table())])
    # c1's two frames survive carrying the label; c2's two frames are dropped (inner)
    assert out["id"].tolist() == ["r1", "r2"]
    assert out["class_label"].tolist() == ["negative", "negative"]
    # schema gained the right's class_label column (keys not duplicated)
    assert [c["name"] for c in schema["columns"]] == [
        "experiment_id", "position_id", "cell_id", "frame", "value", "class_label"]


def test_join_only_inner_supported():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(left(), LEFT_SCHEMA, [
            join_step(KEY, right_table(), how="left")])


def test_join_missing_key_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(left(), LEFT_SCHEMA, [
            join_step(["nope"], right_table())])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_reduce_join.py -v`
Expected: FAIL with `ReduceError: unknown step kind 'join'`.

- [ ] **Step 3: Add `_apply_join`**

In `engine/iris_engine/reduce.py`, above `_apply_step`:

```python
def _apply_join(df: pd.DataFrame, schema: dict,
                step: dict) -> tuple[pd.DataFrame, dict]:
    on = step.get("on") or []
    how = step.get("how", "inner")
    right = step.get("right") or {}
    if how != "inner":
        raise ReduceError(f"join: only inner is supported, got {how!r}")
    if not on:
        raise ReduceError("join needs `on` keys")
    right_schema = right.get("schema") or {}
    right_df = pd.DataFrame(right.get("rows") or [])
    # the right side is a plain table; its bookkeeping id (if any) must not collide
    right_df = right_df.drop(columns=["id"], errors="ignore")
    missing = [k for k in on if k not in df.columns or k not in right_df.columns]
    if missing:
        raise ReduceError(f"join: key(s) {missing!r} absent from a side")
    left_names = {c["name"] for c in schema["columns"]} | set(_meta_cols(df)) | set(on)
    add = [c for c in right_schema.get("columns", []) if c["name"] not in left_names]
    keep = list(dict.fromkeys(on + [c["name"] for c in add]))
    right_df = right_df[[c for c in keep if c in right_df.columns]]
    out = df.merge(right_df, on=on, how="inner")
    return out.reset_index(drop=True), {**schema, "columns": [*schema["columns"], *add]}
```

- [ ] **Step 4: Add the dispatch branch**

In `_apply_step`, add before the final `raise`:

```python
    if kind == "join":
        return _apply_join(df, schema, step)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_reduce_join.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Run the whole reduce suite (no regressions)**

Run: `cd engine && python -m pytest tests/test_reduce.py tests/test_reduce_drop.py tests/test_reduce_filter_null.py tests/test_reduce_derive.py tests/test_reduce_recode.py tests/test_reduce_join.py -v`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add engine/iris_engine/reduce.py engine/tests/test_reduce_join.py
git commit -m "feat(reduce): join step (inner spine-aligned broadcast, inline right table)"
```

---

## Task 5: COV2D-shaped fixture + independent `paired_by_replicate` reference

A small synthetic stand-in for `cell_shape.csv` (per-frame, the left table) + `class_label.csv` (per-cell, the right table) with a **known nesting** (3 experiments × 2 positions × 2 cells/class × 2 frames) and known per-class medians, plus a from-scratch reimplementation of the notebook's `per_frame_values` + `paired_by_replicate` to assert the engine against. This is shared test infrastructure (not a test module).

**Files:**
- Create: `engine/tests/cov2d_fixture.py`
- Test: `engine/tests/test_cov2d_tier_a.py` (a smoke test of the fixture/reference here; the equivalence tests come in Task 6)

- [ ] **Step 1: Write the fixture + reference**

```python
# engine/tests/cov2d_fixture.py
"""A synthetic COV2D §1-§2 stand-in and an independent recompute of the
notebook's paired_by_replicate, used to prove the absorbed graph matches.

Shape mirrors the report: a per-FRAME left table (cell_shape) and a per-CELL
right table (class_label). KEY = (experiment_id, position_id, cell_id). Each of
N=3 experiments has 2 positions; each position has 2 cells per class; each cell
has 2 frames. class_label is raw ("negative"/"positive") and is recoded to
("VimentinKO"/"NLS-mCherry") exactly as the notebook's CLASS_LABELS map does.
"""
from __future__ import annotations

import pandas as pd
import pingouin as pg
from scipy.stats import ttest_rel

KEY = ["experiment_id", "position_id", "cell_id"]
SPINE = ["experiment_id", "position_id", "cell_id", "frame"]
CLASS_MAP = {"negative": "VimentinKO", "positive": "NLS-mCherry"}
# group order must match the reference's (vk, nl) pairing below
LEVELS = ["VimentinKO", "NLS-mCherry"]

LEFT_SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
        {"name": "position_id", "type": "identifier", "label": "Position"},
        {"name": "cell_id", "type": "identifier", "label": "Cell"},
        {"name": "frame", "type": "identifier", "label": "Frame"},
        {"name": "value", "type": "numeric", "label": "Cell size"},
    ],
}

RIGHT_SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
        {"name": "position_id", "type": "identifier", "label": "Position"},
        {"name": "cell_id", "type": "identifier", "label": "Cell"},
        {"name": "class_label", "type": "categorical", "label": "Class",
         "levels": ["negative", "positive"]},
    ],
}


def _build():
    """Deterministic rows: value = base(class) + experiment offset + small
    per-cell/frame wiggle, so VimentinKO sits clearly above NLS-mCherry in every
    replicate (a stable paired separation, no RNG)."""
    left_rows, right_rows, rid = [], [], 0
    base = {"negative": 100.0, "positive": 60.0}     # negative -> VimentinKO (higher)
    for ei, exp in enumerate(["E1", "E2", "E3"]):
        exp_off = 5.0 * ei
        for pos in ["P1", "P2"]:
            for cls in ["negative", "positive"]:
                for c in [0, 1]:
                    cell = f"{exp}_{pos}_{cls}_{c}"
                    right_rows.append({"experiment_id": exp, "position_id": pos,
                                       "cell_id": cell, "class_label": cls})
                    for fr in [0, 1]:
                        rid += 1
                        wiggle = c * 2.0 + fr * 1.0
                        left_rows.append({
                            "id": f"r{rid}", "experiment_id": exp,
                            "position_id": pos, "cell_id": cell, "frame": fr,
                            "value": base[cls] + exp_off + wiggle})
    return pd.DataFrame(left_rows), pd.DataFrame(right_rows)


def left_table() -> dict:
    left, _ = _build()
    rows = left.to_dict(orient="records")
    return {"schema": LEFT_SCHEMA, "rows": rows}


def right_table() -> dict:
    _, right = _build()
    return {"schema": RIGHT_SCHEMA, "rows": right.to_dict(orient="records")}


def per_frame_reference() -> pd.DataFrame:
    """The notebook's per_frame_values: inner-merge label onto frames, recode."""
    left, right = _build()
    cls = right.copy()
    cls["class_label"] = cls["class_label"].map(CLASS_MAP).fillna(cls["class_label"])
    return left.merge(cls, on=KEY, how="inner")


def paired_by_replicate_reference(pf: pd.DataFrame | None = None,
                                  value: str = "value", agg: str = "median") -> dict:
    """The notebook's paired_by_replicate, recomputed from scratch."""
    if pf is None:
        pf = per_frame_reference()
    cell = pf.groupby([*KEY, "class_label"])[value].agg(agg).reset_index()
    field = cell.groupby(["experiment_id", "position_id", "class_label"])[value] \
                .agg(agg).reset_index()
    piv = field.groupby(["experiment_id", "class_label"])[value].agg(agg).unstack()
    vk = piv["VimentinKO"].to_numpy()
    nl = piv["NLS-mCherry"].to_numpy()
    tt = ttest_rel(vk, nl)
    g = float(pg.compute_effsize(vk, nl, paired=True, eftype="hedges"))
    return {"p": float(tt.pvalue), "t": float(tt.statistic), "g": g,
            "vk": vk.tolist(), "nl": nl.tolist(), "n": int(len(vk)),
            "piv": piv}
```

- [ ] **Step 2: Write a smoke test of the fixture/reference**

```python
# engine/tests/test_cov2d_tier_a.py
"""Tier A end-to-end: the absorbed graph reproduces the notebook's numbers."""
import pytest

from iris_engine.tests import cov2d_fixture as fx  # see Step 4 note on import path


def test_fixture_reference_is_paired_and_well_separated():
    ref = fx.paired_by_replicate_reference()
    assert ref["n"] == 3                      # N=3 replicates (experiments)
    # VimentinKO above NLS-mCherry in every replicate
    assert all(v > n for v, n in zip(ref["vk"], ref["nl"]))
    assert ref["p"] < 0.05
```

- [ ] **Step 3: Run the smoke test to verify it fails on import**

Run: `cd engine && python -m pytest tests/test_cov2d_tier_a.py -v`
Expected: FAIL — `ModuleNotFoundError` for the import path (resolved next step).

- [ ] **Step 4: Fix the import path**

The `engine/tests/` directory is not a package. Match how existing tests import siblings — they `from iris_engine import ...`, not from `tests`. Change the import at the top of `test_cov2d_tier_a.py` to a plain module import (pytest adds the test dir to `sys.path`):

```python
import cov2d_fixture as fx
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `cd engine && python -m pytest tests/test_cov2d_tier_a.py -v`
Expected: PASS (1 passed). If pytest cannot import `cov2d_fixture`, confirm `engine/pyproject.toml`'s pytest config does not set `rootdir`/`importmode` that strips the test dir from `sys.path`; the default `prepend` import mode puts `tests/` on the path.

- [ ] **Step 6: Commit**

```bash
git add engine/tests/cov2d_fixture.py engine/tests/test_cov2d_tier_a.py
git commit -m "test(cov2d): synthetic Tier A fixture + independent paired_by_replicate reference"
```

---

## Task 6: End-to-end equivalence + default-chain identity

Build the absorbed spec (drop/filter/join/recode + the flatten chain + a paired stat), run it through the real `render.render`, and assert the paired-t `p`, Hedges `g`, replicate count, and the experiment-grain per-class medians match the reference to full float precision.

**Files:**
- Modify: `engine/tests/test_cov2d_tier_a.py` (add the equivalence + identity tests)

- [ ] **Step 1: Write the failing equivalence test**

Append to `engine/tests/test_cov2d_tier_a.py`:

```python
import numpy as np

from iris_engine import render as render_mod


def _tier_a_spec(derive_log: bool = False) -> dict:
    steps = [{"kind": "filter",
              "conditions": [{"column": "value", "op": "not-null"}]}]
    if derive_log:
        steps.append({"kind": "derive", "column": "value", "expr": "log(value)"})
    steps.append({"kind": "join", "on": fx.KEY, "how": "inner",
                  "right": fx.right_table()})
    steps.append({"kind": "recode", "column": "class_label", "map": fx.CLASS_MAP})
    return {
        "spec_version": "2.0",
        "id": "cov2d-tier-a-size",
        "title": "COV2D Tier A — cell size",
        "data": {"filter": []},
        "reduce": {"steps": steps},
        "encodings": {"x": {"column": "class_label"}, "y": {"column": "value"},
                      "color": {"column": "class_label"}, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": fx.SPINE,
                      "fn": {lv: "median" for lv in fx.SPINE}},
        "layers": [{"geom": "violin", "level": ""},
                   {"geom": "dot", "level": "cell_id"},
                   {"geom": "summary", "level": "experiment_id"}],
        "stats": {"alpha": 0.05, "override": "paired_t"},
    }


def test_engine_graph_matches_notebook_paired_t_and_hedges_g():
    ref = fx.paired_by_replicate_reference()
    fig, res, df, schema, model, issues, level_tables = render_mod.render(
        fx.left_table(), _tier_a_spec())
    r = res["result"]
    assert r["test"] == "paired_t"
    assert model["pairing"]["verdict"] == "paired"
    assert model["pairing"]["across"] == "experiment_id"
    assert res["result"]["p"] == pytest.approx(ref["p"], abs=1e-12)
    assert res["result"]["effect"]["value"] == pytest.approx(ref["g"], abs=1e-12)
    assert abs(res["result"]["t"]) == pytest.approx(abs(ref["t"]), abs=1e-9)
    from iris_engine import compiler
    compiler.close(fig)


def test_default_chain_reproduces_experiment_grain_medians():
    ref = fx.paired_by_replicate_reference()
    _, _, _, _, _, _, level_tables = render_mod.render(
        fx.left_table(), _tier_a_spec())
    exp_tbl, _ = level_tables["experiment_id"]
    got = (exp_tbl.set_index(["experiment_id", "class_label"])["value"]
                  .unstack().reindex(columns=fx.LEVELS))
    want = ref["piv"].reindex(columns=fx.LEVELS)
    np.testing.assert_allclose(got.to_numpy(), want.to_numpy(), atol=1e-12)


def test_inner_join_drops_unclassified_then_log_derive_matches():
    # the join keeps only labelled cells; a pre-flatten log derive matches numpy
    _, res, df, _, _, _, _ = render_mod.render(
        fx.left_table(), _tier_a_spec(derive_log=True))
    # every retained raw row carries a (recoded) label and a logged value
    assert set(df["class_label"]) == set(fx.LEVELS)
    assert df["value"].min() < 10                # log compressed the 60-115 range
    assert res["result"]["test"] == "paired_t"
```

- [ ] **Step 2: Run the equivalence tests to verify they fail (or surface a real wiring gap)**

Run: `cd engine && python -m pytest tests/test_cov2d_tier_a.py -v`
Expected: the three new tests run. If they fail, the message pinpoints the gap (e.g. pairing verdict not "paired", or a level-order mismatch). Fix wiring in the spec/fixture — **not** by loosening tolerances. (All four step kinds from Tasks 1–4 are already in place, so this should pass once the spec fields line up.)

- [ ] **Step 3: Make them pass**

Common adjustments if a test fails:
- **Pairing not "paired":** confirm the coarsest layer level is `experiment_id` (the `summary` layer) so `inferential_level == "experiment_id"` and `class_label` pairs by experiment. See `render.py:158-166` and `hierarchy.pairing`.
- **`g`/`t` sign or value off:** confirm `LEVELS == ["VimentinKO", "NLS-mCherry"]` matches the reference's `ttest_rel(vk, nl)` order, and that recode produced exactly those two levels (Task 3).
- **`p` not exact:** both paths must use median at every level — `fn = {lv: "median"}` for the whole spine — matching the notebook's `agg="median"`.

- [ ] **Step 4: Run the full new-tests set**

Run: `cd engine && python -m pytest tests/test_cov2d_tier_a.py -v`
Expected: PASS (4 passed, incl. the Task 5 smoke test).

- [ ] **Step 5: Commit**

```bash
git add engine/tests/test_cov2d_tier_a.py
git commit -m "test(cov2d): engine graph matches notebook paired-t/Hedges-g + default-chain identity"
```

---

## Task 7: `.iris` round-trip with an embedded join

Prove the join-bearing spec (whose right table is embedded inline) saves and reloads losslessly and re-renders to identical stats — the spec's "Round-trip" acceptance bullet.

**Files:**
- Modify: `engine/tests/test_cov2d_tier_a.py` (add the round-trip test)

- [ ] **Step 1: Write the failing test**

Append to `engine/tests/test_cov2d_tier_a.py`:

```python
from iris_engine import document


def test_iris_round_trip_preserves_join_and_stats():
    spec = _tier_a_spec()
    left = fx.left_table()
    data = document.save_document(
        left["schema"], left["rows"], [spec],
        provenance={"source": "cov2d tier-a round-trip test"},
        engine_snapshot={})
    doc = document.load_document(data)
    assert len(doc["analyses"]) == 1
    reloaded = doc["analyses"][0]
    # the embedded right table survived the JSON sidecar verbatim
    join = next(s for s in reloaded["reduce"]["steps"] if s["kind"] == "join")
    assert len(join["right"]["rows"]) == len(fx.right_table()["rows"])
    # re-render the reloaded spec over the reloaded table -> identical stats
    table = {"schema": doc["schema"], "rows": doc["rows"]}
    ref = fx.paired_by_replicate_reference()
    fig, res, *_ = render_mod.render(table, reloaded)
    assert res["result"]["p"] == pytest.approx(ref["p"], abs=1e-12)
    assert res["result"]["effect"]["value"] == pytest.approx(ref["g"], abs=1e-12)
    from iris_engine import compiler
    compiler.close(fig)
```

- [ ] **Step 2: Run it to verify it passes (or exposes a gap)**

Run: `cd engine && python -m pytest tests/test_cov2d_tier_a.py::test_iris_round_trip_preserves_join_and_stats -v`
Expected: PASS. `save_document` serializes each analysis as a JSON sidecar verbatim (`document.py:39-41`), so the embedded `right` table round-trips with no new code. If it fails on `doc["rows"]` lacking an `id`, add the bookkeeping id the same way `build_table` does (`r["id"] = str(i)`), since the fixture's `left_table` already carries `id`.

- [ ] **Step 3: Commit**

```bash
git add engine/tests/test_cov2d_tier_a.py
git commit -m "test(cov2d): .iris round-trips an embedded-join spec losslessly"
```

---

## Task 8: Shipped validation-corpus case `cov2d-tier-a`

Add the case to the validation corpus so the absorbed SuperPlot ships as a real, openable `.iris` validated through the exact app path (`main._run` → figure), including figure-structure assertions. `data.csv` is the per-frame left table; the join's right table embeds in the spec (the corpus builds one CSV per case, so the second source must ride inline — which it already does).

**Files:**
- Create: `engine/validation/cases/cov2d-tier-a/data.csv`
- Create: `engine/validation/cases/cov2d-tier-a/case.py`

- [ ] **Step 1: Generate `data.csv` from the fixture**

Run (writes the left table as the corpus CSV, without the `id` column — `build_table` adds it):

```bash
cd engine && python -c "
import pandas as pd
from tests import cov2d_fixture as fx  # if 'tests' is not importable, run from engine/tests with: import cov2d_fixture as fx
left = pd.DataFrame(fx.left_table()['rows']).drop(columns=['id'])
left.to_csv('validation/cases/cov2d-tier-a/data.csv', index=False)
print(left.head())
"
```

If `from tests import ...` fails, run the same snippet from `engine/tests/` with `import cov2d_fixture as fx` and an adjusted output path (`../validation/cases/cov2d-tier-a/data.csv`). Verify the CSV has columns `experiment_id,position_id,cell_id,frame,value` and 48 rows.

- [ ] **Step 2: Write `case.py`**

```python
# engine/validation/cases/cov2d-tier-a/case.py
"""COV2D §1-§2 absorption — a cell-size SuperPlot built entirely inside Iris's
transformation graph: an inner join broadcasts a per-cell class label onto
per-frame rows, a recode relabels it, the default nested-median flatten chain
collapses frame->cell->position->experiment, and a paired t across N=3 replicates
+ Hedges g reproduces the notebook's paired_by_replicate. The right (class_label)
table embeds in the spec's join step; data.csv is the per-frame left table.
"""
import json
from pathlib import Path

_RIGHT = json.loads((Path(__file__).parent / "right.json").read_text()) \
    if (Path(__file__).parent / "right.json").exists() else None

TITLE = "COV2D Tier A — cell size SuperPlot (absorbed graph)"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped stand-in; numbers reproduce the notebook's paired_by_replicate"

KEY = ["experiment_id", "position_id", "cell_id"]
SPINE = ["experiment_id", "position_id", "cell_id", "frame"]

# the per-cell class_label table, embedded inline in the join step (the corpus
# builds one CSV per case, so the second source rides in the spec)
RIGHT_TABLE = {
    "schema": {
        "schema_version": "1.0",
        "columns": [
            {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
            {"name": "position_id", "type": "identifier", "label": "Position"},
            {"name": "cell_id", "type": "identifier", "label": "Cell"},
            {"name": "class_label", "type": "categorical", "label": "Class",
             "levels": ["negative", "positive"]},
        ],
    },
    "rows": [
        {"experiment_id": e, "position_id": p, "cell_id": f"{e}_{p}_{cls}_{c}",
         "class_label": cls}
        for e in ["E1", "E2", "E3"] for p in ["P1", "P2"]
        for cls in ["negative", "positive"] for c in [0, 1]
    ],
}

SCHEMA_OVERRIDES = {
    "experiment_id": {"type": "identifier"},
    "position_id": {"type": "identifier"},
    "cell_id": {"type": "identifier"},
    "frame": {"type": "identifier"},
    "value": {"type": "numeric"},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"filter": []},
            "reduce": {"steps": [
                {"kind": "filter",
                 "conditions": [{"column": "value", "op": "not-null"}]},
                {"kind": "join", "on": KEY, "how": "inner", "right": RIGHT_TABLE},
                {"kind": "recode", "column": "class_label",
                 "map": {"negative": "VimentinKO", "positive": "NLS-mCherry"}},
            ]},
            "encodings": {"x": {"column": "class_label"},
                          "y": {"column": "value"},
                          "color": {"column": "class_label"},
                          "size": None, "shape": None},
            "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
            "hierarchy": {"spine": SPINE, "fn": {lv: "median" for lv in SPINE}},
            "layers": [{"geom": "violin", "level": ""},
                       {"geom": "dot", "level": "cell_id"},
                       {"geom": "summary", "level": "experiment_id"}],
            "stats": {"alpha": 0.05, "override": "paired_t"},
        },
        "expected_stats": {
            "test": "paired_t",
            "n": 3,                       # N=3 replicate experiments
        },
        "expected_model": {"family": "group_comparison"},
        "expected_figure": {
            "xtick_labels": ["VimentinKO", "NLS-mCherry"],
        },
    },
]
```

Note: the `right.json` shim at the top is unused (left as a no-op) — delete those two lines if `RIGHT_TABLE` is built inline as shown. Keep only the inline `RIGHT_TABLE`.

- [ ] **Step 3: Clean up the stray shim**

Remove the unused `_RIGHT`/`json`/`Path` lines from `case.py` (the inline `RIGHT_TABLE` is the single source of truth). The header imports should be gone entirely.

- [ ] **Step 4: Verify expected values against the engine**

The corpus asserts concrete numbers; read the real ones off the equivalence test first, then pin any you want to assert tightly:

Run: `cd engine && python -c "
from tests import cov2d_fixture as fx
ref = fx.paired_by_replicate_reference()
print('p', ref['p']); print('g', ref['g']); print('n', ref['n'])
"`

If you want `p`/`effect.value` asserted in the case, add them to `expected_stats` as `(value, 1e-9)` tuples using the printed numbers (the harness supports `(value, tol)` — see `harness._check_field`).

- [ ] **Step 5: Run the validation corpus**

Run: `cd engine && python -m pytest validation/test_validation.py -v -k cov2d`
Expected: PASS — the case builds a `.iris`, runs through `main._run`, and its stats/model/figure assertions hold. The `xtick_labels` assertion confirms the recode-driven class split reached the figure.

- [ ] **Step 6: Run the entire engine suite (final regression gate)**

Run: `cd engine && python -m pytest -q`
Expected: PASS (the full suite, including the existing 372 tests, the new reduce-step tests, the Tier A equivalence tests, and the corpus).

- [ ] **Step 7: Commit**

```bash
git add engine/validation/cases/cov2d-tier-a/
git commit -m "test(cov2d): ship Tier A cell-size SuperPlot as a validation-corpus case"
```

---

## Task 9: Frontend types — new filter ops, reduce steps, edge kinds

Mirror the engine's new vocabulary in the shared TypeScript types so the spec type-checks and the explorer can model the new edges. No GUI authoring (deferred follow-up).

**Files:**
- Modify: `src/types.ts:188` (`FilterOp`), `src/types.ts:197-205` (step types + `ReduceStep` union)

- [ ] **Step 1: Extend `FilterOp` with null predicates**

In `src/types.ts:188`, change:

```typescript
export type FilterOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in";
```

to:

```typescript
export type FilterOp =
  | "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in"
  | "is-null" | "not-null";
```

And make the condition value optional (null ops carry no value) — change `src/types.ts:189-193`:

```typescript
export interface FilterCond {
  column: string;
  op: FilterOp;
  value?: string | number | (string | number)[]; // absent for is-null / not-null
}
```

- [ ] **Step 2: Add the three new step interfaces + extend the union**

In `src/types.ts`, after `FilterStep` (`:200`) and before `ReduceStep` (`:204`), add:

```typescript
/* derive a new (or overwritten) numeric column from a row-wise scalar expr
   over existing columns: "log(value)", "perimeter / sqrt(area)". Raw-grain. */
export interface DeriveStep { kind: "derive"; column: string; expr: string; _key?: string }
/* relabel a categorical column's values (level -> level); unmapped pass through. */
export interface RecodeStep { kind: "recode"; column: string; map: Record<string, string>; _key?: string }
/* inner, spine-aligned, coarse->fine broadcast join; the right table rides inline. */
export interface JoinStep {
  kind: "join"; on: string[]; how: "inner"; right: Table; _key?: string;
}
```

Then change the `ReduceStep` union (`src/types.ts:204`):

```typescript
export type ReduceStep = DropStep | FilterStep | DeriveStep | RecodeStep | JoinStep;
```

- [ ] **Step 3: Extend the explorer `EdgeKind`**

In `src/explorer/graph.ts:9`, change:

```typescript
export type EdgeKind = "filter" | "drop" | "collapse" | "geom" | "test";
```

to:

```typescript
export type EdgeKind =
  | "filter" | "drop" | "derive" | "recode" | "join"
  | "collapse" | "geom" | "test";
```

- [ ] **Step 4: Type-check**

Run: `cd /home/aruppel/Projects/Iris && npx tsc --noEmit`
Expected: `buildGraph` now fails to type-check because `step.kind === "filter" ? step.conditions.length : step.columns.length` (`graph.ts:88`) does not cover the new kinds. That is fixed in Task 10. (If you want a clean checkpoint, you may proceed to Task 10 before committing.)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/explorer/graph.ts
git commit -m "feat(types): derive/recode/join reduce steps + null filter ops + edge kinds"
```

---

## Task 10: `buildGraph` — render derive/recode + the join's two-source convergence

Teach the pure graph builder the new step kinds: `derive`/`recode` are linear single-edge steps; a `join` emits a **second source node** plus a converging `join` edge, so the explorer draws two source lines meeting at the joined table.

**Files:**
- Modify: `src/explorer/graph.ts:85-95` (the reduce-step loop)
- Test: `src/explorer/graph.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/explorer/graph.test.ts` (follow the existing import/setup at the top of the file; reuse its `HIER`/`SCHEMA` helpers):

```typescript
import type { ReduceStep } from "../types";

it("derive and recode are linear single-edge steps", () => {
  const steps: ReduceStep[] = [
    { kind: "derive", column: "q", expr: "perimeter / sqrt(area)" },
    { kind: "recode", column: "class_label", map: { negative: "VimentinKO" } },
  ];
  const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
  const kinds = g.edges.filter((e) => e.kind === "derive" || e.kind === "recode")
    .map((e) => e.kind);
  expect(kinds).toEqual(["derive", "recode"]);
});

it("a join emits a second source node and two converging join edges", () => {
  const right = {
    schema: { schema_version: "1.0", columns: [
      { name: "cell_id", type: "identifier", label: "Cell" },
      { name: "class_label", type: "categorical", label: "Class" },
    ] },
    rows: [{ id: "1", cell_id: "c1", class_label: "negative" }],
  };
  const steps: ReduceStep[] = [
    { kind: "join", on: ["cell_id"], how: "inner", right },
  ];
  const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
  // a second source node exists alongside the primary "source"
  const sources = g.nodes.filter((n) => n.kind === "table" && n.id.startsWith("source"));
  expect(sources.length).toBeGreaterThanOrEqual(2);
  // the join step node has TWO incoming join edges (left chain + right source)
  const joinNode = "step:0";
  const incoming = g.edges.filter((e) => e.toId === joinNode && e.kind === "join");
  expect(incoming.length).toBe(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/aruppel/Projects/Iris && npm test -- graph`
Expected: FAIL (no `derive`/`recode`/`join` edges; only one source node).

- [ ] **Step 3: Rewrite the reduce-step loop in `buildGraph`**

Replace the loop body at `src/explorer/graph.ts:86-94` with kind-aware labeling and the join's second source:

```typescript
  let prev = SOURCE_ID;
  steps.forEach((step, i) => {
    const id = stepId(i);
    nodes.push({ id, kind: "table",
      label: STEP_NODE_LABEL[step.kind] ?? step.kind,
      table: { via: "at_step", at_step: i } });
    if (step.kind === "join") {
      // a second source feeds the join: draw it converging into this node
      const srcId = `source:${i}`;
      nodes.push({ id: srcId, kind: "table", label: "joined table",
        table: { via: "none" } });
      edges.push({ id: `e:${prev}->${id}`, kind: "join", label: "join (inner)",
        fromId: prev, toId: id });
      edges.push({ id: `e:${srcId}->${id}`, kind: "join", label: "join (inner)",
        fromId: srcId, toId: id });
    } else {
      edges.push({ id: `e:${prev}->${id}`, kind: step.kind,
        label: stepEdgeLabel(step), fromId: prev, toId: id });
    }
    prev = id;
  });
```

Add the label helpers above `buildGraph` (near `GEOM_LABEL`, `graph.ts:54`):

```typescript
const STEP_NODE_LABEL: Record<string, string> = {
  filter: "filtered", drop: "dropped", derive: "derived",
  recode: "recoded", join: "joined",
};

function stepEdgeLabel(step: ReduceStep): string {
  switch (step.kind) {
    case "filter": return `filter (${step.conditions.length})`;
    case "drop": return `drop (${step.columns.length})`;
    case "derive": return `derive ${step.column}`;
    case "recode": return `recode ${step.column}`;
    case "join": return "join (inner)";
  }
}
```

Add `ReduceStep` to the type import at `graph.ts:1`:

```typescript
import type { Hierarchy, Layer, ReduceStep, Schema } from "../types";
```

(`ReduceStep` is likely already imported via the function signature; confirm and avoid a duplicate.)

- [ ] **Step 4: Run the explorer tests to verify they pass**

Run: `cd /home/aruppel/Projects/Iris && npm test -- graph`
Expected: PASS (the new tests + the existing `graph.test.ts` suite). The existing tests still expect `filtered`/`dropped` node labels and `filter (n)`/`drop (n)` edge labels — confirm those are unchanged by the refactor.

- [ ] **Step 5: Type-check + full build**

Run: `cd /home/aruppel/Projects/Iris && npx tsc --noEmit && npm run build`
Expected: clean type-check and a successful Vite build.

- [ ] **Step 6: Run the whole frontend test suite**

Run: `cd /home/aruppel/Projects/Iris && npm test`
Expected: PASS (all suites green).

- [ ] **Step 7: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): render derive/recode edges + join as two converging sources"
```

---

## Self-Review

**Spec coverage:**
- *Minimal `derive` (row-wise, raw grain):* Task 2. ✓ (defers post-aggregate/conditionals/string ops — `_eval_derive` rejects unsupported constructs)
- *Minimal `recode` (value relabel + pass-through, rewrites stored category):* Task 3. ✓ (defers function/parser recodes + level merging)
- *Minimal `join` (inner, spine-aligned, coarse→fine broadcast):* Task 4. ✓ (defers outer/many-to-many/non-spine/general joins — `how != "inner"` raises)
- *`.dropna` → null-predicate filter:* Task 1. ✓
- *Two-source fan-in / multi-source from day one:* the join embeds the second source (Task 4); the explorer renders two converging sources (Task 10). ✓
- *Join sits before the flatten, default chain unchanged:* the join is a reduce step; `render.render` reduces, then materializes — order preserved (Task 6 default-chain identity test). ✓
- *Engine equivalence to full float precision (p, g, medians, replicate count):* Task 6. ✓
- *Default-chain identity (absorbing changes no numbers):* Task 6 `test_default_chain_reproduces_experiment_grain_medians`. ✓
- *Join/recode/derive units (broadcast one row/frame, inner drops unclassified, recode pass-through, log/q match numpy):* Tasks 2–4 unit tests + Task 6 `test_inner_join_drops_unclassified_then_log_derive_matches`. ✓
- *Round-trip (.iris saves/reloads losslessly):* Task 7. ✓
- *Run engine pytest + frontend tsc/Vite build + explorer render test:* Tasks 6/8 (pytest), Task 10 (tsc/build/vitest). ✓
- *Spec_version decision:* documented (no bump — join rides in `reduce.steps`). ✓
- *Guard backlog note (broadcast join is where pseudoreplication hides):* out of scope for Tier A (the default flatten runs after the join, so it's safe); flagged in the spec's risks. No task — correctly deferred to the guard pass. ✓
- *`msd_alpha` stays upstream:* out by nature (Tier D); no task. ✓

**Placeholder scan:** No TBDs; every code step shows complete code; every command shows expected output. ✓

**Type consistency:** `KEY`/`SPINE`/`CLASS_MAP`/`LEVELS` defined once in `cov2d_fixture.py` and reused across Tasks 5–8. Step dict shapes (`{kind, column, expr}`, `{kind, column, map}`, `{kind, on, how, right}`) are identical in the engine helpers (Tasks 2–4), the equivalence spec (Task 6), the validation case (Task 8), and the TS interfaces (Task 9). Edge `kind` strings (`derive`/`recode`/`join`) match between `EdgeKind` (Task 9) and `buildGraph` (Task 10). The right-table inline shape `{schema, rows}` matches the engine `_apply_join` reader, the `JoinStep.right: Table` type, and the round-trip assertion. ✓

**One open verification for the implementer:** the `cov2d_fixture` import path from both `engine/tests/` (plain `import cov2d_fixture`) and the one-off CSV-generation snippet in Task 8 (`from tests import cov2d_fixture`). If `engine/tests/` is not importable as a package, run the Task 8 snippet from inside `engine/tests/`. The equivalence tests themselves use the plain `import cov2d_fixture as fx` form (Task 5, Step 4), which pytest's default `prepend` import mode supports.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-23-cov2d-absorption-tier-a.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
