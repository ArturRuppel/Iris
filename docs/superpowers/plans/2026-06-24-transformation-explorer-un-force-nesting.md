# Un-forcing the Nesting (Collapse Routing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the enforced finest-first collapse spine with a per-analysis, editable **CollapsePlan** that defaults to today's exact chain, and replace the pseudoreplication wall with a chosen test grain plus four never-blocking guards (yellow #1/#2/#4, white always-on #3).

**Architecture:** A `CollapsePlan` is an ordered list of `{dim, fn}` ops; each prefix is a graph node whose grain is `spine − removed`. The engine gets one general fold, `materialize_plan`, with `materialize_levels` kept as a thin default-chain adapter (so existing behavior + tests are an exact regression pin). Three pure guard helpers read group counts. The frontend carries the plan + test-grain pointer per plottable, edits them in a dedicated routing panel, renders the graph (read-only) with guard badges, and persists the plan as-is.

**Tech Stack:** Python 3 / pandas / FastAPI (engine, `pytest`); React / TypeScript / jotai / Vite (frontend, `vitest`, `tsc`, Playwright e2e).

**Conventions used throughout:**
- **grain key** — kept dims in spine order (coarse→fine) joined by `/`; raw = `""`. E.g. spine `experiment › cell › frame`, after removing `frame` the grain key is `"experiment/cell"`; after also removing `cell` it is `"experiment"`.
- **default plan** — from a present spine (coarse→fine) and `fn`: one op per spine dim, **finest→coarsest** (`spine` reversed). This reproduces today's chain exactly.

Branch `un-force-nesting` is checked out. Run engine commands from `engine/`, frontend commands from the repo root.

---

## Phase 0 — Shared frontend contracts

### Task 0: CollapsePlan types, grain helpers, default-plan generator

**Files:**
- Modify: `src/types.ts` (after the `Hierarchy` block, ~line 106)
- Create: `src/collapse.ts`
- Test: `src/collapse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/collapse.test.ts
import { describe, it, expect } from "vitest";
import { defaultPlan, grainKey, grainAfter, planGrains } from "./collapse";

const SPINE = ["experiment", "cell", "frame"]; // coarse -> fine

describe("collapse helpers", () => {
  it("defaultPlan removes finest -> coarsest, fn from map or 'mean'", () => {
    expect(defaultPlan(SPINE, { cell: "median" })).toEqual([
      { dim: "frame", fn: "mean" },
      { dim: "cell", fn: "median" },
      { dim: "experiment", fn: "mean" },
    ]);
  });

  it("grainKey joins kept dims in spine order; raw is empty string", () => {
    expect(grainKey([])).toBe("");
    expect(grainKey(["experiment", "cell"])).toBe("experiment/cell");
  });

  it("grainAfter removes the first k ops' dims, keeping spine order", () => {
    const plan = defaultPlan(SPINE, {});
    expect(grainAfter(SPINE, plan, 0)).toEqual([]);                 // raw, nothing removed
    expect(grainAfter(SPINE, plan, 1)).toEqual(["experiment", "cell"]); // removed frame
    expect(grainAfter(SPINE, plan, 2)).toEqual(["experiment"]);     // removed frame, cell
  });

  it("planGrains lists raw + one grain key per prefix, in op order", () => {
    const plan = defaultPlan(SPINE, {});
    expect(planGrains(SPINE, plan)).toEqual(["", "experiment/cell", "experiment"]);
  });

  it("supports a non-prefix grain (keep finer, drop coarser): mean trajectory", () => {
    const plan = [{ dim: "cell", fn: "mean" as const }];
    expect(planGrains(SPINE, plan)).toEqual(["", "experiment/frame"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collapse.test.ts`
Expected: FAIL — `Cannot find module './collapse'`.

- [ ] **Step 3: Add types to `src/types.ts`**

Insert after the `EMPTY_HIERARCHY` / `RAW_LEVEL` block (~line 106):

```ts
/* Un-forcing the nesting: a per-analysis collapse plan. Each op aggregates one
   spine dim away with `fn`, applied in order; each prefix of the list is a graph
   node whose grain is the spine minus the dims removed so far. The default plan
   (every spine dim, finest -> coarsest) reproduces the forced chain exactly. */
export interface CollapseOp { dim: string; fn: LevelFn }
export type CollapsePlan = CollapseOp[];

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

/* The forced chain as a plan: one op per spine dim, finest -> coarsest. */
export function defaultPlan(spine: string[], fn: Record<string, LevelFn>): CollapsePlan {
  return [...spine].reverse().map((dim) => ({ dim, fn: fn[dim] ?? "mean" }));
}

/* Kept dims (spine order) after applying the first `k` ops of `plan`. */
export function grainAfter(spine: string[], plan: CollapsePlan, k: number): string[] {
  const removed = new Set(plan.slice(0, k).map((op) => op.dim));
  return spine.filter((d) => !removed.has(d));
}

export function grainKey(keptDims: string[]): GrainKey {
  return keptDims.join("/");
}

/* Raw grain ("") plus one grain key per op prefix, in op order. */
export function planGrains(spine: string[], plan: CollapsePlan): GrainKey[] {
  const keys: GrainKey[] = [grainKey(grainAfter(spine, plan, 0))];
  for (let k = 1; k <= plan.length; k++) keys.push(grainKey(grainAfter(spine, plan, k)));
  return keys;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/collapse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/collapse.ts src/collapse.test.ts
git commit -m "feat(collapse): CollapsePlan types + grain/default-plan helpers"
```

