# Un-forcing the Nesting (Collapse Routing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the enforced finest-first collapse spine with a per-analysis, editable **CollapsePlan** that defaults to today's exact chain, and replace the pseudoreplication wall with a chosen test grain plus four never-blocking guards (yellow #1/#2/#4, white always-on #3).

**Architecture (Option A — grain-list plan):** A `CollapsePlan` is an ordered list of **steps**, each naming the grain it produces (`keep` = the dims it keeps) and the `fn` that aggregates into it. Raw is a separate, always-present source node; each step's source is the previous step (the first step's source is raw). The engine gets one general fold, `materialize_plan(df, schema, plan, split_cols)`, keyed by **grain key**; `materialize_levels` becomes a thin adapter that builds the *default plan* and re-keys by finest dim, so existing behavior + tests are an exact regression pin. Three pure guard helpers read group counts. The frontend carries the plan + test-grain pointer per plottable, edits them in a dedicated routing panel, renders the graph (read-only) with guard badges, and persists the plan as-is.

**Tech Stack:** Python 3 / pandas / FastAPI (engine, `pytest`); React / TypeScript / jotai / Vite (frontend, `vitest`, `tsc`, Playwright e2e).

**Conventions used throughout:**
- **grain key** — kept dims in spine order (coarse→fine) joined by `/`; raw = `""`. E.g. spine `experiment › cell › frame`, the node that keeps `[experiment, cell]` has key `"experiment/cell"`.
- **default plan** — the full-spine prefix chain, finest→coarsest: step `i` keeps the spine prefix `spine[0..i)` for `i` from `len(spine)` down to `1`; each step's `fn` is the table-level `fn` of its **finest kept dim** (default `"mean"`). For `spine = [experiment, cell]` the default plan is `[{keep:[experiment,cell], fn[cell]}, {keep:[experiment], fn[experiment]}]`. This reproduces `materialize_levels` node-for-node and fn-for-fn.
- **step semantics** — a step removes one *or more* dims from the previous grain. Removing one dim = nested (median-of-medians); removing several at once = pooled (a *skip*); keeping a finer dim while dropping a coarser one = a non-prefix grain (the mean-trajectory shape).

**Branch context:** `un-force-nesting` is checked out and already contains the merged **Tier A** work (commit `5b3296e`): `derive`/`recode`/`join` reduce-step kinds and a join-source node in `graph.ts`. Those live in the *step* section of `buildGraph` and are untouched by this plan — only the *collapse* section changes. Run engine commands from `engine/`, frontend commands from the repo root.

---

## Phase 0 — Shared frontend contracts

### Task 0: CollapsePlan types, grain helpers, default-plan generator

**Files:**
- Modify: `src/types.ts` (after the `EMPTY_HIERARCHY`/`RAW_LEVEL` block, ~line 106)
- Create: `src/collapse.ts`
- Test: `src/collapse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/collapse.test.ts
import { describe, it, expect } from "vitest";
import { defaultPlan, grainKey, planGrains } from "./collapse";

const SPINE = ["experiment", "cell", "frame"]; // coarse -> fine

describe("collapse helpers", () => {
  it("defaultPlan is the full-spine prefix chain finest->coarsest; fn from finest kept dim", () => {
    expect(defaultPlan(SPINE, { cell: "median" })).toEqual([
      { keep: ["experiment", "cell", "frame"], fn: "mean" },   // finest=frame -> fn[frame]||mean
      { keep: ["experiment", "cell"], fn: "median" },          // finest=cell  -> fn[cell]=median
      { keep: ["experiment"], fn: "mean" },                    // finest=experiment
    ]);
  });

  it("grainKey joins kept dims in spine order; raw is empty string", () => {
    expect(grainKey([])).toBe("");
    expect(grainKey(["experiment", "cell"])).toBe("experiment/cell");
  });

  it("planGrains lists raw + one grain key per step, in order", () => {
    expect(planGrains(defaultPlan(SPINE, {}))).toEqual([
      "", "experiment/cell/frame", "experiment/cell", "experiment",
    ]);
  });

  it("skipping a level = a step that drops two dims at once (pool)", () => {
    const plan = [
      { keep: ["experiment", "cell"], fn: "median" as const },  // raw -> per cell
      { keep: ["experiment"], fn: "median" as const },          // per cell -> per experiment (no per-field node)
    ];
    expect(planGrains(plan)).toEqual(["", "experiment/cell", "experiment"]);
  });

  it("mean trajectory: keep a finer dim, drop a coarser one (non-prefix grain)", () => {
    const plan = [
      { keep: ["experiment", "cell", "frame"], fn: "mean" as const },
      { keep: ["experiment", "frame"], fn: "mean" as const },   // drop cell, keep frame
    ];
    expect(planGrains(plan)).toEqual(["", "experiment/cell/frame", "experiment/frame"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collapse.test.ts`
Expected: FAIL — `Cannot find module './collapse'`.

- [ ] **Step 3: Add types to `src/types.ts`**

Insert after the `EMPTY_HIERARCHY` / `RAW_LEVEL` block (~line 106). `LevelFn` already exists in this file.

```ts
/* Un-forcing the nesting: a per-analysis collapse plan. Each step names the grain
   it produces (the dims it KEEPS, in spine order) and the fn that aggregates into
   it. Raw is a separate source node; each step's source is the previous step
   (the first step's source is raw). The default plan (full-spine prefix chain,
   finest -> coarsest) reproduces the forced chain exactly. */
export interface CollapseStep { keep: string[]; fn: LevelFn }
export type CollapsePlan = CollapseStep[];

/* A grain key: kept dims in spine order joined by "/", "" = raw. Matches the
   engine's grain keys so node counts/fetches line up. */
export type GrainKey = string;

/* One guard verdict surfaced on a graph edge. "caution" = yellow (a detectable
   integrity risk: pseudoreplication / pairing-flip / identity-merge); "info" =
   white (the always-on flattening consequence). Never blocks. */
export interface GuardVerdict {
  id: "pseudoreplication" | "pairing_flip" | "identity_merge" | "flatten_info";
  severity: "caution" | "info";
  text: string;
}

/* The raw guard verdicts /shape_counts returns (the frontend turns these into
   GuardVerdicts placed on the right edges via mergeGuards). null = guard not run
   (e.g. no qualifier for pairing-flip). */
export interface ShapeCountsGuards {
  pseudoreplication: { risk: boolean; n_test: number; n_coarsest: number; coarsest_grain: GrainKey } | null;
  pairing_flip: { flipped: boolean; from: string | null; to: string | null; across: string | null } | null;
  identity_merge: { dim: string; kept: string[]; before: number; after: number }[];
}
```

- [ ] **Step 4: Create `src/collapse.ts`**

```ts
import type { CollapsePlan, GrainKey, LevelFn } from "./types";

/* The forced chain as a plan: full-spine prefix chain, finest -> coarsest. Step i
   keeps the prefix spine[0..i) for i = len down to 1; fn from the finest kept dim. */
export function defaultPlan(spine: string[], fn: Record<string, LevelFn>): CollapsePlan {
  const steps: CollapsePlan = [];
  for (let i = spine.length; i >= 1; i--) {
    const keep = spine.slice(0, i);
    steps.push({ keep, fn: fn[keep[keep.length - 1]] ?? "mean" });
  }
  return steps;
}

export function grainKey(keep: string[]): GrainKey {
  return keep.join("/");
}

/* Raw grain ("") followed by each step's grain key, in plan order. */
export function planGrains(plan: CollapsePlan): GrainKey[] {
  return ["", ...plan.map((s) => grainKey(s.keep))];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/collapse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/collapse.ts src/collapse.test.ts
git commit -m "feat(collapse): CollapsePlan (grain-list) types + helpers"
```

