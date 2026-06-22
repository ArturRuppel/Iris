# One-sample (vs-reference) test family & reference-line annotation — design

Covers TODO item **N**. Adds two general capabilities the engine lacks today:

1. A **`location` (one-sample) stat family** — test each group's central value
   against a constant reference (default 0), rather than against another group.
2. A **reference-line annotation** — a configurable horizontal/vertical line at a
   value (chance, control level, unity), with per-group significance markers
   placed against it instead of lane-to-lane brackets.

They ship together because the one-sample test is only legible with the line: the
reader needs to see the reference the test is run against.

Date: 2026-06-22.

Motivating consumer: the COV2D NLS-subpopulation report's "do same-label cells
cluster?" figure (§3). Per contact type (VimKO–VimKO, VimKO–NLS, NLS–NLS) it asks
whether log₂(observed/expected) contact enrichment differs from **chance** (0).
That figure is currently hand-built in matplotlib
(`reports/2026-06-21_COV2D-NLS-subpopulation/report.ipynb`, `clustering_figure`)
because Iris can't express it. This makes it a normal editable `.iris`.

---

## Why one-sample is the correct design (not a workaround)

The three contact fractions sum to 1, so homotypic and heterotypic enrichment are
**not independent** — if same-label is enriched, opposite-label is mechanically
depleted. A "homotypic vs heterotypic" `group_comparison` (which already fits
Iris) is therefore partly tautological. The honest question is each group against
its **own** null (the permutation/analytic null that produced the enrichment) =
one-sample vs a reference. This is a general statistical design (any "is this Δ /
ratio / enrichment ≠ baseline?" question), not specific to contacts.

## What already fits today — do NOT rebuild

The figure shape is an ordinary SuperPlot and needs no new plotting primitives:

- **Categorical x, numeric y, `violin`/`dot` geoms** — standard.
- **The spine/level hierarchy** that draws the big per-replicate dots
  (`hierarchy.materialize_levels`, `coarsest_level`, `resolve_level` in
  `render.py:120-153`) — the one-sample test reuses it verbatim, so the inferential
  unit is the replicate, exactly as in `group_comparison`.
- **The per-position enrichment *value* is a domain reduction the caller
  precomputes** into a tidy column (like `per_cell_values` in the report). Iris
  consumes a tidy table; it does not compute enrichment. The `.iris` table is
  `(experiment_id, position_id, contact_type, value=log2_enrichment)`.

The two gaps below are the entire scope.

---

## A. The `location` stat family

### Trigger / declaration

`statmodel.infer` (`statmodel.py:74`) currently derives the family from column
kinds: categorical-x + numeric-y → `group_comparison`. We must NOT silently
reroute that — most categorical/numeric plots are genuine group comparisons. So
`location` is **opt-in via an explicit `stats.family`**, mirroring how a geom's
declared family is already authoritative for `timeseries`
(`statmodel.py:29-35`, `_is_timeseries`).

Spec shape (in the `.iris` analysis JSON):

```json
"stats": {
  "family": "location",
  "reference": 0.0,
  "test": "one_sample_t",        // optional override; else recommended
  "alpha": 0.05,
  "report": ["effect_size", "ci", "n_per_group"]
}
```

`statmodel.infer` change: before the kind-based dispatch, honor an explicit
`encodings`-independent `stats.family == "location"`. Read the grouping factor the
same way `group_comparison` does (x for vertical, y for horizontal — `statmodel`
already handles both orientations). Design text:
`"location of {y} per group of {x} vs reference {reference}"`; keep the
"n counts independent units" note when a unit/spine is declared. `reference`
travels on the returned model so `render`/`compiler` can read it.

`specnorm.py`: `stats.family` and `stats.reference` must survive normalization.
Line 35 already special-cases `stats.family == "descriptive"`; generalize so any
declared family is preserved, and thread `reference` (default `0.0`) through.
`_override_of` (`specnorm.py:124`) already carries `stats.override` for the test
pin — reused unchanged.

### `stats.location(df, x, y, levels, *, reference=0.0, alpha, override, pairing)`

New function in `stats.py`, structured like `group_comparison` (`stats.py:230`):

- Receives the **materialized inferential-grain table** (`stat_df` from
  `render.py:153`) — one row per replicate per group — exactly as
  `group_comparison` does. The per-group values tested are therefore the
  per-replicate summaries, not raw cells. With no spine it degrades to raw rows
  (same as the rest of the engine).
- For each level in `levels` (or a single unnamed group when `x is None`):
  - `diff = values - reference`.
  - **Recommendation:** Shapiro–Wilk on `diff` (reuse `shapiro_check`,
    `stats.py:45`) → parametric `one_sample_t` vs robust `wilcoxon_signed`.
  - **Parametric (`one_sample_t`):** `pg.ttest(values, reference)` → t, df, p;
    effect size **Cohen's dz** = `mean(diff)/sd(diff)`; mean(diff) + 95% CI.
  - **Robust (`wilcoxon_signed`):** one-sample Wilcoxon of `diff` vs 0
    (`pg.wilcoxon(diff)`); rank-biserial r; median(diff) + CI where available.
  - `n` = number of units (replicates) in that group.
- `override` pins the test for all groups (one pin, applied per group — same model
  as `group_comparison`).

Return shape (a superset of the `group_comparison` contract so existing readers —
caption `_caption`, StatsPanel — keep working):

```python
{
  "family": "location",
  "reference": reference,
  "levels": found,
  "checks": [...],                 # per-group shapiro
  "recommendation": {"test": ..., "reason": ...},
  "decision": {...},
  "chosen_by": "recommendation_accepted",
  "per_group": [                   # NEW: one entry per group
    {"level": lv, "test": ..., "p": ..., "stars": ...,
     "effect": {"name": "cohens_dz"|"rank_biserial", "value": ..., "ci": ...},
     "n": ..., "center": ..., "center_ci": [...]} , ...
  ],
  "result": {...},                 # the single-group result, or the pooled/first
                                   # group, so two-group-style readers don't break
  "summaries": [...],              # per-group mean ± CI for the plot (as today)
  "alpha": alpha,
  "methods_text": "...",           # "<y> in <group> was tested against <ref> using
                                   #  a one-sample t-test: t(df)=…, p=…; dz=…;
                                   #  mean difference … (95% CI …). [×N groups]"
}
```

The multiple-comparison footnote (N groups × one test each) goes in
`methods_text`; no automatic α adjustment in v1 (groups are usually few and the
nulls are independent), but state the count so the reader can judge.

### `render.py` dispatch

Add an `elif family == "location":` branch alongside `group_comparison`
(`render.py:105`). It reuses the **same** block that materializes levels, resolves
the inferential level, and computes pairing (`render.py:120-153`) — factor those
shared lines so both families call them — then:

```python
res = memo(lambda: stats.location(
    stat_df, cat_col, val_col,
    levels=cat_schema.get("levels", []),
    reference=model.get("reference", 0.0),
    alpha=alpha, override=override, pairing=model["pairing"]))
```

`describe_only`/faceted paths fall back to `describe_groups` as group_comparison
does (no test), so faceting stays consistent.

### `guards.py`

Add a per-group minimum-n guard (reuse the `MIN_BOX_N`/`guards.py:19` pattern): a
one-sample test needs ≥3 units per group; below that, warn (not block) that the
location test is underpowered — mirrors the existing box/violin small-n warning.

---

## B. Reference-line annotation

A general annotation, independent of the `location` family (any plot may want a
chance/threshold/control line).

### Declaration & style

Add registry knobs in `style.py` (the annotations group, near `show_n`):

- `reference_value` (number, `auto`/unset = off).
- `reference_label` (text, e.g. "chance"; optional).
- `reference_line_style` (select: dashed/solid/dotted; default dashed).

`transferable: true` (a display preference, like `show_all_levels` from item M).
The `location` family sets `reference_value` to its `reference` by default when
the knob is unset, so authoring the test also draws the line; the user can still
override or hide it.

### Drawing — `compiler.py`

New `_draw_reference_line(ax, value, label, horizontal, style)`:

- Vertical plot (value on Y): `ax.axhline(value, ...)`; horizontal: `ax.axvline`.
- Faint INK-grey dashed by default (match the `#94a3b8` used by
  `_draw_n_labels`), `zorder` below the marks.
- Optional right-/top-aligned label.
- Log-axis guard: if the value axis is log and `value <= 0`, skip + emit a
  describe-level note (can't draw 0 on a log axis; the COV2D figure uses a
  **linear** log₂-enrichment axis where 0 = chance, so this is fine there).

### Per-group significance markers — `compiler.py`

The existing `_draw_significance` (`compiler.py:149`) draws **brackets between
lanes** and is wrong for one-sample. Add `_draw_location_significance(ax, res,
levels, horizontal, style)`:

- Read `res["per_group"]`; for each level, place its `stars` just above that
  lane's drawn data (anchor per group via a per-lane variant of
  `_drawn_value_max`, or a shared top), centered on the lane position.