---

## Phase 1 — Engine: the general fold

### Task 1: `materialize_plan` + make `materialize_levels` delegate to it

**Files:**
- Modify: `engine/iris_engine/hierarchy.py` (add `materialize_plan`; rewrite `materialize_levels` body to delegate)
- Test: `engine/tests/test_hierarchy.py` (add new tests; existing tests are the regression pin)

- [ ] **Step 1: Write the failing test**

Append to `engine/tests/test_hierarchy.py`:

```python
# --------------------------------------------------------------------------- #
# materialize_plan (un-forcing the nesting)
# --------------------------------------------------------------------------- #

def test_default_plan_matches_materialize_levels():
    """The finest->coarsest plan reproduces materialize_levels exactly (the
    regression pin: existing behavior is just the default plan)."""
    df = _unpaired_df()
    plan = [{"dim": d, "fn": "mean"} for d in reversed(SPINE)]  # rep, subject
    grains = hierarchy.materialize_plan(df, _schema(), SPINE, plan, ["group"])
    levels, _ = hierarchy.materialize_levels(df, _schema(), SPINE, {}, ["group"])
    # grain keys: "" (raw), "subject/rep" (per rep), "subject" (per subject)
    assert set(grains) == {"", "subject/rep", "subject"}
    assert len(grains["subject"][0]) == len(levels["subject"][0])
    assert len(grains["subject/rep"][0]) == len(levels["rep"][0])

def test_plan_can_skip_a_level():
    """Dropping the middle op (rep) pools straight to subject; n at subject is
    unchanged, only the weighting differs."""
    df = _unpaired_df()
    plan = [{"dim": "subject", "fn": "mean"}]  # remove subject only -> grain keeps rep? no:
    # remove subject: kept = [rep] -> grain "rep" (mean over subjects within each rep)
    grains = hierarchy.materialize_plan(df, _schema(), SPINE, plan, ["group"])
    assert set(grains) == {"", "rep"}
    assert len(grains["rep"][0]) == df["rep"].nunique()

def test_plan_non_prefix_grain_keep_finer_drop_coarser():
    """Remove the coarser dim, keep the finer: a non-prefix grain (the mean
    trajectory shape)."""
    df = _unpaired_df()
    plan = [{"dim": "subject", "fn": "mean"}]
    grains = hierarchy.materialize_plan(df, _schema(), SPINE, plan, [])
    # kept = [rep]; one row per rep value, pooled across subjects
    assert len(grains["rep"][0]) == df["rep"].nunique()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_hierarchy.py::test_default_plan_matches_materialize_levels -v`
Expected: FAIL — `AttributeError: module 'iris_engine.hierarchy' has no attribute 'materialize_plan'`.

- [ ] **Step 3: Add `materialize_plan` and delegate `materialize_levels`**

In `engine/iris_engine/hierarchy.py`, add (after `materialize_levels`):

```python
def _grain_key(kept: list[str]) -> str:
    """Kept dims (already in spine order) joined by '/'; '' = raw."""
    return "/".join(kept)


def materialize_plan(
    df: pd.DataFrame, schema: dict, spine: list[str],
    plan: list[dict], split_cols: list[str] | None = None,
) -> dict[str, tuple[pd.DataFrame, dict]]:
    """General collapse: fold `plan` (ordered ops `{dim, fn}`, each aggregating
    one spine dim away) over the reduced frame. Returns one (df, schema) per
    prefix-grain, keyed by grain key (kept dims in spine order joined by '/', ''
    = raw). Each op groups the *current* table by its remaining dims (+ split)
    and aggregates with `_level_table` — so collapsing stays nested
    (median-of-medians), the op order is the weighting, and removing a coarser
    dim while keeping a finer one yields a non-prefix grain (the mean-trajectory
    shape). `materialize_levels` is the special case plan = full spine,
    finest -> coarsest."""
    split = [c for c in (split_cols or []) if c in df.columns]
    present = spine_present(df, spine)

    raw = df.copy()
    raw["row_ids"] = [[i] for i in raw["id"].tolist()]
    grains: dict[str, tuple[pd.DataFrame, dict]] = {RAW: (raw, schema)}

    remaining = list(present)
    src, src_schema = raw, schema
    for op in plan:
        dim = op["dim"]
        if dim not in remaining:
            continue  # dim already gone / not present after reduction; skip safely
        remaining = [d for d in remaining if d != dim]
        grain = list(dict.fromkeys(remaining + split))
        tbl = _level_table(src, src_schema, grain, _AGG_FN(op.get("fn")))
        grains[_grain_key(remaining)] = tbl
        src, src_schema = tbl
    return grains


def _AGG_FN(fn: str | None) -> str:
    return fn if fn in _AGG else "mean"
```