---

## Phase 1 — Engine: the general fold

### Task 1: `default_plan` + `materialize_plan`; `materialize_levels` delegates

**Files:**
- Modify: `engine/iris_engine/hierarchy.py`
- Test: `engine/tests/test_hierarchy.py` (add new tests; existing tests are the regression pin)

- [ ] **Step 1: Write the failing test**

Append to `engine/tests/test_hierarchy.py` (it already defines `_schema`, `_unpaired_df`, `SPINE = ["subject", "rep"]`):

```python
# --------------------------------------------------------------------------- #
# materialize_plan (un-forcing the nesting)
# --------------------------------------------------------------------------- #

def test_default_plan_shape():
    assert hierarchy.default_plan(["subject", "rep"], {"rep": "median"}) == [
        {"keep": ["subject", "rep"], "fn": "median"},
        {"keep": ["subject"], "fn": "mean"},
    ]

def test_default_plan_matches_materialize_levels():
    """The default plan reproduces materialize_levels exactly (the regression
    pin): same grains, same row counts."""
    df = _unpaired_df()
    grains = hierarchy.materialize_plan(
        df, _schema(), hierarchy.default_plan(SPINE, {}), ["group"])
    levels, _ = hierarchy.materialize_levels(df, _schema(), SPINE, {}, ["group"])
    assert set(grains) == {"", "subject/rep", "subject"}
    assert len(grains["subject"][0]) == len(levels["subject"][0])
    assert len(grains["subject/rep"][0]) == len(levels["rep"][0])

def test_plan_skip_pools_two_dims_in_one_step():
    """A step that drops both rep AND subject-from... here: raw -> per subject
    directly (one step keeping only [subject]) pools every raw row by subject."""
    df = _unpaired_df()
    grains = hierarchy.materialize_plan(
        df, _schema(), [{"keep": ["subject"], "fn": "mean"}], ["group"])
    assert set(grains) == {"", "subject"}
    assert len(grains["subject"][0]) == df["subject"].nunique()

def test_plan_non_prefix_grain():
    """Keep the finer dim, drop the coarser: a non-prefix grain."""
    df = _unpaired_df()
    grains = hierarchy.materialize_plan(
        df, _schema(), [{"keep": ["rep"], "fn": "mean"}], [])
    assert set(grains) == {"", "rep"}
    assert len(grains["rep"][0]) == df["rep"].nunique()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_hierarchy.py::test_default_plan_shape -v`
Expected: FAIL — `module 'iris_engine.hierarchy' has no attribute 'default_plan'`.

- [ ] **Step 3: Add `default_plan`, `materialize_plan`, `_grain_key`; rewrite `materialize_levels` to delegate**

In `engine/iris_engine/hierarchy.py`, add after `materialize_levels` (`_level_table`, `spine_present`, `_concat_ids`, `_AGG`, `RAW`, `resolve_level` stay unchanged):

```python
def _grain_key(kept: list[str]) -> str:
    """Kept dims (already in spine order) joined by '/'; '' = raw."""
    return "/".join(kept)


def default_plan(spine: list[str], fn: dict | None = None) -> list[dict]:
    """The forced chain as a plan: full-spine prefix chain, finest -> coarsest.
    Step i keeps the prefix spine[:i] for i = len..1; fn from the finest kept dim."""
    fn = fn or {}
    return [{"keep": list(spine[:i]), "fn": fn.get(spine[i - 1], "mean")}
            for i in range(len(spine), 0, -1)]


def materialize_plan(
    df: pd.DataFrame, schema: dict, plan: list[dict],
    split_cols: list[str] | None = None,
) -> dict[str, tuple[pd.DataFrame, dict]]:
    """General collapse: walk `plan` (ordered steps `{keep, fn}`) from raw. Each
    step groups the *previous* table by its `keep` dims (+ split) and aggregates
    with the step's `fn` via `_level_table` — so collapsing stays nested
    (median-of-medians), the step list is the routing, and a step may drop several
    dims (a pooled skip) or keep a finer dim while dropping a coarser one (a
    non-prefix grain). Returns one (df, schema) per step, keyed by grain key
    (kept dims joined by '/', '' = raw)."""
    split = [c for c in (split_cols or []) if c in df.columns]
    raw = df.copy()
    raw["row_ids"] = [[i] for i in raw["id"].tolist()]
    grains: dict[str, tuple[pd.DataFrame, dict]] = {RAW: (raw, schema)}

    src, src_schema = raw, schema
    for step in plan:
        keep = [c for c in step["keep"] if c in df.columns]
        if not keep:
            continue
        grain = list(dict.fromkeys(keep + split))
        agg = step.get("fn") if step.get("fn") in _AGG else "mean"
        tbl = _level_table(src, src_schema, grain, agg)
        grains[_grain_key(keep)] = tbl
        src, src_schema = tbl
    return grains
```

Then rewrite `materialize_levels` to delegate (preserving its exact return shape — keyed by single level name = the finest kept dim — for existing callers):

```python
def materialize_levels(
    df: pd.DataFrame, schema: dict, spine: list[str],
    fn: dict[str, str] | None = None, split_cols: list[str] | None = None,
) -> tuple[dict[str, tuple[pd.DataFrame, dict]], list[str]]:
    """The forced finest -> coarsest chain, kept for callers that key levels by a
    single spine-column name. Thin adapter over `materialize_plan` + the default
    plan."""
    present = spine_present(df, spine)
    grains = materialize_plan(df, schema, default_plan(present, fn or {}), split_cols)
    levels: dict[str, tuple[pd.DataFrame, dict]] = {}
    for key, tbl in grains.items():
        kept = key.split("/") if key else []
        levels[kept[-1] if kept else RAW] = tbl
    return levels, present
```

> Note: the previous inline finest→coarsest loop in `materialize_levels` is removed in favor of the delegation.

- [ ] **Step 4: Run new + existing tests**

Run: `cd engine && python -m pytest tests/test_hierarchy.py -v`
Expected: PASS — the new tests AND every pre-existing `test_hierarchy.py` test (the regression pin).

- [ ] **Step 5: Run the full engine suite (catch downstream callers)**

Run: `cd engine && python -m pytest -q`
Expected: PASS (all green; `render.py`/`compiler.py`/`shape_counts` call `materialize_levels` and get identical results).

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/hierarchy.py engine/tests/test_hierarchy.py
git commit -m "feat(engine): default_plan + materialize_plan; materialize_levels delegates"
```

---

## Phase 2 — Engine: the four guards

### Task 2: `pseudoreplication` guard (#1)

**Files:**
- Modify: `engine/iris_engine/hierarchy.py`
- Test: `engine/tests/test_guards_routing.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_guards_routing.py
import pandas as pd
from iris_engine import hierarchy

def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "experiment", "type": "identifier", "label": "Experiment"},
        {"name": "field", "type": "identifier", "label": "Field"},
        {"name": "cell", "type": "identifier", "label": "Cell"},
        {"name": "frame", "type": "numeric", "label": "Frame"},
        {"name": "area", "type": "numeric", "label": "Area"}]}

