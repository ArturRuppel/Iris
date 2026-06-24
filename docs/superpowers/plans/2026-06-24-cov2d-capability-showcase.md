# COV2D Capability Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new COV2D-shaped, smoke-only gallery example cases that showcase the new reduce vocabulary (`derive`/expression-`filter`/`grid_complete`/`pivot`/`reduce.post`) and collapse routing, surface the existing `cov2d-tier-a` case into the gallery, and write a "Reshaping real data" capstone chapter in `docs/guide.md`.

**Architecture:** Each example is an `engine/validation/cases/<name>/` folder (`case.py` + a deterministically-generated `data.csv`), mirroring the existing `cov2d-tier-a`/`reduction-collapse` cases. They carry **empty** `expected_stats`/`expected_model` and a minimal structural `expected_figure`, so `engine/validation/test_validation.py` auto-discovers and smoke-runs them (build + render) with no harness changes. Adding each case name to `GALLERY_CASES` in `export_gallery.py` exports a committed `.iris` + `.svg`; the guide embeds each via the `![](example:<caseId>/<analysisId>)` markdown token. No engine code changes — every capability already exists on `main`.

**Tech Stack:** Python 3 / pandas (engine + cases, `pytest`); React / TypeScript / Vite (guide rendering, `vitest`, `tsc`). Run engine commands from `engine/`, frontend commands from the repo root. Branch: `cov2d-capability-showcase`.

---

## Background the engineer needs

**A validation case** is a Python module `engine/validation/cases/<name>/case.py` exposing:
- `TITLE`, `DATA = "data.csv"`, `SOURCE` (strings)
- `SCHEMA_OVERRIDES` (dict): per-column type/levels patches over the inferred schema
- `ANALYSES` (list): each `{"spec": <2.1 AnalysisSpec dict>, "expected_stats": {...}, "expected_model": {...}, "expected_figure": {...}}`
- `regenerate_data()` (function): deterministically writes `data.csv` (the pattern in `engine/validation/cases/reduction-collapse/case.py`)

`engine/validation/harness.py` `build_table` reads `data.csv` into a wire table; `_analyses` auto-stamps each analysis `id` as `<case>-NN`. `engine/validation/test_validation.py` parametrizes over every case dir and calls `harness.validate()`, which builds the real `.iris`, runs each analysis through `main._run`, and asserts `expected_stats`/`expected_model`/`expected_figure`. Because `assert_stats({})`/`assert_model({})` iterate empty dicts (assert nothing) and `assert_figure` always checks `has_svg`, **empty expectation dicts make `validate()` a pure "it builds and renders" smoke test.**

**`expected_figure` keys available** (from `harness.assert_figure`): `axis_labels` ({axis: label}), `n_points` (int), `point_groups` (int), `xtick_labels` (list[str]), `title` (str), `annotation_contains` (str), `min_patches` (int), `legend_labels` (list[str]).

**Reduce-step JSON shapes** (from `engine/iris_engine/reduce.py`):
- `derive`: `{"kind": "derive", "column": "<new>", "expr": "<expr>"}` — exprs support `+ - * /`, comparisons (→ 0/1 int), unary `-`, funcs `log`/`log2`/`log10`/`sqrt`/`exp`/`abs`, cast `str`, and column names.
- `filter` (expression bound): `{"kind": "filter", "conditions": [{"column": "<c>", "op": "<=", "bound": "quantile(abs(<c>), 0.99)"}]}` — bound exprs support `abs(series)` and `quantile(series, p)` (p a constant); ops `< <= > >=`, plus `not-null`/`is-null`/`in`/`not-in` with `value`.
- `grid_complete`: `{"kind": "grid_complete", "by": [<id cols>], "column": "<cat>", "levels": [<all levels>], "fill": 0, "count_name": "<out>"}` — produces one row per (by × level) with a row-count column, 0-filling absent combos.

**Post-collapse phase & routing** (from `engine/iris_engine/render.py`):
- `spec["reduce"]["post"]`: list of reduce steps run on the chosen test-grain table AFTER collapse. A layer bound to the test grain can draw a post-derived column.
- `spec["test_grain"]`: a grain key string; `inferential_level = test_grain.split("/")[-1]`. Selects the grain the test runs at from the default level tables (no explicit `collapse` plan needed). Showcases editable routing.
- `stats.describe_only: true`: summaries only, no inferential test (mapped to runtime `_describe_only` by `specnorm`).
- Collapse fns (`hierarchy.py` `_AGG`): `mean`, `median`, `sum`, `min`, `max`.

