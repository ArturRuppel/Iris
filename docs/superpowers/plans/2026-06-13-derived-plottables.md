# Master Table → Derived Plottables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one master table feed many live-computed "plottables", each a saved reduction (filter + collapse) carrying its own figure and stats.

**Architecture:** Add a declarative `reduce` clause to the analysis spec (1.1→1.2, additive). The engine applies filter→collapse in pandas before the unchanged mappings→figure→stats pipeline, and returns the reduced table. The frontend moves today's global per-analysis atoms into a `Plottable[]` list and splits the UI into a maximized-table **Data** mode and a per-plottable **Analyses** mode.

**Tech Stack:** Python (FastAPI, pandas, scipy) engine tested with pytest; React + TypeScript + Jotai frontend, typechecked with `tsc` and exercised by Playwright e2e scripts (`e2e/*.mjs`).

**Reference spec:** `docs/superpowers/specs/2026-06-13-derived-plottables-design.md`

**Conventions used below**
- Engine tests: `cd engine && python -m pytest tests/test_*.py -q` (or a single `-k name`).
- Frontend typecheck gate: `npm run build` (runs `tsc && vite build`).
- The engine must be running for e2e: `cd engine && python -m triad_engine.main` and `npm run dev` in another shell; e2e scripts are run with `node e2e/<name>.mjs` (see existing `e2e/drag_test.mjs` for the Playwright launch pattern).

---

## Task 1: Spec types for the reduce clause (frontend)

**Files:**
- Modify: `src/types.ts` (add reduce types; extend `AnalysisSpec`; bump `spec_version`)

- [ ] **Step 1: Add the reduce types**

In `src/types.ts`, immediately after the `Mark` type alias (around line 24), add:

```ts
/* ---- reduction: filter rows + optionally collapse to group summaries ---- */
export type FilterOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in";
export interface FilterCond {
  column: string;
  op: FilterOp;
  value: string | number | (string | number)[]; // array only for in / not-in
}
export type AggFn = "mean" | "median" | "count" | "sum" | "sem";
export interface CollapseSpec {
  group_by: string[];                 // columns defining a group
  aggregate: Record<string, AggFn>;   // numeric column -> fn; unlisted numerics default to mean
}
export interface ReduceSpec {
  filter: FilterCond[];               // AND-ed; [] means no filter
  collapse: CollapseSpec | null;      // null means no collapse
}
export const EMPTY_REDUCE: ReduceSpec = { filter: [], collapse: null };
```

- [ ] **Step 2: Extend `AnalysisSpec` and bump the version**

In the `AnalysisSpec` interface, change the version line:

```ts
  spec_version: "1.2"; // 1.2 adds an additive `reduce` clause (filter + collapse)
```

and add this field directly after the `data:` line:

```ts
  reduce: ReduceSpec;
```

- [ ] **Step 3: Add `reduced_table` to the analyze response**

In `AnalyzeResponse`, add the reduced table the engine ran on:

```ts
export interface AnalyzeResponse {
  figure: { svg: string; point_groups: { gid: string; row_ids: string[] }[] };
  stats: StatsResult;
  reduced_table: Table;
  engine_snapshot: Record<string, string>;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: FAILS in `src/state.ts` (the `specAtom` builder does not yet set `reduce`, and `spec_version` is `"1.1"`). This is expected — Task 6 fixes state. If you want a green checkpoint now, temporarily nothing else references these new fields, so the only errors are the two in `state.ts`; proceed to fix them in Task 6. Do **not** commit a red build — commit this together with Task 6, or stub `reduce: EMPTY_REDUCE` and `spec_version: "1.2"` in `state.ts` now (one-line change) to keep green.

- [ ] **Step 5: Keep the build green (stub state.ts)**

In `src/state.ts` `specAtom`, change `spec_version: "1.1"` to `spec_version: "1.2"` and add `reduce: EMPTY_REDUCE,` right after the `data: {...}` line; add `EMPTY_REDUCE` to the type import from `./types`. Run `npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/state.ts
git commit -m "types: add reduce clause (filter + collapse) to analysis spec (1.2)"
```

---

## Task 2: Engine reduction — row filtering

**Files:**
- Create: `engine/triad_engine/reduce.py`
- Create test: `engine/tests/test_reduce.py`

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_reduce.py`:

```python
"""Reduction layer: filter rows, then optionally collapse to group summaries."""
import numpy as np
import pandas as pd
import pytest

from triad_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "treatment", "type": "categorical", "label": "Treatment",
         "levels": ["control", "drug_a"]},
        {"name": "dose", "type": "numeric", "label": "Dose"},
        {"name": "response", "type": "numeric", "label": "Response"},
    ],
}


def frame():
    rows = [
        {"id": "r1", "subject": "S1", "treatment": "control", "dose": 10.0, "response": 80.0},
        {"id": "r2", "subject": "S1", "treatment": "control", "dose": 20.0, "response": 70.0},
        {"id": "r3", "subject": "S2", "treatment": "drug_a", "dose": 10.0, "response": 60.0},
        {"id": "r4", "subject": "S2", "treatment": "drug_a", "dose": 20.0, "response": 50.0},
    ]
    return pd.DataFrame(rows)


def test_no_reduce_passes_through():
    df = frame()
    out, schema = rd.apply_reduction(df, SCHEMA, {"filter": [], "collapse": None})
    assert out.equals(df)
    assert schema == SCHEMA


def test_filter_equals_categorical():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [{"column": "treatment", "op": "==", "value": "control"}],
        "collapse": None})
    assert out["id"].tolist() == ["r1", "r2"]


def test_filter_numeric_comparison_and_ands():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [{"column": "dose", "op": ">=", "value": 20},
                   {"column": "treatment", "op": "!=", "value": "control"}],
        "collapse": None})
    assert out["id"].tolist() == ["r4"]


def test_filter_in_and_not_in():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [{"column": "treatment", "op": "in", "value": ["drug_a"]}],
        "collapse": None})
    assert out["id"].tolist() == ["r3", "r4"]


def test_filter_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, {
            "filter": [{"column": "nope", "op": "==", "value": 1}], "collapse": None})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_reduce.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'triad_engine.reduce'`.