def _df():
    rows, rid = [], 0
    for e in ("e1", "e2", "e3"):
        for f in ("f1", "f2"):
            for c in range(4):            # cell ids repeat across fields
                for fr in range(5):
                    rows.append({"id": f"r{rid}", "experiment": e, "field": f,
                                 "cell": c, "frame": fr, "area": float(rid)})
                    rid += 1
    return pd.DataFrame(rows)

SPINE = ["experiment", "field", "cell", "frame"]

def test_pseudoreplication_flags_test_finer_than_coarsest():
    df = _df()
    plan = hierarchy.default_plan(SPINE, {})
    v = hierarchy.pseudoreplication(df, plan, test_grain="")   # test at raw
    assert v["risk"] is True
    assert v["n_test"] == len(df)
    assert v["n_coarsest"] == 3            # 3 experiments
    assert v["coarsest_grain"] == "experiment"

def test_pseudoreplication_clear_at_coarsest():
    df = _df()
    plan = hierarchy.default_plan(SPINE, {})
    v = hierarchy.pseudoreplication(df, plan, test_grain="experiment")
    assert v["risk"] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_guards_routing.py::test_pseudoreplication_flags_test_finer_than_coarsest -v`
Expected: FAIL — no attribute `pseudoreplication`.

- [ ] **Step 3: Implement**

Add to `engine/iris_engine/hierarchy.py`. The guard only counts rows, so a minimal numeric schema over the present columns is enough (grouping identity comes from the column values, not schema types):

```python
def _coarsest_grain(grains) -> str:
    """The grain with the fewest kept dims, excluding raw ('' is the finest, not
    the coarsest, so it only wins when it is the only node). `grains` is any
    iterable of grain keys (a dict or a list)."""
    non_raw = [k for k in grains if k]
    return min(non_raw, key=lambda k: len(k.split("/"))) if non_raw else RAW


def pseudoreplication(df: pd.DataFrame, plan: list[dict], test_grain: str) -> dict:
    """#1: the test reads a grain finer than the coarsest available node, so its
    units are nested in a coarser one (correlated measurements treated as
    independent). n at a grain is its distinct-group count — path-independent, so
    we count directly with groupby (no aggregation, no schema, so string spine
    columns can't trip an aggregate). Returns the risk flag, n at the chosen vs
    coarsest grain, and the coarsest grain key — enough to name the safer option."""
    keys = [RAW] + [_grain_key([c for c in s["keep"] if c in df.columns]) for s in plan]

    def n_for(key: str) -> int:
        dims = [d for d in key.split("/") if d in df.columns] if key else []
        return int(df.groupby(dims, observed=True).ngroups) if dims else int(len(df))

    coarsest = _coarsest_grain(keys)
    return {"risk": test_grain != coarsest,
            "n_test": n_for(test_grain),
            "n_coarsest": n_for(coarsest),
            "coarsest_grain": coarsest}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && python -m pytest tests/test_guards_routing.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/hierarchy.py engine/tests/test_guards_routing.py
