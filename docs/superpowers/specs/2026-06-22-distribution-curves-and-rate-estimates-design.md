# Grouped potential/distribution curves & rate-estimate (count-regression) plots — design

Covers TODO items **P** and **Q**. Adds first-class support for two plot types the
COV2D NLS-subpopulation report (§5) had to hand-build in matplotlib, so they become
ordinary editable `.iris` documents:

1. **P — grouped distribution / "potential" curves.** Overlay one binned density
   curve per group (color), with shared bins, and — for the Boltzmann "potential"
   render — annotate the effective barrier ΔE = U(0) − U_min and mark the wells.
2. **Q — rate / count-regression estimates.** Per categorical group, fit a
   Poisson / negative-binomial GLM to per-replicate counts with an exposure offset,
   and render each group's rate estimate as a point with a model-derived CI bar.

Each ships with a new **example-gallery** case (P: a double-well potential; Q: a
per-group event rate with CIs).

Date: 2026-06-22.

Motivating consumer: `reports/2026-06-21_COV2D-NLS-subpopulation/report.ipynb`, §5.
- §5a draws four T1 **potential landscapes** U(L) = −ln P(L) by contact-transition
  type with an annotated barrier — currently matplotlib (`t1_landscape_by_type.svg`).
- §5b draws per-type **T1 rates** from a negative-binomial GLM (per-field counts,
  offset = log-hours) with 95 % CI bars — currently matplotlib + statsmodels in the
  notebook (`t1_rate_by_type.svg`).
Both are general idioms (any reaction-coordinate potential; any per-group event rate
with exposure), not COV2D-specific.

---

## Part P — grouped distribution / potential curves

### What already exists — do NOT rebuild

The `distribution` geom (descriptive family) already does most of this:

- `dist_render` includes **`"potential"`** (`style.py:204-205`); `_draw_distribution`
  (`compiler.py:1488-1531`) Boltzmann-inverts the histogram:
  `u = -np.log(counts[occ] / counts.sum())` and plots `centers[occ]` vs `u` as a
  line+markers, with the y-label auto-set to **"−ln P"** in `build_histogram_figure`
  (`compiler.py:1546`).
- `bin_method` includes **`"sinh"`** (`style.py:206-207`) with `bin_sharpness`
  (`style.py:212-214`); `_sinh_bin_edges` (`compiler.py:1436-1455`) gives the
  adaptive bins (tighter near zero) the reaction-coordinate potential wants — the
  engine analogue of CellFlow's `adaptive_bin_edges`.
- **Faceting already works**: `build_histogram_figure` (`compiler.py:1534-1591`)
  draws one cell per (row × col) facet level. So §5a's "four panels by transition
  type" is *already* expressible as `facet.col = transition_type` — the only reason
  the report used matplotlib is the two gaps below.

So Part P is an **extension of the existing `distribution` geom**, not a new geom.

### Gap P1 — group by `color` (overlaid curves, shared bins)

Today `_draw_distribution` takes the pooled `vals` and uses a single
`color = _group_color(style, 0)` — it ignores any `color` encoding, so you cannot
overlay one curve per group in a single panel (only facet into separate panels).

- `statmodel.infer` (`statmodel.py:129-132`, the `descriptive` branch): keep `x:
  None`, `y: numeric`, but allow a **`color` (categorical) encoding** to declare the
  grouping factor. Carry the color column on the model (`group: color_col`).
- `build_histogram_figure` (`compiler.py:1534`): when a color group is present, split
  the cell's rows by the color column and call a grouped variant of
  `_draw_distribution` once per level, each with that level's palette color
  (`_group_color(style, i)`); emit a legend (reuse the existing
  `Scales.legend_entries` / `_draw_legend` path used by the comparison families).