- [ ] **Step 3: Write the filter implementation**

Create `engine/triad_engine/reduce.py`:

```python
"""Reduction layer: filter rows, then optionally collapse to group summaries.

Quantity-agnostic and pandas-only (no matplotlib, no FastAPI). The caller
removes excluded rows first; reduction never sees them.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


class ReduceError(ValueError):
    """A reduction could not be applied (bad column, bad op, etc.)."""


_NUMERIC_OPS = {
    "==": lambda s, v: s == v,
    "!=": lambda s, v: s != v,
    "<": lambda s, v: s < v,
    "<=": lambda s, v: s <= v,
    ">": lambda s, v: s > v,
    ">=": lambda s, v: s >= v,
}


def _col_type(schema: dict, name: str) -> str:
    for c in schema["columns"]:
        if c["name"] == name:
            return c["type"]
    raise ReduceError(f"unknown column {name!r}")


def _coerce(value, col_type: str):
    if col_type == "numeric":
        try:
            return float(value)
        except (TypeError, ValueError) as e:
            raise ReduceError(f"{value!r} is not numeric") from e
    return value


def _apply_filter(df: pd.DataFrame, schema: dict, conds: list[dict]) -> pd.DataFrame:
    mask = pd.Series(True, index=df.index)
    for cond in conds:
        col, op = cond["column"], cond["op"]
        ctype = _col_type(schema, col)
        if col not in df:
            raise ReduceError(f"unknown column {col!r}")
        series = df[col]
        if op in ("in", "not-in"):
            values = cond["value"]
            if not isinstance(values, (list, tuple)):
                raise ReduceError(f"{op!r} needs a list value")
            coerced = [_coerce(v, ctype) for v in values]
            m = series.isin(coerced)
            mask &= ~m if op == "not-in" else m
        elif op in _NUMERIC_OPS:
            v = _coerce(cond["value"], ctype)
            mask &= _NUMERIC_OPS[op](series, v)
        else:
            raise ReduceError(f"unknown filter op {op!r}")
    return df[mask]


def apply_reduction(df: pd.DataFrame, schema: dict,
                    reduce: dict | None) -> tuple[pd.DataFrame, dict]:
    """Filter rows, then optionally collapse. Returns (frame, schema)."""
    if not reduce:
        return df, schema
    out = _apply_filter(df, schema, reduce.get("filter") or [])
    collapse = reduce.get("collapse")
    if not collapse:
        return out.reset_index(drop=True), schema
    return _apply_collapse(out, schema, collapse)
```

Note: `_apply_collapse` is added in Task 3. To keep this task's tests runnable, add a temporary stub at the bottom that the next task replaces:

```python
def _apply_collapse(df, schema, collapse):  # replaced in Task 3
    raise NotImplementedError
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_reduce.py -q`
Expected: PASS (the 5 filter tests; no collapse test exists yet).

- [ ] **Step 5: Commit**

```bash
git add engine/triad_engine/reduce.py engine/tests/test_reduce.py
git commit -m "engine: reduce.py row filtering (eq/ne/lt/gt/in/not-in, AND-ed)"
```

---

## Task 3: Engine reduction — collapse / aggregate

**Files:**
- Modify: `engine/triad_engine/reduce.py` (replace `_apply_collapse` stub)
- Modify test: `engine/tests/test_reduce.py` (add collapse tests)

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_reduce.py`:

```python
def test_collapse_mean_per_group():
    out, schema = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [],
        "collapse": {"group_by": ["treatment"], "aggregate": {"response": "mean"}}})
    out = out.set_index("treatment")
    assert out.loc["control", "response"] == pytest.approx(75.0)
    assert out.loc["drug_a", "response"] == pytest.approx(55.0)
    # group-by column keeps its type/levels; response stays numeric
    types = {c["name"]: c["type"] for c in schema["columns"]}
    assert types["treatment"] == "categorical"
    assert types["response"] == "numeric"


def test_collapse_default_mean_for_unlisted_numeric():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [], "collapse": {"group_by": ["treatment"], "aggregate": {}}})
    out = out.set_index("treatment")
    assert out.loc["control", "dose"] == pytest.approx(15.0)
    assert out.loc["control", "response"] == pytest.approx(75.0)


def test_collapse_count_adds_n_column():
    out, schema = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [],
        "collapse": {"group_by": ["treatment"], "aggregate": {"response": "count"}}})
    assert set(out["n"]) == {2}
    assert any(c["name"] == "n" for c in schema["columns"])


def test_collapse_sem_matches_scipy():
    from scipy.stats import sem
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [],
        "collapse": {"group_by": ["treatment"], "aggregate": {"response": "sem"}}})
    out = out.set_index("treatment")
    assert out.loc["control", "response"] == pytest.approx(sem([80.0, 70.0]))


def test_collapse_assigns_fresh_row_ids():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [], "collapse": {"group_by": ["treatment"], "aggregate": {}}})
    assert "id" in out and out["id"].is_unique
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && python -m pytest tests/test_reduce.py -k collapse -q`
Expected: FAIL with `NotImplementedError`.

- [ ] **Step 3: Implement collapse**

In `engine/triad_engine/reduce.py`, add the scipy import at the top (`from scipy.stats import sem as _scipy_sem`) and replace the `_apply_collapse` stub with:

```python
_AGG = {
    "mean": "mean",
    "median": "median",
    "sum": "sum",
    "count": "size",
    "sem": lambda s: _scipy_sem(s.to_numpy(dtype=float), nan_policy="omit"),
}