**The gallery**: `engine/validation/export_gallery.py` has an ordered `GALLERY_CASES` list. `npm run examples:build` (= `python -m validation.export_gallery` from `engine/`) writes committed `src/examples/assets/<case>.iris`, `<case>-NN.svg`, and `manifest.json`. `engine/validation/test_export_gallery.py` asserts the export round-trips and is byte-deterministic (so data generators must be RNG-free).

**The guide**: `docs/guide.md` is rendered in-app by `src/examples/Guide.tsx`. Inline figure: `![](example:<caseId>/<analysisId>)` where `analysisId = <caseId>-01`. Open button: `[Open in Iris](iris-open:<caseId>)`.

---

## File structure

- Create: `engine/validation/cases/cov2d-rate-landscape/case.py` + `data.csv` — Fig 1 (derive + expression-filter + grid_complete)
- Create: `engine/validation/cases/cov2d-enrichment/case.py` + `data.csv` — Fig 2 (reduce.post + one-sample location)
- Create: `engine/validation/cases/cov2d-motility-superplot/case.py` + `data.csv` — Fig 3 (collapse routing via test_grain)
- Create: `engine/validation/cases/cov2d-shape-pivot/case.py` + `data.csv` — Fig 5 (pivot long→wide + derive)
- Modify: `engine/validation/export_gallery.py` — add the 4 new cases + `cov2d-tier-a` to `GALLERY_CASES`
- Modify (regenerate): `src/examples/assets/*` — new `.iris`/`.svg` + `manifest.json` via `npm run examples:build`
- Modify: `docs/guide.md` — new `# Reshaping real data` capstone chapter

---

## Task 1: Fig 1 — `cov2d-rate-landscape` (derive + expression-filter + grid_complete)

**Files:**
- Create: `engine/validation/cases/cov2d-rate-landscape/case.py`
- Create: `engine/validation/cases/cov2d-rate-landscape/data.csv` (generated)

- [ ] **Step 1: Write `case.py`**

```python
# engine/validation/cases/cov2d-rate-landscape/case.py
"""COV2D §5 absorption (showcase) — an event-rate landscape built in the graph:
`derive` an absolute displacement, a data-dependent `filter` clips the tail at the
99th percentile of |L|, `grid_complete` builds the position × transition-type grid
(an absent combo is a real 0, not missing), and a final `derive` turns counts into
a rate. Smoke/visualization only — no pinned stats (describe-only)."""
import csv
from pathlib import Path

TITLE = "COV2D §5 — event-rate landscape (grid-completed, tail-clipped)"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

TT_LEVELS = ["static", "slow", "fast"]
EXPERIMENTS = ["E1", "E2", "E3"]
# events per (position, transition); (P3, fast) intentionally ABSENT so
# grid_complete must 0-fill it — the honest-zero-denominator point.
COUNTS = {
    ("P1", "static"): 5, ("P1", "slow"): 3, ("P1", "fast"): 2,
    ("P2", "static"): 4, ("P2", "slow"): 4, ("P2", "fast"): 3,
    ("P3", "static"): 6, ("P3", "slow"): 2,
}

SCHEMA_OVERRIDES = {
    "experiment_id": {"type": "identifier"},
    "position_id": {"type": "identifier"},
    "tt": {"type": "categorical", "levels": TT_LEVELS},
    "L": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {"steps": [
            {"kind": "derive", "column": "absL", "expr": "abs(L)"},
            {"kind": "filter", "conditions": [
                {"column": "absL", "op": "<=", "bound": "quantile(absL, 0.99)"}]},
            {"kind": "grid_complete", "by": ["experiment_id", "position_id"],
             "column": "tt", "levels": TT_LEVELS, "fill": 0, "count_name": "events"},
            {"kind": "derive", "column": "rate", "expr": "events / 60.0"},
        ]},
        "encodings": {"x": {"column": "tt"}, "y": {"column": "rate"},
                      "color": {"column": "tt"}, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": ["experiment_id", "position_id"],
                      "fn": {"experiment_id": "median", "position_id": "median"}},
        "layers": [{"geom": "box", "level": ""}],
        "stats": {"alpha": 0.05, "describe_only": True},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"xtick_labels": TT_LEVELS},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free → byte-stable gallery export)."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "tt", "L"])
        for e in EXPERIMENTS:
            for (pos, tt), n in COUNTS.items():
                for k in range(n):
                    w.writerow([e, pos, tt, round(1.0 + 0.1 * k, 3)])
        # two extreme-displacement events the data-dependent filter clips
        w.writerow(["E1", "P1", "static", 99.0])
        w.writerow(["E2", "P2", "fast", 120.0])
```

