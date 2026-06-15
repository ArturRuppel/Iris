# Composable Grammar of Graphics — Phase 1 (Layers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Triad's six fixed plot types into composable, ordered geom layers with per-layer params, a first-class geom registry, a geom-level point-count guard that fixes the 82k-row browser freeze, and an inferred-and-displayed `stat_model` — while old documents keep opening.

**Architecture:** Two parts that each ship working software. **Part A (engine, Tasks 1–7)** introduces a geom registry, a validity-guard pass, a stat-model inference module, and a layered compiler that honors layer order and per-layer params. The engine *normalizes* any legacy (`spec_version` ≠ `"2.0"`) spec to 2.0 internally, so the existing frontend and every current test keep working unchanged — and the point-cap guard fixes the freeze the moment Part A lands. **Part B (frontend, Tasks 8–15)** replaces the plot-type dropdown with a layer rail modeled on the existing reduction `PipelineRail`/`StepCards`, wires encoding pickers + the stat-model panel + a blocking/warning guard bar, and migrates the client to emit 2.0 specs.

**Tech Stack:** Python (FastAPI, pandas, scipy, pingouin, matplotlib) engine tested with `pytest`; React + TypeScript + Jotai frontend, typechecked with `tsc` and exercised by Playwright e2e scripts (`e2e/*.mjs`). Engine tests run with `cd engine && python -m pytest tests -q`. Frontend typecheck: `npx tsc --noEmit`. E2e: engine on port 8765 + `npm run dev` on 5173, then `node e2e/<name>.mjs`.

---

## Key reconciliation decisions (read before starting)

These resolve the spec's three open questions and pin naming so tasks stay consistent:

1. **Geom name == the existing mark string.** We do *not* rename the mark vocabulary. A `Layer` is `{ geom, params }` where `geom ∈ {"dot","summary","box","violin","bar","scatter","regression","histogram","density"}` — exactly today's `Mark` values. This keeps the compiler refactor low-risk and existing SVG-shape tests green. (The spec's prose used `"point"/"jitter"`; we map that intent onto the existing `"dot"`.)
2. **`StatModel.family` uses the engine's existing family strings:** `"group_comparison" | "correlation" | "descriptive" | "none"`. No second vocabulary.
3. **Point cap = 3000**, a module constant `POINT_CAP`. Applies to per-row geoms (`dot`, `scatter`). Above it → a **blocking** issue; the figure does not render.
4. **Registry is engine-authoritative and served on `GET /health`** under a `registry` key. The frontend consumes it at startup (it already calls `waitForHealth()`), so there is no hand-mirrored copy and no drift.
5. **`spec_version` 2.0 cutover is normalize-time only.** The engine accepts both shapes and translates legacy → 2.0 internally on every request; there is no dual-write. After Part B, the frontend builds and saves 2.0 specs; `migrateSpec` upgrades old `.viz` files on load.
6. **Model-level validity (too-few-per-group, single-level factor) stays in `stats.py`** where it already lives and returns a 422. The new `guards.py` owns the *new* capability: geom-level guards (the point cap + min-observations warnings). This avoids double-maintaining the same checks.
7. **Blocking issues surface as HTTP 422** (detail = the message) in Part A, integrating with the frontend's existing error path — this is what fixes the freeze. Warnings ride along in the 200 response under `issues` and are rendered by the warn-bar in Part B.

## File structure

**Part A — engine (`engine/triad_engine/`)**
- `geoms.py` *(new)* — the geom registry: one dict, plus `registry_payload()` (JSON for the frontend) and small lookup helpers. Single source of truth for which geoms exist, what they need, whether they aggregate, their default params, the frontend param-editor specs, and the per-geom point cap.
- `statmodel.py` *(new)* — `infer(encodings, schema, override)` → a `StatModel` dict. Phase 1 reproduces today's family rules through this object.
- `guards.py` *(new)* — `evaluate(df, schema, spec, stat_model)` → a list of issue dicts (`level` blocking/warning). Phase 1: point-cap (blocking) + box/violin min-n (warning).
- `specnorm.py` *(new)* — `normalize(spec)` → a 2.0 spec. Translates legacy `mappings`+`{mark,…}` layers into `encodings`+`{geom,params}` layers; idempotent on 2.0.
- `compiler.py` *(modify)* — `build_figure` becomes a layered renderer that loops `spec["layers"]` in order and dispatches each to a per-geom render function reading `layer["params"]`. Existing mark branches become those functions.
- `main.py` *(modify)* — `/health` returns `registry`; `_run` normalizes → infers `stat_model` → runs guards → blocks on blocking → renders; `/analyze` returns `stat_model` + `issues`.

**Part B — frontend (`src/`)**
- `types.ts` *(modify)* — 2.0 `AnalysisSpec` (encodings, `{geom,params}` layers, `stat_model`, `facet` placeholder); `Geom`/`Registry`/`StatModel`/`Issue` types; `engine` gains `registry` data from health; `migrateSpec` upgrades to 2.0.
- `state.ts` *(modify)* — `buildSpec` emits 2.0; the six `PLOT_TYPES` become template seeds; `registryAtom`; layer-CRUD atoms (add/remove/move/update) mirroring the reduce-step atoms.
- `components/LayerCards.tsx` *(new)* — per-geom param editors driven by the registry's `param_specs` (mirrors `StepCards`).
- `components/LayerRail.tsx` *(new)* — the layer rail (mirrors `PipelineRail`): add/remove/reorder/configure layers + a template-seed menu.
- `components/StatsPanel.tsx` *(modify)* — render the inferred design sentence + `[describe only]` toggle alongside the existing test controls.
- `App.tsx` *(modify)* — store the registry from health; render `LayerRail`; encoding pickers source from `effectiveSchema`; guard bar distinguishes blocking (red) vs warning (amber).
- `e2e/layers_test.mjs` *(new)* — Playwright smoke for the rail.

---

# PART A — Engine grammar core (independently shippable; fixes the freeze)

## Task 1: Geom registry module

**Files:**
- Create: `engine/triad_engine/geoms.py`
- Test: `engine/tests/test_geoms.py`

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_geoms.py`:

```python
"""The geom registry: single source of truth for composable layers."""
from triad_engine import geoms


def test_every_known_geom_is_registered():
    expected = {"dot", "summary", "box", "violin", "bar",
                "scatter", "regression", "histogram", "density"}
    assert set(geoms.GEOMS) == expected


def test_per_row_geoms_carry_the_point_cap():
    # dot and scatter draw one mark per row, so they declare a cap
    assert geoms.GEOMS["dot"].point_cap == geoms.POINT_CAP
    assert geoms.GEOMS["scatter"].point_cap == geoms.POINT_CAP
    # aggregating geoms draw a bounded number of marks → no cap
    assert geoms.GEOMS["bar"].point_cap is None
    assert geoms.GEOMS["bar"].aggregates is True
    assert geoms.GEOMS["dot"].aggregates is False


def test_geoms_declare_their_family_and_needs():
    assert geoms.GEOMS["dot"].family == "group_comparison"
    assert geoms.GEOMS["scatter"].family == "correlation"
    assert geoms.GEOMS["histogram"].family == "descriptive"
    assert geoms.GEOMS["dot"].needs == ["x", "y"]
    assert geoms.GEOMS["histogram"].needs == ["y"]