def _apply_collapse(df: pd.DataFrame, schema: dict,
                    collapse: dict) -> tuple[pd.DataFrame, dict]:
    group_by = collapse["group_by"]
    if not group_by:
        raise ReduceError("collapse requires at least one group_by column")
    for col in group_by:
        if col not in df:
            raise ReduceError(f"unknown group_by column {col!r}")

    cols = {c["name"]: c for c in schema["columns"]}
    numerics = [c["name"] for c in schema["columns"]
                if c["type"] == "numeric" and c["name"] in df
                and c["name"] not in group_by]
    agg = dict(collapse.get("aggregate") or {})
    wants_count = any(fn == "count" for fn in agg.values())

    grouped = df.groupby(group_by, observed=True, sort=False)
    data: dict[str, list] = {}
    for col in numerics:
        fn = agg.get(col, "mean")
        if fn == "count":
            continue  # represented by the shared n column below
        data[col] = grouped[col].agg(_AGG[fn]).to_numpy()
    keys = list(grouped.groups.keys())

    out = pd.DataFrame()
    for i, gcol in enumerate(group_by):
        out[gcol] = [k if len(group_by) == 1 else k[i] for k in keys]
    for col, vals in data.items():
        out[col] = vals
    if wants_count:
        out["n"] = grouped.size().to_numpy()
    out.insert(0, "id", [f"g{i+1}" for i in range(len(out))])
    out["excluded"] = False

    # fresh schema: group-by columns keep their defs; numerics stay numeric; +n
    new_cols = []
    for gcol in group_by:
        new_cols.append(cols[gcol])
    for col in data:
        new_cols.append(cols[col])
    if wants_count:
        new_cols.append({"name": "n", "type": "numeric", "label": "n"})
    new_schema = {**schema, "columns": new_cols}
    return out.reset_index(drop=True), new_schema
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && python -m pytest tests/test_reduce.py -q`
Expected: PASS (all filter + collapse tests).

- [ ] **Step 5: Commit**

```bash
git add engine/triad_engine/reduce.py engine/tests/test_reduce.py
git commit -m "engine: reduce.py collapse (group_by + mean/median/sum/count/sem)"
```

---

## Task 4: Wire reduction into the analyze pipeline

**Files:**
- Modify: `engine/triad_engine/main.py:65-101` (`_prepare`, `_run`) and `:114-120` (`/analyze`)
- Modify test: `engine/tests/test_engine.py` (add reduce-through-endpoint tests)

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_engine.py`:

```python
# ---------------- reduce clause ----------------

def _spec_with_reduce(reduce, **mapping):
    spec = make_spec()
    spec["reduce"] = reduce
    spec["spec_version"] = "1.2"
    spec["mappings"].update(mapping)
    return spec


def test_analyze_filter_changes_n():
    spec = _spec_with_reduce(
        {"filter": [{"column": "treatment", "op": "==", "value": "control"}],
         "collapse": None})
    spec["stats"]["family"] = "descriptive"
    spec["layers"] = [{"mark": "histogram", "options": {}}]
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    assert r.json()["stats"]["result"]["n"] == 20  # only control rows
    assert len(r.json()["reduced_table"]["rows"]) == 20


def test_analyze_collapse_makes_stats_per_group():
    # collapse dose+response to the subject level, then compare across subjects
    table = make_table()
    spec = _spec_with_reduce(
        {"filter": [],
         "collapse": {"group_by": ["treatment", "subject"],
                      "aggregate": {"response": "mean"}}},
        x={"column": "treatment"}, y={"column": "response"})
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200
    body = r.json()
    # one row per subject after collapse; 40 subjects -> 40 reduced rows
    assert len(body["reduced_table"]["rows"]) == 40
    # n per group equals subjects per treatment, not raw observations
    assert body["stats"]["summaries"][0]["n"] == 20


def test_analyze_reduce_error_is_422():
    spec = _spec_with_reduce(
        {"filter": [{"column": "ghost", "op": "==", "value": 1}], "collapse": None})
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 422


def test_analyze_without_reduce_key_still_works():
    # old specs (no `reduce`) behave exactly as before
    spec = make_spec()
    assert "reduce" not in spec
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    assert len(r.json()["reduced_table"]["rows"]) == 40
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && python -m pytest tests/test_engine.py -k "reduce or collapse_makes" -q`
Expected: FAIL — `reduced_table` is missing from the response (KeyError) and reduce is not applied.

- [ ] **Step 3: Wire reduction into `_run`**

In `engine/triad_engine/main.py`, add the import (line 17 area):

```python
from . import compiler, document, importer, reduce as reduce_mod, stats
```

Add a helper that turns a frame + schema back into a transport table, after `_prepare`:

```python
def _to_table(df: pd.DataFrame, schema: dict) -> dict:
    return {"schema": schema, "rows": json.loads(df.to_json(orient="records"))}
```

(and add `import json` near the top imports).

Rewrite `_run` to reduce before stats, threading the reduced schema through:

```python
def _run(table: dict, spec: dict):
    df, schema = _prepare(table, spec)
    try:
        df, schema = reduce_mod.apply_reduction(df, schema, spec.get("reduce"))
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e
    m = spec["mappings"]
    family = spec["stats"]["family"]
    alpha = spec["stats"].get("alpha", 0.05)
    override = (spec["stats"].get("test")
                if spec["stats"].get("chosen_by") == "user_override" else None)
    if family == "group_comparison":
        xcol = next(c for c in schema["columns"] if c["name"] == m["x"]["column"])
        res = stats.group_comparison(
            df, m["x"]["column"], m["y"]["column"],
            levels=xcol.get("levels", []), alpha=alpha, override=override)
    elif family == "correlation":
        res = stats.correlation(df, m["x"]["column"], m["y"]["column"],
                                alpha=alpha, override=override)
    elif family == "descriptive":
        res = stats.descriptive(df, m["y"]["column"], alpha=alpha)
    else:
        raise HTTPException(400, f"unknown stats family {family!r}")
    if "error" in res:
        raise HTTPException(422, res["error"])
    fig, point_groups = compiler.build_figure(df, schema, spec, res)
    return fig, point_groups, res, df, schema
```

