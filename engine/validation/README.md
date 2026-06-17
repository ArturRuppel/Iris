# Validation corpus — known datasets → known plots & stats

Each **case** pairs a known, well-characterized dataset with a real Iris analysis
spec, and does four jobs at once:

1. **Statistical correctness** — asserts the engine's computed stats against
   *published reference values*, independently recomputed with raw scipy/numpy
   (never echoing Iris's own output — see each case's `NOTES`).
2. **End-to-end regression** — drives the real pipeline (`.iris` → analyses →
   figure + stats) so unintended drift fails a case in CI.
3. **Shippable demo** — each case builds to a real, openable `.iris` a user can
   load in the app.
4. **Visual/plot structure** — asserts *structural* facts of the rendered SVG
   (mark counts, axis labels, tick labels, annotations) — robust across machines
   and matplotlib versions, not pixel-exact.

This is distinct from `engine/tests/`, which tests engine internals in isolation;
these drive the whole public pipeline through the real document format on
recognizable datasets, and double as demos.

## Running (from the `engine/` directory)

```sh
python -m pytest validation              # run the whole corpus (one test per case)
python -m pytest validation -k iris      # a subset
python -m validation.build --all         # (re)build artifacts/<case>.iris + .svg
python -m validation.build reduction-collapse
```

`artifacts/` (the built `.iris` and rendered `.svg`) is **gitignored** — build on
demand; only the human-readable sources (`data.csv` + `case.py`) are committed.
The validator builds the `.iris` automatically if it's missing, so a fresh
checkout passes `pytest` with no build step.

## Layout

```
validation/
  cases/<case>/data.csv   # canonical / generated dataset (committed)
  cases/<case>/case.py    # spec(s), reference values + citations, assertions
  harness.py              # build_iris(case) + validate(case): shared machinery
  svgstruct.py            # parse SVG -> structural facts
  build.py                # CLI: regenerate .iris (+ .svg) into artifacts/
  test_validation.py      # pytest: parametrized over cases/
  artifacts/              # GITIGNORED: built .iris + rendered .svg
```

## The case contract (`case.py`)

A small declarative module — Python, not JSON, so each expected number carries an
inline citation and tolerance that reads naturally:

```python
TITLE  = "..."
DATA   = "data.csv"
SOURCE = "...; recomputed with scipy ... (see NOTES)"
NOTES  = "published value + the independent raw-scipy recompute"
SCHEMA_OVERRIDES = {}   # optional: {col: {"type": ..., "levels": [...]}}

ANALYSES = [{
  "spec": { ...a real 2.0 Iris AnalysisSpec... },
  "expected_stats":  { "test": "pearson", "r": (0.962865, 1e-5),
                       "p": ("<", 1e-80), "n": 150 },
  "expected_model":  { "family": "correlation", "chosen_by": "inferred" },
  "expected_figure": { "axis_labels": {"x": "petal length"}, "n_points": 150 },
}]
```

Three assertion buckets, each a distinct correctness property:

- **`expected_stats`** — the numbers, asserted against the engine's stats result.
  A field is resolved at the top level or inside `result` (so `"r"` reaches
  `res["result"]["r"]`); a dotted key walks a path (`"summaries.0.mean"`,
  `"effect.value"`). A named field **absent** from the result is a failure (it
  catches silent drift). Each value is one of:
  - exact (`"chi_square"`, `150`) → equality;
  - `(value, abs_tol)` → `|actual - value| <= abs_tol`;
  - `(op, bound)` with `op` in `< > <= >=` → operator bound;
  - `("~", value)` → approximately equal (relative 1e-3).
- **`expected_model`** — that the right *family / test selection* happened
  (`statmodel.infer`'s model), e.g. inferred Welch's t vs a pinned override.
- **`expected_figure`** — structural SVG facts via `svgstruct`:
  `axis_labels` `{x,y}`, `n_points`, `point_groups` (count), `xtick_labels`,
  `title`, `annotation_contains`, `min_patches`.

## Provenance policy

For every published value a case asserts, its `NOTES` records both the published
figure (with citation) and an independent recompute with raw scipy/numpy run
*outside* Iris's code path — so an assertion can never be a tautology that merely
re-confirms Iris's own output.

## Adding a case

Add a `cases/<name>/` folder with `data.csv` + `case.py`; the corpus parametrizes
over folders, so there are **zero harness changes**. For a dataset generated from
a cited source (e.g. a contingency count matrix), keep the matrix and a
`regenerate_data()` in `case.py` and commit the generated `data.csv`.

## Current cases

| Case | Dataset | Family / test | Geom |
|---|---|---|---|
| `iris-petal-correlation` | Fisher iris (150) | correlation → Pearson (pinned) | scatter + regression |
| `iris-species-comparison` | Fisher iris, 2 species | group comparison → Welch's t (inferred) | box |
| `iris-sepal-descriptive` | Fisher iris (150) | descriptive | histogram |
| `contingency-2x2` | Aspirin × MI (NEJM 1988) | contingency → chi-square | tile |
| `reduction-collapse` | synthetic, cells_by_frame-shaped | reduce (filter → collapse) → group comparison | box |

The corpus grows as siblings — Spearman, Mann–Whitney/Kruskal, paired-t,
Fisher-exact, and a k>2 omnibus once the engine grows an ANOVA path — each a new
`cases/` folder.

> **Note on test selection.** The `iris-petal-correlation` case pins Pearson via
> the override channel because the engine *infers* Spearman on the petal
> dimensions (Shapiro–Wilk rejects normality). The design spec's original
> `iris-species-anova` (a k>2 one-way ANOVA) is **not yet mappable** — the engine
> only compares exactly two groups — so it is represented here by its mappable
> sibling, the two-group `iris-species-comparison`.