- [ ] **Step 2: Generate `data.csv`**

Run: `cd engine && python -c "from validation import harness; c=harness.load_case(harness.CASES_DIR/'cov2d-rate-landscape'); c.regenerate_data(); print('wrote', (c.__case_dir__/c.DATA))"`
Expected: prints `wrote .../cov2d-rate-landscape/data.csv`; the file exists with a header + ~93 rows.

- [ ] **Step 3: Smoke-run the case (build + render)**

Run: `cd engine && python -c "from validation import harness; print(harness.validate(harness.CASES_DIR/'cov2d-rate-landscape', rebuild=True))"`
Expected: prints a result dict with no exception (the `.iris` built, the figure rendered, `xtick_labels == ['static','slow','fast']`).
If it raises: the likely causes are (a) `tt` not surviving `grid_complete` as categorical — drop the `xtick_labels` assertion to `{}` and re-eyeball; (b) empty/box layer level — try `"hierarchy": {"spine": [], "fn": {}}`. Adjust until it renders, keeping the four reduce steps intact.

- [ ] **Step 4: Eyeball the figure**

Run: `cd engine && python -m validation.build --cases cov2d-rate-landscape`
Then open `engine/validation/artifacts/cov2d-rate-landscape-01.svg`. Confirm: three boxes (static/slow/fast), `fast` lower than the others (P3 contributes a 0), a `rate` y-axis.

- [ ] **Step 5: Confirm the auto-discovered test passes**

Run: `cd engine && python -m pytest validation/test_validation.py -q -k cov2d_rate_landscape`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add engine/validation/cases/cov2d-rate-landscape/
git commit -m "feat(examples): cov2d-rate-landscape showcase (derive + expr-filter + grid_complete)"
```

---

## Task 2: Fig 2 — `cov2d-enrichment` (reduce.post + one-sample location)

**Files:**
- Create: `engine/validation/cases/cov2d-enrichment/case.py`
- Create: `engine/validation/cases/cov2d-enrichment/data.csv` (generated)

- [ ] **Step 1: Write `case.py`**

```python
# engine/validation/cases/cov2d-enrichment/case.py
"""COV2D §3 absorption (showcase) — a post-collapse enrichment. Per-cell obs/exp
counts sum up the spine to the experiment grain (collapse fn = sum), then a
`reduce.post` `derive` computes log2(Σobs / Σexp) ON the aggregated rows — a
grain-dependent transform the raw-grain reduce phase cannot express. The
one-sample `location` test asks whether replicate enrichment differs from 0; the
post-aggregate-derive caution guard fires (derive after an aggregate). Smoke
showcase — the test runs but no number is pinned."""
import csv
from pathlib import Path

TITLE = "COV2D §3 — replicate enrichment, log2(Σobs/Σexp) after collapse"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

EXPERIMENTS = ["E1", "E2", "E3"]
POSITIONS = ["P1", "P2"]
CELLS = ["C1", "C2", "C3"]
# per-experiment obs:exp ratio (varied so replicate enrichment has nonzero spread,
# else a one-sample t over identical values is degenerate)
RATIO = {"E1": 2.0, "E2": 2.2, "E3": 1.8}