> **Type note:** `group_comparison` needs the x column's `levels`. After a collapse on a categorical `group_by`, the reduced schema reuses that column's original def, so its `levels` survive — `xcol.get("levels", [])` keeps working. If `x` is a `group_by` column with no declared `levels`, `stats.group_comparison` derives them from the data (existing behavior); no change needed.

- [ ] **Step 4: Return `reduced_table` from `/analyze`**

Update the `/analyze` endpoint and the `_run` call sites. `analyze`:

```python
@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    fig, point_groups, res, df, schema = _run(req.table, req.spec)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return {"figure": {"svg": svg, "point_groups": point_groups},
            "stats": res, "reduced_table": _to_table(df, schema),
            "engine_snapshot": engine_snapshot()}
```

Update `export` to unpack the wider tuple (it ignores the extras):

```python
    fig, _, _, _, _ = _run(req.table, req.spec)
```

- [ ] **Step 5: Run the full engine suite**

Run: `cd engine && python -m pytest tests -q`
Expected: PASS — the new reduce tests plus all existing tests (the no-`reduce` regression guard `test_analyze_without_reduce_key_still_works` and every tier-1/2 test stay green).

- [ ] **Step 6: Commit**

```bash
git add engine/triad_engine/main.py engine/tests/test_engine.py
git commit -m "engine: apply reduce clause before stats; return reduced_table from /analyze"
```

---

## Task 5: Frontend plottable model + state refactor

**Files:**
- Modify: `src/state.ts` (introduce `Plottable`, list/active/mode atoms; refactor `specAtom`, `loadTableAtom`; add CRUD atoms)

This task keeps the UI working as a single plottable; Task 7 adds multi-plottable UI. Verified by `npm run build` (typecheck) and the existing app still rendering one analysis.

- [ ] **Step 1: Define the Plottable record and atoms**

In `src/state.ts`, add the `ReduceSpec`/`EMPTY_REDUCE` imports to the `./types` import, then replace the per-analysis singleton atoms (`mappingsAtom`, `overrideAtom`, `presetAtom`, `plotTypeAtom`, `styleAtom`) with a plottable list. Add:

```ts
import { EMPTY_REDUCE, type ReduceSpec } from "./types";

export interface Plottable {
  id: string;
  name: string;
  mappings: { x: string; y: string };
  plotType: PlotType;
  override: TestName | null;
  preset: string;
  style: StyleOverrides;
  reduce: ReduceSpec;
}

let _pid = 0;
const nextId = () => `pt_${Date.now().toString(36)}_${_pid++}`;

export function makeDefaultPlottable(schema: Schema): Plottable {
  const cats = schema.columns.filter((c) => c.type === "categorical");
  const nums = schema.columns.filter((c) => c.type === "numeric");
  let plotType: PlotType = "dots";
  if (cats.length === 0) plotType = nums.length >= 2 ? "scatter" : "histogram";
  const kind = PLOT_TYPES[plotType].xKind;
  const y = nums[nums.length - 1]?.name ?? "";
  const x = kind === "numeric"
    ? (nums.find((c) => c.name !== y)?.name ?? y)
    : (cats[0]?.name ?? "");
  return {
    id: nextId(), name: "Analysis 1",
    mappings: { x, y }, plotType, override: null,
    preset: "demo_default", style: {}, reduce: EMPTY_REDUCE,
  };
}

export const plottablesAtom = atom<Plottable[]>([]);
export const activePlottableIdAtom = atom<string | null>(null);
export const viewModeAtom = atom<"data" | "analyses">("data");

/* the active plottable, read/write; writing replaces it in the list */
export const activePlottableAtom = atom(
  (get): Plottable | null => {
    const id = get(activePlottableIdAtom);
    return get(plottablesAtom).find((p) => p.id === id) ?? null;
  },
  (get, set, next: Plottable) => {
    set(plottablesAtom, get(plottablesAtom).map((p) => (p.id === next.id ? next : p)));
  },
);

/* per-plottable analyze results, keyed by id (instant switching) */
export const analysisByIdAtom = atom<Record<string, AnalyzeResponse>>({});
```

Keep `analysisAtom` as a derived convenience for the active plottable so existing components need a smaller diff:

```ts
export const analysisAtom = atom(
  (get) => {
    const id = get(activePlottableIdAtom);
    return id ? (get(analysisByIdAtom)[id] ?? null) : null;
  },
  (get, set, res: AnalyzeResponse | null) => {
    const id = get(activePlottableIdAtom);
    if (!id) return;
    const map = { ...get(analysisByIdAtom) };
    if (res) map[id] = res; else delete map[id];
    set(analysisByIdAtom, map);
  },
);
```

- [ ] **Step 2: Refactor `specAtom` to read the active plottable**

Replace the `specAtom` body so it reads from `activePlottableAtom` instead of the deleted singletons, emits the `reduce` clause and `spec_version: "1.2"`, and uses the plottable's `id`/`name` for `id`/`title`:

```ts
export const specAtom = atom<AnalysisSpec | null>((get) => {
  const schema = get(schemaAtom);
  const p = get(activePlottableAtom);
  if (!schema || !p) return null;
  const pt = PLOT_TYPES[p.plotType];
  const recRaw = get(analysisAtom)?.stats.recommendation.test as TestName | undefined;
  const rec = recRaw && pt.tests.includes(recRaw) ? recRaw : undefined;
  const ycol = schema.columns.find((c) => c.name === p.mappings.y);
  const xcol = schema.columns.find((c) => c.name === p.mappings.x);
  const test = (p.override && pt.tests.includes(p.override) ? p.override : null)
    ?? rec ?? pt.tests[0];
  const usedOverride = p.override !== null && test === p.override && test !== rec;
  return {
    spec_version: "1.2",
    id: p.id,
    title: p.name,
    data: { filter: [], respect_exclusions: true },
    reduce: p.reduce,
    mappings: { x: { column: p.mappings.x }, y: { column: p.mappings.y },
                color: pt.xKind === "categorical" ? { column: p.mappings.x } : null,
                pair_by: null, facet: null },
    layers: pt.layers,
    stats: {
      family: pt.family, test,
      chosen_by: usedOverride ? "user_override"
        : rec ? "recommendation_accepted" : "default",
      alternatives_offered: pt.tests.filter((t) => t !== test),
      assumption_checks: [{ check: "shapiro_wilk",
                            per: pt.family === "group_comparison" ? "group" : "variable" }],
      alpha: 0.05,
      report: ["effect_size", "ci", "n_per_group"],
    },
    annotations: { significance_brackets: "auto", show_n: true },
    style: { preset: p.preset, overrides: p.style },
    engine_snapshot: get(engineSnapshotAtom) ?? {},
  };
});
```

> Note the title now comes from the plottable `name` (the design's "reuse title as the sidebar label" decision). The old auto-title (`"Y by X"`) is dropped in favor of the user-facing name; the initial name is set per plottable on creation (`makeDefaultPlottable` / add).

- [ ] **Step 3: Refactor `loadTableAtom` to seed one plottable**

```ts
export const loadTableAtom = atom(null, (get, set, table: Table) => {
  set(schemaAtom, table.schema);
  set(rowsAtom, table.rows);
  set(exclusionLogAtom, []);
  set(engineErrorAtom, null);
  set(selectedRowIdAtom, null);
  set(analysisByIdAtom, {});
  const first = makeDefaultPlottable(table.schema);
  set(plottablesAtom, [first]);
  set(activePlottableIdAtom, first.id);
});
```

- [ ] **Step 4: Add CRUD atoms**

```ts
export const addPlottableAtom = atom(null, (get, set) => {
  const schema = get(schemaAtom);
  if (!schema) return;
  const p = makeDefaultPlottable(schema);
  p.name = `Analysis ${get(plottablesAtom).length + 1}`;
  set(plottablesAtom, [...get(plottablesAtom), p]);
  set(activePlottableIdAtom, p.id);
});

export const duplicatePlottableAtom = atom(null, (get, set, id: string) => {
  const src = get(plottablesAtom).find((p) => p.id === id);
  if (!src) return;
  const copy: Plottable = {
    ...src, id: nextId(), name: `${src.name} copy`,
    mappings: { ...src.mappings }, style: { ...src.style },
    reduce: { filter: src.reduce.filter.map((f) => ({ ...f })),
              collapse: src.reduce.collapse
                ? { group_by: [...src.reduce.collapse.group_by],
                    aggregate: { ...src.reduce.collapse.aggregate } } : null },
  };
  set(plottablesAtom, [...get(plottablesAtom), copy]);
  set(activePlottableIdAtom, copy.id);
});

export const renamePlottableAtom = atom(null, (get, set, arg: { id: string; name: string }) => {
  set(plottablesAtom, get(plottablesAtom).map(
    (p) => (p.id === arg.id ? { ...p, name: arg.name } : p)));
});

export const deletePlottableAtom = atom(null, (get, set, id: string) => {
  const list = get(plottablesAtom);
  if (list.length <= 1) return; // always keep >= 1
  const idx = list.findIndex((p) => p.id === id);
  const next = list.filter((p) => p.id !== id);
  set(plottablesAtom, next);
  if (get(activePlottableIdAtom) === id)
    set(activePlottableIdAtom, next[Math.max(0, idx - 1)].id);
  const map = { ...get(analysisByIdAtom) }; delete map[id];
  set(analysisByIdAtom, map);
});
```

- [ ] **Step 5: Update `App.tsx` to the new atoms (keep single-plottable behavior)**

`App.tsx` currently destructures `mappingsAtom`, `plotTypeAtom`, `presetAtom`, `overrideAtom`, `styleAtom`. Re-point those reads/writes at the active plottable. Replace the relevant hook lines with:

```tsx
const [active, setActive] = useAtom(activePlottableAtom);
// derive locals from the active plottable (guard null with `?`):
const mappings = active?.mappings ?? { x: "", y: "" };
const plotType = active?.plotType ?? "dots";
const preset = active?.preset ?? "demo_default";
const style = active?.style ?? {};
const setMappings = (m: { x: string; y: string }) =>
  active && setActive({ ...active, mappings: m });
const setPreset = (preset: string) => active && setActive({ ...active, preset });
const setOverride = (override: TestName | null) =>
  active && setActive({ ...active, override });
const setPlotType = (plotType: PlotType) => active && setActive({ ...active, plotType });
```

Adjust `switchPlotType` to use `setPlotType`/`setOverride`/`setMappings` as above (the logic is unchanged; it now writes through the active plottable). Replace the seeding effect that did `setSchema(t.schema); setRows(t.rows);` with the load atom:

```tsx
const loadTable = useSetAtom(loadTableAtom);
// in the bootstrap effect, after engine.sample():
.then((t) => loadTable(t))
```

Replace `doSave`'s `[spec]` with all plottables' specs (the spec builder reads the *active* one, so build each by temporarily — simplest: keep `[spec]` for now and finish multi-spec save in Task 8). Leave a `// TODO(Task 8): save all plottables` comment.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: PASS. (If `DEFAULT_PALETTE` or other now-unused exports trip `noUnusedLocals`, keep them — they are still imported elsewhere; only remove a symbol if `tsc` reports it unused.)

- [ ] **Step 7: Commit**

```bash
git add src/state.ts src/App.tsx
git commit -m "state: plottable list model + active/mode atoms; specAtom reads active plottable"
```

---

## Task 6: Reduced-table view + reduce response plumbing

**Files:**
- Modify: `src/App.tsx` (store `reduced_table` from the response; pass to a viewer)
- Create: `src/components/ReducedTable.tsx` (read-only grid of the reduced rows)

- [ ] **Step 1: Surface the reduced table in state**

`analysisAtom` already carries the whole `AnalyzeResponse` (now including `reduced_table`). No new atom needed — consumers read `analysis.reduced_table`. Confirm `AnalyzeResponse` import path is correct in components that will read it.

- [ ] **Step 2: Build the read-only reduced-table component**

Create `src/components/ReducedTable.tsx` — a minimal read-only AG Grid mirroring `DataTable`'s column setup but non-editable, driven by `analysisAtom`:

```tsx
import { useAtomValue } from "jotai";
import { AgGridReact } from "ag-grid-react";
import { analysisAtom } from "../state";

export function ReducedTable() {
  const analysis = useAtomValue(analysisAtom);
  if (!analysis) return null;
  const { schema, rows } = analysis.reduced_table;
  const colDefs = schema.columns.map((c) => ({
    field: c.name, headerName: c.label, editable: false, sortable: true,
  }));
  return (
    <div className="reduced-table ag-theme-quartz" style={{ height: "100%" }}>
      <AgGridReact rowData={rows} columnDefs={colDefs} />
    </div>
  );
}
```

> Match the exact AG Grid import/theme setup used by `src/components/DataTable.tsx` (module registration, theme class). Read that file first and mirror its boilerplate so registration is not duplicated incorrectly.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReducedTable.tsx
git commit -m "ui: read-only reduced-table view driven by analyze response"
```

---

## Task 7: Two-mode workspace + Reduce panel UI

**Files:**
- Modify: `src/App.tsx` (mode toggle; Data vs Analyses layout; plottable sidebar; collapsible triad sections)
- Create: `src/components/PlottableSidebar.tsx` (list + add/duplicate/rename/delete)
- Create: `src/components/ReducePanel.tsx` (filter builder + collapse pickers)
- Create test: `e2e/plottables_test.mjs` (Playwright)

- [ ] **Step 1: Build the plottable sidebar**

Create `src/components/PlottableSidebar.tsx`:

```tsx
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  activePlottableIdAtom, addPlottableAtom, deletePlottableAtom,
  duplicatePlottableAtom, plottablesAtom, renamePlottableAtom,
} from "../state";