Then rewrite `materialize_levels` to delegate (keeping its exact return shape — keyed by single level name = the finest kept dim — for existing callers):

```python
def materialize_levels(
    df: pd.DataFrame, schema: dict, spine: list[str],
    fn: dict[str, str] | None = None, split_cols: list[str] | None = None,
) -> tuple[dict[str, tuple[pd.DataFrame, dict]], list[str]]:
    """The forced finest -> coarsest chain, kept for callers that key levels by a
    single spine-column name. Thin adapter over `materialize_plan`."""
    fn = fn or {}
    present = spine_present(df, spine)
    plan = [{"dim": d, "fn": fn.get(d, "mean")} for d in reversed(present)]
    grains = materialize_plan(df, schema, present, plan, split_cols)
    # re-key each grain by its finest kept dim (prefix grains only, by construction)
    levels: dict[str, tuple[pd.DataFrame, dict]] = {}
    for key, tbl in grains.items():
        kept = key.split("/") if key else []
        levels[kept[-1] if kept else RAW] = tbl
    return levels, present
```

> Note: `materialize_levels` previously built the dict inline; that loop is now removed in favor of the delegation. `_level_table`, `spine_present`, `_concat_ids`, `_AGG`, `RAW`, `resolve_level` are unchanged.

- [ ] **Step 4: Run new + existing tests to verify all pass**

Run: `cd engine && python -m pytest tests/test_hierarchy.py -v`
Expected: PASS — the three new tests AND every pre-existing `test_hierarchy.py` test (the regression pin).

- [ ] **Step 5: Run the full engine suite (catch downstream callers)**

Run: `cd engine && python -m pytest -q`
Expected: PASS (all green; `render.py`/`compiler.py`/`shape_counts` still call `materialize_levels` and get identical results).

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/hierarchy.py engine/tests/test_hierarchy.py
git commit -m "feat(engine): materialize_plan general fold; materialize_levels delegates"
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
    # test reads RAW while a coarser collapse (per experiment) exists
    v = hierarchy.pseudoreplication(df, SPINE,
        plan=[{"dim": d, "fn": "median"} for d in reversed(SPINE)],
        test_grain="")
    assert v["risk"] is True
    assert v["n_test"] == len(df)
    assert v["n_coarsest"] == 3            # 3 experiments
    assert v["coarsest_grain"] == "experiment"

def test_pseudoreplication_clear_at_coarsest():
    df = _df()
    v = hierarchy.pseudoreplication(df, SPINE,
        plan=[{"dim": d, "fn": "median"} for d in reversed(SPINE)],
        test_grain="experiment")
    assert v["risk"] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_guards_routing.py::test_pseudoreplication_flags_test_finer_than_coarsest -v`
Expected: FAIL — no attribute `pseudoreplication`.

- [ ] **Step 3: Implement**

Add to `engine/iris_engine/hierarchy.py`. The materialize call needs a schema; the
guard only counts rows, so a minimal numeric schema over the present columns is
enough (identity for grouping comes from the column values, not the schema types):

```python
def _grain_n(grains: dict, key: str) -> int:
    tbl = grains.get(key)
    return int(len(tbl[0])) if tbl else 0


def _coarsest_grain(grains: dict) -> str:
    """The grain key with the fewest kept dims ('' = raw is finest, not coarsest,
    so it is excluded unless it is the only node)."""
    non_raw = [k for k in grains if k]
    return min(non_raw, key=lambda k: len(k.split("/"))) if non_raw else RAW


