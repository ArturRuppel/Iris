# Transformation Explorer — Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the engine the two things the transformation-explorer UI depends on — a `drop`-columns step (replacing the backwards keep-list `select`) and the ability to return the table *at any pipeline node* via an `at_step` parameter on `/reduce`.

**Architecture:** Pure-pandas reduce layer + a thin FastAPI endpoint. The `select` step (a keep-list projection) becomes `drop` (a remove-list), flipping the semantics so naming columns *removes* them and new columns pass through. `/reduce` already returns the capped table for the full pipeline and for any flatten level; we add `at_step` so it can also return the table after step *k* (slicing `steps[:k+1]`), which is all the data tab needs for source/filter/drop nodes.

**Tech Stack:** Python 3, pandas, FastAPI (TestClient for tests), pytest. Frontend rename only: TypeScript, React, Jotai (verified by `tsc`/Vite build).

**Context:** Work on branch `transformation-explorer` (already checked out). This is Plan 1 of 2; Plan 2 (the `TransformExplorer` + `DataTab` UI) consumes the `at_step` surface this plan ships.

---

### Task 1: Replace `select` (keep-list) with `drop` (remove-list) in the reduce layer

**Files:**
- Modify: `engine/iris_engine/reduce.py:1-95`
- Test: `engine/tests/test_reduce_drop.py` (create)
- Modify (fix existing references): `engine/tests/test_engine.py:160-176`, `engine/tests/test_engine.py:864-878`

- [ ] **Step 1: Write the failing unit tests**

Create `engine/tests/test_reduce_drop.py`:

```python
"""Drop step: name columns to REMOVE (remove-list); everything else passes through."""
import pandas as pd
import pytest

from iris_engine import reduce as reduce_mod

_SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "a", "type": "numeric"},
    {"name": "b", "type": "numeric"},
    {"name": "c", "type": "numeric"}]}


def _df():
    return pd.DataFrame({"id": ["r1", "r2"], "a": [1, 2], "b": [3, 4], "c": [5, 6]})


def test_drop_removes_listed_columns():
    out, sch = reduce_mod.apply_reduction(_df(), _SCHEMA, [{"kind": "drop", "columns": ["b"]}])
    assert [c["name"] for c in sch["columns"]] == ["a", "c"]
    assert list(out.columns) == ["id", "a", "c"]  # meta `id` preserved, `b` gone


def test_drop_empty_list_is_identity():
    out, sch = reduce_mod.apply_reduction(_df(), _SCHEMA, [{"kind": "drop", "columns": []}])
    assert [c["name"] for c in sch["columns"]] == ["a", "b", "c"]


def test_drop_unknown_column_raises():
    with pytest.raises(reduce_mod.ReduceError):
        reduce_mod.apply_reduction(_df(), _SCHEMA, [{"kind": "drop", "columns": ["zzz"]}])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest engine/tests/test_reduce_drop.py -v`
Expected: FAIL — `ReduceError: unknown step kind 'drop'`

- [ ] **Step 3: Implement `drop` in `reduce.py`, replacing `select`**

In `engine/iris_engine/reduce.py`, replace the module docstring lines 3-5:

```python
A step is one of `drop` (remove columns) or `filter` (drop rows). Each step
transforms the output of the one above, so order matters and is honored (e.g.
filter → drop → filter). Aggregation across a grain is NOT a reduce step: it
```

Replace `_apply_select` (lines 75-84) with:

```python
def _apply_drop(df: pd.DataFrame, schema: dict,
                columns: list[str]) -> tuple[pd.DataFrame, dict]:
    cols = {c["name"]: c for c in schema["columns"]}
    unknown = [c for c in columns if c not in cols]
    if unknown:
        raise ReduceError(f"drop: unknown column(s) {unknown!r}")
    drop = set(columns)
    keep_names = [c["name"] for c in schema["columns"] if c["name"] not in drop]
    keep = _meta_cols(df) + [c for c in keep_names if c in df.columns]
    out = df[keep].copy()
    new_schema = {**schema, "columns": [cols[c] for c in keep_names]}
    return out, new_schema
```

Replace the `select` branch in `_apply_step` (lines 90-91) with:

```python
    if kind == "drop":
        return _apply_drop(df, schema, step.get("columns") or [])
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `python -m pytest engine/tests/test_reduce_drop.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Fix the two existing tests that referenced `select`**

In `engine/tests/test_engine.py`, replace line 169:

```python
        {"kind": "drop", "columns": ["subject", "dose"]}]}
```

and replace the assertion on line 176:

```python
    assert steps[1]["columns"] == ["subject", "dose"]
```

Then replace `test_reduce_preview_trace_per_step` (lines 864-878) with:

```python
def test_reduce_preview_trace_per_step():
    table = make_table()  # 40 rows, 20 per treatment
    steps = [
        {"kind": "drop", "columns": ["dose"]},
        {"kind": "filter",
         "conditions": [{"column": "treatment", "op": "==", "value": "control"}]},
        {"kind": "drop", "columns": ["subject"]},
    ]
    r = client.post("/reduce", json={"table": table, "steps": steps})
    assert r.status_code == 200
    body = r.json()
    assert [t["n_rows_out"] for t in body["trace"]] == [40, 20, 20]
    assert body["n_total"] == 20
    cols = [c["name"] for c in body["preview"]["schema"]["columns"]]
    assert "treatment" in cols and "response" in cols
    assert "subject" not in cols and "dose" not in cols
```

- [ ] **Step 6: Run the full engine suite to verify nothing else broke**

Run: `python -m pytest engine/tests -q`
Expected: PASS (all green; no remaining reference to a `select` reduce step)

- [ ] **Step 7: Commit**

```bash
git add engine/iris_engine/reduce.py engine/tests/test_reduce_drop.py engine/tests/test_engine.py
git commit -m "feat(reduce): replace select keep-list with drop remove-list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Add `at_step` to `/reduce` — return the table at any pipeline node

**Files:**
- Modify: `engine/iris_engine/main.py:69-77` (the `ReduceRequest` model), `engine/iris_engine/main.py:489-510` (the endpoint)
- Test: `engine/tests/test_engine.py` (append after `test_reduce_preview_trace_per_step`)

- [ ] **Step 1: Write the failing test**

Append to `engine/tests/test_engine.py` (after the trace test):

```python
def test_reduce_preview_at_step_returns_intermediate_table():
    table = make_table()  # 40 rows, 20 per treatment
    steps = [
        {"kind": "filter",
         "conditions": [{"column": "treatment", "op": "==", "value": "control"}]},
        {"kind": "drop", "columns": ["dose"]},
    ]

    def cols(body):
        return [c["name"] for c in body["preview"]["schema"]["columns"]]

    # at_step = -1 → raw table, before any step
    r0 = client.post("/reduce", json={"table": table, "steps": steps, "at_step": -1})
    assert r0.status_code == 200 and r0.json()["n_total"] == 40
    assert "dose" in cols(r0.json())

    # at_step = 0 → after the filter only
    r1 = client.post("/reduce", json={"table": table, "steps": steps, "at_step": 0})
    assert r1.json()["n_total"] == 20
    assert "dose" in cols(r1.json())

    # at_step = 1 → after the drop
    r2 = client.post("/reduce", json={"table": table, "steps": steps, "at_step": 1})
    assert r2.json()["n_total"] == 20
    assert "dose" not in cols(r2.json())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest engine/tests/test_engine.py::test_reduce_preview_at_step_returns_intermediate_table -v`
Expected: FAIL — `at_step` is ignored, so `r0` (at_step=-1) returns the full reduction (`n_total == 20`, and `dose` absent), tripping the first assertion.

- [ ] **Step 3: Add the `at_step` field to `ReduceRequest`**

In `engine/iris_engine/main.py`, add to `ReduceRequest` (after line 76, `level: str | None = None`):

```python
    # when set, return the table AFTER step index `at_step` (slicing steps[:at_step+1]);
    # -1 means the raw table before any step. Drives the explorer data tab. Takes
    # precedence over `level` (flatten-level inspection is a separate node kind).
    at_step: int | None = None
```

- [ ] **Step 4: Slice the steps in the endpoint**

In `engine/iris_engine/main.py`, replace lines 494-505 (from `table = _resolve_table(...)` through the `req.level` collapse block) with:

```python
    table = _resolve_table(req.table, req.table_token)
    df, schema = _load_frame(table)
    steps = req.steps if req.at_step is None else req.steps[: req.at_step + 1]
    try:
        out, sch, trace = reduce_mod.reduce_with_trace(df, schema, steps)
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e
    # collapse to the requested hierarchy level (RAW = the reduced rows as-is).
    # Skipped when inspecting an intermediate step: flatten is a separate node.
    spine = hierarchy.spine_present(out, (req.hierarchy or {}).get("spine") or [])
    if req.at_step is None and req.level and req.level != hierarchy.RAW and spine:
        levels, _ = hierarchy.materialize_levels(
            out, sch, spine, (req.hierarchy or {}).get("fn"), [])
        out, sch = hierarchy.resolve_level(levels, req.level)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest engine/tests/test_engine.py::test_reduce_preview_at_step_returns_intermediate_table -v`
Expected: PASS

- [ ] **Step 6: Run the full engine suite**

Run: `python -m pytest engine/tests -q`
Expected: PASS (all green)

- [ ] **Step 7: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_engine.py
git commit -m "feat(reduce): /reduce at_step returns the table at any pipeline node

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Rename `select` → `drop` across the frontend

This is a mechanical rename verified by the strict TypeScript build; all edits land in one commit so the build is never left red. The `step.columns` list now means "columns to drop"; the toggle logic is unchanged, only the labels flip.

**Files:**
- Modify: `src/types.ts:198`, `src/types.ts:204`
- Modify: `src/state.ts:699-701`
- Modify: `src/components/StepCards.tsx:1-36`
- Modify: `src/components/PipelineSection.tsx:9-14`, `:45-46`, `:57`, `:101`, `:129`, `:138`

- [ ] **Step 1: Rename the type in `types.ts`**

Replace `src/types.ts:198`:

```typescript
export interface DropStep { kind: "drop"; columns: string[]; _key?: string }
```

Replace `src/types.ts:204`:

```typescript
export type ReduceStep = DropStep | FilterStep;
```

- [ ] **Step 2: Update `makeStep` in `state.ts`**

Replace `src/state.ts:699-701`:

```typescript
export function makeStep(kind: ReduceStepKind): ReduceStep {
  if (kind === "drop") return { _key: nextStepKey(), kind, columns: [] };  // starts blank, by design
  return { _key: nextStepKey(), kind: "filter", conditions: [] };
}
```

- [ ] **Step 3: Rename `StepSelect` → `StepDrop` and flip its labels in `StepCards.tsx`**

Replace `src/components/StepCards.tsx:3` (the import):

```typescript
  ColumnDef, FilterOp, DropStep, FilterStep,