SCHEMA_OVERRIDES = {
    "experiment_id": {"type": "identifier"},
    "position_id": {"type": "identifier"},
    "cell_id": {"type": "identifier"},
    "contact": {"type": "categorical", "levels": ["high"]},
    "obs": {"type": "numeric"},
    "exp": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {
            "steps": [],
            "post": [{"kind": "derive", "column": "enrich",
                      "expr": "log2(obs / exp)"}],
        },
        "encodings": {"x": {"column": "contact"}, "y": {"column": "enrich"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": ["experiment_id", "position_id", "cell_id"],
                      "fn": {"experiment_id": "sum", "position_id": "sum",
                             "cell_id": "sum"}},
        "test_grain": "experiment_id",
        "layers": [{"geom": "dot", "level": "experiment_id"},
                   {"geom": "summary", "level": "experiment_id"}],
        "stats": {"family": "location", "reference": 0.0, "alpha": 0.05},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"axis_labels": {"y": "enrich"}},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free)."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "cell_id", "contact",
                    "obs", "exp"])
        for e in EXPERIMENTS:
            r = RATIO[e]
            for p in POSITIONS:
                for ci, c in enumerate(CELLS):
                    exp = 10 + ci          # 10, 11, 12 — deterministic
                    obs = round(exp * r)   # ratio sets the enrichment per replicate
                    w.writerow([e, p, c, "high", obs, exp])
```

- [ ] **Step 2: Generate `data.csv`**

Run: `cd engine && python -c "from validation import harness; c=harness.load_case(harness.CASES_DIR/'cov2d-enrichment'); c.regenerate_data(); print('ok')"`
Expected: prints `ok`; `data.csv` has a header + 18 rows (3 exp × 2 pos × 3 cells).

- [ ] **Step 3: Smoke-run the case**

Run: `cd engine && python -c "from validation import harness; print(harness.validate(harness.CASES_DIR/'cov2d-enrichment', rebuild=True))"`
Expected: no exception; the figure renders with a `y = enrich` axis.
If it raises with `post-collapse reduction failed` or a missing `enrich` column: confirm the `summary`/`dot` layers are bound to `level: "experiment_id"` (the test grain where `reduce.post` materializes `enrich`). If the one-sample test errors on n=3, that is acceptable for a smoke showcase only if the figure still renders — if `validate()` raises, set `"stats": {"alpha": 0.05, "describe_only": True}` and drop `family`/`reference` to make it describe-only.

- [ ] **Step 4: Eyeball the figure + confirm the guard fires**

Run: `cd engine && python -m validation.build --cases cov2d-enrichment` and open `engine/validation/artifacts/cov2d-enrichment-01.svg` (one group "high", three replicate dots above 0, a summary).
Confirm the post-aggregate-derive guard is present:
Run: `cd engine && python -c "
from validation import harness
from iris_engine import main
c = harness.load_case(harness.CASES_DIR/'cov2d-enrichment')
doc = harness.load_built(c, rebuild=True)
table = {'schema': doc['schema'], 'rows': doc['rows']}
client = __import__('fastapi.testclient', fromlist=['TestClient']).TestClient(main.app)
r = client.post('/shape_counts', json={'table': table, 'spec': doc['analyses'][0]})
print('post_aggregate_derive:', r.json()['guards'].get('post_aggregate_derive'))
"`
Expected: a non-empty `post_aggregate_derive` list (the guard recognizes the post-collapse derive). If empty, that is non-blocking for the figure but note it — the chapter prose claims the guard fires.

- [ ] **Step 5: Confirm the auto-discovered test passes**

Run: `cd engine && python -m pytest validation/test_validation.py -q -k cov2d_enrichment`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/validation/cases/cov2d-enrichment/
git commit -m "feat(examples): cov2d-enrichment showcase (reduce.post log2 enrichment + guard)"
```

---

## Task 3: Fig 3 — `cov2d-motility-superplot` (collapse routing via `test_grain`)

**Files:**
- Create: `engine/validation/cases/cov2d-motility-superplot/case.py`
- Create: `engine/validation/cases/cov2d-motility-superplot/data.csv` (generated)

- [ ] **Step 1: Write `case.py`**

```python
# engine/validation/cases/cov2d-motility-superplot/case.py
"""COV2D §1–§2 absorption (showcase) — a motility SuperPlot whose unit of
inference is chosen, not enforced. The spine nests experiment›position›cell›frame;
`test_grain` explicitly routes the comparison to the experiment (replicate) grain
rather than letting the finest layer decide. Choosing a finer grain instead would
fire the pseudoreplication caution — the chapter shows that contrast in prose.
Smoke/visualization showcase (no pinned stats)."""
import csv
from pathlib import Path

TITLE = "COV2D §1–2 — motility SuperPlot, inference routed to the replicate"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