def pseudoreplication(df: pd.DataFrame, spine: list[str], plan: list[dict],
                      test_grain: str) -> dict:
    """#1: the test reads a grain finer than the coarsest available node, so its
    units are nested in a coarser one (correlated measurements treated as
    independent). Returns the risk flag with n at the chosen grain vs the
    coarsest, plus the coarsest grain key — enough to name the safer option."""
    cols = [{"name": c, "type": "numeric", "label": c}
            for c in df.columns if c != "id"]
    grains = materialize_plan(df, {"schema_version": "1.0", "columns": cols},
                              spine, plan, [])
    coarsest = _coarsest_grain(grains)
    return {"risk": test_grain != coarsest,
            "n_test": _grain_n(grains, test_grain),
            "n_coarsest": _grain_n(grains, coarsest),
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

Append to `engine/tests/test_guards_routing.py`. Reuse the paired fixture shape from `test_hierarchy.py`:

```python
def _paired_df():
    rows, rid = [], 0
    for s in ["s1", "s2", "s3"]:
        for grp in ("A", "B"):
            for r in range(3):
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
        default_grain="subject", chosen_grain="rep")
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

`pairing()` already takes `inferential_level` (a single spine-column name). A grain key's inferential level is its finest kept dim (`key.split("/")[-1]`, or `RAW` for raw). Add:

```python
def _grain_inferential_level(grain: str) -> str:
    return grain.split("/")[-1] if grain else RAW


def pairing_flip(df: pd.DataFrame, spine: list[str], qualifier: str | None,
                 default_grain: str, chosen_grain: str) -> dict:
    """#2: re-routing/retargeting can change the pairing verdict (which is
    derived from the spine + the inferential grain). Run `pairing` at the default
    grain and the chosen grain; report whether the verdict changed."""
    def verdict(grain: str):
        p = pairing(df, spine, qualifier,
                    inferential_level=_grain_inferential_level(grain))
        return p["verdict"] if p else None
    frm, to = verdict(default_grain), verdict(chosen_grain)
    return {"flipped": frm is not None and to is not None and frm != to,
            "from": frm, "to": to,
            "across": (pairing(df, spine, qualifier,
                       inferential_level=_grain_inferential_level(chosen_grain)) or {}).get("across")}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && python -m pytest tests/test_guards_routing.py -v`
Expected: PASS (4 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/hierarchy.py engine/tests/test_guards_routing.py
git commit -m "feat(engine): pairing-flip guard (#2)"
```

### Task 4: `identity_merge` guard (#4) with the coordinate exemption

**Files:**
- Modify: `engine/iris_engine/hierarchy.py`
- Test: `engine/tests/test_guards_routing.py`

- [ ] **Step 1: Write the failing test**

Append (uses `_df()`/`SPINE`/`_schema()` from the top of the file):

```python
def test_identity_merge_flags_dropping_field_keeping_cell():
    df = _df()
    # plan removes frame, then field, but KEEPS cell -> cell ids collide across
    # fields and merge. (cell is an identifier -> guarded.)
    plan = [{"dim": "frame", "fn": "median"}, {"dim": "field", "fn": "median"}]
    out = hierarchy.identity_merge(df, _schema(), SPINE, plan)
    assert len(out) == 1
    m = out[0]
    assert m["dim"] == "field"
    assert m["before"] == df.groupby(["experiment", "field", "cell"]).ngroups  # 24
    assert m["after"] == df.groupby(["experiment", "cell"]).ngroups            # 12
    assert m["after"] < m["before"]

def test_identity_merge_exempts_numeric_coordinate():
    df = _df()
    # remove cell, KEEP frame (numeric coordinate) -> intentional pooling, no flag.
    plan = [{"dim": "cell", "fn": "mean"}]
    out = hierarchy.identity_merge(df, _schema(), SPINE, plan)
    assert out == []

def test_identity_merge_clear_for_default_chain():
    df = _df()
    plan = [{"dim": d, "fn": "median"} for d in reversed(SPINE)]
    assert hierarchy.identity_merge(df, _schema(), SPINE, plan) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_guards_routing.py::test_identity_merge_flags_dropping_field_keeping_cell -v`
Expected: FAIL — no attribute `identity_merge`.

- [ ] **Step 3: Implement**

```python
def identity_merge(df: pd.DataFrame, schema: dict, spine: list[str],
                   plan: list[dict]) -> list[dict]:
    """#4: removing a dim while keeping a FINER *identifier* dim can merge
    distinct units (a finer id unique only within the removed parent). Flag each
    such op. Numeric/coordinate kept dims (e.g. time/frame) are exempt — pooling
    over them is intentional. Detection is exact: distinct count of (kept
    identifiers) vs (kept identifiers + the removed dim)."""
    types = {c["name"]: c["type"] for c in schema["columns"]}
    present = spine_present(df, spine)
    merges: list[dict] = []
    removed: list[str] = []
    for op in plan:
        dim = op["dim"]
        if dim not in present:
            continue
        removed.append(dim)
        kept = [d for d in present if d not in removed]
        kept_ids = [d for d in kept if types.get(d) == "identifier"]
        if not kept_ids:
            continue
        before = df.groupby(kept_ids + [dim], observed=True).ngroups
        after = df.groupby(kept_ids, observed=True).ngroups
        if after < before:
            merges.append({"dim": dim, "kept": kept_ids,
                           "before": int(before), "after": int(after)})
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
- Test: `engine/tests/test_shape_counts.py` (new; if one exists, append)

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
DEFAULT = [{"dim": d, "fn": "median"} for d in reversed(SPINE)]

def test_shape_counts_keys_collapse_nodes_by_grain():
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": DEFAULT, "test_grain": "experiment", "qualifier": None}
    r = client.post("/shape_counts", json=body)
    assert r.status_code == 200
    grains = r.json()["grains"]
    assert grains["experiment"]["rows"] == 3
    assert grains["experiment/field/cell"]["rows"] == 24

def test_shape_counts_returns_guards():
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": DEFAULT, "test_grain": "", "qualifier": None}
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
    # un-forcing the nesting: the per-analysis plan, chosen test grain, and the
    # comparison qualifier (for the pairing-flip guard). Absent -> default chain.
    collapse: list[dict] | None = None
    test_grain: str | None = None
    qualifier: str | None = None
```

In `shape_counts`, after the existing `levels_out` block (it stays for back-compat with the legacy single-name keys), add grain-keyed counts and guards. Replace the `return` (~line 573) with:

```python
    # grain-keyed counts for the routing graph (un-forcing the nesting)
    spine_full = (req.hierarchy or {}).get("spine") or []
    present = hierarchy.spine_present(full, spine_full)
    plan = req.collapse or [{"dim": d, "fn": (req.hierarchy or {}).get("fn", {}).get(d, "mean")}
                            for d in reversed(present)]
    grains: dict[str, dict] = {}
    guards: dict = {"pseudoreplication": None, "pairing_flip": None, "identity_merge": []}
    if present:
        gmats = hierarchy.materialize_plan(full, full_sch, present, plan, [])
        for key, (gdf, _gsch) in gmats.items():
            grains[key] = {"rows": int(len(gdf)), "cols": _cols(gdf)}
        coarsest = hierarchy._coarsest_grain(gmats)
        test_grain = req.test_grain if req.test_grain is not None else coarsest
        guards["pseudoreplication"] = hierarchy.pseudoreplication(full, present, plan, test_grain)
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
    # keep frame (numeric), drop cell -> grain "experiment/field/frame"
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": [{"dim": "cell", "fn": "mean"}],
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
    # joined by '/'). Takes precedence over `level` when both `collapse` + `grain`
    # are set. Absent -> legacy `level` path.
    collapse: list[dict] | None = None
    grain: str | None = None
```

In `reduce_preview`, after the existing legacy `level` block (~line 520), add the grain path (before `out = out.drop(columns=["row_ids"]...)`):

```python
    if req.at_step is None and req.collapse is not None and req.grain is not None and spine:
        gmats = hierarchy.materialize_plan(out, sch, spine, req.collapse, [])
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

Read `engine/iris_engine/render.py:140-175` to see how `model`/`spec` carry hierarchy, layers, and how `inf_level` is currently derived (`coarsest_level(present_spine, layer_levels)`).

- [ ] **Step 2: Write the failing test**

```python
# engine/tests/test_render_routing.py
# Mirror an existing render test (see engine/tests for the analyze/spec fixture
# helpers — e.g. test_multigroup.py / test_correlation_spine.py build a spec dict
# and call the analyze entrypoint). Reuse that helper here.
#
# Assert: when the spec carries `collapse` + `test_grain` set to a finer grain,
# stat_model["inferential_level"] reflects the CHOSEN grain's finest kept dim,
# not coarsest_level's derivation.
```

Concretely (adapt to the analyze entrypoint the sibling tests use):

```python
def test_test_grain_override_sets_inferential_level(analyze, paired_spec, paired_table):
    spec = paired_spec()
    spec["collapse"] = [{"dim": d, "fn": "median"} for d in reversed(["subject", "rep"])]
    spec["test_grain"] = "subject/rep"          # finer than the default "subject"
    out = analyze(paired_table(), spec)
    assert out["stat_model"]["inferential_level"] == "rep"
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_render_routing.py -v`
Expected: FAIL — `inferential_level` is still `coarsest_level`'s pick (`subject`).

- [ ] **Step 4: Implement**

In `render.py`, where `level_tables` and `inf_level` are computed (~149–167), read the plan + test grain from the spec and prefer them:

```python
    plan = spec.get("collapse")
    if plan:
        grains = hierarchy.materialize_plan(df, sch, present_spine, plan, split_cols)
    # ... keep level_tables for layer resolution via materialize_levels as today ...

    # inferential grain: the explicit test_grain wins; else the legacy derivation.
    test_grain = spec.get("test_grain")
    if test_grain is not None:
        inf_level = test_grain.split("/")[-1] if test_grain else hierarchy.RAW
    else:
        inf_level = hierarchy.coarsest_level(present_spine, layer_levels)
    model["inferential_level"] = inf_level
```

> Keep `resolve_level(level_tables, inf_level)` working: `inf_level` is the finest kept dim of the chosen grain, which `materialize_levels` keys by. For a non-prefix chosen grain, resolve from `grains[test_grain]` instead:

```python
    if plan and test_grain in (grains if plan else {}):
        stat_df, _ = grains[test_grain]
    else:
        stat_df, _ = hierarchy.resolve_level(level_tables, inf_level)
```

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

- [ ] **Step 1: Update the existing tests + add new ones**

`buildGraph`'s signature changes from `(steps, hierarchy, layers, schema, stats)` to `(steps, spine, plan, layers, schema, stats)` where `spine: string[]` and `plan: CollapsePlan`. Update `graph.test.ts`:
- Replace `HIER` usage: derive `const SPINE = ["experiment", "cell"]; const PLAN = defaultPlan(SPINE, {});` (import `defaultPlan` from `../collapse`).
- Collapse node ids are now grain keys prefixed `grain:` — `grain:experiment/cell`, `grain:experiment` (raw stays `source`/last step). Update the id/label assertions:

```ts
import { defaultPlan } from "../collapse";
const SPINE = ["experiment", "cell"];
const PLAN = defaultPlan(SPINE, {});

it("collapse nodes are keyed by grain; chain runs finest -> coarsest", () => {
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
```

(Port the other existing assertions: `level:cell`→`grain:experiment/cell`, `level:experiment`→`grain:experiment`; `nodeIdForLevel` is replaced by `nodeIdForGrain` — see Step 3.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: FAIL — signature/id mismatches.

- [ ] **Step 3: Rewrite the collapse section of `buildGraph`**

Add `guards?: GuardVerdict[]` to the `Edge` interface. Replace the spine loop (graph.ts:97–107) and `nodeIdForLevel`:

```ts
import type { CollapsePlan, GuardVerdict } from "../types";
import { grainAfter, grainKey } from "../collapse";

const grainId = (key: string) => (key === "" ? null : `grain:${key}`);
export function nodeIdForGrain(key: string, rawNodeId: string): string {
  return key === "" ? rawNodeId : `grain:${key}`;
}

const labelForGrain = (schema: Schema | null, kept: string[]): string =>
  kept.length === 1 ? `per ${labelForCol(schema, kept[0])}`
    : `per ${kept.map((d) => labelForCol(schema, d)).join(" × ")}`;

const flattenInfo = (schema: Schema | null, op: { dim: string; fn: string }, keptAfter: string[]): GuardVerdict => ({
  id: "flatten_info", severity: "info",
  text: `${op.fn} over ${labelForCol(schema, op.dim)}; ` +
        (keptAfter.length ? `grouped per ${keptAfter.map((d) => labelForCol(schema, d)).join(" × ")}` : "one value overall"),
});
```

In `buildGraph(steps, spine, plan, layers, schema, stats)`, replace the collapse loop:

```ts
  let cprev = rawNodeId;
  plan.forEach((op, k) => {
    const kept = grainAfter(spine, plan, k + 1);
    const key = grainKey(kept);
    const id = `grain:${key}`;
    nodes.push({ id, kind: "table", label: labelForGrain(schema, kept),
      table: { via: "grain", grain: key } });
    edges.push({ id: `e:${cprev}->${id}`, kind: "collapse", label: "collapse",
      fromId: cprev, toId: id, guards: [flattenInfo(schema, op, kept)] });
    cprev = id;
  });
```

Update `NodeTable` (graph.ts:11) to add `| { via: "grain"; grain: string }`. Update the geom/test edge origin resolution to use grain keys: a layer's `level` is now a grain key; `nodeIdForGrain(layer.level, rawNodeId)`. The test edge originates from `nodeIdForGrain(testGrain, rawNodeId)` — but `testGrain` is passed via `stats` (see Task 9 for the atom wiring); for this task derive it as the coarsest grain (last plan node) to preserve current behavior:

```ts
  const coarsest = grainKey(grainAfter(spine, plan, plan.length));
  const testFromId = nodeIdForGrain(coarsest, rawNodeId);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/explorer/graph.test.ts`
Expected: PASS (all ported + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/explorer/graph.ts src/explorer/graph.test.ts
git commit -m "feat(explorer): buildGraph from CollapsePlan; grain node ids; white #3 info"
```

---

## Phase 5 — Frontend: per-analysis state

### Task 9: Plottable carries `collapse` + `testGrain`; seed/mutate/reset atoms

**Files:**
- Modify: `src/state.ts` (Plottable interface ~line 143; new atoms near the hierarchy mutators ~line 769)
- Modify: `src/explorer/graphAtom.ts` (build from the plottable's plan; merge guard verdicts onto edges)
- Test: `src/state.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/state.test.ts`:

```ts
import { createStore } from "jotai";
import { effectivePlanAtom, setTestGrainAtom, resetCollapseAtom } from "./state";
// (mirror the existing state.test.ts setup: seed schema/hierarchy/active plottable)

it("effectivePlanAtom defaults to the spine's finest->coarsest chain", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]); // helper from existing tests
  expect(store.get(effectivePlanAtom)).toEqual([
    { dim: "cell", fn: "mean" }, { dim: "experiment", fn: "mean" },
  ]);
});

it("setTestGrain stores on the active plottable; reset clears the plan override", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  store.set(setTestGrainAtom, "experiment/cell");
  expect(store.get(activePlottableAtom)?.testGrain).toBe("experiment/cell");
  store.set(resetCollapseAtom);
  expect(store.get(activePlottableAtom)?.collapse).toBeUndefined();
  expect(store.get(activePlottableAtom)?.testGrain).toBeUndefined();
});
```

> If `state.test.ts` lacks a `makeStoreWithSpine` helper, add a small local one that sets `schemaAtom`, `hierarchyAtom` (`{spine, fn:{}}`), one plottable, and `activePlottableIdAtom`. Match the existing file's setup idiom.

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

Add atoms (near the hierarchy mutators, ~line 769):

```ts
import { defaultPlan, grainKey, grainAfter } from "./collapse";
import type { CollapsePlan, GrainKey } from "./types";

/* the plan in effect for the active plottable: its override, else the default
   chain generated from the table-level spine. */
export const effectivePlanAtom = atom<CollapsePlan>((get) => {
  const p = get(activePlottableAtom);
  const h = get(hierarchyAtom);
  return p?.collapse ?? defaultPlan(h.spine, h.fn);
});

/* the test grain in effect: the override, else the coarsest node. */
export const effectiveTestGrainAtom = atom<GrainKey>((get) => {
  const p = get(activePlottableAtom);
  const h = get(hierarchyAtom);
  const plan = get(effectivePlanAtom);
  return p?.testGrain ?? grainKey(grainAfter(h.spine, plan, plan.length));
});

const writePlottable = (get: any, set: any, patch: Partial<Plottable>) => {
  const p = get(activePlottableAtom);
  if (p) set(activePlottableAtom, { ...p, ...patch });
};

/* edit the plan: materialize the current effective plan onto the plottable, then
   apply `next` (so the first edit pins the default before mutating it). */
export const setCollapsePlanAtom = atom(null, (get, set, next: CollapsePlan) =>
  writePlottable(get, set, { collapse: next }));

export const setTestGrainAtom = atom(null, (get, set, grain: GrainKey) =>
  writePlottable(get, set, { testGrain: grain }));

/* remove the overrides -> fall back to the generated default. */
export const resetCollapseAtom = atom(null, (get, set) =>
  writePlottable(get, set, { collapse: undefined, testGrain: undefined }));
```

- [ ] **Step 4: Wire `graphAtom.ts` to the plan + merge guards**

Rewrite `explorerGraphAtom` in `src/explorer/graphAtom.ts`:

```ts
import { hierarchyAtom, effectivePlanAtom, effectiveTestGrainAtom } from "../state";

/* guard verdicts from /shape_counts, mapped onto edges (null until loaded). */
export const guardsAtom = atom<ShapeCountsGuards | null>(null); // type from types.ts

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
  if (guards) edges = mergeGuards(edges, guards, get(effectiveTestGrainAtom), h.spine, plan);
  return { ...g, nodes, edges };
});
```

Add `mergeGuards(edges, guards, testGrain, spine, plan)` (same file): attach a `caution` GuardVerdict to the **test edge** (`kind === "test"`) for `pseudoreplication.risk` and `pairing_flip.flipped`, and to the **collapse edge** whose op removed `dim` for each `identity_merge` entry. Build the human text from the verdict numbers (e.g. pseudoreplication: `Testing at this grain uses ${n_test} measurements from ${n_coarsest} ${coarsest}. Consider testing per ${coarsest} (n = ${n_coarsest}).`). The `shapeCountsAtom` fetch (DataTab / a shared effect) must now send `collapse`, `test_grain`, and the comparison `qualifier`, and store `res.guards` into `guardsAtom` and `res.grains` (keyed `grain:<key>`) into `shapeCountsAtom`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/state.test.ts && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/explorer/graphAtom.ts src/state.test.ts src/types.ts
git commit -m "feat(state): per-analysis collapse plan + test grain; guard merge"
```

---

## Phase 6 — Frontend: routing panel + graph badges

### Task 10: `CollapseRoutingPanel` component

**Files:**
- Create: `src/components/CollapseRoutingPanel.tsx`
- Modify: `src/App.tsx` (mount it in the analysis column, near the layer controls)
- Modify: `src/index.css` (panel + badge styles)
- Test: `src/components/CollapseRoutingPanel.test.tsx` (new)

- [ ] **Step 1: Write the failing test (render + interactions)**

```tsx
// src/components/CollapseRoutingPanel.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { CollapseRoutingPanel } from "./CollapseRoutingPanel";
// seed a store with spine ["experiment","cell"], one active plottable (helper as in state.test.ts)

it("lists one row per collapse op with a fn select and a remove button", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  expect(screen.getAllByRole("button", { name: /remove level/i })).toHaveLength(2);
});

it("test-grain select offers every plan node with its n", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  expect(screen.getByLabelText(/test reads at/i)).toBeInTheDocument();
});

it("reset button clears the override", () => {
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
import { grainAfter, grainKey } from "../collapse";
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
  const nodeKeys = [grainKey(grainAfter(spine, plan, 0)),
    ...plan.map((_, k) => grainKey(grainAfter(spine, plan, k + 1)))];
  const removedDims = new Set(plan.map((o) => o.dim));
  const addable = spine.filter((d) => !removedDims.has(d));

  const setFn = (i: number, fn: LevelFn) =>
    setPlan(plan.map((o, j) => (j === i ? { ...o, fn } : o)));
  const remove = (i: number) => setPlan(plan.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= plan.length) return;
    const next = [...plan]; [next[i], next[j]] = [next[j], next[i]]; setPlan(next);
  };
  const add = (dim: string) => setPlan([...plan, { dim, fn: "mean" }]);

  return (
    <aside className="collapse-routing">
      <h3>Collapse routing</h3>
      <ol className="cr-ops">
        {plan.map((op, i) => (
          <li key={`${op.dim}:${i}`} className="cr-op">
            <span className="cr-dim">{label(op.dim)}</span>
            <select aria-label={`aggregate ${label(op.dim)}`} value={op.fn}
              onChange={(e) => setFn(i, e.target.value as LevelFn)}>
              {LEVEL_FNS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <button className="icon" title="Earlier" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button className="icon" title="Later" onClick={() => move(i, 1)} disabled={i === plan.length - 1}>↓</button>
            <button className="icon" aria-label={`remove level ${label(op.dim)}`} onClick={() => remove(i)}>×</button>
          </li>
        ))}
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
          {nodeKeys.map((k) => {
            const n = counts?.[k === "" ? "source" : `grain:${k}`]?.rows;
            const name = k === "" ? "Raw (every row)"
              : k.split("/").map(label).join(" × ");
            return <option key={k} value={k}>{name}{n != null ? ` (n = ${n})` : ""}</option>;
          })}
        </select>
      </label>
      <button className="cr-reset" onClick={() => reset()}>Reset to default</button>
    </aside>
  );
}
```

- [ ] **Step 4: Mount + style**

In `src/App.tsx`, render `<CollapseRoutingPanel />` in the analyses-mode analysis column next to the layer controls (follow the existing `LayerRail`/`LayerCards` placement). In `src/index.css`, add `.collapse-routing`, `.cr-ops`, `.cr-op`, `.cr-add`, `.cr-testgrain`, `.cr-reset` rules mirroring `.hierarchy-panel`/`.layer-*` spacing; add `.edge-badge.caution` (yellow `#d97706` icon) and `.edge-badge.info` (neutral/white) for the graph badges (Task 11).

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
- Test: covered by e2e (Task 12); add a focused render test if `TransformExplorer` has one.

- [ ] **Step 1: Read the current edge-label rendering**

Read `src/components/TransformExplorer.tsx` where edges draw their colored label at the midpoint (the re-model added this). Note the per-edge render path.

- [ ] **Step 2: Add badge rendering**

For each edge, after its label, render any `edge.guards`: an `info` (white) badge on collapse edges (terse: an `ⓘ`/dot with the `flatten_info.text` as `title`); a `caution` (yellow) badge on the test/merging edge (a `⚠` with the verdict text as `title`). Add an aggregate caution dot to the `stats` node when any edge into it carries a caution guard:

```tsx
const cautionOnTest = edges.some((e) => e.toId === "stats"
  && e.guards?.some((g) => g.severity === "caution"));
// render a small `.node-caution-dot` on the stats node when cautionOnTest
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/TransformExplorer.tsx
git commit -m "feat(explorer): render white/yellow guard badges on graph edges"
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
  store.set(setCollapsePlanAtom, [{ dim: "cell", fn: "median" }]);
  store.set(setTestGrainAtom, "experiment/cell");
  const spec = store.get(buildActiveSpecAtom); // or call buildSpec directly as existing tests do
  expect(spec.collapse).toEqual([{ dim: "cell", fn: "median" }]);
  expect(spec.test_grain).toBe("experiment/cell");

  const p = fromSpec(spec, /* schema */); // match existing fromSpec test call
  expect(p.collapse).toEqual([{ dim: "cell", fn: "median" }]);
  expect(p.testGrain).toBe("experiment/cell");
});

it("fromSpec leaves collapse/testGrain undefined when the spec omits them", () => {
  const spec = /* a minimal spec without collapse/test_grain (CellFlow export) */;
  const p = fromSpec(spec);
  expect(p.collapse).toBeUndefined();
  expect(p.testGrain).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state.test.ts`
Expected: FAIL — `spec.collapse`/`p.collapse` undefined on the round-trip.

- [ ] **Step 3: Implement**

Add to `AnalysisSpec` (types.ts):

```ts
  /* un-forcing the nesting: recorded as-is (full plan + chosen grain), not as a
     deviation from the default. Absent -> regenerate from the spine on load. */
  collapse?: CollapsePlan;
  test_grain?: GrainKey;
```

In `buildSpec` (state.ts:550), include them when present on the plottable:

```ts
    ...(p.collapse ? { collapse: p.collapse } : {}),
    ...(p.testGrain ? { test_grain: p.testGrain } : {}),
```

In the `fromSpec` inverse (state.ts:468), read them back (default-on-absent):

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
- Modify: the existing explorer e2e shot (find it: `ls e2e/ tests/e2e/ 2>/dev/null; grep -rl "TransformExplorer\|explorer" e2e tests 2>/dev/null`)

- [ ] **Step 1: Extend the explorer e2e spec**

Add assertions to the explorer Playwright test:
- The Collapse routing panel renders with one row per spine level.
- Removing a level (click `remove level …`) re-routes the graph: a collapse node disappears.
- Changing **Test reads at** to a finer node makes a **yellow** caution badge appear on the test edge (`.edge-badge.caution`) and the caution dot on the stats node.
- A **white** info badge (`.edge-badge.info`) is present on every collapse edge from the start.

- [ ] **Step 2: Run the e2e suite**

Run: `npx playwright test` (or the project's e2e script — check `package.json`).
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
- **grain key consistency.** The TS `grainKey` (Task 0) and Python `_grain_key` (Task 1) must agree exactly (`/`-joined kept dims, spine order, `""` for raw). The node ids (`grain:<key>`), the `shapeCountsAtom` keys, the `/reduce` `grain` param, and the `test_grain` field all use this one convention.
- **Coordinate exemption depends on column type.** Guard #4 exempts non-identifier kept dims. If `frame`/time is typed `identifier` (the sibling TODO friction), the mean-trajectory re-route will warn — acceptable as a retype nudge, but call it out in the PR.
- **`layer.level` is now a grain key.** Existing layers stored a single spine-column name (a prefix grain's finest dim); these still resolve because `materialize_levels` keys prefixes by that name. Non-prefix layer grains only arise once the user re-routes — confirm `levelOptions` (src/levels.ts) lists the plan's nodes by grain key so a layer can target one.
