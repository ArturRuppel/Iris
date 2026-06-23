# COV2D Absorption — Tier B/C Implementation Plan (buildable slice)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Tier B/C reduce-step nodes that do **not** depend on the
`un-force-nesting` collapse-plan work, proving each reproduces its COV2D prep op
on a fixture, against the already-landed engine (`drop`/`filter`/`derive`/`recode`
/`join` are on `main`).

**Spec:** `docs/superpowers/specs/2026-06-24-cov2d-absorption-tier-b-c-design.md`

## Scope — why this is exactly the independent half

`un-force-nesting` works in `engine/iris_engine/hierarchy.py` (the collapse/flatten
stage); these nodes live in `engine/iris_engine/reduce.py`, which is **byte-identical
on `main` and `un-force-nesting`**. The seam is clean.

**In (this plan):**
- **B2** — `derive` boolean (comparison → 0/1) + string concat (`opp`, the `ev` key).
- **C2** — `pivot`/unstack (long→wide with an internal aggregate + 0-fill): §4's `opp → s,o`.
- **C4** — grid-completion (cross-join observed ids × a fixed category list, internal count, 0-fill): §5's `pos × tt` rate grid.
- **C5** — expression-valued `filter` (a quantile bound): §5's tail-clip at the 99th pct of `|L|`, with the realized bound logged to provenance.
- **Frontend** — mirror the new vocabulary in `src/types.ts` + `src/explorer/graph.ts` (linear single-edge steps; no authoring UI).

**Out (needs `un-force-nesting`, deferred):**
- **C1** arbitrary-grain aggregate — *is* the `un-force-nesting` `CollapsePlan`; do not duplicate.
- **C3** post-aggregate `derive`'s pseudoreplication **guard** — rides the `un-force-nesting` guard machinery.
- **B1** N-way join & **B3** split-and-map recode — both reduce to *composing landed steps*: per_cell_features is a chain of landed `join`s (each per-cell⋈per-cell inner = the landed merge), and `_ttype` is a **flat enumerated `recode`** over the finite contact-type vocabulary (landed `recode`, no parser). No new code; verified as composition tests only, and only end-to-end once C1 yields the per-cell tables.
- The **§3/§4/§5 end-to-end figure assembly** — needs C1 to form `per_cell_features`.

**Acceptance:** each new step has unit tests asserting it reproduces its pandas op
on a small fixture; the full engine suite stays green; `tsc` + Vite build clean.

## File Structure

**Engine (modify):** `engine/iris_engine/reduce.py` — extend `_eval_derive` (B2),
add `_apply_pivot` (C2), `_apply_grid_complete` (C4), extend `_apply_filter` for an
expression bound (C5); dispatch branches in `_apply_step`.

**Engine (create):** `engine/tests/test_reduce_derive_ops.py` (B2),
`test_reduce_pivot.py` (C2), `test_reduce_grid_complete.py` (C4),
`test_reduce_filter_expr.py` (C5).

**Frontend (modify):** `src/types.ts` (step unions + `EdgeKind`),
`src/explorer/graph.ts` (+ `graph.test.ts`).

---

## Task 1: B2 — `derive` boolean (comparison) + string concat

`opp = (focal_label != neighbor_label)` and `ev = experiment_id +"|"+ position_id +"|"+ str(t1_event_id)`.
Extend the landed `_eval_derive` AST: comparisons → int 0/1; `str` constants and
`+` over strings; a `str(col)` cast.

**Files:** Modify `engine/iris_engine/reduce.py` (`_eval_derive`); test `engine/tests/test_reduce_derive_ops.py`.

- [ ] **Step 1: Failing test**

```python
# engine/tests/test_reduce_derive_ops.py
"""derive: comparison -> 0/1, string concat, str() cast."""
import pandas as pd, pytest
from iris_engine import reduce as rd

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "a", "type": "categorical", "label": "A", "levels": ["x", "y"]},
    {"name": "b", "type": "categorical", "label": "B", "levels": ["x", "y"]},
    {"name": "e", "type": "identifier", "label": "E"},
    {"name": "n", "type": "numeric", "label": "N"}]}

def frame():
    return pd.DataFrame([
        {"id": "r1", "a": "x", "b": "y", "e": "E1", "n": 3},
        {"id": "r2", "a": "x", "b": "x", "e": "E1", "n": 7}])

def d(col, expr): return {"kind": "derive", "column": col, "expr": expr}

def test_comparison_yields_int_flag():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [d("opp", "a != b")])
    assert out["opp"].tolist() == [1, 0]

def test_string_concat_builds_key():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [d("ev", 'e + "|" + str(n)')])
    assert out["ev"].tolist() == ["E1|3", "E1|7"]
```

Run: `cd engine && python -m pytest tests/test_reduce_derive_ops.py -v` → FAIL (`derive: unsupported expression`).

- [ ] **Step 2: Extend `_eval_derive`** in `reduce.py`: handle `ast.Constant` of `str`; `ast.Compare` with the six ops → `(left <op> right).astype(int)`; `ast.Add` where either side is non-numeric → string `+`; add `"str"` to a cast set evaluating `series.astype(str)`. Keep the existing numeric paths; reject anything still unmatched with the existing `ReduceError`.
- [ ] **Step 3:** Run → PASS. Then `pytest tests/test_reduce_derive.py tests/test_reduce_derive_ops.py -v` (no regression of the numeric derive).
- [ ] **Step 4: Commit** `feat(reduce): derive boolean comparisons + string concat`.

---

## Task 2: C2 — `pivot` / unstack (long → wide, internal aggregate, 0-fill)

`groupby(KEY+["opp"]).sum().unstack(fill_value=0)` → columns `s`,`o`. Self-contained
(the aggregate is internal to the pivot), so it needs no collapse plan.

