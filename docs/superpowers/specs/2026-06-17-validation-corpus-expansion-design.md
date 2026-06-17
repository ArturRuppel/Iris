# Validation Corpus Expansion — Closing the Per-Test Coverage Matrix

*Design spec — 2026-06-17*

## Format in flux (read first)

The engine is **dropping the test-selection/recommendation idea** (change in
progress as of this writing). Iris is *not* an authority on which test is correct;
**the user picks the test**, and the engine's job is to run the test it was given
and report it faithfully. Consequences for this spec and the whole corpus:

- There is no more "inferred vs. overridden" axis. Every case's spec simply
  **names the test it wants**; the corpus asserts that test is executed correctly.
- The `.iris` JSON (the `AnalysisSpec` `stats` block) and the engine's stats
  *result* shape are changing. Field names below — `chosen_by`, `decision`,
  `recommendation`, and possibly the `expected_model` bucket itself — **are
  provisional** and must be reconciled with the final format before
  implementation. Treat every `spec.stats` / `expected_model` snippet here as
  intent, not literal keys.
- **The v1 cases need the same adaptation.** `iris-petal-correlation`,
  `iris-species-comparison`, `iris-species-anova`, and `contingency-2x2` all
  currently assert `expected_model.chosen_by` (`"inferred"` / `"user_override"`)
  and rely on the engine *inferring* a test. Once selection is gone those
  assertions are meaningless and must be rewritten to "the named test ran
  correctly." That cleanup is a prerequisite for, and should land alongside, this
  expansion — see *Follow-on*.

The corpus's job therefore **narrows**: from "guard that Iris selects the right
test" to "guard that Iris computes the user-specified test correctly, and renders
it correctly." That is still four jobs (correctness, regression, demo, figure
structure) minus the selection-guarding one — which is no longer Iris's
responsibility to get right.

## Purpose

The v1 corpus ([validation-corpus-design](2026-06-17-validation-corpus-design.md))
landed one case per stat *family*. This spec adds the **sibling cases** so every
test `iris_engine/stats.py` can run has a case asserting its arithmetic against an
independently-recomputed reference.

Each case is a new `engine/validation/cases/<name>/` folder (`data.csv` +
`case.py`); the harness parametrizes over folders, so this is **zero harness
changes** — exactly the growth path the v1 spec was built for.

## Current coverage vs. the engine's test set

Every test `iris_engine/stats.py` can compute, and where it stands:

| Family | Test | Status (v1) |
|---|---|---|
| Correlation | `pearson` | ✅ iris-petal-correlation |
| | `spearman` | ❌ **gap** |
| Group comparison (2) | `welch_t` | ✅ iris-species-comparison |
| | `mann_whitney` | ❌ **gap** |
| | `paired_t` | ❌ **gap** — paired-alignment path untested |
| | `wilcoxon` | ❌ **gap** — paired-alignment path untested |
| Group comparison (≥3) | `one_way_anova` | ✅ iris-species-anova |
| | `kruskal` | ❌ **gap** |
| Contingency | `chi_square` | ✅ contingency-2x2 |
| | `fisher_exact` | ❌ **gap** |
| Descriptive | `descriptive` | ✅ iris-sepal-descriptive |
| Reduction | (pipeline) | ✅ reduction-collapse |

One engine surface remains entirely untested beyond the per-test arithmetic: the
**paired-alignment path** (`hierarchy.pairing` + `stats._paired_arrays`), which
aligns one value per unit across two conditions. With selection gone, the user
*chooses* `paired_t`/`wilcoxon`, but the engine still has to detect the pairing
unit and align the pairs correctly — real work worth guarding. The `sleep` cases
cover it.

## The six new cases

Provenance follows v1 policy: published reference + independent raw-scipy/pingouin
recompute in `NOTES`, except the two nonparametric group cases which are
**synthetic, exact by construction** (no clean published nonparametric statistic
exists; the reduction-collapse case set this precedent).