EXPERIMENTS = ["E1", "E2", "E3"]
POSITIONS = ["P1", "P2"]
CELLS = ["C1", "C2", "C3"]
FRAMES = [0, 1, 2]
CONDITIONS = ["ctrl", "trt"]
SPINE = ["experiment_id", "position_id", "cell_id", "frame"]
# trt speeds run higher than ctrl; per-experiment offset gives replicate spread
BASE = {"ctrl": 1.0, "trt": 1.6}
EXP_OFFSET = {"E1": 0.0, "E2": 0.1, "E3": -0.1}

SCHEMA_OVERRIDES = {
    "experiment_id": {"type": "identifier"},
    "position_id": {"type": "identifier"},
    "cell_id": {"type": "identifier"},
    "frame": {"type": "identifier"},
    "condition": {"type": "categorical", "levels": CONDITIONS},
    "speed": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {"steps": [
            {"kind": "filter",
             "conditions": [{"column": "speed", "op": "not-null"}]}]},
        "encodings": {"x": {"column": "condition"}, "y": {"column": "speed"},
                      "color": {"column": "condition"}, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": SPINE, "fn": {lv: "median" for lv in SPINE}},
        "test_grain": "experiment_id",
        "layers": [{"geom": "violin", "level": ""},
                   {"geom": "dot", "level": "cell_id"},
                   {"geom": "summary", "level": "experiment_id"}],
        "stats": {"alpha": 0.05, "override": "paired_t"},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"xtick_labels": CONDITIONS},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free). A small per-cell ramp gives
    intra-cell variation without randomness."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "cell_id", "frame",
                    "condition", "speed"])
        for e in EXPERIMENTS:
            for cond in CONDITIONS:
                base = BASE[cond] + EXP_OFFSET[e]
                for p in POSITIONS:
                    for ci, c in enumerate(CELLS):
                        cell = f"{e}_{p}_{cond}_{c}"
                        for fr in FRAMES:
                            speed = round(base + 0.05 * ci + 0.02 * fr, 4)
                            w.writerow([e, p, cell, fr, cond, speed])
```

- [ ] **Step 2: Generate `data.csv`**

Run: `cd engine && python -c "from validation import harness; c=harness.load_case(harness.CASES_DIR/'cov2d-motility-superplot'); c.regenerate_data(); print('ok')"`
Expected: prints `ok`; `data.csv` has a header + 108 rows (3 exp × 2 cond × 2 pos × 3 cells × 3 frames).

- [ ] **Step 3: Smoke-run the case**

Run: `cd engine && python -c "from validation import harness; print(harness.validate(harness.CASES_DIR/'cov2d-motility-superplot', rebuild=True))"`
Expected: no exception; `xtick_labels == ['ctrl','trt']`.
If `paired_t` errors (cells per condition unequal across the pairing): drop `"override": "paired_t"` so the engine recommends a group comparison, and re-run.

- [ ] **Step 4: Eyeball the figure**

Run: `cd engine && python -m validation.build --cases cov2d-motility-superplot` and open `engine/validation/artifacts/cov2d-motility-superplot-01.svg`. Confirm a SuperPlot: a violin per condition, cell-level dots, and three replicate summaries, with trt above ctrl.

- [ ] **Step 5: Confirm the auto-discovered test passes**

Run: `cd engine && python -m pytest validation/test_validation.py -q -k cov2d_motility_superplot`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/validation/cases/cov2d-motility-superplot/
git commit -m "feat(examples): cov2d-motility-superplot showcase (routed test grain)"
```

---

## Task 4: Fig 5 — `cov2d-shape-pivot` (pivot long→wide + derive)

**Files:**
- Create: `engine/validation/cases/cov2d-shape-pivot/case.py`
- Create: `engine/validation/cases/cov2d-shape-pivot/data.csv` (generated)

`pivot` step shape (from `engine/iris_engine/reduce.py` `_apply_pivot`):
`{"kind": "pivot", "index": [<keep cols>], "column": "<cat>", "values": "<num>", "agg": "mean", "fill": 0, "names": {<level>: <out col>}}` — unstacks `column` into one numeric column per level named by `names`, aggregating `values` over `index`; non-`names` levels are dropped; columns not in index/column/values do not survive.