git commit -m "feat(engine): pseudoreplication guard (#1)"
```

### Task 3: `pairing_flip` guard (#2)

**Files:**
- Modify: `engine/iris_engine/hierarchy.py`
- Test: `engine/tests/test_guards_routing.py`

- [ ] **Step 1: Write the failing test**

Append to `engine/tests/test_guards_routing.py`:

```python
def _paired_df():
    # paired by SUBJECT (each subject sees both groups) but NOT by rep: group A
    # uses reps 0-2, group B uses reps 3-5, so no single rep crosses both groups.
    # Testing at the subject grain is paired; testing at the rep grain is not.
    rows, rid = [], 0
    for s in ["s1", "s2", "s3"]:
        for grp, reps in (("A", [0, 1, 2]), ("B", [3, 4, 5])):
            for r in reps:
                rows.append({"id": f"r{rid}", "group": grp,
                             "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)

PSPINE = ["subject", "rep"]

def test_pairing_flip_detects_paired_to_unpaired():
    df = _paired_df()
    # default: test at subject (coarser than the qualifier's home) -> paired;
    # re-routed to test at rep -> the across-subject pairing is gone.
    v = hierarchy.pairing_flip(df, PSPINE, "group",
        default_grain="subject", chosen_grain="subject/rep")
    assert v["flipped"] is True
    assert v["from"] == "paired"
    assert v["to"] in ("unpaired", "partially_paired")

def test_pairing_flip_none_when_verdict_unchanged():
    df = _paired_df()
    v = hierarchy.pairing_flip(df, PSPINE, "group",
        default_grain="subject", chosen_grain="subject")
    assert v["flipped"] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_guards_routing.py::test_pairing_flip_detects_paired_to_unpaired -v`
Expected: FAIL — no attribute `pairing_flip`.

- [ ] **Step 3: Implement**

`pairing()` already takes `inferential_level` (a single spine-column name). A grain key's inferential level is its finest kept dim. Add:

```python
def _grain_inferential_level(grain: str) -> str:
    return grain.split("/")[-1] if grain else RAW


def pairing_flip(df: pd.DataFrame, spine: list[str], qualifier: str | None,
                 default_grain: str, chosen_grain: str) -> dict:
    """#2: re-routing/retargeting can change the pairing verdict (derived from the
    spine + the inferential grain). Run `pairing` at the default grain and the
    chosen grain; report whether the verdict changed."""
    def verdict(grain: str):
        p = pairing(df, spine, qualifier,
                    inferential_level=_grain_inferential_level(grain))
        return p["verdict"] if p else None
    frm, to = verdict(default_grain), verdict(chosen_grain)
    chosen = pairing(df, spine, qualifier,
                     inferential_level=_grain_inferential_level(chosen_grain))
    return {"flipped": frm is not None and to is not None and frm != to,
            "from": frm, "to": to, "across": (chosen or {}).get("across")}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && python -m pytest tests/test_guards_routing.py -v`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/hierarchy.py engine/tests/test_guards_routing.py
git commit -m "feat(engine): pairing-flip guard (#2)"
```

### Task 4: `identity_merge` guard (#4)

**Files:**
- Modify: `engine/iris_engine/hierarchy.py`
- Test: `engine/tests/test_guards_routing.py`

- [ ] **Step 1: Write the failing test**

Append (uses `_df()`/`SPINE`/`_schema()` from the top of the file):

```python
def test_identity_merge_flags_dropping_field_keeping_cell():
    df = _df()
    # raw -> per cell [e,f,c], then drop FIELD but keep CELL -> [e,c].
    # cell ids collide across fields, so cells merge.
    plan = [{"keep": ["experiment", "field", "cell"], "fn": "median"},
            {"keep": ["experiment", "cell"], "fn": "median"}]
    out = hierarchy.identity_merge(df, _schema(), SPINE, plan)
    assert len(out) == 1
    m = out[0]
    assert m["dim"] == "field"
    assert m["before"] == df.groupby(["experiment", "cell", "field"]).ngroups  # 24
    assert m["after"] == df.groupby(["experiment", "cell"]).ngroups            # 12
    assert m["after"] < m["before"]

def test_identity_merge_exempts_numeric_coordinate():
    df = _df()
    # full spine, then drop CELL but keep FRAME (numeric coordinate) -> no merge.
    plan = [{"keep": ["experiment", "field", "cell", "frame"], "fn": "mean"},
            {"keep": ["experiment", "field", "frame"], "fn": "mean"}]
    assert hierarchy.identity_merge(df, _schema(), SPINE, plan) == []

def test_identity_merge_clear_for_default_chain():
    df = _df()
    assert hierarchy.identity_merge(
        df, _schema(), SPINE, hierarchy.default_plan(SPINE, {})) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_guards_routing.py::test_identity_merge_flags_dropping_field_keeping_cell -v`
Expected: FAIL — no attribute `identity_merge`.

- [ ] **Step 3: Implement**

```python
def identity_merge(df: pd.DataFrame, schema: dict, spine: list[str],
                   plan: list[dict]) -> list[dict]:
    """#4: dropping a dim D merges distinct units ONLY when a KEPT dim finer than
    D is an `identifier` (its labels may repeat across D) and loses distinctness.
    Numeric/coordinate kept dims never trigger it; dropping a dim with no finer
    kept identifier (the default chain, or pooling with nothing finer kept) is
    exempt. Detection is exact: distinct count of (kept identifiers) with vs
    without D."""
    types = {c["name"]: c["type"] for c in schema["columns"]}
    present = spine_present(df, spine)
    pos = {d: i for i, d in enumerate(present)}
    merges: list[dict] = []
    prev = list(present)            # raw carries the full spine identity
    for step in plan:
        keep = [c for c in step["keep"] if c in present]
        removed = [d for d in prev if d not in keep]
        kept_ids = [d for d in keep if types.get(d) == "identifier"]
        for dim in removed:
            if dim not in pos:
                continue
            finer_kept_ids = [c for c in kept_ids if pos[c] > pos[dim]]
            if not finer_kept_ids:
                continue            # nothing finer kept -> intentional pooling
            before = df.groupby(kept_ids + [dim], observed=True).ngroups
            after = df.groupby(kept_ids, observed=True).ngroups
            if after < before:
                merges.append({"dim": dim, "kept": kept_ids,
                               "before": int(before), "after": int(after)})
        prev = keep
    return merges
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && python -m pytest tests/test_guards_routing.py -v`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/hierarchy.py engine/tests/test_guards_routing.py
git commit -m "feat(engine): identity-merge guard (#4) with coordinate exemption"
```

---

## Phase 3 — Engine: API + analyze integration

### Task 5: `/shape_counts` — grain-keyed counts + guard verdicts

**Files:**
- Modify: `engine/iris_engine/main.py` (`ShapeCountsRequest` ~line 83; `shape_counts` ~line 528)
- Test: `engine/tests/test_shape_counts.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_shape_counts.py
from fastapi.testclient import TestClient
from iris_engine.main import app

client = TestClient(app)

def _table():
    cols = ["experiment", "field", "cell", "frame", "area"]
    rows = []
    for e in ("e1", "e2", "e3"):
        for f in ("f1", "f2"):
            for c in range(4):
                for fr in range(5):
                    rows.append([e, f, c, fr, float(len(rows))])
    return {"schema": {"schema_version": "1.0", "columns": [
                {"name": "experiment", "type": "identifier", "label": "Experiment"},
                {"name": "field", "type": "identifier", "label": "Field"},
                {"name": "cell", "type": "identifier", "label": "Cell"},
                {"name": "frame", "type": "numeric", "label": "Frame"},
                {"name": "area", "type": "numeric", "label": "Area"}]},
            "rows": [dict(zip(cols, r)) for r in rows]}

SPINE = ["experiment", "field", "cell", "frame"]

def _default_plan():
    return [{"keep": SPINE[:i], "fn": "median"} for i in range(len(SPINE), 0, -1)]

def test_shape_counts_keys_collapse_nodes_by_grain():
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": _default_plan(), "test_grain": "experiment", "qualifier": None}
    r = client.post("/shape_counts", json=body)
    assert r.status_code == 200
    grains = r.json()["grains"]
    assert grains["experiment"]["rows"] == 3
    assert grains["experiment/field/cell"]["rows"] == 24

def test_shape_counts_returns_guards():
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": _default_plan(), "test_grain": "", "qualifier": None}
    g = client.post("/shape_counts", json=body).json()["guards"]
    assert g["pseudoreplication"]["risk"] is True
    assert g["identity_merge"] == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -v`
Expected: FAIL — response has no `grains`/`guards` keys (KeyError).

- [ ] **Step 3: Extend the request model and endpoint**

In `engine/iris_engine/main.py`, extend `ShapeCountsRequest` (~line 83):

```python
class ShapeCountsRequest(BaseModel):
    table: dict | None = None
    table_token: str | None = None
    steps: list[dict] = []
    hierarchy: dict | None = None
    # un-forcing the nesting: the per-analysis plan (grain-list), chosen test
    # grain, and the comparison qualifier (for the pairing-flip guard). Absent
    # collapse -> default chain.
    collapse: list[dict] | None = None
    test_grain: str | None = None
    qualifier: str | None = None
```

In `shape_counts`, the existing `levels_out` block stays (legacy single-name keys). Replace the final `return` (~line 573) with grain-keyed counts + guards:

```python
    # grain-keyed counts + guards for the routing graph (un-forcing the nesting)
    present = hierarchy.spine_present(full, (req.hierarchy or {}).get("spine") or [])
    plan = req.collapse or hierarchy.default_plan(present, (req.hierarchy or {}).get("fn") or {})
    grains: dict[str, dict] = {}
    guards: dict = {"pseudoreplication": None, "pairing_flip": None, "identity_merge": []}
    if present:
        gmats = hierarchy.materialize_plan(full, full_sch, plan, [])
        for key, (gdf, _gsch) in gmats.items():
            grains[key] = {"rows": int(len(gdf)), "cols": _cols(gdf)}
        coarsest = hierarchy._coarsest_grain(gmats)
        test_grain = req.test_grain if req.test_grain is not None else coarsest
        guards["pseudoreplication"] = hierarchy.pseudoreplication(full, plan, test_grain)
        guards["identity_merge"] = hierarchy.identity_merge(full, full_sch, present, plan)
        if req.qualifier:
            guards["pairing_flip"] = hierarchy.pairing_flip(
                full, present, req.qualifier, coarsest, test_grain)
    return {"source": out_source, "steps": steps_counts,
            "levels": levels_out, "grains": grains, "guards": guards}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && python -m pytest tests/test_shape_counts.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_shape_counts.py
git commit -m "feat(engine): /shape_counts returns grain counts + guard verdicts"
```

### Task 6: `/reduce` — fetch an arbitrary grain by key

**Files:**
- Modify: `engine/iris_engine/main.py` (`ReduceRequest` ~line 69; `reduce_preview` ~line 500)
- Test: `engine/tests/test_reduce_grain.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_reduce_grain.py
from fastapi.testclient import TestClient
from iris_engine.main import app
from tests.test_shape_counts import _table, SPINE  # reuse fixture

client = TestClient(app)

def test_reduce_fetches_non_prefix_grain():
    # full spine, then drop cell keeping frame -> grain "experiment/field/frame"
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": [{"keep": ["experiment", "field", "cell", "frame"], "fn": "mean"},
                         {"keep": ["experiment", "field", "frame"], "fn": "mean"}],
            "grain": "experiment/field/frame"}
    r = client.post("/reduce", json=body)
    assert r.status_code == 200
    # 3 experiments x 2 fields x 5 frames = 30 rows
    assert r.json()["n_total"] == 30
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_reduce_grain.py -v`
Expected: FAIL — `n_total` is the raw count (grain ignored).

- [ ] **Step 3: Extend the request model and endpoint**

Extend `ReduceRequest` (~line 69) with:

```python
    # un-forcing the nesting: fetch an arbitrary collapse grain by key (kept dims
    # joined by '/'). Takes precedence over `level` when both are set.
    collapse: list[dict] | None = None
    grain: str | None = None