```

Replace the `StepSelect` block (`src/components/StepCards.tsx:11-36`):

```typescript
/* ---- Drop: remove the named columns (everything else passes through) ---- */
export function StepDrop(
  { step, columns, onChange }:
  { step: DropStep; columns: ColumnDef[]; onChange: (s: DropStep) => void },
) {
  const toggle = (name: string) => {
    const has = step.columns.includes(name);
    onChange({ ...step,
      columns: has ? step.columns.filter((c) => c !== name) : [...step.columns, name] });
  };
  const toggleGroup = (names: string[], on: boolean) => {
    const set = new Set(step.columns);
    names.forEach((n) => (on ? set.add(n) : set.delete(n)));
    onChange({ ...step, columns: orderBy(columns, set) });
  };
  return (
    <>
      <div className="step-meta">
        {step.columns.length} of {columns.length} columns dropped
        {step.columns.length === 0 && <em> — pick columns to drop</em>}
      </div>
      <ColumnPicker columns={columns} selected={step.columns}
        onToggle={toggle} onToggleGroup={toggleGroup} />
    </>
  );
}
```

- [ ] **Step 4: Update `PipelineSection.tsx`**

Replace `src/components/PipelineSection.tsx:9` (the type import):

```typescript
  DropStep, FilterStep,
```

Replace `src/components/PipelineSection.tsx:11` (the component import):

```typescript
import { StepFilter, StepDrop } from "./StepCards";
```

Replace `src/components/PipelineSection.tsx:14` (the label map):

```typescript
  drop: "Drop columns", filter: "Filter rows",
```

Replace `src/components/PipelineSection.tsx:45-46` (the render branch):

```typescript
          {step.kind === "drop" && (
            <StepDrop step={step as DropStep} columns={cols} onChange={onChange} />
```

Replace `src/components/PipelineSection.tsx:101` (the title attribute):

```typescript
        <span className="dim" title="Filter rows / drop columns before plotting">
```

Replace `src/components/PipelineSection.tsx:129` (the add-step kinds):

```typescript
                {(["drop", "filter"] as ReduceStepKind[]).map((k) => (
```

Replace `src/components/PipelineSection.tsx:138` (the add button label):

```typescript
                + Filter / Drop
```

- [ ] **Step 5: Type-check to verify no dangling references**

Run: `npx tsc --noEmit`
Expected: PASS — no errors. (If any `SelectStep`/`StepSelect`/`"select"` reference remains, tsc names the file and line.)

- [ ] **Step 6: Production build**

Run: `npm run build`
Expected: PASS — Vite build completes.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/state.ts src/components/StepCards.tsx src/components/PipelineSection.tsx
git commit -m "feat(ui): rename reduce select step to drop (remove-list)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (this plan = the engine-foundation slice of the spec):**
- "`select` → `drop`, remove-list semantics, keep the step" → Tasks 1 & 3. ✓
- "Engine node→table surface returning rows at an intermediate point, not just counts" → Task 2 (`at_step`). ✓
- Flatten-level inspection (the data tab's other half) is *already* served by the existing `level` param on `/reduce`; no work needed, and Task 2 explicitly leaves it intact. ✓
- Out of this plan (Plan 2): `TransformExplorer` / `DataTab` components, fan-in provenance arrows, inline node editors. Not engine work. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and every command shows expected output. ✓

**Type consistency:** `DropStep` (kind `"drop"`, field `columns`) is defined in Task 3 Step 1 and used identically in `makeStep`, `StepDrop`, and `PipelineSection`. Engine `kind == "drop"` (Task 1) matches the frontend `kind: "drop"` (Task 3). `at_step` is named identically in the model, endpoint, and tests (Task 2). `ReduceStepKind` is `DropStep["kind"] | FilterStep["kind"]` = `"drop" | "filter"`, matching the `["drop", "filter"]` add-menu list. ✓