- [ ] **Step 1: Write `case.py`**

```python
# engine/validation/cases/cov2d-shape-pivot/case.py
"""COV2D §4 absorption (showcase) — from long measurements to a shape factor. Each
cell contributes one row per measured feature (perimeter, area). A `pivot` unstacks
those into per-cell `perimeter`/`area` columns (long → wide), then a `derive`
computes the shape factor q = perimeter / sqrt(area) — pivot and derive composed.
Smoke/visualization showcase (no pinned stats)."""
import csv
from pathlib import Path

TITLE = "COV2D §4 — pivot to a shape factor, q = perimeter / sqrt(area)"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

EXPERIMENTS = ["E1", "E2", "E3"]
POSITIONS = ["P1", "P2"]
FEATURES = ["perimeter", "area"]
CLASSES = ["round", "spread"]
# per class: (perimeter, area) base — round cells are more compact (smaller q)
BASE = {"round": (40.0, 130.0), "spread": (60.0, 110.0)}

SCHEMA_OVERRIDES = {
    "experiment_id": {"type": "identifier"},
    "position_id": {"type": "identifier"},
    "cell_id": {"type": "identifier"},
    "class_label": {"type": "categorical", "levels": CLASSES},
    "feature": {"type": "categorical", "levels": FEATURES},
    "val": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {"steps": [
            {"kind": "pivot",
             "index": ["experiment_id", "position_id", "cell_id", "class_label"],
             "column": "feature", "values": "val", "agg": "mean", "fill": 0,
             "names": {"perimeter": "perimeter", "area": "area"}},
            {"kind": "derive", "column": "q", "expr": "perimeter / sqrt(area)"},
        ]},
        "encodings": {"x": {"column": "class_label"}, "y": {"column": "q"},
                      "color": {"column": "class_label"}, "size": None,
                      "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": [], "fn": {}},
        "layers": [{"geom": "box", "level": ""}],
        "stats": {"alpha": 0.05, "describe_only": True},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"xtick_labels": CLASSES},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free). Two feature rows per cell."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "cell_id", "class_label",
                    "feature", "val"])
        for e in EXPERIMENTS:
            for p in POSITIONS:
                for cls in CLASSES:
                    per, ar = BASE[cls]
                    for ci in range(3):
                        cell = f"{e}_{p}_{cls}_{ci}"
                        w.writerow([e, p, cell, cls, "perimeter", round(per + ci, 3)])
                        w.writerow([e, p, cell, cls, "area", round(ar + ci, 3)])
```

- [ ] **Step 2: Generate `data.csv`**

Run: `cd engine && python -c "from validation import harness; c=harness.load_case(harness.CASES_DIR/'cov2d-shape-pivot'); c.regenerate_data(); print('ok')"`
Expected: prints `ok`; `data.csv` has a header + 72 rows (3 exp × 2 pos × 2 classes × 3 cells × 2 features).

- [ ] **Step 3: Smoke-run the case**

Run: `cd engine && python -c "from validation import harness; print(harness.validate(harness.CASES_DIR/'cov2d-shape-pivot', rebuild=True))"`
Expected: no exception; `xtick_labels == ['round','spread']`.
If it raises: confirm `class_label` is in the pivot `index` (otherwise it is dropped and `x` has no column). If `q` is missing, confirm the pivot `names` produced `perimeter`/`area` columns the derive can read.

- [ ] **Step 4: Eyeball the figure**

Run: `cd engine && python -m validation.build --cases cov2d-shape-pivot` and open `engine/validation/artifacts/cov2d-shape-pivot-01.svg`. Confirm two boxes (round/spread), `spread` higher `q` than `round`, a `q` y-axis.

- [ ] **Step 5: Confirm the auto-discovered test passes**

Run: `cd engine && python -m pytest validation/test_validation.py -q -k cov2d_shape_pivot`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/validation/cases/cov2d-shape-pivot/
git commit -m "feat(examples): cov2d-shape-pivot showcase (pivot long->wide + derive)"
```

---

## Task 5: Surface all five COV2D cases into the gallery

**Files:**
- Modify: `engine/validation/export_gallery.py` (the `GALLERY_CASES` list)
- Modify (regenerate): `src/examples/assets/` (new `.iris`/`.svg` + `manifest.json`)

- [ ] **Step 1: Add the four cases to `GALLERY_CASES`**

In `engine/validation/export_gallery.py`, append these four entries to the end of the `GALLERY_CASES` list (after `"nested-correlation"`), keeping the existing entries unchanged:

```python
    "cov2d-tier-a",
    "cov2d-rate-landscape",
    "cov2d-enrichment",
    "cov2d-motility-superplot",
    "cov2d-shape-pivot",