| Case | Dataset | Test (user-specified) | Geom | Ground truth |
|---|---|---|---|---|
| `iris-petal-spearman` | Fisher iris (150) | `spearman` | scatter + regression | published; recompute `scipy.stats.spearmanr` |
| `sleep-paired-t` | Cushny–Peebles "sleep" (10×2) | `paired_t` | box | published (Student 1908); recompute `pingouin.ttest(paired=True)` |
| `sleep-wilcoxon` | same sleep data | `wilcoxon` | box | recompute `pingouin.wilcoxon` |
| `mann-whitney` | synthetic two-group | `mann_whitney` | box | exact by construction; recompute `scipy.stats.mannwhitneyu` |
| `kruskal` | synthetic three-group | `kruskal` | box | exact by construction; recompute `scipy.stats.kruskal` + pingouin Dunn/MW |
| `fisher-exact-tea` | Fisher's lady-tasting-tea 2×2 | `fisher_exact` | tile | published (Fisher 1935); recompute `scipy.stats.fisher_exact` |

In every case the test is named in the spec (the user's choice). The
`expected_stats` bucket asserts the arithmetic; figure assertions are unchanged
from v1. The exact key that carries the chosen test in the new `stats` block is
TBD pending the format change — placeholders below assume something like
`spec.stats.test`.

### 1. `iris-petal-spearman` — the rank-correlation sibling

The Spearman counterpart to `iris-petal-correlation` on the same two columns
(petal length × petal width). Under the old model these two cases differed by
*selection* (engine inferred Spearman, the Pearson case overrode to Pearson); now
they are simply two user-chosen tests on the same data, and the corpus asserts
each computes correctly. Spearman is the natural choice here — the petal
relationship is monotonic but the columns are bimodal across species, so a rank
correlation is what a careful user would pick.

- `spec.stats`: names `spearman`.
- `expected_stats`: `{"test": "spearman", "r": (0.9376668, 1e-5), "p": ("<", 1e-60), "n": 150}`
  — recompute `scipy.stats.spearmanr(petal_length, petal_width)` → ρ=0.9376668,
  p=8.16e-70 (less extreme than the Pearson case's p, hence the looser bound).
- `expected_figure`: scatter + regression, `n_points: 150`, `point_groups: 1`,
  `annotation_contains: "r ="` (mirrors the Pearson case).

### 2 & 3. `sleep-paired-t` / `sleep-wilcoxon` — the paired-alignment path

The classic Cushny–Peebles sleep data (10 patients, two soporific drugs, extra
hours of sleep) — the dataset Student's 1908 paper used. Tidy `data.csv`:
`patient, drug, extra_sleep` (20 rows). The hierarchy detects `patient` as a unit
crossing both `drug` levels → `hierarchy.pairing` verdict `"paired"`, so when the
user picks a paired test the engine aligns pairs over `patient`.

- **Reference** (published / R `datasets::sleep`, recomputed raw):
  `t = 4.0621, df = 9, p = 0.002833, n = 10` pairs, `mean_diff = 1.58`.
- `sleep-paired-t` — spec names `paired_t`. Asserts `test: "paired_t"`, `t`,
  `df: 9`, `p`, `n: 10`, `mean_diff: (1.58, …)`, `effect.value` (Hedges' g). This
  is the **only** case exercising the paired-alignment path.
- `sleep-wilcoxon` — same data, spec names `wilcoxon` (the user's nonparametric
  paired choice). Asserts `test: "wilcoxon"`, `W`, `p` (≈0.0039), `n: 10`,
  `effect.value` (rank-biserial).
- `expected_figure` (both): box, `y` axis label `extra sleep`, `xtick_labels`
  the two drug labels, `point_groups: 0`.

> Confirm during authoring how the pairing unit (`patient`) reaches
> `hierarchy.pairing` — it is derived from the data hierarchy / spine, not declared
> in `stats`. The build step (`document._infer_schema` + hierarchy) should detect
> it from the tidy table; if a `SCHEMA_OVERRIDES` or explicit unit declaration is
> required, the case sets it.

**Paired test on unpaired data — no silent fallback (decided).** If the user picks
`paired_t`/`wilcoxon` but the data has no detectable pairing, the engine must *not*
quietly run something else. It surfaces a **warning** (a UI dialogue) and lets the
user decide:

- **Accept** → run the paired test as requested anyway (the user owns the choice).
- **Decline** → the engine *suggests* an alternative test and the user selects it;
  the engine never picks silently.

The warning, not a fallback result, is the contract — so the engine must emit it
as a structured `issue` from `_run` (the headless surface the corpus can see; the
dialogue is the UI rendering of that issue). The `sleep` cases above run on
*correctly* paired data and assert the clean paired result. A **separate guard**
should cover the unpaired branch: same `paired_t` spec on a deliberately-unpaired
dataset, asserting the engine emits the pairing warning issue (and does *not*
return a silently-substituted test). Whether that lives as a new validation case
(`paired-on-unpaired`) or an engine unit test is an authoring call; the corpus is
the natural home since it drives the real `_run` path end to end.

### 4. `mann-whitney` — nonparametric two-group

Synthetic: two small groups (e.g. n≈12 each), values fixed literals in `data.csv`
(`group, value`) so the statistic is exact by construction. With selection gone,
the data no longer has to *force* a robust inference — the user simply picks
`mann_whitney`; the dataset just needs to make the U statistic a clean, citable
recompute.

- `spec.stats`: names `mann_whitney`.
- `expected_stats`: `test: "mann_whitney"`, `U`, `p`, `effect.value`
  (rank-biserial), per-group `summaries.*.n` — recompute
  `scipy.stats.mannwhitneyu(a, b, alternative="two-sided")`.
- `SOURCE = "synthetic — known by construction; recomputed scipy"`.

### 5. `kruskal` — nonparametric multi-group + Dunn pairwise

Synthetic three-group analogue of `iris-species-anova`; the user picks `kruskal`,
which runs the omnibus plus its Holm-adjusted pairwise contrasts (the sibling the
ANOVA case's NOTES references).

- `spec.stats`: names `kruskal`.
- `expected_stats`: `test: "kruskal"`, `H`, `df`, `p`, `n`, `k: 3`,
  `correction` (Holm), and `pairwise.{0,1,2}.stars` — recompute
  `scipy.stats.kruskal` for the omnibus and pingouin pairwise MW for the contrasts.
- `expected_figure`: box, three `xtick_labels`, stacked brackets present.

### 6. `fisher-exact-tea` — small-count contingency

Fisher's lady-tasting-tea 2×2 — the inverse of `contingency-2x2`'s large table: a
user analyzing tiny counts picks Fisher's exact test. Reviewable source is the
cited count matrix; tidy `data.csv` generated by a `regenerate_data()` (mirrors
`contingency-2x2`).

- `CELLS`: guessed × actual milk-first, `[[3,1],[1,3]]`, n=8.
- `spec.stats`: names `fisher_exact`.
- `expected_stats`: `test: "fisher_exact"`, `p` (recompute
  `scipy.stats.fisher_exact([[3,1],[1,3]])` → two-sided p = 0.4857), `n: 8`,
  `effect.value`.
- `SOURCE`: Fisher, *The Design of Experiments* (1935). `NOTES` records both
  Fisher's hand-computed one-sided p (0.2429) and the engine/scipy two-sided value
  so the assertion is unambiguous about which tail the engine reports.

## Decisions locked

- **Scope:** all six gaps in one batch (full per-test matrix closure).
- **Selection is the user's, not Iris's.** Cases name the test; the corpus guards
  execution + figure, not selection. (Drove the rewrite above.)
- **No silent fallbacks.** When the user picks a test the data can't structurally
  support (e.g. `paired_t` with no detectable pairing), the engine warns and the
  user decides — accept and run it anyway, or have the engine *suggest* an
  alternative the user then selects. The engine never substitutes a test on its
  own. Guarded by a `paired_t`-on-unpaired-data case asserting the warning issue.
- **Nonparametric two/multi-group datasets:** synthetic, exact by construction —
  no published nonparametric statistic is sourced; provenance is "known by
  construction" with a raw-scipy recompute, per the reduction-collapse precedent.
- Published ground truth is used wherever it exists cleanly (iris-Spearman,
  sleep, tea).

## Out of scope (unchanged from v1)

- Pixel/perceptual image diffing; committing binary `.iris`; frontend/UI; any
  harness or `svgstruct` changes. If a new figure structural fact is genuinely
  needed (e.g. paired-line geom), it is a separate, justified `svgstruct` addition
  — not assumed here.

## Follow-on (lands with this work)

- **Adapt the v1 cases to the new format** — strip `chosen_by` / inference
  assertions from `iris-petal-correlation`, `iris-species-comparison`,
  `iris-species-anova`, `contingency-2x2`; reframe each as "user-specified test,
  computed correctly." This is a prerequisite, not optional cleanup.
- Update `engine/validation/README.md`: drop the test-selection note (the
  Spearman/Pearson caveat dissolves — both are now plain user choices), refresh the
  "Current cases" table and the `expected_model` description to match the new
  result shape.
- Reconcile the provisional `spec.stats` / `expected_stats` keys above with the
  final JSON format once the in-progress code change lands.