- **Shared bins across groups _and_ facets** (new): compute one bin-edge array from
  the **pooled** in-scope values (all groups, all facet cells) once, and pass it to
  every `_draw_distribution` call, so curves are directly comparable. Add a helper
  `_shared_dist_bins(df, y, gs, facet/group scope)` that wraps `_resolve_dist_bins`
  on the pooled values; per-cell independent bins remain the default only when no
  grouping/faceting is active (preserves current single-panel behaviour). For
  `sinh`, share a **symmetric** range `[-m, m]`, `m = max(|lo|, |hi|)` over the
  pooled values (matches the report's symmetric reaction-coordinate convention).

The `potential` math is per-group/per-cell as today (each curve inverts its own
counts over the shared edges), so a grouped potential plot draws one double-well per
group on common axes — exactly §5a, but in one panel when grouped by color (or N
panels when faceted, now with shared bins).

### Gap P2 — barrier (ΔE) annotation for the potential render

A `potential`-specific annotation (meaningless for bars/step/line). Opt-in style
knob, gated to the potential render:

- `style.py` (distribution geom group): `show_barrier` (bool, default **off**,
  `visible_when` `dist_render == "potential"`), `transferable: true` (a display
  preference, like `show_all_levels` from item M).
- New `compiler._annotate_potential_barrier(ax, centers, u, color, style)`:
  - Mark the two **wells** (the minima of U on each side of the central reference,
    default 0) with a filled marker (matches the report's well dots).
  - Compute the **effective barrier** ΔE = U(reference) − min(U) using the same
    definition as CellFlow's `effective_barrier` (interpolate U at the reference,
    subtract the global/within-side minimum; skip with a describe-note if the
    reference is not bracketed by occupied bins).
  - Label `ΔE = {value:.2f} kT` near the top of the curve, in the curve's color
    (one per group when grouped).
  - The reference defaults to 0; reuse the **existing `reference_value` knob** from
    item N so the four-fold-vertex line (x = 0) and the barrier share one control.
- Wire it into `build_histogram_figure` after `_draw_distribution` when
  `dist_render == "potential"` and `show_barrier` is on, per group/cell.

### Gap P3 — sinh range symmetry (small)

`_sinh_bin_edges` currently spans `[min(vals), max(vals)]` (`compiler.py:1467-1472`).
When sharing bins for a signed reaction coordinate the range should be symmetric
about the reference. Fold this into `_shared_dist_bins` (Gap P1), not into
`_sinh_bin_edges` (keep that primitive range-faithful); the symmetric choice is a
property of the shared-scope binning, not of sinh itself.

---

## Part Q — rate / count-regression estimates

A genuinely new family + render path. This is the count analogue of `location`:
per group, estimate a rate from counts (not a mean from values), and draw the
estimate with a model CI.

### Dependency

Add **`statsmodels>=0.14`** to `engine/pyproject.toml` (`dependencies`,
`pyproject.toml:26-34`). It is the standard, well-tested Poisson/NB GLM
implementation; scipy/pingouin have no offset-GLM. This is the one new third-party
dependency; isolate the import inside `stats.rate` so the rest of the engine never
pays for it.

### Declaration

Opt-in via explicit `stats.family`, exactly like `location` (`statmodel.py:82-105`):

```json
"encodings": { "x": {"column": "transition_type"}, "y": {"column": "count"} },
"stats": {
  "family": "rate",
  "exposure": "hours",          // offset column (log-exposure); omit -> exposure = 1
  "model": "nb",                // "nb" (default, overdispersed) | "poisson" | "auto"
  "alpha": 0.05
}
```

- `x` = categorical group, `y` = integer **count** per replicate, `stats.exposure` =
  a numeric per-row exposure column (hours, area, cell-count). With no spine the rows
  are the replicates; with a spine the engine's materialized inferential grain feeds
  the GLM (counts and exposures summed to the unit), same machinery as
  `group_comparison`/`location` (`render.py:120-153`).
- `specnorm._norm_stats` (`specnorm.py:61-71`): preserve `family == "rate"`,
  `exposure`, and default `model` to `"nb"`.
- `statmodel.infer`: add a `declared_family == "rate"` branch returning
  `{"family": "rate", "factors": [...], "exposure": ..., "model": ..., ...}`,
  reading the group factor for either orientation (mirror the `location` branch).

### `stats.rate(df, group, count, *, exposure, levels, model, alpha, ...)`

New function in `stats.py`, structured like `location` (`stats.py:422-567`):

- Per level: fit `count ~ 1` with `offset = log(exposure)` via
  `statsmodels.discrete.discrete_model` (NB) / `GLM(family=Poisson())` (Poisson).
  `model == "auto"` fits Poisson, tests overdispersion (Pearson χ²/df), and refits
  NB if overdispersed (state the choice in `methods_text`).
  - rate = `exp(intercept)`; 95 % CI = `exp(intercept ± z·SE)` — the morphogenesis
    recipe (`fig6.py`).
  - `n` = number of units in the group; carry the summed count + exposure.
- **Global "does group matter" test**: a likelihood-ratio test of `count ~ C(group)`
  (offset log-exposure) vs `count ~ 1`, χ² on the model df difference → put in
  `decision`/`methods_text` (the single p the §5b prose cites).
- Return a superset of the location/`group_comparison` contract so `_caption` and
  StatsPanel keep working:

```python
{
  "family": "rate", "model": "nb"|"poisson", "exposure": exposure_col,
  "levels": found,
  "per_group": [{"level": lv, "rate": r, "ci": [lo, hi], "n": n,
                 "count": k, "exposure": e}, ...],
  "decision": {...},                 # the global LR test + chosen model
  "result": {"test": "nb_glm"|"poisson_glm", "p": <global LR p>, ...},
  "summaries": [...],                # per-group rate as mean-shaped dicts for readers
  "alpha": alpha,
  "methods_text": "..."             # model, offset, per-group CI, global LR
}
```

### Rendering — a `pointrange` geom fed by the model

The estimate comes from the GLM, not from raw-value summaries, so the existing
`summary` geom (which reads `_summary`'s value-based CI, `stats.py:570-576`) cannot
be reused directly. Add a thin geom:

- `geoms.py`: `"pointrange": GeomDef("Estimate ± CI", "group_comparison", True,
  ["x", "y"], x_type="categorical", y_type="numeric", h_orient=True, aes=["color"])`.
  Family `group_comparison` so it flows through `build_comparison_figure`
  (`compiler.py:~1037`), like `summary`.
- `compiler._geom_pointrange(ax, ctx, layer)`: when `stats.family == "rate"`, read
  `ctx["stats"]["per_group"]` and draw, per lane, a point at `rate` with an
  **asymmetric** error bar to `[lo, hi]` (the model CI), colored by group; honor
  `h_orient`. Reuse `_err_*`/`errorbar` styling from `_geom_summary`
  (`compiler.py:1016-1034`) for capsize/линеwidth. When `stats.family` is not `rate`
  (a plain pointrange on raw data), fall back to `_summary`-style mean ± CI so the
  geom is also usable standalone.
- `build_comparison_figure` family dispatch (the same site that chose brackets vs
  `_draw_location_significance`, `compiler.py:~1053-1076`): for `rate`, skip
  significance brackets (the inference is the global LR + the visible CIs); optionally
  surface the global-LR star above the panel (reuse the omnibus-label slot).
- y-axis label defaults to `rate ({y} / {exposure})` when unset.
- **Optional (flag, not v1-required):** allow a `dot` layer to overlay the per-unit
  observed rate (count/exposure) so the plot is a rate SuperPlot; needs the family to
  expose a per-row `count/exposure` column the dot geom can read. Defer unless asked.

---

## Frontend (optional, later — not required for the consumers)

Engine-first is enough to author both `.iris` files by hand in the report notebook
(the analysis JSON is written directly, as §1–§3 already do). Discoverability in the
Iris app is a later pass:

- Part P: `dist_render="potential"`, `bin_method="sinh"`, `bin_sharpness`,
  `show_barrier`, and `reference_value` already render generically in StylePane (the
  registry is the source of truth — item C). The only new FE surface is letting a
  descriptive plot bind a **`color`** encoding (EncodingsCard already supports color;
  the change is not blocking it for the descriptive family).
- Part Q: a `stats.family = "rate"` + `exposure` picker in the guided test-picker
  (`2026-06-17-guided-test-picker-ui-design.md`); the `pointrange` geom appears in the
  add menu automatically once registered. Out of scope here.

---

## Example-gallery cases (one per type)

Gallery cases are validation cases listed in `GALLERY_CASES`
(`engine/validation/export_gallery.py:24-84`), each a
`engine/validation/cases/<name>/` dir with `case.py` (TITLE/SOURCE/ANALYSES) +
`data.csv`, exported to `src/examples/assets/` + `manifest.json` by
`python -m validation.export_gallery`.

- **P — `potential-double-well`**: a signed reaction-coordinate column with a clear
  double-well (a two-lobed synthetic distribution, or a downsampled COV2D-like
  signed-length sample) grouped by a 2-level category; spec uses
  `dist_render="potential"`, `bin_method="sinh"`, `show_barrier=true`,
  `reference_value=0`. Descriptive family → no inferential `expected_stats`; the
  case validates the render (one curve per group, a barrier label, the sinh bins).
- **Q — `event-rate-by-group`**: a tidy `(group, replicate, count, exposure)` table
  (e.g. 3–4 groups × several replicates) with a known per-group rate; spec declares
  `stats.family="rate"`, `exposure`, `model="nb"`, a `pointrange` layer.
  `expected_stats` recomputes each group's NB-GLM rate + CI and the global LR p
  **independently against statsmodels** (the one-case-per-family convention; this is
  the first case needing statsmodels in the harness).

Both added to `GALLERY_CASES`; manifest regenerated.

---

## Testing

- **`test_stats.py`** — `rate` on synthetic counts with a known per-group rate and
  exposure: assert the rate, the CI matches a direct statsmodels fit, the global LR
  p, and the spine path (counts summed to the inferential unit, n = replicates not
  raw rows). Include a Poisson vs NB `model` pin and the `model="auto"` overdispersion
  switch.
- **`test_aesthetics.py` / render-level** —
  - P: a grouped `distribution`/`potential` spec renders one curve per color level on
    shared bins, with a barrier label per group when `show_barrier` is on; faceted
    potential shares bins across cells; the `reference not bracketed` case skips the
    label cleanly.
  - Q: a `rate` spec renders a `pointrange` per lane with the model CI (asymmetric),
    no significance brackets, y-label = `rate (...)`; horizontal orientation works.
- **`specnorm`/`statmodel`** — `stats.family` ∈ {`rate`} + `exposure`/`model` survive
  normalization; `infer` returns the right family; a descriptive plot WITHOUT a color
  encoding still renders single-curve (no regression); a cat/numeric plot WITHOUT
  `family="rate"` still infers `group_comparison`.
- **Validation corpus** — the two gallery cases double as validation cases (P render
  facts; Q stats recomputed against statsmodels).
- Full engine + FE suites green; typecheck + build clean.

---

## The consumer changes (separate, after this ships)

In the report §5, replace the two matplotlib builders with `.iris` documents:
- §5a: a grouped `distribution` `.iris` (`dist_render="potential"`,
  `bin_method="sinh"`, `show_barrier`, color/facet = transition type), reading the
  precomputed signed-length tidy table.
- §5b: a `rate` `.iris` (`stats.family="rate"`, `exposure="hours"`, `pointrange`),
  reading a precomputed `(transition_type, field, count, hours)` table.
Both then render via the engine like §1–§3, removing the bespoke matplotlib +
in-notebook statsmodels path. Tracked under items P/Q; not part of the engine work.

---

## Critical files

- `engine/iris_engine/geoms.py` — register `pointrange` (Q); `distribution` unchanged
  (P extends its render).
- `engine/iris_engine/style.py` — `show_barrier` knob (P, gated to potential);
  pointrange capsize/error knobs (Q).
- `engine/iris_engine/compiler.py` — grouped + shared-bin `_draw_distribution` and
  `_annotate_potential_barrier` (P, in `build_histogram_figure`); `_geom_pointrange`
  + rate dispatch in `build_comparison_figure` (Q); reuse `_sinh_bin_edges`,
  `_resolve_dist_bins`, `reference_value`/`_draw_reference_line` (item N),
  `_err_*`/`_geom_summary` styling.
- `engine/iris_engine/stats.py` — new `rate()` (Q); reuse `_summary`, `_fmt_p`,
  `_p_stars`.
- `engine/iris_engine/statmodel.py` — color-group on the descriptive model (P);
  `declared_family == "rate"` branch carrying `exposure`/`model` (Q).
- `engine/iris_engine/render.py` — `rate` dispatch (Q); pass the color group through
  the descriptive path (P).
- `engine/iris_engine/specnorm.py` — preserve `family`/`exposure`/`model` (Q).
- `engine/pyproject.toml` — add `statsmodels>=0.14` (Q).
- `engine/validation/cases/potential-double-well/`, `.../event-rate-by-group/`,
  `engine/validation/export_gallery.py` (`GALLERY_CASES`) — the two gallery cases.
- Tests: `engine/tests/test_stats.py`, `engine/tests/test_aesthetics.py`,
  `engine/validation/`.

## Scope notes

- Part P reuses the existing `distribution`/`potential`/`sinh` machinery; the new
  pieces are color-grouping, shared bins, and the barrier annotation — no new geom.
- Part Q is the count analogue of `location`: opt-in family, GLM with exposure
  offset, estimate ± model CI via a small `pointrange` geom; NB default for
  overdispersion, Poisson/auto selectable.
- No automatic multiple-comparison correction for the per-group rate CIs (state the
  global LR test + group count in `methods_text`), matching the `location` precedent.
- The observed-rate `dot` overlay (rate SuperPlot) is deferred unless requested.
- `statsmodels` is imported lazily inside `stats.rate` so only the rate family loads it.