**Files:** Modify `reduce.py` (`_apply_pivot` + dispatch); test `engine/tests/test_reduce_pivot.py`.

- [ ] **Step 1: Failing test** — one categorical `column` unstacked into one column per level, `values` summed per `index` keys, absent = 0; new columns added to schema as numeric.

```python
def piv(index, column, values, names):
    return {"kind": "pivot", "index": index, "column": column,
            "values": values, "agg": "sum", "fill": 0, "names": names}
# 2 cells; cell c1 has opp 0 and 1, c2 only opp 0 -> c2's "o" column must be 0
```

Assert `out` is one row per `index` tuple with `s`/`o` columns and the c2 `o == 0`.

- [ ] **Step 2: Add `_apply_pivot`**: `df.pivot_table(index=index, columns=column, values=values, aggfunc=agg, fill_value=fill)`, flatten columns, rename via `names` (level→new name), `reset_index()`; append the new columns to `schema["columns"]` as numeric, drop the consumed `column`/`values` from schema.
- [ ] **Step 3:** dispatch branch `if kind == "pivot"`; run → PASS; full reduce suite green.
- [ ] **Step 4: Commit** `feat(reduce): pivot step (unstack one key, internal aggregate + 0-fill)`.

---

## Task 3: C4 — grid-completion (cross-join + count + 0-fill)

§5's `(field × transition)` grid: cross-join the observed `(experiment_id, position_id)`
with a fixed `tt` level list, left-join a per-cell count, fill absent = real 0.

**Files:** Modify `reduce.py` (`_apply_grid_complete` + dispatch); test `engine/tests/test_reduce_grid_complete.py`.

- [ ] **Step 1: Failing test** — given event rows over 2 fields × {present tt subset}, assert the output has `len(fields) × len(levels)` rows and the absent `(field, tt)` cells carry `count == 0`.

```python
def grid(by, column, levels, count_unique=None):
    return {"kind": "grid_complete", "by": by, "column": column,
            "levels": levels, "count": True, "count_unique": count_unique,
            "fill": 0, "count_name": "count"}
```

- [ ] **Step 2: Add `_apply_grid_complete`**: `base = df[by].drop_duplicates()`; `full = base.merge(pd.DataFrame({column: levels}), how="cross")`; `obs = df.drop_duplicates(count_unique).groupby(by+[column]).size()` (or `.size()` if no `count_unique`); `full[count_name] = full.set_index(by+[column]).index.map(obs).fillna(fill).astype(int)`; schema gains `column` (categorical, `levels`) + `count_name` (numeric).
- [ ] **Step 3:** dispatch; run → PASS; full suite green.
- [ ] **Step 4: Commit** `feat(reduce): grid_complete step (cross-join + count + 0-fill)`.

---

## Task 4: C5 — expression-valued `filter` bound (quantile)

§5 landscape tail-clip: `abs(value) <= quantile(abs(value), 0.99)`. The bound is a
reduction over the filter's input; record the realized numeric bound in the trace.

**Files:** Modify `reduce.py` (`_apply_filter` + a tiny bound evaluator); test `engine/tests/test_reduce_filter_expr.py`.

- [ ] **Step 1: Failing test** — a condition `{"column": "value", "op": "<=", "bound": "quantile(abs(value), 0.99)"}` drops only the rows above the data's 99th-pct of `|value|`; assert the kept set and that the realized bound is exposed (e.g. in the returned trace/step record).

- [ ] **Step 2: Extend `_apply_filter`**: when a condition carries `bound` (instead of `value`), evaluate it with a minimal whitelist — `quantile(expr, p)`, `abs(col)`, column refs, arithmetic — over the current `df`, producing a scalar; compare `series <op> scalar`. Stash the realized scalar onto the step/trace so provenance can log it. Static-`value` conditions are unchanged.
- [ ] **Step 3:** run → PASS; existing `test_reduce_filter_null.py` + `test_reduce.py` green.
- [ ] **Step 4: Commit** `feat(reduce): expression-valued filter bound (quantile), realized value traced`.

---

## Task 5: Frontend — types + explorer edges for the new steps

Mirror the engine vocabulary; render each as a linear single-edge step (no authoring UI).

**Files:** Modify `src/types.ts`, `src/explorer/graph.ts` (+ `graph.test.ts`).

- [ ] **Step 1:** add `PivotStep` / `GridCompleteStep` interfaces + extend `ReduceStep`; allow `FilterCond.bound?: string`; extend `EdgeKind` with `pivot`/`grid_complete` (derive/recode/join/filter already exist).
- [ ] **Step 2:** `buildGraph` — `pivot`/`grid_complete` are linear single edges (`STEP_NODE_LABEL` + `stepEdgeLabel`); add a `graph.test.ts` case.
- [ ] **Step 3:** `npx tsc --noEmit && npm run build && npm test -- graph` → green.
- [ ] **Step 4: Commit** `feat(types,explorer): pivot + grid_complete steps + expression filter bound`.

---

## Deferred (resume when `un-force-nesting` lands)

- **C1** arbitrary-grain aggregate (consume the `CollapsePlan`); **C3** guard wiring;
  **B1/B3** end-to-end composition; the **§3 crowding / §4 het / §5 rate** equivalence
  tests against `replicate_spearman` / `write_t1_rate_iris` (the Tier A-style
  fixtures + full-precision number match). Add these as a Tier B/C *part 2* plan
  once the collapse-plan interface is final and the open architectural fork (join
  consuming a plan node) is settled.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-24-cov2d-absorption-tier-b-c.md` on
branch `cov2d-absorption-tier-bc`. Tasks 1–4 are independent reduce-step units
(parallelizable across subagents); Task 5 depends on 1–4 landing the step shapes.