- No brackets, no axis-spanning arches — a compact star per lane.
- `build_comparison_figure` (`compiler.py:~1053`) dispatches to brackets for
  `group_comparison`/multi-group and to this for `location`.

---

## Frontend (optional, later — not required for the consumer)

Engine-first is enough to author the §3 `.iris` by hand in the report notebook
(the analysis JSON is written directly, as §1–§2 already do). To make the feature
discoverable in the Iris app, a later pass adds to the guided test picker
(`2026-06-17-guided-test-picker-ui-design.md`): a "compare to a reference value"
design option + a numeric reference field, and the reference-line knobs already
render generically in StylePane's Annotations section (no bespoke FE code, like
item M's `show_all_levels`). Out of scope for this spec's first cut.

---

## Testing

- **`test_stats.py`** — `location` on synthetic data with a known per-group mean
  offset from the reference: assert the recommended test, the sign, and that
  `dz`/p match a direct scipy `ttest_1samp` / `wilcoxon`. Include a group centered
  exactly on the reference (p≈1) and the spine path (per-replicate grain → n =
  replicates, not raw rows).
- **Validation corpus** (`engine/validation/`, per
  `2026-06-17-validation-corpus-design.md`) — one `location` case with reference
  values independently recomputed against raw scipy, matching the one-case-per-
  family convention.
