# Validation Corpus — Known Datasets → Known Plots & Stats

*Design spec — 2026-06-17*

## Purpose

A corpus of curated **validation cases**, each pairing a known, well-characterized
dataset with an Iris analysis spec. Every case does four jobs at once:

1. **Statistical correctness** — assert Iris's computed stats (test selection,
   p-values, effect sizes, summaries) against *published reference values*,
   independently recomputed with raw scipy/pingouin (never echoing Iris's own
   output).
2. **End-to-end regression** — exercise the real engine pipeline
   (`.iris` → analyses → figure + stats) so unintended drift fails a case in CI.
3. **Shippable demos** — each case builds to a real, openable `.iris` file a user
   can load in the app and inspect for themselves.
4. **Visual/plot correctness** — assert *structural* properties of the rendered
   figure (mark counts, layers, legend entries, axis labels) — robust across
   machines and matplotlib versions, not pixel-exact.

This corpus is distinct from the existing `engine/tests/` unit suite: those test
engine internals in isolation; these drive the *whole* public pipeline through
the real document format on recognizable datasets, and double as user-facing
demos.

## Approach (decisions locked in brainstorming)

- **The `.iris` is the deliverable and the test input** (approach "C"). The
  validator loads the actual built `.iris` via `document.load_document` and runs
  each analysis through the engine's real entry point — no reimplementation of
  the pipeline.
- **Build on demand; do not commit the binary.** Only human-readable sources are
  committed (`data.csv` + `case.py`). A builder regenerates the `.iris` (and a
  rendered `.svg`) into a gitignored `artifacts/` dir for testing and shipping.
  Clean git history; reviewable, diffable diffs; a real file still one command
  away.
- **Ground truth = published reference values**, anchored on Fisher's iris
  dataset, with independent recompute and analytic-synthetic constructions as
  acceptable fallback where no published analysis exists.
- **Figure checks are structural** (parsed-SVG assertions), not image diffs.
- **Coverage = one case per stat family** (5 cases), designed to grow as siblings.

## Architecture & layout

```
engine/validation/
  cases/
    iris-petal-correlation/   data.csv  case.py
    iris-species-anova/       data.csv  case.py
    iris-sepal-descriptive/   data.csv  case.py
    contingency-2x2/          data.csv  case.py
    reduction-collapse/       data.csv  case.py
  harness.py            # build_iris(case) + validate(case): shared machinery
  svgstruct.py          # parse SVG → structural facts (marks, legend, axes)
  build.py              # CLI: regenerate .iris (+ .svg) into artifacts/
  test_validation.py    # pytest: parametrized over cases/, runs validate()
  artifacts/            # GITIGNORED: built .iris + rendered .svg
  README.md             # how to add a case; where the numbers come from
```