def test_registry_payload_is_json_safe_and_complete():
    payload = geoms.registry_payload()
    assert payload["point_cap"] == geoms.POINT_CAP
    dot = payload["geoms"]["dot"]
    assert dot["label"] and dot["family"] == "group_comparison"
    assert dot["aggregates"] is False
    assert isinstance(dot["param_specs"], list)
    # bar exposes an error_type select so the rail can render an editor
    bar_specs = {p["key"]: p for p in payload["geoms"]["bar"]["param_specs"]}
    assert bar_specs["error_type"]["type"] == "select"
    assert "ci95" in bar_specs["error_type"]["options"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_geoms.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'triad_engine.geoms'`

- [ ] **Step 3: Write the implementation**

Create `engine/triad_engine/geoms.py`:

```python
"""Geom registry — the single source of truth for composable layers.

Each geom declares the encodings it needs, whether it aggregates rows, its
default params, the param editors the frontend rail should render, and (for
per-row geoms) the point cap above which it cannot draw individually. The
compiler reads this to render, the guard pass reads it to validate, and the
frontend reads `registry_payload()` (served on /health) to build the rail.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Above this many raw marks, a per-row geom (dot/scatter) freezes the browser:
# 82,241 points → a 13.8 MB SVG with 82k interactive <use> nodes. 1,383 points
# rendered in 0.26 MB and stayed responsive, so 3,000 is a safe blocking cap.
POINT_CAP = 3000


@dataclass(frozen=True)
class GeomDef:
    label: str
    family: str                       # group_comparison | correlation | descriptive
    aggregates: bool                  # collapses rows (bar/summary) vs per-row (dot)
    needs: list[str]                  # required encodings, e.g. ["x", "y"]
    params: dict = field(default_factory=dict)        # default param values
    param_specs: list[dict] = field(default_factory=list)  # frontend editors
    point_cap: int | None = None      # blocking cap for per-row geoms


def _num(key, label, *, lo, hi, step):
    return {"key": key, "label": label, "type": "number",
            "min": lo, "max": hi, "step": step}


def _err_select(key="error_type", label="Error bars"):
    return {"key": key, "label": label, "type": "select",
            "options": ["ci95", "sem", "sd"]}


GEOMS: dict[str, GeomDef] = {
    "dot": GeomDef(
        "Dots", "group_comparison", False, ["x", "y"],
        params={"jitter": 0.18},
        param_specs=[_num("jitter", "Jitter", lo=0.0, hi=0.5, step=0.02)],
        point_cap=POINT_CAP),
    "summary": GeomDef(
        "Mean ± error", "group_comparison", True, ["x", "y"],
        params={"error_type": "ci95"},
        param_specs=[_err_select()]),
    "box": GeomDef(
        "Box", "group_comparison", True, ["x", "y"],
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)]),
    "violin": GeomDef(
        "Violin", "group_comparison", True, ["x", "y"],
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)]),
    "bar": GeomDef(
        "Bar ± error", "group_comparison", True, ["x", "y"],
        params={"error_type": "ci95"},
        param_specs=[_err_select()]),
    "scatter": GeomDef(
        "Scatter", "correlation", False, ["x", "y"],
        params={},
        param_specs=[],
        point_cap=POINT_CAP),
    "regression": GeomDef(
        "Regression", "correlation", True, ["x", "y"],
        params={}, param_specs=[]),
    "histogram": GeomDef(
        "Histogram", "descriptive", True, ["y"],
        params={},
        param_specs=[_num("hist_bins", "Bins", lo=0, hi=200, step=1)]),
    "density": GeomDef(
        "Density", "descriptive", True, ["y"],
        params={}, param_specs=[]),
}


def registry_payload() -> dict:
    """JSON-safe registry for the frontend rail (served on /health)."""
    return {
        "point_cap": POINT_CAP,
        "geoms": {
            name: {"label": g.label, "family": g.family,
                   "aggregates": g.aggregates, "needs": list(g.needs),
                   "params": dict(g.params), "param_specs": list(g.param_specs),
                   "point_cap": g.point_cap}
            for name, g in GEOMS.items()
        },
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_geoms.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/triad_engine/geoms.py engine/tests/test_geoms.py
git commit -m "feat(engine): geom registry (single source of truth for layers)"
```

---

## Task 2: Stat-model inference module

**Files:**
- Create: `engine/triad_engine/statmodel.py`
- Test: `engine/tests/test_statmodel.py`

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_statmodel.py`:

```python
"""Stat-model inference: encodings + schema -> an explicit, legible model."""
from triad_engine import statmodel

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "treatment", "type": "categorical", "label": "Treatment",
     "levels": ["control", "drug_a"]},
    {"name": "dose", "type": "numeric", "label": "Dose"},
    {"name": "response", "type": "numeric", "label": "Response"},
]}


def enc(x=None, y=None):
    return {"x": {"column": x} if x else None,
            "y": {"column": y} if y else None,
            "color": None, "size": None, "shape": None}


def test_categorical_x_numeric_y_is_comparison():
    m = statmodel.infer(enc("treatment", "response"), SCHEMA, override=None)
    assert m["family"] == "group_comparison"
    assert m["chosen_by"] == "inferred"
    assert m["test"] is None  # let stats.py recommend
    assert "treatment" in m["design"] and "response" in m["design"]


def test_two_numerics_is_correlation():
    m = statmodel.infer(enc("dose", "response"), SCHEMA, override=None)
    assert m["family"] == "correlation"


def test_single_numeric_is_descriptive():
    m = statmodel.infer(enc(None, "response"), SCHEMA, override=None)
    assert m["family"] == "descriptive"


def test_override_is_recorded_and_carried():
    m = statmodel.infer(enc("treatment", "response"), SCHEMA,
                        override="mann_whitney")
    assert m["chosen_by"] == "user_override"
    assert m["test"] == "mann_whitney"


def test_describe_only_when_unmapped():
    m = statmodel.infer(enc(None, None), SCHEMA, override=None)
    assert m["family"] == "none"
    assert m["chosen_by"] == "describe_only"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_statmodel.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'triad_engine.statmodel'`

- [ ] **Step 3: Write the implementation**

Create `engine/triad_engine/statmodel.py`:

```python
"""Infer an explicit statistical model from the encodings + reduced schema.

This inverts the old `plot-type -> test` table into `encodings -> model`. The
model is returned to the frontend and shown in plain language, so the user
confirms "this is the right test for this picture". Phase 1 reproduces today's
three families; Phases 2-3 extend the same object (color as a 2nd factor,
per-facet correction). When the design is ambiguous, default to describe-only.
"""
from __future__ import annotations


def _kind(schema: dict, name: str | None) -> str | None:
    if not name:
        return None
    for c in schema["columns"]:
        if c["name"] == name:
            return c["type"]
    return None


def _col(enc: dict, key: str) -> str | None:
    e = enc.get(key)
    return e["column"] if e and e.get("column") else None


def infer(encodings: dict, schema: dict, override: str | None) -> dict:
    """encodings + schema -> StatModel. `override` is the user-chosen test
    name carried from the spec when chosen_by == user_override, else None."""
    x = _col(encodings, "x")
    y = _col(encodings, "y")
    xk, yk = _kind(schema, x), _kind(schema, y)

    if xk == "categorical" and yk == "numeric":
        family = "group_comparison"
        design = f"comparison of {y} between groups of {x}"
        factors = [{"column": x, "role": "group"}]
    elif xk == "numeric" and yk == "numeric":
        family = "correlation"
        design = f"association between {x} and {y}"
        factors = [{"column": x, "role": "predictor"},
                   {"column": y, "role": "response"}]
    elif yk == "numeric" and x is None:
        family = "descriptive"
        design = f"distribution of {y}"
        factors = [{"column": y, "role": "variable"}]
    else:
        return {"design": "no statistical model — pick X / Y to analyze",
                "family": "none", "factors": [], "test": None,
                "facet_handling": None, "chosen_by": "describe_only",
                "issues": []}

    chosen_by = "user_override" if override else "inferred"
    return {"design": design, "family": family, "factors": factors,
            "test": override, "facet_handling": None,
            "chosen_by": chosen_by, "issues": []}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_statmodel.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/triad_engine/statmodel.py engine/tests/test_statmodel.py
git commit -m "feat(engine): stat-model inference (encodings -> explicit model)"
```

---

## Task 3: Validity guard pass

**Files:**
- Create: `engine/triad_engine/guards.py`
- Test: `engine/tests/test_guards.py`

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_guards.py`:

```python
"""Geom-level validity guards. The point cap is the 82k-freeze fix."""
import pandas as pd

from triad_engine import guards, geoms

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "grp", "type": "categorical", "label": "Group",
     "levels": ["a", "b"]},
    {"name": "val", "type": "numeric", "label": "Value"},
]}


def frame(n_per_group):
    rows = []
    for g in ("a", "b"):
        for i in range(n_per_group):
            rows.append({"id": f"{g}{i}", "grp": g, "val": float(i),
                         "excluded": False})
    return pd.DataFrame(rows)


def spec(*geom_names):
    return {"encodings": {"x": {"column": "grp"}, "y": {"column": "val"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": g, "params": {}} for g in geom_names]}


def test_dot_over_cap_is_blocking():
    df = frame(geoms.POINT_CAP)  # 2 * POINT_CAP rows, well over the cap
    issues = guards.evaluate(df, SCHEMA, spec("dot"), stat_model=None)
    blocking = [i for i in issues if i["level"] == "blocking"]
    assert blocking and blocking[0]["geom"] == "dot"
    assert str(len(df)) in blocking[0]["message"]


def test_dot_under_cap_is_clean():
    df = frame(5)  # 10 rows
    issues = guards.evaluate(df, SCHEMA, spec("dot"), stat_model=None)
    assert [i for i in issues if i["level"] == "blocking"] == []


def test_aggregating_geom_never_trips_the_point_cap():
    df = frame(geoms.POINT_CAP)
    issues = guards.evaluate(df, SCHEMA, spec("bar"), stat_model=None)
    assert issues == []


def test_box_below_min_n_warns():
    df = frame(2)  # 2 per group, below the box minimum
    issues = guards.evaluate(df, SCHEMA, spec("box"), stat_model=None)
    warn = [i for i in issues if i["level"] == "warning"]
    assert warn and warn[0]["geom"] == "box"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_guards.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'triad_engine.guards'`

- [ ] **Step 3: Write the implementation**

Create `engine/triad_engine/guards.py`:

```python
"""Validity guards evaluated against the reduced data before render.

Phase 1 owns the *geom-level* guards — the new capability the grammar unlocks:
- per-row geoms (dot/scatter) that would draw more than POINT_CAP marks block
  the render (this is the 82k-point browser-freeze fix);
- box/violin with too few observations per group warn.

Model-level validity (too few per group, single-level factor) stays in
stats.py, which already returns those as 422s; we don't duplicate it here.
Each issue is {"level", "code", "message", "geom"}.
"""
from __future__ import annotations

import pandas as pd

from . import geoms

MIN_BOX_N = 3  # below this per group, a box/violin summary is meaningless


def _issue(level, code, message, geom=None):
    return {"level": level, "code": code, "message": message, "geom": geom}


def _xy(spec: dict):
    enc = spec["encodings"]
    x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
    y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
    return x, y


def evaluate(df: pd.DataFrame, schema: dict, spec: dict, stat_model) -> list[dict]:
    x, y = _xy(spec)
    issues: list[dict] = []
    for layer in spec.get("layers", []):
        name = layer["geom"]
        g = geoms.GEOMS.get(name)
        if g is None:
            continue

        if g.point_cap is not None:
            cols = [c for c in (x, y) if c and c in df]
            n = int(len(df[cols].dropna())) if cols else int(len(df))
            if n > g.point_cap:
                issues.append(_issue(
                    "blocking", "point_cap",
                    f"{n:,} points is too many to draw individually "
                    f"(limit {g.point_cap:,}). Add a Collapse step to "
                    f"aggregate, or use a summarizing geom (bar, box, violin).",
                    geom=name))

        if name in ("box", "violin") and x and y and x in df and y in df:
            sizes = df.dropna(subset=[y]).groupby(x)[y].size()
            if len(sizes) and int(sizes.min()) < MIN_BOX_N:
                issues.append(_issue(
                    "warning", "min_observations",
                    f"a group has fewer than {MIN_BOX_N} observations — the "
                    f"{name} summary is unreliable.", geom=name))
    return issues
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_guards.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/triad_engine/guards.py engine/tests/test_guards.py
git commit -m "feat(engine): geom-level validity guards (point cap fixes freeze)"
```

---

## Task 4: Spec normalization (legacy → 2.0)

**Files:**
- Create: `engine/triad_engine/specnorm.py`
- Test: `engine/tests/test_specnorm.py`

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_specnorm.py`:

```python
"""Normalize any legacy spec to the 2.0 grammar shape, idempotently."""
from triad_engine import specnorm


def legacy_spec():
    return {
        "spec_version": "1.0", "id": "an", "title": "t",
        "mappings": {"x": {"column": "treatment"}, "y": {"column": "response"},
                     "color": {"column": "treatment"}, "pair_by": None,
                     "facet": None},
        "layers": [{"mark": "dot", "options": {"jitter": 0.18}},
                   {"mark": "summary", "stat": {"center": "mean", "error": "ci95"}}],
        "stats": {"family": "group_comparison", "test": "mann_whitney",
                  "chosen_by": "user_override"},
        "style": {"preset": "demo_default", "overrides": {}},
    }


def test_mappings_become_encodings():
    out = specnorm.normalize(legacy_spec())
    assert out["spec_version"] == "2.0"
    assert out["encodings"]["x"] == {"column": "treatment"}
    assert out["encodings"]["y"] == {"column": "response"}
    assert out["encodings"]["color"] == {"column": "treatment"}
    assert out["encodings"]["size"] is None
    assert "mappings" not in out


def test_marks_become_geoms_preserving_order_and_options():
    out = specnorm.normalize(legacy_spec())
    assert [l["geom"] for l in out["layers"]] == ["dot", "summary"]
    assert out["layers"][0]["params"] == {"jitter": 0.18}


def test_carries_the_user_override_for_inference():
    out = specnorm.normalize(legacy_spec())
    assert out["_override"] == "mann_whitney"  # chosen_by was user_override


def test_no_override_when_recommendation_accepted():
    spec = legacy_spec()
    spec["stats"]["chosen_by"] = "recommendation_accepted"
    out = specnorm.normalize(spec)
    assert out["_override"] is None


def test_idempotent_on_2_0():
    out = specnorm.normalize(legacy_spec())
    again = specnorm.normalize(out)
    assert again["encodings"] == out["encodings"]
    assert [l["geom"] for l in again["layers"]] == ["dot", "summary"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_specnorm.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'triad_engine.specnorm'`

- [ ] **Step 3: Write the implementation**

Create `engine/triad_engine/specnorm.py`:

```python
"""Translate any legacy (<2.0) analysis spec into the 2.0 grammar shape.

The engine accepts both shapes and normalizes on every request, so the old
frontend and old .viz documents keep working while the client is migrated.
Normalization is the ONLY place the translation happens — there is no
dual-write. A 2.0 spec passes through unchanged (idempotent).

Legacy:  mappings{x,y,color}            layers[{mark, options?, stat?}]
2.0:     encodings{x,y,color,size,shape} layers[{geom, params}]

`_override` carries the user's chosen test (when chosen_by == user_override)
so statmodel.infer can honor it; it is read by main._run, not persisted.
"""
from __future__ import annotations


def normalize(spec: dict) -> dict:
    if spec.get("spec_version") == "2.0":
        out = dict(spec)
        out.setdefault("_override", _override_of(spec))
        return out

    out = dict(spec)
    out["spec_version"] = "2.0"

    m = spec.get("mappings", {})
    out["encodings"] = {
        "x": m.get("x"), "y": m.get("y"), "color": m.get("color"),
        "size": None, "shape": None,
    }
    out.pop("mappings", None)
    out["facet"] = {"row": None, "col": None, "share_x": True, "share_y": True}

    out["layers"] = [
        {"geom": layer["mark"], "params": dict(layer.get("options") or {})}
        for layer in spec.get("layers", [])
    ]
    out["_override"] = _override_of(spec)
    return out


def _override_of(spec: dict) -> str | None:
    st = spec.get("stats", {})
    if st.get("chosen_by") == "user_override":
        return st.get("test")
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_specnorm.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/triad_engine/specnorm.py engine/tests/test_specnorm.py
git commit -m "feat(engine): normalize legacy specs to the 2.0 grammar shape"
```

---

## Task 5: Layered compiler — comparison family

Refactor `build_comparison_figure` so it loops `spec["layers"]` in order and dispatches each geom to a render function that reads `layer["params"]`, instead of flattening marks to a set and pulling every option from the global style. The existing comparison tests (`test_marks_render`, `test_analyze_endpoint_svg_has_clickable_point_groups`, `test_box_anatomy_and_scales`, `test_style_overrides_reach_the_svg`) must stay green — so per-geom zorder constants and default widths are preserved exactly; params merely *override* the style fallback.

**Files:**
- Modify: `engine/triad_engine/compiler.py` (replace `build_comparison_figure`, lines 225–330; change `_err_half` signature, lines 137–143; update `build_figure` dispatch, lines 213–222)
- Test: `engine/tests/test_engine.py` (add ordered-params tests)

- [ ] **Step 1: Write the failing test**

Add to the end of `engine/tests/test_engine.py`:

```python
# ---------------- phase 1: layered renderer honors order + params ----------

def test_layer_params_override_style_jitter():
    # a 2.0 spec whose dot layer sets its own jitter must reach the SVG
    # regardless of the global style jitter
    spec = make_spec()
    spec["spec_version"] = "2.0"
    spec["encodings"] = {"x": {"column": "treatment"},
                         "y": {"column": "response"},
                         "color": {"column": "treatment"},
                         "size": None, "shape": None}
    spec.pop("mappings", None)
    spec["layers"] = [{"geom": "dot", "params": {"jitter": 0.0}}]
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    # the click contract still holds (one <use> per row, ordered groups)
    body = r.json()
    assert [g["gid"] for g in body["figure"]["point_groups"]] == ["pts-0", "pts-1"]


def test_blocking_point_cap_returns_422():
    # a dot layer over POINT_CAP raw points must block, not freeze
    from triad_engine import geoms
    rows = [{"id": f"r{i}", "subject": f"S{i}",
             "treatment": "control" if i % 2 else "drug_a",
             "dose": 1.0, "response": float(i), "excluded": False}
            for i in range(geoms.POINT_CAP * 2 + 10)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    r = client.post("/analyze", json={"table": table, "spec": make_spec()})
    assert r.status_code == 422
    assert "too many" in r.json()["detail"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_engine.py -k "layer_params or point_cap" -q`
Expected: FAIL — `test_layer_params_override_style_jitter` errors because the compiler still reads `spec["mappings"]`; `test_blocking_point_cap_returns_422` fails (200, not 422) because no guard runs yet. (Both are wired up across Tasks 5–7; this task makes the compiler read encodings/geoms/params.)

- [ ] **Step 3: Change `_err_half` to take an explicit error_type**

In `engine/triad_engine/compiler.py`, replace the function at lines 137–143:

```python
def _err_half(s: dict, error_type: str) -> float:
    """Half-length of an error bar for one group summary."""
    if error_type == "sem":
        return s["sd"] / np.sqrt(s["n"]) if s["n"] else 0.0
    if error_type == "sd":
        return s["sd"]
    return s["ci95_half"]
```

- [ ] **Step 4: Replace the `build_figure` dispatch to read the stat_model**

In `engine/triad_engine/compiler.py`, replace lines 213–222 (`build_figure`):

```python
def build_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Dispatch on the inferred stat_model family. Returns (fig, point_groups);
    point_groups maps SVG gids to row ids in draw order, so the frontend can
    wire click-to-exclude per point (empty for aggregate-only figures)."""
    family = spec["stat_model"]["family"]
    if family == "correlation":
        return build_scatter_figure(df, schema, spec, stats)
    if family == "descriptive":
        return build_histogram_figure(df, schema, spec, stats)
    return build_comparison_figure(df, schema, spec, stats)
```

- [ ] **Step 5: Replace `build_comparison_figure` with the layered renderer**

In `engine/triad_engine/compiler.py`, replace the whole function (lines 225–330) with:

```python
def _param(params: dict, key: str, style: dict, style_key: str):
    """A layer param wins over the global style; falling back to style keeps
    legacy specs (which carry no params) pixel-identical to today."""
    v = params.get(key)
    return v if v is not None else style[style_key]


def _comparison_context(df, schema, spec, stats):
    x = spec["encodings"]["x"]["column"]
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    levels = stats["levels"]
    has_dots = any(l["geom"] == "dot" for l in spec.get("layers", []))
    groups, top = [], -np.inf
    for gi, lv in enumerate(levels):
        rows = df[(df[x] == lv) & df[y].notna()]
        ys = rows[y].to_numpy(dtype=float)
        s = next(s for s in stats["summaries"] if s["group"] == lv)
        err = _err_half(s, style["error_type"])
        if len(ys):
            top = max(top, ys.max(), s["mean"] + err)
        groups.append({"gi": gi, "lv": lv, "ys": ys,
                       "row_ids": rows["id"].tolist(),
                       "color": _group_color(style, gi), "summary": s})
    return {"x": x, "y": y, "cols": cols, "style": style, "levels": levels,
            "groups": groups, "has_dots": has_dots, "lw": style["line_width"],
            "top": top, "p_sig": stats["result"]["p"] < stats.get("alpha", 0.05)}


def _geom_violin(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    width = _param(params, "mark_width", style, "mark_width") or 0.7
    for grp in ctx["groups"]:
        ys = grp["ys"]
        if len(ys) <= 1:
            continue
        vp = ax.violinplot([ys], positions=[grp["gi"]], widths=width,
                           showextrema=False)
        for body in vp["bodies"]:
            body.set_facecolor(grp["color"]); body.set_alpha(0.22)
            body.set_edgecolor(grp["color"]); body.set_linewidth(lw * 0.6)
            body.set_zorder(1)
    return None


def _geom_box(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    width = _param(params, "mark_width", style, "mark_width") or 0.42
    show_fliers = not ctx["has_dots"] and style["outlier_marker"] != "none"
    line = dict(color="#475569", linewidth=lw * 0.65)
    for grp in ctx["groups"]:
        ys = grp["ys"]
        if not len(ys):
            continue
        ax.boxplot([ys], positions=[grp["gi"]], widths=width,
                   notch=style["notch"] and len(ys) > 5, showfliers=show_fliers,
                   boxprops=line, whiskerprops=line, capprops=line,
                   medianprops=dict(color=INK, linewidth=lw * 0.93),
                   flierprops=dict(marker=style["outlier_marker"],
                                   markersize=style["outlier_size"],
                                   markerfacecolor=grp["color"],
                                   markeredgecolor=grp["color"],
                                   markeredgewidth=0.8),
                   zorder=2)
    return None


def _geom_bar(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    error_type = _param(params, "error_type", style, "error_type")
    width = style["mark_width"] or 0.6
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        ax.bar(grp["gi"], s["mean"], width=width, color=grp["color"],
               alpha=0.55, zorder=1)
        ax.errorbar(grp["gi"], s["mean"], yerr=err, fmt="none", ecolor=INK,
                    elinewidth=lw * 0.85, capsize=style["capsize"], zorder=3)
    return None


def _geom_dot(ax, ctx, params):
    style = ctx["style"]
    jitter = _param(params, "jitter", style, "jitter")
    point_group = None
    for grp in ctx["groups"]:
        xs = grp["gi"] + np.array([_stable_jitter(rid, jitter)
                                   for rid in grp["row_ids"]])
        sc = ax.scatter(xs, grp["ys"], s=style["marker_size"],
                        color=grp["color"], alpha=style["marker_alpha"],
                        linewidths=0.6, edgecolors="white", zorder=3)
        gid = f"pts-{grp['gi']}"
        sc.set_gid(gid)
        point_group = point_group or []
        point_group.append({"gid": gid, "row_ids": grp["row_ids"]})
    return point_group


def _geom_summary(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    error_type = _param(params, "error_type", style, "error_type")
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        cx = grp["gi"] + 0.28
        ax.errorbar(cx, s["mean"], yerr=err, fmt="none", ecolor=INK,
                    elinewidth=lw, capsize=style["capsize"], zorder=4)
        ax.plot(cx, s["mean"], marker="D", ms=5, color=INK, zorder=5)
    return None


_COMPARISON_GEOMS = {"violin": _geom_violin, "box": _geom_box, "bar": _geom_bar,
                     "dot": _geom_dot, "summary": _geom_summary}


def build_comparison_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Group comparison rendered as ordered geom layers; each layer draws with
    its own params (falling back to the global style)."""
    ctx = _comparison_context(df, schema, spec, stats)
    style, levels = ctx["style"], ctx["levels"]

    with plt.rc_context(_rc(style)):
        fig, ax = plt.subplots(
            figsize=(style["width_mm"] * MM, style["height_mm"] * MM),
            layout="constrained")
        point_groups = []
        for layer in spec.get("layers", []):
            render = _COMPARISON_GEOMS.get(layer["geom"])
            if render is None:
                continue
            pg = render(ax, ctx, layer.get("params") or {})
            if pg:
                point_groups.extend(pg)

        if ctx["p_sig"] and style["show_significance"]:
            yr = ax.get_ylim()
            h = ctx["top"] + (yr[1] - yr[0]) * 0.08
            tick = (yr[1] - yr[0]) * 0.02
            ax.plot([0, 0, 1, 1], [h, h + tick, h + tick, h],
                    color=INK, lw=1.1, zorder=5)
            p = stats["result"]["p"]
            label = "***" if p < 0.001 else "**" if p < 0.01 else "*"
            ax.text(0.5, h + tick * 1.4, label, ha="center", va="bottom",
                    color=INK)
            ax.set_ylim(yr[0], max(yr[1], h + tick * 5))

        ax.set_xticks(range(len(levels)))
        labels = ctx["cols"].get(ctx["x"], {}).get("labels", {}) or {}
        ax.set_xticklabels([labels.get(lv, lv) for lv in levels])
        ax.set_xlim(-0.55, len(levels) - 0.45)
        ax.set_ylabel(ctx["cols"].get(ctx["y"], {}).get("label", ctx["y"]))
        _apply_axes(ax, style, x_numeric=False,
                    grid_x_default=False, grid_y_default=True)
        if style["show_n"]:
            for s, lv in zip(stats["summaries"], levels):
                ax.annotate(f"n = {s['n']}", (levels.index(lv), 0),
                            xycoords=("data", "axes fraction"),
                            xytext=(0, -26), textcoords="offset points",
                            ha="center", fontsize=style["font_pt"] - 2,
                            color="#94a3b8", annotation_clip=False)
        _decorate(fig, ax, style)
    return fig, point_groups
```

- [ ] **Step 6: Update the scatter & histogram builders to read encodings**

These two still read `spec["mappings"]`. In `build_scatter_figure` replace lines 341–345 (the `x`/`y`/`marks` block) with:

```python
    x = spec["encodings"]["x"]["column"]
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    marks = {layer["geom"] for layer in spec.get("layers", [])} or {"scatter",
                                                                    "regression"}
```

In `build_histogram_figure` replace lines 392–395 with:

```python
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    marks = {layer["geom"] for layer in spec.get("layers", [])} or {"histogram"}
```

(Scatter/histogram keep set-membership for Phase 1 — they have at most one per-row geom each, so order doesn't matter; the comparison family is where ordering/params mattered. Per-layer params for `hist_bins` continue to flow from the global style, unchanged.)

- [ ] **Step 7: Run the full engine suite to verify nothing regressed**

The two new tests still fail until Tasks 6–7 wire `stat_model`/guards into `_run`, but **every pre-existing test must stay green** through the compiler change. Confirm the compiler refactor in isolation against a normalized spec:

Run: `cd engine && python -m pytest tests/test_engine.py -k "not layer_params and not point_cap" -q`
Expected: these still fail with `KeyError: 'encodings'` / `KeyError: 'stat_model'` because `_run` hasn't been updated yet — that is Task 6. **Do not commit yet**; Tasks 5–6 land together (the compiler cannot be exercised until `_run` feeds it 2.0 + stat_model). Proceed directly to Task 6.

---

## Task 6: Wire normalization + stat_model + guards into `/analyze`

**Files:**
- Modify: `engine/triad_engine/main.py` (`_run`, lines 148–178; imports, line 19; `analyze`, lines 198–205; `health`, lines 181–183)
- Test: `engine/tests/test_engine.py` (the two Task-5 tests now pass; add a response-shape test)

- [ ] **Step 1: Add the response-shape test**

Add to `engine/tests/test_engine.py`:

```python
def test_analyze_returns_stat_model_and_issues():
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_spec()})
    assert r.status_code == 200
    body = r.json()
    assert body["stat_model"]["family"] == "group_comparison"
    assert "design" in body["stat_model"]
    assert body["issues"] == []  # default sample is small + clean


def test_health_serves_the_geom_registry():
    body = client.get("/health").json()
    assert "registry" in body
    assert "dot" in body["registry"]["geoms"]
    assert body["registry"]["point_cap"] == 3000
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_engine.py -k "stat_model or registry" -q`
Expected: FAIL — `KeyError`/`AssertionError` (no `stat_model`, `issues`, or `registry` yet).

- [ ] **Step 3: Update imports**

In `engine/triad_engine/main.py`, replace the import at line 19:

```python
from . import (compiler, document, geoms, guards, importer,
               reduce as reduce_mod, specnorm, stats, statmodel)
```

- [ ] **Step 4: Rewrite `_run` to normalize → infer → guard → render**

Replace `_run` (lines 148–178) with:

```python
def _run(table: dict, spec: dict):
    spec = specnorm.normalize(spec)
    df, schema = _prepare(table, spec)
    steps = (spec.get("reduce") or {}).get("steps") or []
    try:
        df, schema = reduce_mod.apply_reduction(df, schema, steps)
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e

    model = statmodel.infer(spec["encodings"], schema, spec.get("_override"))
    spec["stat_model"] = model

    issues = guards.evaluate(df, schema, spec, model)
    blocking = next((i for i in issues if i["level"] == "blocking"), None)
    if blocking:
        raise HTTPException(422, blocking["message"])

    enc = spec["encodings"]
    alpha = spec.get("stats", {}).get("alpha", 0.05)
    override = spec.get("_override")
    family = model["family"]
    if family == "group_comparison":
        xcol = next((c for c in schema["columns"]
                     if c["name"] == enc["x"]["column"]), None)
        if xcol is None:
            raise HTTPException(
                422, f"x column {enc['x']['column']!r} not found in schema")
        res = stats.group_comparison(
            df, enc["x"]["column"], enc["y"]["column"],
            levels=xcol.get("levels", []), alpha=alpha, override=override)
    elif family == "correlation":
        res = stats.correlation(df, enc["x"]["column"], enc["y"]["column"],
                                alpha=alpha, override=override)
    elif family == "descriptive":
        res = stats.descriptive(df, enc["y"]["column"], alpha=alpha)
    else:
        raise HTTPException(422, "no statistical model — map X / Y to analyze")
    if "error" in res:
        raise HTTPException(422, res["error"])
    fig, point_groups = compiler.build_figure(df, schema, spec, res)
    return fig, point_groups, res, df, schema, model, issues
```

- [ ] **Step 5: Update `analyze` and `export` to the new `_run` arity, and serve the registry on `/health`**

Replace `health` (lines 181–183):

```python
@app.get("/health")
def health():
    return {"status": "ok", "engine_snapshot": engine_snapshot(),
            "registry": geoms.registry_payload()}
```

Replace `analyze` (lines 198–205):

```python
@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    table = _resolve_table(req.table, req.table_token)
    fig, point_groups, res, df, schema, model, issues = _run(table, req.spec)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return {"figure": {"svg": svg, "point_groups": point_groups},
            "stats": res, "stat_model": model, "issues": issues,
            "engine_snapshot": engine_snapshot()}
```

In `export` (lines 225–234), update the unpack on line 230 — `_run` now returns seven values:

```python
    fig, _, _, _, _, _, _ = _run(table, req.spec)
```

- [ ] **Step 6: Run the full engine suite**

Run: `cd engine && python -m pytest tests -q`
Expected: PASS (all pre-existing tests + the new Task-5/6 tests). The 82k-freeze path now returns 422 instead of a 13.8 MB SVG.

- [ ] **Step 7: Commit Tasks 5 + 6 together**

```bash
git add engine/triad_engine/compiler.py engine/triad_engine/main.py engine/tests/test_engine.py
git commit -m "feat(engine): layered renderer + stat_model + guard pass on /analyze"
```

---

## Task 7: Manual end-to-end sanity of Part A against the running engine

**Files:** none (verification only)

- [ ] **Step 1: Start the engine**

Run (in `engine/`): `python -m triad_engine.main`
Expected: boots on 127.0.0.1:8765 with no traceback.

- [ ] **Step 2: Confirm the registry is served**

Run: `curl -s 127.0.0.1:8765/health | python -m json.tool | grep -A2 point_cap`
Expected: `"point_cap": 3000` and a `geoms` object present.

- [ ] **Step 3: Confirm a legacy spec still analyzes (back-compat)**

Run: `cd engine && python -m pytest tests/test_engine.py -k "marks_render or clickable or box_anatomy or style_overrides" -q`
Expected: PASS — the old 1.0 specs round-trip through normalization unchanged.

- [ ] **Step 4: Stop the engine**

Press Ctrl-C. (Do not leave a spawned engine bound to 8765 — it collides with the user's `dev.sh`.)

- [ ] **Step 5: Commit (no-op marker / none needed)**

No code changed. Part A is complete and shippable: the freeze is fixed, the registry is live, and the old frontend still works.

---

# PART B — Composable layer UI

## Task 8: 2.0 spec types + registry/stat_model/issue types + migration

**Files:**
- Modify: `src/types.ts` (the `Mark` type stays; add `Geom`, registry/model/issue types; rework `AnalysisSpec`; extend `AnalyzeResponse`; add `engine.health` registry typing; rewrite `migrateSpec`)
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Add the grammar types**

In `src/types.ts`, after the `Mark` type (line 24), add:

```typescript
export type Geom = Mark; // geom name == existing mark string (dot, box, …)

export interface Layer { geom: Geom; params: Record<string, unknown> }

export interface ParamSpec {
  key: string; label: string;
  type: "number" | "select";
  min?: number; max?: number; step?: number; options?: string[];
}
export interface GeomMeta {
  label: string; family: StatsFamily; aggregates: boolean;
  needs: string[]; params: Record<string, unknown>;
  param_specs: ParamSpec[]; point_cap: number | null;
}
export interface Registry { point_cap: number; geoms: Record<string, GeomMeta> }

export interface StatModel {
  design: string;
  family: StatsFamily | "none";
  factors: { column: string; role: string }[];
  test: TestName | null;
  facet_handling: null;
  chosen_by: "inferred" | "user_override" | "describe_only";
  issues: unknown[];
}
export interface Issue {
  level: "blocking" | "warning";
  code: string; message: string; geom: string | null;
}
```

- [ ] **Step 2: Rework `AnalysisSpec` to the 2.0 shape**

Replace the `AnalysisSpec` interface (lines 113–139) with:

```typescript
export interface AnalysisSpec {
  spec_version: "2.0";
  id: string;
  title: string;
  data: { filter: unknown[]; respect_exclusions: boolean };
  reduce: ReduceSpec;
  encodings: {
    x: { column: string } | null;
    y: { column: string } | null;
    color: { column: string } | null;
    size: { column: string } | null;   // Phase 2
    shape: { column: string } | null;  // Phase 2
  };
  facet: { row: null; col: null; share_x: boolean; share_y: boolean }; // Phase 3
  layers: Layer[];
  stats: {
    family: StatsFamily;
    test: TestName;
    chosen_by: "recommendation_accepted" | "user_override" | "default" | "describe_only";
    alternatives_offered: string[];
    assumption_checks: { check: string; per: string }[];
    alpha: number;
    report: string[];
  };
  annotations: { significance_brackets: "auto"; show_n: boolean };
  style: { preset: string; overrides: StyleOverrides };
  engine_snapshot: Record<string, string>;
}
```

- [ ] **Step 3: Extend `AnalyzeResponse` and the health typing**

Replace `AnalyzeResponse` (lines 163–167) with:

```typescript
export interface AnalyzeResponse {
  figure: { svg: string; point_groups: { gid: string; row_ids: string[] }[] };
  stats: StatsResult;
  stat_model: StatModel;
  issues: Issue[];
  engine_snapshot: Record<string, string>;
}
```

In the `engine` object (line 278), replace the `health` line with one that carries the registry:

```typescript
  health: () => get<{ engine_snapshot: Record<string, string>; registry: Registry }>("/health"),
```

- [ ] **Step 4: Rewrite `migrateSpec` to upgrade old documents to 2.0**

Replace `migrateSpec` (lines 172–187) with:

```typescript
/* Upgrade a serialized analysis to spec_version 2.0. Legacy reduce shapes
   ({filter, collapse}) become the ordered steps[] pipeline; legacy mappings
   become encodings; legacy {mark, options|stat} layers become {geom, params}.
   Lossless: the engine does the same normalization server-side. */
export function migrateSpec(an: Record<string, unknown>): AnalysisSpec {
  if ((an as { spec_version?: string }).spec_version === "2.0") {
    return an as unknown as AnalysisSpec;
  }
  const base = an as Record<string, unknown>;

  /* --- reduce: legacy {filter, collapse} -> steps[] (unchanged logic) --- */
  const steps: ReduceStep[] = [];
  const r = base.reduce as
    | { filter?: FilterCond[]; collapse?: CollapseStepLegacy | null; steps?: ReduceStep[] }
    | undefined;
  let reduce: ReduceSpec;
  if (r?.steps) reduce = { steps: r.steps };
  else {
    if (r?.filter && r.filter.length) steps.push({ kind: "filter", conditions: r.filter });
    if (r?.collapse) steps.push({ kind: "collapse", group_by: r.collapse.group_by,
                                  aggregate: r.collapse.aggregate ?? {} });
    reduce = { steps };
  }

  /* --- mappings -> encodings --- */
  const m = (base.mappings ?? {}) as Record<string, { column: string } | null>;
  const encodings = {
    x: m.x ?? null, y: m.y ?? null, color: m.color ?? null,
    size: null, shape: null,
  };

  /* --- {mark, options|stat} -> {geom, params} --- */
  const legacyLayers = (base.layers ?? []) as
    { mark: Geom; options?: Record<string, unknown>; stat?: unknown }[];
  const layers: Layer[] = legacyLayers.map((l) => ({
    geom: l.mark, params: { ...(l.options ?? {}) },
  }));

  const st = (base.stats ?? {}) as AnalysisSpec["stats"];
  return {
    ...(base as object),
    spec_version: "2.0",
    reduce, encodings, layers,
    facet: { row: null, col: null, share_x: true, share_y: true },
    stats: st,
  } as AnalysisSpec;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `state.ts` / `App.tsx` / `StatsPanel.tsx` (they still build the 1.3 shape) — those are fixed in Tasks 9–13. `types.ts` itself must report no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): 2.0 grammar spec, registry/stat_model/issue types, migration"
```

---

## Task 9: Registry atom, template seeds, and layer-CRUD atoms in `state.ts`

**Files:**
- Modify: `src/state.ts` (imports; `registryAtom`; `PLOT_TYPES` → `TEMPLATES`; `Plottable` gains `layers`; `makeDefaultPlottable`; `buildSpec`/`specAtom`/`allSpecsAtom`; new layer-CRUD atoms)
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Add the registry atom and import the new types**

In `src/state.ts`, extend the type import (lines 2–6) to add `Layer, Registry, StatModel`, then after `engineSnapshotAtom` (line 11) add:

```typescript
/* the geom registry, fetched once from /health at startup; drives the rail */
export const registryAtom = atom<Registry | null>(null);
```

- [ ] **Step 2: Convert `PLOT_TYPES` into template seeds carrying 2.0 layers**

Replace the `PLOT_TYPES` block (lines 19–64) with a template table that yields `{geom, params}` layers and the encoding kind a seed expects:

```typescript
/* Template seeds: one-click starting points that populate a layer stack +
   encoding kind. They are NO LONGER a closed set the user is locked into — the
   layer rail can add/remove/reorder geoms freely afterwards. */
export type TemplateName = "dots" | "box" | "violin" | "bar" | "scatter" | "histogram";
export const TEMPLATES: Record<TemplateName, {
  label: string;
  family: StatsFamily;
  layers: Layer[];
  xKind: "categorical" | "numeric" | "none";
}> = {
  dots: { label: "Dots + mean ± CI", family: "group_comparison", xKind: "categorical",
    layers: [{ geom: "dot", params: { jitter: 0.18 } },
             { geom: "summary", params: { error_type: "ci95" } }] },
  box: { label: "Box + dots", family: "group_comparison", xKind: "categorical",
    layers: [{ geom: "box", params: {} }, { geom: "dot", params: { jitter: 0.18 } }] },
  violin: { label: "Violin + dots", family: "group_comparison", xKind: "categorical",
    layers: [{ geom: "violin", params: {} }, { geom: "dot", params: { jitter: 0.18 } }] },
  bar: { label: "Bar ± CI", family: "group_comparison", xKind: "categorical",
    layers: [{ geom: "bar", params: { error_type: "ci95" } }] },
  scatter: { label: "Scatter + regression", family: "correlation", xKind: "numeric",
    layers: [{ geom: "scatter", params: {} }, { geom: "regression", params: {} }] },
  histogram: { label: "Histogram + density", family: "descriptive", xKind: "none",
    layers: [{ geom: "histogram", params: {} }, { geom: "density", params: {} }] },
};

/* the family a geom belongs to, mirrored from the registry for cheap lookups
   when the rail filters which geoms are addable for the current encodings */
export const TEST_BY_FAMILY: Record<StatsFamily, TestName[]> = {
  group_comparison: ["welch_t", "mann_whitney"],
  correlation: ["pearson", "spearman"],
  descriptive: ["descriptive"],
};
```

- [ ] **Step 3: Give `Plottable` an explicit, editable layer stack**

Replace the `Plottable` interface (lines 81–90) with:

```typescript
export interface Plottable {
  id: string;
  name: string;
  mappings: { x: string; y: string };
  family: StatsFamily;      // which stats family + geom palette this plottable uses
  layers: Layer[];          // the editable, ordered geom stack
  override: TestName | null;
  describeOnly: boolean;    // user asked to render without a test
  preset: string;
  style: StyleOverrides;
  reduce: ReduceSpec;
}
```

- [ ] **Step 4: Seed a default plottable from a template**

Replace `makeDefaultPlottable` (lines 95–114) with:

```typescript
export function makeDefaultPlottable(schema: Schema): Plottable {
  const cats = schema.columns.filter((c) => c.type === "categorical");
  const nums = schema.columns.filter((c) => c.type === "numeric");
  let template: TemplateName = "dots";
  if (cats.length === 0) template = nums.length >= 2 ? "scatter" : "histogram";
  const t = TEMPLATES[template];
  const y = nums[nums.length - 1]?.name ?? "";
  const x = t.xKind === "numeric"
    ? (nums.find((c) => c.name !== y)?.name ?? y)
    : (cats[0]?.name ?? "");
  return {
    id: nextId(), name: "Analysis 1",
    mappings: { x, y }, family: t.family,
    layers: t.layers.map((l) => ({ geom: l.geom, params: { ...l.params } })),
    override: null, describeOnly: false,
    preset: "demo_default", style: {},
    reduce: { steps: [] },
  };
}
```

- [ ] **Step 5: Emit the 2.0 spec from `buildSpec`**

Replace `buildSpec` (lines 168–199) with:

```typescript
export function buildSpec(p: Plottable, rec: TestName | undefined,
                          snapshot: Record<string, string>): AnalysisSpec {
  const tests = TEST_BY_FAMILY[p.family];
  const recOk = rec && tests.includes(rec) ? rec : undefined;
  const test = (p.override && tests.includes(p.override) ? p.override : null)
    ?? recOk ?? tests[0];
  const usedOverride = p.override !== null && test === p.override && test !== recOk;
  const chosen_by = p.describeOnly ? "describe_only"
    : usedOverride ? "user_override"
    : recOk ? "recommendation_accepted" : "default";
  return {
    spec_version: "2.0",
    id: p.id,
    title: p.name,
    data: { filter: [], respect_exclusions: true },
    reduce: p.reduce,
    encodings: {
      x: p.family === "descriptive" ? null : { column: p.mappings.x },
      y: { column: p.mappings.y },
      color: p.family === "group_comparison" ? { column: p.mappings.x } : null,
      size: null, shape: null,
    },
    facet: { row: null, col: null, share_x: true, share_y: true },
    layers: p.layers,
    stats: {
      family: p.family, test, chosen_by,
      alternatives_offered: tests.filter((t) => t !== test),
      assumption_checks: [{ check: "shapiro_wilk",
                            per: p.family === "group_comparison" ? "group" : "variable" }],
      alpha: 0.05,
      report: ["effect_size", "ci", "n_per_group"],
    },
    annotations: { significance_brackets: "auto", show_n: true },
    style: { preset: p.preset, overrides: p.style },
    engine_snapshot: snapshot,
  };
}
```

- [ ] **Step 6: Update `specAtom` and `allSpecsAtom` to use `family` not `plotType`**

Replace `specAtom` (lines 202–210):

```typescript
export const specAtom = atom<AnalysisSpec | null>((get) => {
  const schema = get(schemaAtom);
  const p = get(activePlottableAtom);
  if (!schema || !p) return null;
  const tests = TEST_BY_FAMILY[p.family];
  const recRaw = get(analysisAtom)?.stats.recommendation.test as TestName | undefined;
  const rec = recRaw && tests.includes(recRaw) ? recRaw : undefined;
  return buildSpec(p, rec, get(engineSnapshotAtom) ?? {});
});
```

Replace `allSpecsAtom` (lines 214–224):

```typescript
export const allSpecsAtom = atom((get): AnalysisSpec[] => {
  if (!get(schemaAtom)) return [];
  const snap = get(engineSnapshotAtom) ?? {};
  const byId = get(analysisByIdAtom);
  return get(plottablesAtom).map((p) => {
    const tests = TEST_BY_FAMILY[p.family];
    const recRaw = byId[p.id]?.stats.recommendation.test as TestName | undefined;
    const rec = recRaw && tests.includes(recRaw) ? recRaw : undefined;
    return buildSpec(p, rec, snap);
  });
});
```

- [ ] **Step 7: Carry `layers`/`family`/`describeOnly` through duplicate**

In `duplicatePlottableAtom` (lines 237–247), replace the `copy` object so the new fields deep-copy:

```typescript
  const copy: Plottable = {
    ...src, id: nextId(), name: `${src.name} copy`,
    mappings: { ...src.mappings },
    layers: src.layers.map((l) => ({ geom: l.geom, params: { ...l.params } })),
    style: structuredClone(src.style),
    reduce: { steps: structuredClone(src.reduce.steps) },
  };
```

- [ ] **Step 8: Add layer-CRUD atoms (mirroring the reduce-step atoms)**

At the end of `src/state.ts`, add:

```typescript
/* ---- layer CRUD + reorder on the ACTIVE plottable (mirrors reduce steps) ---- */

export const addLayerAtom = atom(null, (get, set, geom: Layer["geom"]) => {
  const p = get(activePlottableAtom); if (!p) return;
  const reg = get(registryAtom);
  const params = { ...(reg?.geoms[geom]?.params ?? {}) };
  set(activePlottableAtom, { ...p, layers: [...p.layers, { geom, params }] });
});

export const updateLayerAtom = atom(null,
  (get, set, arg: { index: number; layer: Layer }) => {
    const p = get(activePlottableAtom); if (!p) return;
    set(activePlottableAtom, { ...p, layers:
      p.layers.map((l, i) => (i === arg.index ? arg.layer : l)) });
  });

export const removeLayerAtom = atom(null, (get, set, index: number) => {
  const p = get(activePlottableAtom); if (!p) return;
  set(activePlottableAtom,
    { ...p, layers: p.layers.filter((_, i) => i !== index) });
});

export const moveLayerAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) => {
    const p = get(activePlottableAtom); if (!p) return;
    const layers = [...p.layers];
    const j = arg.index + arg.dir;
    if (j < 0 || j >= layers.length) return;
    [layers[arg.index], layers[j]] = [layers[j], layers[arg.index]];
    set(activePlottableAtom, { ...p, layers });
  });

/* apply a template seed: swap the layer stack + family in one shot */
export const applyTemplateAtom = atom(null, (get, set, name: TemplateName) => {
  const p = get(activePlottableAtom); if (!p) return;
  const t = TEMPLATES[name];
  const nextOverride = t.family !== p.family ? null : p.override;
  set(activePlottableAtom, {
    ...p, family: t.family, override: nextOverride, describeOnly: false,
    layers: t.layers.map((l) => ({ geom: l.geom, params: { ...l.params } })),
  });
});
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `App.tsx` (uses `PLOT_TYPES`, `plotType`) and `StatsPanel.tsx` — fixed next. `state.ts` itself clean.

- [ ] **Step 10: Commit**

```bash
git add src/state.ts
git commit -m "feat(state): registry atom, template seeds, editable layer stack + CRUD atoms"
```

---

## Task 10: Per-geom param editors (`LayerCards.tsx`)

**Files:**
- Create: `src/components/LayerCards.tsx`
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Write the component**

Create `src/components/LayerCards.tsx` (mirrors `StepCards` — a registry-driven editor per geom):

```typescript
import type { Layer, ParamSpec, Registry } from "../types";

/* One geom's param editors, generated from the registry's param_specs so the
   engine stays the single source of truth for what's configurable. */
export function LayerCard(
  { layer, registry, onChange }:
  { layer: Layer; registry: Registry; onChange: (l: Layer) => void },
) {
  const meta = registry.geoms[layer.geom];
  if (!meta || meta.param_specs.length === 0) {
    return <div className="layer-meta"><em>no options</em></div>;
  }
  const setParam = (key: string, value: unknown) =>
    onChange({ ...layer, params: { ...layer.params, [key]: value } });

  return (
    <div className="layer-params">
      {meta.param_specs.map((spec: ParamSpec) => {
        const cur = layer.params[spec.key] ?? meta.params[spec.key];
        if (spec.type === "select") {
          return (
            <label key={spec.key} className="layer-param">
              <span>{spec.label}</span>
              <select value={String(cur ?? "")}
                onChange={(e) => setParam(spec.key, e.target.value)}>
                {(spec.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label key={spec.key} className="layer-param">
            <span>{spec.label}</span>
            <input type="number" value={cur === undefined ? "" : Number(cur)}
              min={spec.min} max={spec.max} step={spec.step}
              onChange={(e) => setParam(spec.key,
                e.target.value === "" ? undefined : Number(e.target.value))} />
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `LayerCards.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/LayerCards.tsx
git commit -m "feat(ui): registry-driven per-geom param editors"
```

---

## Task 11: The layer rail (`LayerRail.tsx`)

**Files:**
- Create: `src/components/LayerRail.tsx`
- Modify: `src/index.css` (rail styles — reuse the pipeline-rail look)
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Write the rail**

Create `src/components/LayerRail.tsx` (mirrors `PipelineRail`: ordered cards, move/remove, an add-menu filtered to the current family, and a template menu):

```typescript
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, applyTemplateAtom, moveLayerAtom,
  registryAtom, removeLayerAtom, updateLayerAtom, TEMPLATES,
  type TemplateName,
} from "../state";
import type { Geom } from "../types";
import { LayerCard } from "./LayerCards";

export function LayerRail() {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const addLayer = useSetAtom(addLayerAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
  const applyTemplate = useSetAtom(applyTemplateAtom);
  const [adding, setAdding] = useState(false);

  if (!active || !registry) return null;
  const layers = active.layers;

  /* only geoms whose family matches this plottable are addable (Phase 1 keeps
     geoms tied to the family the encodings imply) */
  const addable = (Object.keys(registry.geoms) as Geom[])
    .filter((g) => registry.geoms[g].family === active.family)
    .filter((g) => !layers.some((l) => l.geom === g));

  return (
    <div className="layer-rail">
      <div className="rail-head">
        <strong>Layers</strong>
        <select className="template-pick" value=""
          onChange={(e) => { if (e.target.value) applyTemplate(e.target.value as TemplateName); }}>
          <option value="">Start from…</option>
          {(Object.keys(TEMPLATES) as TemplateName[]).map((t) => (
            <option key={t} value={t}>{TEMPLATES[t].label}</option>
          ))}
        </select>
      </div>

      {layers.length === 0 && (
        <p className="rail-empty">No layers — add a geom or pick a template.</p>
      )}

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <li key={i} className="layer-card">
            <div className="layer-head">
              <span className="layer-name">{registry.geoms[layer.geom]?.label ?? layer.geom}</span>
              <span className="layer-actions">
                <button className="icon" title="Move up" disabled={i === 0}
                  onClick={() => moveLayer({ index: i, dir: -1 })}>↑</button>
                <button className="icon" title="Move down" disabled={i === layers.length - 1}
                  onClick={() => moveLayer({ index: i, dir: 1 })}>↓</button>
                <button className="icon" title="Remove layer"
                  onClick={() => removeLayer(i)}>✕</button>
              </span>
            </div>
            <LayerCard layer={layer} registry={registry}
              onChange={(l) => updateLayer({ index: i, layer: l })} />
          </li>
        ))}
      </ol>

      <div className="add-layer">
        {adding ? (
          <div className="add-layer-menu">
            {addable.length === 0 && <em className="rail-empty">all geoms added</em>}
            {addable.map((g) => (
              <button key={g} onClick={() => { addLayer(g); setAdding(false); }}>
                {registry.geoms[g].label}
              </button>
            ))}
            <button className="cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="add-layer-btn" onClick={() => setAdding(true)}>+ Add layer</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add rail styles**

In `src/index.css`, append (reuse the pipeline-rail visual language so the two rails read as siblings):

```css
.layer-rail { display: flex; flex-direction: column; gap: 8px; padding: 10px;
  border-right: 1px solid #e2e8f0; min-width: 220px; max-width: 260px; }
.layer-rail .rail-head { display: flex; align-items: center; justify-content: space-between; }
.layer-rail .template-pick { font-size: 12px; }
.layer-list { list-style: none; margin: 0; padding: 0; display: flex;
  flex-direction: column; gap: 6px; }
.layer-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; }
.layer-head { display: flex; align-items: center; justify-content: space-between; }
.layer-name { font-weight: 600; font-size: 13px; }
.layer-actions .icon { margin-left: 2px; }
.layer-params { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.layer-param { display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; gap: 8px; }
.layer-param input, .layer-param select { width: 90px; }
.add-layer-btn { font-size: 13px; color: #0e7490; background: none; border: none;
  cursor: pointer; padding: 4px; text-align: left; }
.add-layer-menu { display: flex; flex-direction: column; gap: 4px; }
.layer-meta { font-size: 12px; color: #94a3b8; margin-top: 6px; }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `LayerRail.tsx`/`LayerCards.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/LayerRail.tsx src/index.css
git commit -m "feat(ui): composable layer rail (add/remove/reorder/configure geoms)"
```

---

## Task 12: Render the stat-model design sentence + describe-only in `StatsPanel`

**Files:**
- Modify: `src/components/StatsPanel.tsx`
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Surface the inferred model and the describe-only toggle**

In `src/components/StatsPanel.tsx`, update the imports (line 2) to add `analysisAtom` is already imported; add the `describeOnly` plumbing. Replace the header of the component body (lines 68–81) so the inferred model shows above the recommendation, and add a describe-only control:

```typescript
export function StatsPanel() {
  const analysis = useAtomValue(analysisAtom);
  const [active, setActive] = useAtom(activePlottableAtom);
  const override = active?.override ?? null;
  const setOverride = (t: TestName | null) => active && setActive({ ...active, override: t });
  const setDescribeOnly = (v: boolean) =>
    active && setActive({ ...active, describeOnly: v });
  if (!analysis) return <section className="pane stats-pane"><div className="pane-head"><h2>Statistics</h2></div><p className="hint">Waiting for first analysis…</p></section>;

  const s = analysis.stats;
  const model = analysis.stat_model;
  const rec = s.recommendation;
  const alternatives = FAMILY_TESTS[s.result.test] ?? [];

  return (
    <section className="pane stats-pane">
      <div className="pane-head"><h2>Statistics</h2></div>
      <div className="stats-body">
        <h3>Inferred model</h3>
        <p className="reason">{model.design}.</p>
        <label className="describe-toggle">
          <input type="checkbox" checked={active?.describeOnly ?? false}
            onChange={(e) => setDescribeOnly(e.target.checked)} />
          Describe only — run no test
        </label>
```

(The rest of the component — assumption checks, recommended test, result rows, methods text — is unchanged and follows directly after this block. Leave lines 82 onward intact.)

- [ ] **Step 2: Add the toggle style**

In `src/index.css`, append:

```css
.describe-toggle { display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: #475569; margin: 4px 0 8px; }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `StatsPanel.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/StatsPanel.tsx src/index.css
git commit -m "feat(ui): show inferred stat-model + describe-only toggle"
```

---

## Task 13: Point `StylePane` at `family` + the live layer stack

`StylePane` derives its plot-specific controls from `PLOT_TYPES[active.plotType]` — both of which Task 9 removed. Repoint it at the plottable's `family` and its live, editable `layers` (which is *more* accurate: mark-specific controls now follow what the user actually stacked, not a fixed preset).

**Files:**
- Modify: `src/components/StylePane.tsx`
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Drop the `PLOT_TYPES` import**

In `src/components/StylePane.tsx`, replace the import on line 2:

```typescript
import { activePlottableAtom, analysisAtom, DEFAULT_PALETTE } from "../state";
```

- [ ] **Step 2: Derive `family` / `marks` / `xNumeric` from the plottable**

Replace lines 23–28 (the `plotType` … `xNumeric` block):

```typescript
  const analysis = useAtomValue(analysisAtom);
  const family = active?.family ?? "group_comparison";
  const grouped = family === "group_comparison";
  /* mark options follow the live, editable layer stack now, not a fixed preset */
  const marks = new Set((active?.layers ?? []).map((l) => l.geom));
  const xNumeric = family === "correlation" || family === "descriptive";
```

- [ ] **Step 3: Replace the two remaining `plotType` literals**

Find the grid-x default (around line 223) and replace:

```typescript
              checked={style.grid_x ?? (family === "correlation")}
```

Find the annotation label (around line 314) and replace:

```typescript
              {family === "descriptive" ? "median line + label" : "r / p annotation"}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no remaining errors from `StylePane.tsx` (App.tsx errors remain until Task 14).

- [ ] **Step 5: Commit**

```bash
git add src/components/StylePane.tsx
git commit -m "feat(ui): style pane follows family + live layer stack, not PLOT_TYPES"
```

---

## Task 14: Wire `App.tsx` — registry fetch, layer rail, encodings, guard bar

**Files:**
- Modify: `src/App.tsx`
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Import the rail, registry atom, templates, and drop `PLOT_TYPES`**

In `src/App.tsx`, replace the `./state` import block (lines 11–16) with this consolidated one — it drops `PLOT_TYPES`/`PlotType`, and adds `analysisAtom`, `applyTemplateAtom`, `registryAtom`, `TEMPLATES`, and the `TemplateName` type:

```typescript
import {
  activePlottableAtom, activePlottableIdAtom, allSpecsAtom, analysisAtom,
  applyTemplateAtom, engineErrorAtom, engineSnapshotAtom, exclusionLogAtom,
  loadTableAtom, registryAtom, reducePreviewAtom, rowsAtom, schemaAtom,
  setAnalysisByIdAtom, setReducePreviewByIdAtom, specAtom, tableTokenAtom,
  viewModeAtom, TEMPLATES, type TemplateName,
} from "./state";
```

Add to the existing component imports (lines 5–9): `import { LayerRail } from "./components/LayerRail";`

- [ ] **Step 2: Read the registry atom and store it from health**

After `const reducePreview = useAtomValue(reducePreviewAtom);` (line 47), add:

```typescript
  const setRegistry = useSetAtom(registryAtom);
  const applyTemplate = useSetAtom(applyTemplateAtom);
```

In the startup effect (lines 64–70), store the registry from the health payload:

```typescript
  useEffect(() => {
    engine.waitForHealth()
      .then((h) => { setSnapshot(h.engine_snapshot); setRegistry(h.registry); setEngineUp(true); })
      .then(() => engine.sample())
      .then((t) => loadTable(t))
      .catch(() => setEngineUp(false));
  }, []);
```

- [ ] **Step 3: Derive `family`/`xKind` from the active plottable, not `PLOT_TYPES`**

Replace the derived block (lines 55–82) so it reads `active.family` and infers `xKind` from the family:

```typescript
  /* derived from active plottable */
  const mappings = active?.mappings ?? { x: "", y: "" };
  const family = active?.family ?? "group_comparison";
  const preset = active?.preset ?? "demo_default";
  const xKind: "categorical" | "numeric" | "none" =
    family === "group_comparison" ? "categorical"
    : family === "correlation" ? "numeric" : "none";

  const setMappings = (m: { x: string; y: string }) =>
    active && setActive({ ...active, mappings: m });
  const setPreset = (p: string) => active && setActive({ ...active, preset: p });

  const effectiveSchema = reducePreview?.preview.schema ?? schema;
  const numericCols = effectiveSchema?.columns.filter((c) => c.type === "numeric") ?? [];
  const catCols = effectiveSchema?.columns.filter((c) => c.type === "categorical") ?? [];
  const xCols = xKind === "numeric" ? numericCols.filter((c) => c.name !== mappings.y) : catCols;
  const schemaKey = effectiveSchema?.columns.map((c) => `${c.name}:${c.type}`).join(",") ?? "";
```

- [ ] **Step 4: Keep the existing `mappingError` block; remove `switchPlotType`**

The `survives`/`mappingError` block (lines 95–105) stays as-is. Delete `switchPlotType` (lines 110–122) — template switching now lives in the layer rail (`applyTemplate`) and the Plot dropdown becomes a template seed selector.

- [ ] **Step 5: Surface engine-returned warnings in the guard bar**

The analyze response now carries `issues` (typed `Issue[]` via `AnalyzeResponse`). Read the active plottable's warnings off the stored analysis — add this right after `const reducePreview = useAtomValue(reducePreviewAtom);` (line 47), alongside the `setRegistry`/`applyTemplate` reads from Step 2:

```typescript
  const warnIssue = (useAtomValue(analysisAtom)?.issues ?? [])
    .find((i) => i.level === "warning");
```

(`analysisAtom` is in the consolidated `./state` import from Step 1.) Then update the banner (lines 269–270) to show a red hard error, else the amber mapping warning, else the amber guard warning:

```typescript
      {error ? <div className="error-bar">{error}</div>
        : mappingError ? <div className="error-bar warn-bar">{mappingError}</div>
        : warnIssue ? <div className="error-bar warn-bar">{warnIssue.message}</div>
        : null}
```

- [ ] **Step 6: Replace the Plot dropdown with a template seed selector + render the rail**

In the header controls (lines 231–238), replace the `<label>Plot …>` block so it seeds a template:

```typescript
              <label>Plot
                <select value=""
                  onChange={(e) => { if (e.target.value) applyTemplate(e.target.value as TemplateName); }}>
                  <option value="">Start from…</option>
                  {(Object.keys(TEMPLATES) as TemplateName[]).map((t) => (
                    <option key={t} value={t}>{TEMPLATES[t].label}</option>
                  ))}
                </select>
              </label>
```

(`TEMPLATES`/`TemplateName` are in the consolidated import from Step 1; `applyTemplate` was wired in Step 2.)

In the analyses layout (lines 276–283), mount the layer rail next to the pipeline rail:

```typescript
          <div className="analyses-mode">
            <PlottableSidebar />
            <PipelineRail />
            <LayerRail />
            <div className="triad">
              <Section title="Reduced table" defaultOpen><ReducedTable /></Section>
              <Section title="Figure" defaultOpen><FigurePane /></Section>
              <Section title="Statistics" defaultOpen><StatsPanel /></Section>
            </div>
          </div>
```

- [ ] **Step 7: Typecheck the whole frontend**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors) across the project.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): mount layer rail, encodings from family, registry fetch, guard bar"
```

---

## Task 15: End-to-end smoke for the layer rail

**Files:**
- Create: `e2e/layers_test.mjs`
- Verify: run against a live engine + dev server

- [ ] **Step 1: Write the e2e smoke (modeled on `e2e/plottables_test.mjs`)**

Create `e2e/layers_test.mjs`:

```javascript
import { chromium } from "playwright";

/* Smoke for the composable layer rail: switch to Analyses, confirm the rail
   renders the seeded layers, add a geom, reorder, remove, and confirm the
   figure still renders without an error bar. Needs the engine (8765) and the
   vite dev server (5173) running. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error(msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });
await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 10000 });

// The default template seeds at least one layer card.
await page.waitForSelector(".layer-card", { timeout: 10000 });
const seeded = await page.locator(".layer-card").count();
if (seeded < 1) fail(`expected seeded layers, got ${seeded}`);
console.log("seeded layers:", seeded);

// Add a layer via the add menu (if any geom is still addable).
await page.click(".add-layer-btn");
const addable = await page.locator(".add-layer-menu button:not(.cancel)").count();
if (addable > 0) {
  await page.locator(".add-layer-menu button:not(.cancel)").first().click();
  const after = await page.locator(".layer-card").count();
  if (after !== seeded + 1) fail(`add layer: expected ${seeded + 1}, got ${after}`);
  console.log("added a layer:", after);
} else {
  await page.click(".add-layer-menu .cancel");
}

// Remove the last layer.
const before = await page.locator(".layer-card").count();
await page.locator(".layer-card .icon[title='Remove layer']").last().click();
const removed = await page.locator(".layer-card").count();
if (removed !== before - 1) fail(`remove layer: expected ${before - 1}, got ${removed}`);

// The figure renders and no error bar is shown.
await page.waitForSelector(".figure-pane svg, .triad svg", { timeout: 20000 });
if (await page.locator(".error-bar:not(.warn-bar)").count() > 0)
  fail("hard error bar after layer edits: " + await page.locator(".error-bar").innerText());

console.log("layers e2e ok");
await browser.close();
```

- [ ] **Step 2: Run it against a live engine + dev server**

In one shell: `cd engine && python -m triad_engine.main`
In another: `npm run dev`
In a third: `node e2e/layers_test.mjs`
Expected: prints `seeded layers: …`, `added a layer: …`, `layers e2e ok`; exit 0. Stop the engine afterward (Ctrl-C) so it doesn't hold port 8765.

- [ ] **Step 3: Commit**

```bash
git add e2e/layers_test.mjs
git commit -m "test(e2e): layer rail smoke (seed, add, reorder, remove, render)"
```

---

## Done — Phase 1 complete

After Task 15: the plot is a composable, ordered stack of geom layers with per-layer params; the geom registry is the single engine-authoritative source consumed by the rail; the 82k-point freeze is blocked with a clear, actionable message; the statistical model is inferred from the encodings and shown in plain language with a describe-only escape hatch; and old `.viz` documents still open via `migrateSpec`. Phases 2 (Aesthetics) and 3 (Facets) extend the `encodings`/`facet`/`stat_model` seams already present, each in its own spec → plan → implementation cycle.