```

- [ ] **Step 2: Regenerate the committed gallery assets**

Run: `npm run examples:build`
Expected: prints `exported 24 cases (... plots) -> .../src/examples/assets`. New files appear: `cov2d-tier-a.iris`, `cov2d-rate-landscape.iris`, `cov2d-enrichment.iris`, `cov2d-motility-superplot.iris`, `cov2d-shape-pivot.iris`, their `*-01.svg`, and an updated `manifest.json`.

- [ ] **Step 3: Verify export round-trip + byte-determinism**

Run: `cd engine && python -m pytest validation/test_export_gallery.py -q`
Expected: PASS (asserts every manifest `.iris` round-trips through `document.load_document` and re-export is byte-identical).

- [ ] **Step 4: Re-run the build once more to confirm no churn**

Run: `npm run examples:build && git status --short src/examples/assets`
Expected: after the second build, `git status` shows the new files as added but **no further modification** to already-written bytes (determinism holds).

- [ ] **Step 5: Commit**

```bash
git add engine/validation/export_gallery.py src/examples/assets/
git commit -m "feat(examples): export the four COV2D showcase cases to the gallery"
```

---

## Task 6: The "Reshaping real data" guide chapter

**Files:**
- Modify: `docs/guide.md` (insert a new top-level chapter before `# References`)
- Modify: `TODO.md` (remove the now-satisfied `pivot` deferral note)

- [ ] **Step 1: Insert the chapter**

In `docs/guide.md`, immediately **before** the `# References` heading (line ~690), insert the following. Each `![](example:...)` token resolves to the gallery SVG; each figure's `analysisId` is `<caseId>-01`.

```markdown
# Reshaping real data

Everything so far assumed a tidy table: one row per observation, the columns you
want to plot already present. Real experiments rarely arrive that way. A motility
assay lands as one row per frame; a class label lives in a separate per-cell
sheet; an event-rate denominator needs grid cells that never occurred to be
counted as real zeros. Iris does this reshaping **inside the spec** — declarative
reduce steps, not notebook code — so the figure stays reproducible and the
transformation stays inspectable. The boundary is firm: Iris reshapes the pooled
tidy table into a figure; producing that table from images or graphs stays
upstream.

## From per-frame rows to a SuperPlot

The cell-size SuperPlot below starts from per-frame rows. A `join` broadcasts a
per-cell class label onto every frame, a `recode` relabels it, and the nested
median chain collapses frame → cell → position → experiment, so the paired test
runs across the three replicates — not the thousands of frames.

![](example:cov2d-tier-a/cov2d-tier-a-01)

[Open in Iris](iris-open:cov2d-tier-a)

## Honest rates need a complete grid

An event rate is only honest if its denominator counts the cells where the event
*could* have happened but didn't. Here a data-dependent `filter` clips the
displacement tail at the 99th percentile of its own distribution, `grid_complete`
builds the full position × transition-type grid (a combination with no events
becomes a real **0**, not a missing cell), and a `derive` turns the counts into a
rate.

![](example:cov2d-rate-landscape/cov2d-rate-landscape-01)

[Open in Iris](iris-open:cov2d-rate-landscape)

## Deriving after the collapse

Some quantities only exist once you have aggregated. Replicate enrichment is
`log2(Σobs / Σexp)` — a ratio of *sums*, computable only after the per-cell counts
collapse to the experiment grain. Iris runs this as a post-collapse step
(`reduce.post`): collapse first by sum, then derive. Because a derive after an
aggregate loses the raw-grain safety guarantee, Iris raises a caution — visible,
never blocking. (Iris guides and educates; the user is responsible.)

![](example:cov2d-enrichment/cov2d-enrichment-01)

[Open in Iris](iris-open:cov2d-enrichment)

## Choosing the unit of inference

The nesting spine is a *default*, not a wall. The SuperPlot below routes its test
to the experiment (replicate) grain — three points, three replicates. Route it
instead to the cell grain and Iris keeps drawing, but fires a pseudoreplication
caution: thousands of correlated cells are not independent replicates. Re-pairing
across the wrong level trips the pairing-flip caution the same way. The guards
move the protection from a locked door to a loud, specific warning. See also
*Experimental design and nesting* above.

![](example:cov2d-motility-superplot/cov2d-motility-superplot-01)

[Open in Iris](iris-open:cov2d-motility-superplot)

## From long measurements to a shape factor

Measurements often arrive long: one row per cell per feature. A `pivot` unstacks
them into wide form — a `perimeter` and an `area` column per cell — and a `derive`
turns the pair into a shape factor, `q = perimeter / sqrt(area)`. Spread cells
carry more perimeter per unit area, so their `q` runs higher.

![](example:cov2d-shape-pivot/cov2d-shape-pivot-01)

[Open in Iris](iris-open:cov2d-shape-pivot)
```