export function PlottableSidebar() {
  const plottables = useAtomValue(plottablesAtom);
  const [activeId, setActiveId] = useAtom(activePlottableIdAtom);
  const add = useSetAtom(addPlottableAtom);
  const dup = useSetAtom(duplicatePlottableAtom);
  const del = useSetAtom(deletePlottableAtom);
  const rename = useSetAtom(renamePlottableAtom);
  return (
    <aside className="plottable-sidebar">
      <button className="add-plottable" onClick={() => add()}>+ Analysis</button>
      <ul>
        {plottables.map((p) => (
          <li key={p.id} className={p.id === activeId ? "active" : ""}
              onClick={() => setActiveId(p.id)}>
            <input value={p.name} onClick={(e) => e.stopPropagation()}
              onChange={(e) => rename({ id: p.id, name: e.target.value })} />
            <button title="Duplicate" onClick={(e) => { e.stopPropagation(); dup(p.id); }}>⧉</button>
            <button title="Delete" disabled={plottables.length <= 1}
              onClick={(e) => { e.stopPropagation(); del(p.id); }}>✕</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

> Replace the duplicate-button glyph with a plain `⧉` or the text "copy"; the exact icon is cosmetic. Keep `e.stopPropagation()` so editing the name or clicking a row-button does not also re-select.

- [ ] **Step 2: Build the Reduce panel**

Create `src/components/ReducePanel.tsx`. It edits `active.reduce` through `activePlottableAtom`. Filter rows = (column, op, value) triples; collapse = group-by checkboxes + per-numeric aggregate select.

```tsx
import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, schemaAtom } from "../state";
import type { AggFn, FilterOp } from "../types";

const OPS: FilterOp[] = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in"];
const AGGS: AggFn[] = ["mean", "median", "count", "sum", "sem"];

export function ReducePanel() {
  const schema = useAtomValue(schemaAtom);
  const [p, setP] = useAtom(activePlottableAtom);
  if (!schema || !p) return null;
  const cols = schema.columns;
  const numerics = cols.filter((c) => c.type === "numeric");
  const reduce = p.reduce;

  const setReduce = (r: typeof reduce) => setP({ ...p, reduce: r });
  const addFilter = () => setReduce({ ...reduce,
    filter: [...reduce.filter, { column: cols[0].name, op: "==", value: "" }] });
  const setFilter = (i: number, patch: Partial<typeof reduce.filter[0]>) =>
    setReduce({ ...reduce,
      filter: reduce.filter.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const rmFilter = (i: number) =>
    setReduce({ ...reduce, filter: reduce.filter.filter((_, j) => j !== i) });

  const toggleGroup = (name: string) => {
    const c = reduce.collapse;
    const group_by = c?.group_by ?? [];
    const next = group_by.includes(name)
      ? group_by.filter((g) => g !== name) : [...group_by, name];
    setReduce({ ...reduce,
      collapse: next.length ? { group_by: next, aggregate: c?.aggregate ?? {} } : null });
  };
  const setAgg = (col: string, fn: AggFn) => {
    if (!reduce.collapse) return;
    setReduce({ ...reduce,
      collapse: { ...reduce.collapse,
        aggregate: { ...reduce.collapse.aggregate, [col]: fn } } });
  };

  return (
    <div className="reduce-panel">
      <div className="reduce-filter">
        <strong>Filter rows</strong>
        {reduce.filter.map((f, i) => (
          <div key={i} className="filter-row">
            <select value={f.column}
              onChange={(e) => setFilter(i, { column: e.target.value })}>
              {cols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
            </select>
            <select value={f.op}
              onChange={(e) => setFilter(i, { op: e.target.value as FilterOp })}>
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input value={Array.isArray(f.value) ? f.value.join(",") : String(f.value)}
              onChange={(e) => setFilter(i, {
                value: (f.op === "in" || f.op === "not-in")
                  ? e.target.value.split(",").map((s) => s.trim())
                  : e.target.value })} />
            <button onClick={() => rmFilter(i)}>✕</button>
          </div>
        ))}
        <button onClick={addFilter}>+ condition</button>
      </div>
      <div className="reduce-collapse">
        <strong>Collapse</strong>
        <div className="group-by">
          {cols.map((c) => (
            <label key={c.name}>
              <input type="checkbox"
                checked={reduce.collapse?.group_by.includes(c.name) ?? false}
                onChange={() => toggleGroup(c.name)} /> {c.label}
            </label>
          ))}
        </div>
        {reduce.collapse && (
          <div className="aggregates">
            {numerics.filter((c) => !reduce.collapse!.group_by.includes(c.name)).map((c) => (
              <label key={c.name}>{c.label}
                <select value={reduce.collapse!.aggregate[c.name] ?? "mean"}
                  onChange={(e) => setAgg(c.name, e.target.value as AggFn)}>
                  {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

> Value typing: filter values are entered as strings here; the engine coerces numeric columns via `_coerce`, so a string `"20"` against a numeric column works. No client-side numeric parsing required.

- [ ] **Step 3: Add the mode toggle + two layouts to App.tsx**

In `App.tsx`, read `viewModeAtom` and render two layouts. Add a header toggle:

```tsx
const [viewMode, setViewMode] = useAtom(viewModeAtom);
// in <header>, near the title:
<div className="mode-toggle">
  <button className={viewMode === "data" ? "active" : ""}
    onClick={() => setViewMode("data")}>Data</button>
  <button className={viewMode === "analyses" ? "active" : ""}
    onClick={() => setViewMode("analyses")}>Analyses</button>
</div>
```

Replace `<main>`:

```tsx
<main>
  {viewMode === "data" ? (
    <div className="data-mode"><DataTable /></div>
  ) : (
    <div className="analyses-mode">
      <PlottableSidebar />
      <div className="triad">
        <Section title="Reduced table" defaultOpen>
          <ReducePanel />
          <ReducedTable />
        </Section>
        <Section title="Figure" defaultOpen><FigurePane /></Section>
        <Section title="Statistics" defaultOpen><StatsPanel /></Section>
      </div>
    </div>
  )}
</main>
```

Add a tiny `Section` collapsible helper in `App.tsx` (or `src/components/Section.tsx`):

```tsx
function Section({ title, defaultOpen, children }:
  { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="triad-section">
      <button className="section-header" onClick={() => setOpen((o) => !o)}>
        <span className="chevron">{open ? "▾" : "▸"}</span> {title}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
```

Move the plot/X/Y/size controls (currently always in the header) so they only show in Analyses mode — they configure the active plottable, which is meaningless in Data mode. Simplest: wrap that `.controls` cluster in `{viewMode === "analyses" && (...)}`; keep Import/DataEntry/Save always available.

- [ ] **Step 4: Add minimal CSS**

In `src/index.css`, add layout rules (sizes are starting points):

```css
.mode-toggle button.active { font-weight: 600; }
.analyses-mode { display: flex; gap: 12px; height: 100%; }
.plottable-sidebar { width: 200px; flex: 0 0 auto; overflow: auto; }
.plottable-sidebar li.active { background: #e2e8f0; }
.plottable-sidebar li { display: flex; align-items: center; gap: 4px; }
.triad { flex: 1 1 auto; overflow: auto; }
.triad-section .section-header { width: 100%; text-align: left; }
.data-mode { height: 100%; }
.filter-row { display: flex; gap: 4px; margin: 2px 0; }
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Write the e2e test**

Create `e2e/plottables_test.mjs`, modeled on `e2e/drag_test.mjs` (same Playwright launch + dev-server assumption). It must: load the app (sample data auto-loads), switch to Analyses mode, add a second plottable, apply a filter on the first, and assert the reduced table row count drops.

```js
import { chromium } from "playwright";

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);
await page.waitForSelector(".app");

// enter Analyses mode
await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".analyses-mode");

// sample data: 40 rows, 20 control. Filter treatment == control.
await page.click(".reduce-filter button:has-text('+ condition')");
await page.selectOption(".filter-row select:nth-of-type(1)", "treatment");
await page.selectOption(".filter-row select:nth-of-type(2)", "==");
await page.fill(".filter-row input", "control");

// wait for the debounced re-analyze, then count reduced rows
await page.waitForTimeout(600);
const rows = await page.locator(".reduced-table .ag-center-cols-container [role='row']").count();
if (rows !== 20) { console.error(`expected 20 reduced rows, got ${rows}`); process.exit(1); }

// add a second plottable
await page.click(".add-plottable");
const count = await page.locator(".plottable-sidebar li").count();
if (count !== 2) { console.error(`expected 2 plottables, got ${count}`); process.exit(1); }

console.log("plottables e2e ok");
await browser.close();
```

- [ ] **Step 7: Run the e2e test**

Start the engine (`cd engine && python -m triad_engine.main`) and dev server (`npm run dev`) in separate shells, then:
Run: `node e2e/plottables_test.mjs`
Expected: prints `plottables e2e ok`, exits 0. (The AG Grid row selector may need adjusting to the actual DOM — open the page once and confirm the reduced-table row container class before finalizing the selector.)

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/PlottableSidebar.tsx src/components/ReducePanel.tsx src/index.css e2e/plottables_test.mjs
git commit -m "ui: Data/Analyses modes, plottable sidebar, reduce panel, collapsible triad"
```

---

## Task 8: Multi-plottable documents (.viz)

**Files:**
- Modify: `src/App.tsx` (`doSave` serializes all plottables; load maps `analyses[]` → plottables)
- Modify: `src/state.ts` (add `plottablesToSpecs` + `specsToPlottables` with migration)
- Modify test: `engine/tests/test_engine.py` (multi-analysis roundtrip already supported; add a reduce-carrying roundtrip)

- [ ] **Step 1: Engine roundtrip test for a reduce-carrying spec**

Append to `engine/tests/test_engine.py`:

```python
def test_document_roundtrip_keeps_reduce_clause():
    table = make_table()
    spec = make_spec()
    spec["spec_version"] = "1.2"
    spec["reduce"] = {"filter": [{"column": "treatment", "op": "==", "value": "control"}],
                      "collapse": {"group_by": ["subject"], "aggregate": {"response": "mean"}}}
    saved = document.save_document(table["schema"], table["rows"], [spec, make_spec()],
                                   {"exclusions": []}, {"engine": "test"})
    doc = document.load_document(saved)
    assert len(doc["analyses"]) == 2
    assert doc["analyses"][0]["reduce"]["collapse"]["group_by"] == ["subject"]
```

Run: `cd engine && python -m pytest tests/test_engine.py -k roundtrip_keeps_reduce -q` → PASS (the document layer is spec-agnostic; this guards that the reduce clause survives).

- [ ] **Step 2: Add spec↔plottable mapping with migration in state.ts**

To save every plottable (not just the active one) without temporarily swapping the active id, factor the spec-building pure function out of `specAtom`. Extract a `buildSpec(schema, plottable, rec, snapshot)` helper and have both `specAtom` and the save path call it:

```ts
export function buildSpec(schema: Schema, p: Plottable,
                          rec: TestName | undefined,
                          snapshot: Record<string, string>): AnalysisSpec {
  /* move the existing specAtom body here, parameterized */
}
```

Migration (load): map each stored `AnalysisSpec` back to a `Plottable`, stamping a default `reduce` for pre-1.2 specs:

```ts
export function specToPlottable(spec: AnalysisSpec, schema: Schema): Plottable {
  const reduce: ReduceSpec = (spec as any).reduce ?? EMPTY_REDUCE;
  const plotType = inferPlotType(spec); // map spec.layers/stats.family back to a PlotType
  return {
    id: spec.id || nextId(),
    name: spec.title || "Analysis",
    mappings: { x: spec.mappings.x.column, y: spec.mappings.y.column },
    plotType,
    override: spec.stats.chosen_by === "user_override" ? spec.stats.test : null,
    preset: spec.style.preset,
    style: spec.style.overrides ?? {},
    reduce,
  };
}
```

`inferPlotType(spec)`: match `spec.stats.family` + the layer marks against the `PLOT_TYPES` table (e.g. family `correlation` → `scatter`; `descriptive` → `histogram`; `group_comparison` with a `box` mark → `box`, with `violin` → `violin`, with `bar` → `bar`, else `dots`). Implement as a small switch over `spec.layers.map(l => l.mark)`.

- [ ] **Step 3: Save all plottables**

In `App.tsx` `doSave`, build a spec per plottable and save them all:

```tsx
const doSave = async () => {
  if (!schema) return;
  const rec = undefined; // recommendations are per-result; save the user's config
  const specs = store.get(plottablesAtom).map((p) =>
    buildSpec(schema, p, rec, store.get(engineSnapshotAtom) ?? {}));
  const f = await engine.saveDocument({ schema, rows }, specs, { exclusions: exclusionLog });
  downloadBase64(f.filename, f.data_base64);
};
```

(Use `useAtomValue(plottablesAtom)` rather than a `store` if that matches the file's existing pattern — `App.tsx` uses hooks, so read `const plottables = useAtomValue(plottablesAtom);` at the top and map over it.)

- [ ] **Step 4: Load maps analyses[] → plottables**

Wherever document load is wired (add a "Load .viz" affordance if not present, or extend the existing one), after fetching `{schema, rows, analyses}`:

```tsx
setSchema(doc.schema); setRows(doc.rows);
const ps = doc.analyses.map((a) => specToPlottable(a, doc.schema));
setPlottables(ps.length ? ps : [makeDefaultPlottable(doc.schema)]);
setActiveId((ps[0] ?? makeDefaultPlottable(doc.schema)).id);
```

> If no load-document UI exists yet in `App.tsx`, scope this step to wiring `specToPlottable` + `plottablesAtom` population behind the existing load path; do not build a new file picker if one isn't already there — note it as a follow-on in the commit message.

- [ ] **Step 5: Typecheck + engine suite**

Run: `npm run build` → PASS
Run: `cd engine && python -m pytest tests -q` → PASS

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/state.ts engine/tests/test_engine.py
git commit -m "doc: save/load all plottables through analyses[]; migrate pre-1.2 specs"
```

---

## Task 9: Roadmap update + final verification

**Files:**
- Modify: `ROADMAP.md` (note derived plottables landed)

- [ ] **Step 1: Run both suites green**

Run: `cd engine && python -m pytest tests -q` → all pass
Run: `npm run build` → passes
Run (with engine + dev server up): `node e2e/plottables_test.mjs` → ok

- [ ] **Step 2: Record in the roadmap**

Add a sentence to the Tier 2 status block in `ROADMAP.md` noting: one master table now feeds many live-computed plottables (saved filter + collapse reductions), each with its own figure and stats; spec bumped to 1.2 with an additive `reduce` clause and migration.

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "roadmap: derived plottables (filter + collapse reductions) landed"
```

---

## Out of scope (follow-ons, not in this plan)

- Derived/computed columns (`transform` clause).
- Superplots / two-level (raw + collapsed) display.
- Cross-plottable / cross-table joins; multiple master tables.
- Saved reusable filter/collapse presets.
- Per-plottable export bundle (all figures + combined stats table).