- **`test_aesthetics.py` / render-level** — a `location` spec renders one
  reference line at the declared value and one star per lane (not brackets); the
  log-axis `value<=0` guard skips cleanly.
- **`specnorm`/`statmodel`** — `stats.family == "location"` + `reference` survive
  normalization and `infer` returns `family == "location"` with the reference on
  the model; a categorical/numeric plot WITHOUT the explicit family still infers
  `group_comparison` (no regression).
- Full engine + FE suites green; typecheck + build clean.

## The consumer change (separate, after this ships)

In the report, replace `clustering_figure` with: precompute the per-position
log₂(observed/expected) tidy table, `write_*` an `.iris` declaring
`stats.family = "location"`, `reference = 0`, the three contact-type levels,
`violin` + per-position `dot` + per-replicate `dot` layers (spine
`experiment_id→position_id`, aggregate dot bound at `experiment_id`), and let the
engine draw the chance line + per-lane stars. The replicate-level numbers the
prose cites come from the same `.iris` render, removing the bespoke matplotlib
path. Tracked in TODO item N; not part of the engine work itself.

## Critical files

- `engine/iris_engine/stats.py` — new `location()` (+ reuse `shapiro_check`,
  `_summary`, `_fmt_p`, `_p_stars`).
- `engine/iris_engine/statmodel.py` — honor explicit `stats.family == "location"`;
  carry `reference`.
- `engine/iris_engine/render.py` — `location` dispatch; factor the shared
  level-materialization block out of the `group_comparison` branch.
- `engine/iris_engine/specnorm.py` — preserve `stats.family`/`stats.reference`.
- `engine/iris_engine/compiler.py` — `_draw_reference_line`,
  `_draw_location_significance`, and the family dispatch in
  `build_comparison_figure`.
- `engine/iris_engine/style.py` — `reference_value`/`reference_label`/
  `reference_line_style` registry knobs.
- `engine/iris_engine/guards.py` — per-group min-n warning.
- Tests: `engine/tests/test_stats.py`, `engine/validation/`,
  `engine/tests/test_aesthetics.py`.

## Scope notes

- No automatic multiple-comparison correction in v1 (state the test count in
  `methods_text`).
- Reference line is a standalone annotation usable by any family; the `location`
  family just defaults it on.
- Paired/two-sample designs are untouched; `location` is additive.