```

In `reduce_preview`, after the existing legacy `level` block (~line 520, before `out = out.drop(columns=["row_ids"]...)`), add the grain path. `spine` is already computed just above:

```python
    if req.at_step is None and req.collapse is not None and req.grain is not None and spine:
        gmats = hierarchy.materialize_plan(out, sch, req.collapse, [])
        if req.grain in gmats:
            out, sch = gmats[req.grain]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && python -m pytest tests/test_reduce_grain.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_reduce_grain.py
git commit -m "feat(engine): /reduce can fetch an arbitrary collapse grain"
```

### Task 7: analyze path honors the plan + chosen test grain

**Files:**
- Modify: `engine/iris_engine/render.py` (~lines 149–167)
- Test: `engine/tests/test_render_routing.py` (new)

- [ ] **Step 1: Read the current block**

Read `engine/iris_engine/render.py:140-175` to see how `model`/`spec` carry hierarchy + layers, how `inf_level = hierarchy.coarsest_level(present_spine, layer_levels)` is derived, and how `stat_df` is resolved (`resolve_level(level_tables, inf_level)`). Also find an existing analyze test that builds a spec dict + calls the analyze entrypoint (e.g. `engine/tests/test_multigroup.py` or `test_correlation_spine.py`) — copy its harness for Step 2 rather than inventing fixtures.

- [ ] **Step 2: Write the failing test**

Mirror the analyze harness from the existing test you found. The assertion: when the spec carries `collapse` + a `test_grain` *finer* than the default coarsest, `stat_model["inferential_level"]` reflects the chosen grain's finest kept dim, not `coarsest_level`'s derivation. Sketch (adapt names to the real harness):

```python
def test_test_grain_override_sets_inferential_level(/* analyze, paired spec+table fixtures */):
    spec = paired_spec()                 # group comparison, spine [subject, rep]
    spec["collapse"] = [{"keep": ["subject", "rep"], "fn": "median"},
                        {"keep": ["subject"], "fn": "median"}]
    spec["test_grain"] = "subject/rep"   # finer than the default "subject"
    out = analyze(paired_table(), spec)
    assert out["stat_model"]["inferential_level"] == "rep"
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_render_routing.py -v`
Expected: FAIL — `inferential_level` is still `coarsest_level`'s pick (`subject`).

- [ ] **Step 4: Implement**

In `render.py`, where `level_tables`/`inf_level`/`stat_df` are computed (~149–167), read the plan + test grain from the spec and prefer them. Keep `level_tables` (built by `materialize_levels`) for the existing layer resolution; add the plan grains only when a plan is present:

```python
    plan = spec.get("collapse")
    grains = (hierarchy.materialize_plan(df, sch, plan, split_cols) if plan else None)

    test_grain = spec.get("test_grain")
    if test_grain is not None:
        inf_level = test_grain.split("/")[-1] if test_grain else hierarchy.RAW
    else:
        inf_level = hierarchy.coarsest_level(present_spine, layer_levels)
    model["inferential_level"] = inf_level

    if grains is not None and test_grain in grains:
        stat_df, _ = grains[test_grain]
    else:
        stat_df, _ = hierarchy.resolve_level(level_tables, inf_level)
```

> `df`, `sch`, `split_cols`, `present_spine`, `layer_levels`, `level_tables`, `model` are the names already in scope at that point — confirm against the file you read in Step 1 and match them exactly.

- [ ] **Step 5: Run to verify it passes**

Run: `cd engine && python -m pytest tests/test_render_routing.py -v && python -m pytest -q`
Expected: PASS (new test + full suite green; specs without `collapse`/`test_grain` fall through to today's path unchanged).

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/render.py engine/tests/test_render_routing.py
git commit -m "feat(engine): analyze honors collapse plan + chosen test grain"
```

---

## Phase 4 — Frontend: graph from the plan

### Task 8: `buildGraph` consumes a CollapsePlan; grain node ids; white #3 info

**Files:**
- Modify: `src/explorer/graph.ts`
- Test: `src/explorer/graph.test.ts`

> Tier A added `derive`/`recode`/`join` to `EdgeKind` and a join-source node in the *step* loop of `buildGraph` — leave that section as-is. Only the **collapse**, **geom-origin**, and **test-origin** sections change, plus the signature.

- [ ] **Step 1: Update the existing tests + add new ones**

`buildGraph`'s signature changes from `(steps, hierarchy, layers, schema, stats)` to `(steps, spine, plan, layers, schema, stats)`. Update `src/explorer/graph.test.ts`:
- Import `defaultPlan` from `../collapse`; replace `HIER` with `const SPINE = ["experiment", "cell"]; const PLAN = defaultPlan(SPINE, {});` and pass `SPINE, PLAN` wherever `HIER` was passed.
- Collapse node ids are now grain keys prefixed `grain:` (`grain:experiment/cell`, `grain:experiment`). Port every `level:cell`→`grain:experiment/cell` and `level:experiment`→`grain:experiment`. `nodeIdForLevel` is replaced by `nodeIdForGrain` (update that unit test too).

```ts
import { defaultPlan } from "../collapse";
const SPINE = ["experiment", "cell"];
const PLAN = defaultPlan(SPINE, {});

it("collapse nodes are keyed by grain; chain runs full-spine -> coarsest", () => {
  const g = buildGraph([{ kind: "drop", columns: ["area"] }], SPINE, PLAN,
    [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
  expect(edge(g, "step:0", "grain:experiment/cell")?.kind).toBe("collapse");
  expect(edge(g, "grain:experiment/cell", "grain:experiment")?.kind).toBe("collapse");
  expect(g.nodes.find((n) => n.id === "grain:experiment")?.label).toBe("per Experiment");
});

it("each collapse edge carries the white #3 flatten-info guard", () => {
  const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
  const ce = g.edges.find((e) => e.kind === "collapse");
  expect(ce?.guards?.some((gd) => gd.id === "flatten_info" && gd.severity === "info")).toBe(true);
});

it("nodeIdForGrain: raw -> given raw node; a grain key -> its grain node", () => {
  expect(nodeIdForGrain("", "step:2")).toBe("step:2");
  expect(nodeIdForGrain("experiment/cell", "source")).toBe("grain:experiment/cell");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL — signature/id mismatches.

- [ ] **Step 3: Rewrite the collapse / geom-origin / test-origin sections**

Add `guards?: GuardVerdict[]` to the `Edge` interface; add `| { via: "grain"; grain: string }` to `NodeTable`. Replace `nodeIdForLevel` with `nodeIdForGrain` and add helpers (imports at top of file):

```ts
import type { CollapsePlan, GuardVerdict } from "../types";
import { grainKey, planGrains } from "../collapse";

export function nodeIdForGrain(key: string, rawNodeId: string): string {
  return key === "" ? rawNodeId : `grain:${key}`;
}

const labelForGrain = (schema: Schema | null, kept: string[]): string =>
  kept.length === 1 ? `per ${labelForCol(schema, kept[0])}`
    : `per ${kept.map((d) => labelForCol(schema, d)).join(" × ")}`;

/* white #3: what this step pools, derived from the dims it removed. */
const flattenInfo = (schema: Schema | null, fn: string, removed: string[], kept: string[]): GuardVerdict => ({
  id: "flatten_info", severity: "info",
  text: `${fn} over ${removed.map((d) => labelForCol(schema, d)).join(", ") || "—"}; ` +
        (kept.length ? `grouped per ${kept.map((d) => labelForCol(schema, d)).join(" × ")}` : "one value overall"),
});