Runs under the engine's existing Python/pytest toolchain (base conda env already
has pandas, scipy, seaborn, pingouin, pyarrow). `data.csv` files for the iris
cases are the canonical Fisher iris (150 rows; verified byte-identical to
seaborn's bundled copy at authoring time).

## Flow for one case

1. **Build** — `harness.build_iris(case)`: read `data.csv` → schema (via the same
   `document._infer_schema` used by `load_sample`, plus a per-case override hook
   for explicit types/levels), take the spec(s) from `case.py`, call
   `document.save_document(...)` → `artifacts/<case>.iris`. This is the exact file
   a user opens.
2. **Validate** — `harness.validate(case)`: `document.load_document()` the *built*
   `.iris`; for each analysis call `main._run(table, spec)` →
   `(fig, _, res, _, _, model, issues)`. Then:
   - assert `res` against `expected_stats` (per-field tolerances / operator
     bounds; a field missing from `res` is an error — catches silent drift);
   - assert `model` against `expected_model` (guards *test selection*, e.g. iris
     picks Pearson not Spearman, ANOVA not t-test);
   - render `compiler.figure_to_svg(fig)`, parse with `svgstruct`, assert
     `expected_figure`;
   - write the `.svg` to `artifacts/` for human spot-checking.
3. **Ship/demo** — `artifacts/<case>.iris` is the openable demo;
   `python -m validation.build [case|--all]` regenerates on demand.

## The case contract (`case.py`)

A small declarative Python module (Python, not JSON, so each expected number
carries an inline citation and tolerances read naturally):

```python
TITLE  = "Petal length vs petal width (Fisher's iris)"
DATA   = "data.csv"
SOURCE = "Fisher 1936; r recomputed with scipy.stats.pearsonr (see NOTES)"
NOTES  = "Pearson r=0.962865, p=4.7e-86, n=150; recomputed scipy 1.16.3."
SCHEMA_OVERRIDES = {}   # optional: {col: {"type": "categorical", "levels": [...]}}

ANALYSES = [
  {
    "spec": { ...a real Iris AnalysisSpec... },
    "expected_stats": {           # asserted against _run()'s `res`
        "test": "pearson",        # exact value
        "r":    (0.96287, 1e-4),  # (value, abs-tolerance)
        "p":    ("<", 1e-10),     # operator bound: "<", ">", "~"
        "n":    150,
    },
    "expected_model":  {"family": "correlation", "chosen_by": "inferred"},
    "expected_figure": {          # structural SVG assertions
        "layers": ["scatter", "regression"],
        "n_points": 150,
        "axis_labels": {"x": "petal_length", "y": "petal_width"},
    },
  },
]
```

Three assertion buckets, each a real and distinct correctness property:
- **`expected_stats`** — the numbers, with per-value tolerance so authors set
  looseness where the science warrants it (no global fudge factor).
- **`expected_model`** — that the right test/family was *selected*.
- **`expected_figure`** — structural facts about the rendered plot.

A case with no published number (the reduction case) sets `SOURCE` to
"analytic — known by construction" and asserts values exact by design.

## `svgstruct.py` — the only genuinely new test infrastructure

A small helper that parses an SVG string and returns structural facts the figure
assertions check against: counts of marks by class/group (points, bars, boxes,
tiles), the geom layers present, legend entry labels, and axis label / title /
range text. Deliberately structural so it survives font-hint and
matplotlib-version differences across machines (and the coming macOS/Windows
packaging). Everything else in the harness is orchestration of existing engine
functions.

## Initial corpus (5 cases)

One case per stat family; each also exercises a different geom so figure-structure
coverage comes along for free. Recomputed reference values (scipy 1.16.3 /
pingouin 0.6.1) shown are the actual numbers the cases assert.

| Case | Dataset | Family / test | Geom | Reference values |
|---|---|---|---|---|
| `iris-petal-correlation` | Fisher iris (150) | correlation → Pearson | scatter + regression | r=0.962865, p≈4.7e-86, n=150 |
| `iris-species-anova` | Fisher iris | group comparison → one-way ANOVA (petal_length ~ species) | box | F=1180.16, p≈2.9e-91, k=3, N=150 |
| `iris-sepal-descriptive` | Fisher iris | descriptive (sepal_length) | histogram + density | n=150, mean=5.8433, sd=0.8281, median=5.80, Q1=5.10, Q3=6.40, min=4.3, max=7.9 |
| `contingency-2x2` | Published 2×2 (cell counts cited; tidy `data.csv` generated from them) | contingency → chi-square (+ Fisher note) | tile / heatmap | χ² and p from the cited source |
| `reduction-collapse` | Synthetic wide table, cells_by_frame-shaped | reduction pipeline (filter → collapse) then group comparison on the collapsed grain | box | analytic — reduced table and resulting stat exact by construction |

Notes:
- The three iris cases use the canonical downloaded Fisher iris, verified
  byte-identical to seaborn's bundled copy.
- **Contingency** uses a published canonical table; because Iris consumes tidy
  (one-row-per-observation) tables, the reviewable source is the cited cell-count
  matrix and the tidy `data.csv` is generated from it deterministically.
- **Reduction** specifically guards the `reduce`-pipeline + hierarchy path (the
  newest, least-covered engine surface); its synthetic dataset is constructed so
  the collapsed grain and downstream stat are known exactly.
- The corpus grows as siblings — Spearman, Mann-Whitney/Kruskal, paired-t (the
  classic `sleep` dataset), Fisher-exact — each a new `cases/` folder, zero
  harness changes.

## Provenance policy

For every published value the harness asserts, the case `NOTES` records both the
published figure (with citation) and an independent recompute with raw
scipy/pingouin run *outside* Iris's code path — so an assertion can never be a
tautology that merely re-confirms Iris's own output.

## Test integration

- **CI / pytest** — `test_validation.py` parametrizes over every folder in
  `cases/`; each runs the full `harness.validate(case)`. One `pytest
  engine/validation` run delivers all four jobs; each case is its own named test,
  so a failure names the case.
- **On demand** — `python -m validation.build [case|--all]` regenerates
  `artifacts/<case>.iris` and `artifacts/<case>.svg`. The `.iris` is what you hand
  a user or open in the app; the `.svg` is the human side of "look for yourself".
- `artifacts/` is gitignored.

## Out of scope (YAGNI)

- Pixel/perceptual image diffing.
- Committing binary `.iris` files.
- Exhaustive test-matrix coverage (every test variant × every geom) — the corpus
  is built to grow, but v1 is one case per family.
- Frontend/UI involvement — this is entirely a headless engine concern.