- [ ] **Step 2: Reconcile the `pivot` note in `TODO.md`**

The §4 thread's update to `TODO.md` left a "Follow-on (deferred with §4): `pivot`
showcase" note that this plan now satisfies. Remove that paragraph (the block
beginning `**Follow-on (deferred with §4):`), since `pivot` is covered by
Task 4 / Figure 5. Leave the rest of `TODO.md` (including the §4 status block)
untouched.

- [ ] **Step 3: Verify the frontend builds and the guide tokens parse**

Run: `npx tsc --noEmit && npx vitest run src/examples`
Expected: tsc exit 0; the `tokens` tests pass (the `example:`/`iris-open:` tokens in the new chapter are well-formed).

- [ ] **Step 4: Confirm every referenced asset exists**

Run: `for id in cov2d-tier-a cov2d-rate-landscape cov2d-enrichment cov2d-motility-superplot cov2d-shape-pivot; do test -f "src/examples/assets/$id-01.svg" && echo "ok $id" || echo "MISSING $id"; done`
Expected: five `ok` lines (no `MISSING`).

- [ ] **Step 5: Commit**

```bash
git add docs/guide.md TODO.md
git commit -m "docs(guide): add the 'Reshaping real data' capstone chapter"
```

---

## Task 7: Full verification

- [ ] **Step 1: Engine suite**

Run: `cd engine && python -m pytest -q`
Expected: all pass (the three new cases add to the validation count; no regressions).

- [ ] **Step 2: Frontend suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; all vitest pass.

- [ ] **Step 3: Gallery determinism (final)**

Run: `npm run examples:build && git status --short`
Expected: a clean tree (assets already committed; the rebuild produces identical bytes, so nothing to stage).

- [ ] **Step 4: Final review commit (if any tweaks were needed above)**

```bash
git add -A
git commit -m "test: verify COV2D showcase cases + gallery build green" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** Fig 1 → derive + expression-filter + grid_complete (spec §"event-rate landscape"); Fig 2 → reduce.post + post-aggregate-derive guard + one-sample location (spec §"enrichment"); Fig 3 → collapse routing via `test_grain` + pseudoreplication/pairing-flip prose (spec §"motility SuperPlot"); Fig 5 → pivot long→wide + derive (Task 4, spec §"shape factor"); Fig 4 → cov2d-tier-a join+recode surfaced (Task 5). Chapter (Task 6) matches the spec's six-section outline. `pivot` is now included (§4 landed 2026-06-24, unblocking it) — no remaining deferral.
- **Smoke-only invariant:** every new case uses empty `expected_stats`/`expected_model`; only minimal structural `expected_figure`. No pinned reference numbers, per the spec's decision 1.
- **No engine/harness changes:** all capabilities (`derive`/`filter`/`grid_complete`/`reduce.post`/`test_grain`/`describe_only`/`sum`) already exist on `main`; empty-dict expectations ride the existing `validate()` path.
- **Determinism:** all three `regenerate_data()` are RNG-free, so `test_export_gallery.py`'s byte-determinism guard holds.
- **Risk:** the three specs are concrete but unverified against a live render; Tasks 1–3 Step 3/4 are explicit render-and-eyeball loops with named fallbacks (describe-only, drop override, spineless) for the most likely failure modes. This is expected for showcase authoring and does not change any engine behavior.
```