/* the grain node a layer's `level` (a single spine dim, or RAW) maps to: the plan
   step whose finest kept dim is that level. Returns null if no such node (a stale
   level not on this plan) so the geom edge is skipped, as today. */
function levelGrainNode(level: string, plan: CollapsePlan, rawNodeId: string): string | null {
  if (level === RAW_LEVEL) return rawNodeId;
  const step = plan.find((s) => s.keep[s.keep.length - 1] === level);
  return step ? `grain:${grainKey(step.keep)}` : null;
}
```

In `buildGraph(steps, spine, plan, layers, schema, stats)`, after the step loop sets `rawNodeId`, replace the old spine collapse loop with a walk over `plan` (each step's source is the previous; the white #3 info is derived from the dims removed since the previous keep):

```ts
  let cprev = rawNodeId;
  let prevKeep: string[] = spine;            // raw carries the full spine identity
  for (const step of plan) {
    const kept = step.keep.filter((d) => spine.includes(d));
    const key = grainKey(kept);
    const id = `grain:${key}`;
    const removed = prevKeep.filter((d) => !kept.includes(d));
    nodes.push({ id, kind: "table", label: labelForGrain(schema, kept),
      table: { via: "grain", grain: key } });
    edges.push({ id: `e:${cprev}->${id}`, kind: "collapse", label: "collapse",
      fromId: cprev, toId: id, guards: [flattenInfo(schema, step.fn, removed, kept)] });
    cprev = id;
    prevKeep = kept;
  }
```

Replace the geom-origin and test-origin sections to use grain nodes. Geom: a layer draws from `levelGrainNode(layer.level, plan, rawNodeId)`; skip when null (replaces the old `spineSet.has` guard). Test: default origin = the coarsest grain node = the last plan step (or `rawNodeId` if the plan is empty):

```ts
  const seenGeom = new Set<string>();
  for (const layer of layers) {
    const fromId = levelGrainNode(layer.level, plan, rawNodeId);
    if (!fromId) continue;
    const label = geomLabel(layer.geom);
    const k = `${fromId}:${label}`;
    if (seenGeom.has(k)) continue;
    seenGeom.add(k);
    edges.push({ id: `g:${k}`, kind: "geom", label, fromId, toId: PLOT_ID });
  }
  if (seenGeom.size === 0) {
    edges.push({ id: "g:plain", kind: "geom", label: "plotted", fromId: rawNodeId, toId: PLOT_ID });
  }

  const grainsList = planGrains(plan);                       // ["", ...keys]
  const coarsest = grainsList[grainsList.length - 1] ?? "";
  const testFromId = nodeIdForGrain(coarsest, rawNodeId);
  edges.push({ id: "t:test", kind: "test",
    label: stats?.describeOnly ? "describe" : (stats?.test ? testLabel(stats.test) : "describe"),
    fromId: testFromId, toId: STATS_ID });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/explorer/graph.test.ts && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): buildGraph from CollapsePlan; grain node ids; white #3 info"
```

---

## Phase 5 — Frontend: per-analysis state

### Task 9: Plottable carries `collapse` + `testGrain`; seed/mutate/reset atoms; guard merge

**Files:**
- Modify: `src/state.ts` (Plottable interface ~line 143; new atoms near the hierarchy mutators ~line 769)
- Modify: `src/explorer/graphAtom.ts` (build from the plottable's plan; merge guard verdicts onto edges; send the plan/grain/qualifier to `/shape_counts`)
- Test: `src/state.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/state.test.ts`, mirroring the file's existing setup idiom. If there is no `makeStoreWithSpine` helper, add a small local one that creates a jotai store and sets `schemaAtom`, `hierarchyAtom` (`{ spine, fn: {} }`), one plottable in `plottablesAtom`, and `activePlottableIdAtom`.

```ts
import { effectivePlanAtom, effectiveTestGrainAtom,
         setCollapsePlanAtom, setTestGrainAtom, resetCollapseAtom,
         activePlottableAtom } from "./state";

it("effectivePlanAtom defaults to the full-spine prefix chain", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  expect(store.get(effectivePlanAtom)).toEqual([
    { keep: ["experiment", "cell"], fn: "mean" },
    { keep: ["experiment"], fn: "mean" },
  ]);
});

it("effectiveTestGrainAtom defaults to the coarsest (last) node", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  expect(store.get(effectiveTestGrainAtom)).toBe("experiment");
});

it("setTestGrain/setCollapsePlan write the active plottable; reset clears them", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  store.set(setTestGrainAtom, "experiment/cell");
  expect(store.get(activePlottableAtom)?.testGrain).toBe("experiment/cell");
  store.set(resetCollapseAtom);
  expect(store.get(activePlottableAtom)?.collapse).toBeUndefined();
  expect(store.get(activePlottableAtom)?.testGrain).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Extend Plottable + add atoms**

In `src/state.ts`, add to the `Plottable` interface (~line 143):

```ts
  /* un-forcing the nesting: the per-analysis collapse plan + chosen test grain.
     Both optional — absent means "use the default chain generated from the
     table-level spine" (a new analysis, or a CellFlow-exported .iris). */
  collapse?: CollapsePlan;
  testGrain?: GrainKey;
```

Add atoms (near the hierarchy mutators, ~line 769). Import `defaultPlan`, `grainKey` from `./collapse` and the types from `./types`:

```ts
import { defaultPlan, grainKey } from "./collapse";
import type { CollapsePlan, GrainKey } from "./types";

/* the plan in effect: the plottable's override, else the default chain from the
   table-level spine. */
export const effectivePlanAtom = atom<CollapsePlan>((get) => {
  const p = get(activePlottableAtom);
  const h = get(hierarchyAtom);
  return p?.collapse ?? defaultPlan(h.spine, h.fn);
});

/* the test grain in effect: the override, else the coarsest (last) node. */
export const effectiveTestGrainAtom = atom<GrainKey>((get) => {
  const p = get(activePlottableAtom);
  const plan = get(effectivePlanAtom);
  return p?.testGrain ?? (plan.length ? grainKey(plan[plan.length - 1].keep) : "");
});

const patchActive = (get: any, set: any, patch: Partial<Plottable>) => {
  const p = get(activePlottableAtom);
  if (p) set(activePlottableAtom, { ...p, ...patch });
};
export const setCollapsePlanAtom = atom(null, (get, set, next: CollapsePlan) =>
  patchActive(get, set, { collapse: next }));
export const setTestGrainAtom = atom(null, (get, set, grain: GrainKey) =>
  patchActive(get, set, { testGrain: grain }));
export const resetCollapseAtom = atom(null, (get, set) =>
  patchActive(get, set, { collapse: undefined, testGrain: undefined }));
```

- [ ] **Step 4: Wire `graphAtom.ts` to the plan + merge guards**

Rewrite `explorerGraphAtom` in `src/explorer/graphAtom.ts` to build from `effectivePlanAtom` and merge guard verdicts onto edges. Add a `guardsAtom` holding the `/shape_counts` `guards` payload (`ShapeCountsGuards | null` from `./types`).

```ts
import { hierarchyAtom, effectivePlanAtom, effectiveTestGrainAtom } from "../state";
import type { ShapeCountsGuards, GuardVerdict } from "../types";

export const guardsAtom = atom<ShapeCountsGuards | null>(null);

export const explorerGraphAtom = atom<ExplorerGraph | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const h = get(hierarchyAtom);
  const plan = get(effectivePlanAtom);
  const g = buildGraph(p.reduce.steps, h.spine, plan, p.layers,
    get(effectiveSchemaAtom), get(statsInputAtom));
  const counts = get(shapeCountsAtom);
  const guards = get(guardsAtom);
  let nodes = g.nodes, edges = g.edges;
  if (counts) nodes = nodes.map((n) => (counts[n.id] ? { ...n, count: counts[n.id] } : n));
  if (guards) edges = mergeGuards(edges, guards);
  return { ...g, nodes, edges };
});
```

Add `mergeGuards(edges, guards)` in the same file:
- **caution → test edge** (`e.kind === "test"`): if `guards.pseudoreplication?.risk`, append a `caution` GuardVerdict with text like `Testing here uses ${n_test} from ${n_coarsest} ${coarsest_grain}; consider testing per ${coarsest_grain} (n = ${n_coarsest}).`; if `guards.pairing_flip?.flipped`, append `Pairing changed: ${from} → ${to}${across ? " (over " + across + ")" : ""}.`.
- **caution → the merging collapse edge** for each `guards.identity_merge` entry: the collapse edge whose `toId` grain *excludes* `entry.dim` but whose `fromId` grain *includes* it (parse the grain key off `grain:<key>`); text like `Collapsing out ${dim} while keeping a finer level merges ${before} → ${after} units.`.

Also extend the `shapeCountsAtom` fetch (wherever `/shape_counts` is currently called) to send `collapse: plan`, `test_grain`, and `qualifier` (the comparison column, if any), store `res.grains` under `grain:<key>` ids into `shapeCountsAtom` (plus `source`/`step:i` from `res.source`/`res.steps`), and store `res.guards` into `guardsAtom`.

> Read the current `/shape_counts` caller (search `shapeCounts(` / `shapeCountsAtom`) before editing so the count-id mapping (`source`, `step:i`, and now `grain:<key>`) matches the node ids `buildGraph` emits.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/state.test.ts && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/explorer/graphAtom.ts src/state.test.ts
git commit -m "feat(state): per-analysis collapse plan + test grain; guard merge"
```

---

## Phase 6 — Frontend: routing panel + graph badges

### Task 10: `CollapseRoutingPanel` component

**Files:**
- Create: `src/components/CollapseRoutingPanel.tsx`
- Modify: `src/App.tsx` (mount in the analysis column, near the layer controls)
- Modify: `src/index.css` (panel + badge styles)
- Test: `src/components/CollapseRoutingPanel.test.tsx` (new)

The panel edits the **plan steps** directly: one row per step (its resulting grain + fn + remove/reorder), an "add level" affordance, and a "test reads at" selector over `planGrains`. Removing a step splices it out of the plan array (its successor then sources from the prior step — a pooled skip); reordering swaps steps; the fn select changes that step's `fn`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/CollapseRoutingPanel.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { CollapseRoutingPanel } from "./CollapseRoutingPanel";
import { setTestGrainAtom, activePlottableAtom } from "../state";
// makeStoreWithSpine: same helper as state.test.ts (spine + one active plottable)

it("renders one row per collapse step with a remove button", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);  // default plan = 2 steps
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  expect(screen.getAllByRole("button", { name: /remove level/i })).toHaveLength(2);
});

it("test-grain select is present", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  expect(screen.getByLabelText(/test reads at/i)).toBeInTheDocument();
});

it("reset clears the override", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  store.set(setTestGrainAtom, "experiment/cell");
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));
  expect(store.get(activePlottableAtom)?.testGrain).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/CollapseRoutingPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

```tsx
// src/components/CollapseRoutingPanel.tsx
import { useAtomValue, useSetAtom } from "jotai";
import {
  activePlottableAtom, effectivePlanAtom, effectiveTestGrainAtom,
  hierarchyAtom, schemaAtom, shapeCountsAtom,
  setCollapsePlanAtom, setTestGrainAtom, resetCollapseAtom,
} from "../state";
import { grainKey, planGrains } from "../collapse";
import { LEVEL_FNS, type LevelFn } from "../types";

export function CollapseRoutingPanel() {
  const p = useAtomValue(activePlottableAtom);
  const schema = useAtomValue(schemaAtom);
  const { spine } = useAtomValue(hierarchyAtom);
  const plan = useAtomValue(effectivePlanAtom);
  const testGrain = useAtomValue(effectiveTestGrainAtom);
  const counts = useAtomValue(shapeCountsAtom);
  const setPlan = useSetAtom(setCollapsePlanAtom);
  const setTestGrain = useSetAtom(setTestGrainAtom);
  const reset = useSetAtom(resetCollapseAtom);
  if (!p || spine.length === 0) return null;

  const label = (n: string) => schema?.columns.find((c) => c.name === n)?.label ?? n;
  const grainLabel = (k: string) => k === "" ? "Raw (every row)"
    : k.split("/").map(label).join(" × ");
  const keptDims = new Set(plan.flatMap((s) => s.keep));
  const addable = spine.filter((d) => !keptDims.has(d));

  const setFn = (i: number, fn: LevelFn) =>
    setPlan(plan.map((s, j) => (j === i ? { ...s, fn } : s)));
  const remove = (i: number) => setPlan(plan.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= plan.length) return;
    const next = [...plan]; [next[i], next[j]] = [next[j], next[i]]; setPlan(next);
  };
  const add = (dim: string) =>                       // append the full-spine-prefix up to dim
    setPlan([...plan, { keep: spine.slice(0, spine.indexOf(dim) + 1), fn: "mean" }]);

  return (
    <aside className="collapse-routing">
      <h3>Collapse routing</h3>
      <ol className="cr-steps">
        {plan.map((step, i) => {
          const key = grainKey(step.keep);
          return (
            <li key={`${key}:${i}`} className="cr-step">
              <span className="cr-grain">{grainLabel(key)}</span>
              <select aria-label={`aggregate into ${grainLabel(key)}`} value={step.fn}
                onChange={(e) => setFn(i, e.target.value as LevelFn)}>
                {LEVEL_FNS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button className="icon" title="Earlier" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="icon" title="Later" onClick={() => move(i, 1)} disabled={i === plan.length - 1}>↓</button>
              <button className="icon" aria-label={`remove level ${grainLabel(key)}`} onClick={() => remove(i)}>×</button>
            </li>
          );
        })}
      </ol>
      {addable.length > 0 && (
        <div className="cr-add">
          <span>+ add level</span>
          {addable.map((d) => <button key={d} onClick={() => add(d)}>{label(d)}</button>)}
        </div>
      )}
      <label className="cr-testgrain">
        <span>Test reads at</span>
        <select aria-label="test reads at" value={testGrain}
          onChange={(e) => setTestGrain(e.target.value)}>
          {planGrains(plan).map((k) => {
            const n = counts?.[k === "" ? "source" : `grain:${k}`]?.rows;
            return <option key={k} value={k}>{grainLabel(k)}{n != null ? ` (n = ${n})` : ""}</option>;
          })}
        </select>
      </label>
      <button className="cr-reset" onClick={() => reset()}>Reset to default</button>
    </aside>
  );
}
```

- [ ] **Step 4: Mount + style**

In `src/App.tsx`, render `<CollapseRoutingPanel />` in the analyses-mode analysis column next to the layer controls (follow the existing `LayerRail`/`LayerCards` placement). In `src/index.css`, add `.collapse-routing`, `.cr-steps`, `.cr-step`, `.cr-grain`, `.cr-add`, `.cr-testgrain`, `.cr-reset` rules mirroring `.hierarchy-panel`/`.layer-*` spacing; add `.edge-badge.caution` (amber `#d97706`) and `.edge-badge.info` (neutral/white) for the graph badges (Task 11).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/CollapseRoutingPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/CollapseRoutingPanel.tsx src/components/CollapseRoutingPanel.test.tsx src/App.tsx src/index.css
git commit -m "feat(explorer): per-analysis collapse routing panel"
```

### Task 11: Render guard badges on the graph

**Files:**
- Modify: `src/components/TransformExplorer.tsx`

- [ ] **Step 1: Read the current edge-label rendering**

Read `src/components/TransformExplorer.tsx` where each edge draws its colored label at the midpoint (the re-model added this; Tier A touched it lightly). Note the per-edge render path and how edges are iterated.

- [ ] **Step 2: Add badge rendering**

For each edge, after its label, render any `edge.guards`: an `info` (white) badge on collapse edges (a terse `ⓘ`/dot with `flatten_info.text` as the `title` tooltip); a `caution` (amber) badge on the test/merging edge (a `⚠` with the verdict text as `title`). Add an aggregate caution dot to the `stats` node when any edge into it carries a caution guard:

```tsx
const cautionOnTest = graph.edges.some((e) => e.toId === "stats"
  && e.guards?.some((g) => g.severity === "caution"));
// render a small `.node-caution-dot` on the stats node when cautionOnTest is true
```

Use the `.edge-badge.caution` / `.edge-badge.info` classes added in Task 10.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/TransformExplorer.tsx
git commit -m "feat(explorer): render white/amber guard badges on graph edges"
```

---

## Phase 7 — Persistence (as-is)

### Task 12: `buildSpec`/`fromSpec` round-trip the plan + test grain

**Files:**
- Modify: `src/types.ts` (`AnalysisSpec` ~line 324 — add `collapse?` + `test_grain?`)
- Modify: `src/state.ts` (`buildSpec` ~line 550; the `fromSpec` inverse ~line 468)
- Test: `src/state.test.ts` (append a round-trip test)

- [ ] **Step 1: Write the failing test**

```ts
it("buildSpec records the collapse plan + test grain as-is; fromSpec restores", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  store.set(setCollapsePlanAtom, [{ keep: ["experiment", "cell"], fn: "median" }]);
  store.set(setTestGrainAtom, "experiment/cell");
  // build the spec for the active plottable exactly as the existing tests do
  const spec = buildActiveSpec(store);   // adapt to how state.test.ts builds a spec
  expect(spec.collapse).toEqual([{ keep: ["experiment", "cell"], fn: "median" }]);
  expect(spec.test_grain).toBe("experiment/cell");

  const p = fromSpec(spec /*, schema */);  // match the existing fromSpec call signature
  expect(p.collapse).toEqual([{ keep: ["experiment", "cell"], fn: "median" }]);
  expect(p.testGrain).toBe("experiment/cell");
});

it("fromSpec leaves collapse/testGrain undefined when the spec omits them", () => {
  const spec = minimalSpecWithoutCollapse();  // a CellFlow-style export
  const p = fromSpec(spec);
  expect(p.collapse).toBeUndefined();
  expect(p.testGrain).toBeUndefined();
});
```

> Read `buildSpec`/`fromSpec` (and how `state.test.ts` already exercises them) first, and match the exact call shapes for `buildActiveSpec`/`fromSpec`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state.test.ts`
Expected: FAIL — `spec.collapse`/`p.collapse` undefined.

- [ ] **Step 3: Implement**

Add to `AnalysisSpec` (types.ts ~line 324):

```ts
  /* un-forcing the nesting: recorded as-is (full plan + chosen grain), not as a
     deviation from the default. Absent -> regenerate from the spine on load. */
  collapse?: CollapsePlan;
  test_grain?: GrainKey;
```

In `buildSpec` (state.ts ~line 550), include them when present on the plottable:

```ts
    ...(p.collapse ? { collapse: p.collapse } : {}),
    ...(p.testGrain ? { test_grain: p.testGrain } : {}),
```

In the `fromSpec` inverse (state.ts ~line 468), read them back (default-on-absent — the same path a new analysis takes):

```ts
    collapse: spec.collapse,        // undefined -> effectivePlanAtom regenerates
    testGrain: spec.test_grain,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/state.test.ts && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/state.ts src/state.test.ts
git commit -m "feat(persist): round-trip collapse plan + test grain as-is in .iris"
```

---

## Phase 8 — e2e + final verification

### Task 13: Playwright — routing edits, re-route, badges

**Files:**
- Modify: the existing explorer e2e shot (find it: `grep -rl "TransformExplorer\|explorer\|collapse" e2e tests 2>/dev/null; ls e2e 2>/dev/null`)

- [ ] **Step 1: Extend the explorer e2e spec**

Add assertions to the explorer Playwright test:
- The Collapse routing panel renders with one row per collapse step.
- Removing a step re-routes the graph (a collapse node disappears).
- Changing **Test reads at** to a finer node makes an **amber** caution badge appear on the test edge (`.edge-badge.caution`) and the caution dot on the stats node.
- A **white** info badge (`.edge-badge.info`) is present on every collapse edge from the start.

- [ ] **Step 2: Run the e2e suite**

Run: the project's e2e script (check `package.json`; likely `npx playwright test`).
Expected: PASS (the sandbox has Chromium; run it, do not skip).

- [ ] **Step 3: Commit**

```bash
git add e2e
git commit -m "test(e2e): collapse routing edits + guard badges in the explorer"
```

### Task 14: Full green sweep

- [ ] **Step 1: Run everything**

```bash
cd engine && python -m pytest -q && cd ..
npx vitest run
npx tsc --noEmit
npm run build
```
Expected: all green.

- [ ] **Step 2: Fix any fallout, then commit**

```bash
git add -A
git commit -m "chore: green sweep for un-forcing the nesting"
```

---

## Self-review notes (for the implementer)

- **Default-plan equivalence is the safety net.** Tasks 1 and 7 must keep specs *without* `collapse`/`test_grain` byte-for-byte identical to today (the regression pins in `test_hierarchy.py` and the full engine suite). If any pre-existing test changes output, the delegation is wrong — fix the adapter, don't edit the baseline.
- **grain key consistency.** TS `grainKey` (Task 0) and Python `_grain_key` (Task 1) must agree exactly (`/`-joined kept dims in spine order, `""` for raw). The node ids (`grain:<key>`), the `shapeCountsAtom` keys, the `/reduce` `grain` param, and the `test_grain` field all use this one convention.
- **`materialize_plan` signature is `(df, schema, plan, split_cols)`** — no `spine` argument (the grain lives in each step's `keep`). Every caller (guards, `/shape_counts`, `/reduce`, `render.py`) uses this shape.
- **Coordinate exemption depends on column type.** Guard #4 fires only when a kept dim *finer than* the dropped one is an `identifier`. If `frame`/time is mis-typed `identifier` (the sibling TODO friction), a mean-trajectory re-route would warn — acceptable as a retype nudge; call it out in the PR.
- **Layer binding stays by level-name in this sub-project.** `levelGrainNode` maps a layer's `level` (a single spine dim) to its prefix-grain node. Drawing a geom at a *non-prefix* grain (full mean-trajectory *plotting*, vs testing/inspecting it) needs `layer.level` generalized to a grain key through the compiler — **out of scope here**; the routing, the test grain, the guards, and data-tab inspection of any grain are delivered.
