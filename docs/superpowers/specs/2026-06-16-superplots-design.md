# Composable grammar of graphics — Phase 5: Superplots

*Status: shipped 16 June 2026. Spec stays at 2.0 (the new fields fit the 2.0
seams — no version bump). Follows Phase 4 (Facets).*

## The problem

A repetition key already ships the *statistical* half of "n = independent
units" (TODO item 10, `stats.repetition_key` → `stats._aggregate_reps`): when
set, technical replicates are averaged to one value per unit before the test, so
n, the recommended test, the summaries, and bar/summary error bars all count
units. But on box / violin / dot the figure still draws the raw replicates, so
the only visible change is a small `n =` label — which reads as "n does
nothing." The conclusive fix is the **superplot** rendering pattern (Lord et al.
2020): show the same measurement at several collapse levels at once — raw
replicates (de-emphasized), one prominent mark per independent unit, and the
group summary — so the inference basis is literally "count the big marks."

## The mechanism: a layer-level summary stat (NOT a reduce step)

Superplots are a **visual transform**, not a data transform. The distinction is
load-bearing: a `reduce.collapse` step changes what a row *is* (and is logged in
provenance as such), whereas a per-unit overlay leaves the data model, n, and
provenance untouched — the master table still holds every raw replicate.

So the mechanism is a new optional **`stat` on a `Layer`**:

```
Layer = { geom, params, stat?: { per_unit: bool } }
```

When `stat.per_unit` is set, the layer collapses its raw rows to one value per
independent unit (mean) before drawing. The unit columns are **not** redeclared
on the layer — they come from `spec.stats.repetition_key`, the same single
declaration that defines n for the test. One source of truth means the visible
per-unit marks and the inferential n can never disagree (the product's core
honesty property). A `stat` with no unit declared is inert (draws raw rows), so
`stat` absent or unit absent = today's behaviour.

### What each geom does with a per-unit stat

The geom registry gains `accepts_stat` (true for `dot`, `summary`, `bar`):

- **`dot` + per-unit** → one mark per (group × unit), positioned at the group
  slot with stable per-unit jitter, coloured by group, drawn above the raw dots
  (zorder 4) and below the summary. Each unit is its own point-group whose
  `row_ids` span the unit's raw replicates, so click-to-exclude on a unit mark
  excludes the whole unit. (The per-row color/size/shape splits are bypassed —
  a unit mark is an aggregate.)
- **`summary` / `bar` + per-unit** → mean of unit means, with error
  (CI95 / SEM / SD via the existing `error_type`) computed from the unit-level
  spread. This is the honest inferential summary (n = units), matching the test.

`dot` also gains per-layer `marker_size` and `alpha` params so the raw layer can
be faint/small and the unit layer bold/large within one composed figure (the
visual contrast that makes the overlay read as "big marks").

### The canonical superplot, composed

The "Build superplot" button (offered once a unit is declared) lays down the
three-layer stack — it does not introduce a hidden mode:

```
[ dot     {jitter:0.2,  size:11, alpha:0.25}                    ]  raw replicates
[ dot     {jitter:0.07, size:60, alpha:0.95}, stat:{per_unit}   ]  one mark per unit
[ summary {error_type:"sem"},                 stat:{per_unit}   ]  mean ± SEM of units
```

Everything stays editable (reorder, retype, remove, re-style) — it is a starting
point, not a preset family.

## Statistics: one declared inferential unit

The `StatModel` echoes the declared `unit` (`statmodel.infer(..., unit=rep_key)`)
and names it in the design sentence ("…; n counts independent units (subject)"),
so the StatsPanel makes the inference basis explicit. The test itself is
unchanged from item 10: it runs on data collapsed to the unit (mean), n = units,
and the lower levels are *described*, not tested — the Phase 2 *describe-don't-
test* discipline extended to nesting depth.

**Deferred (consistent with the user's "statistics when the rest stands"):**
- A per-layer summary function other than mean (median/…); the test uses the
  mean, so allowing a divergent visual aggregate would be dishonest. `fn` is left
  out of the surfaced API for now (the seam — `{ per_unit }` → `{ per_unit, fn }`
  — is non-breaking when wanted).
- Colouring unit marks per unit (classic superplots do); the `color` channel
  already exists for raw points, and group colour keeps the overlay legible. A
  per-unit colour is additive later.
- The paired-design case (a unit spanning both groups ⇒ a paired test) folds
  into the `pair_by` / single inferential-unit work (Tier 2/3), not here.

## Spec / schema impact

No `spec_version` bump. New, optional, absent-defaults-to-today fields:
- `Layer.stat?: { per_unit: bool }` (passes through `specnorm` untouched on 2.0
  specs; legacy specs simply never carry it).
- `StatModel.unit: string[]` (echo of `stats.repetition_key`, response-only).
- registry `GeomMeta.accepts_stat: bool`; `dot` gains `marker_size` + `alpha`
  param specs.

## Tests

`engine/tests/test_superplot.py`: per-unit dot emits one point-group per unit
with the unit's raw rows; the raw (no-stat) path is unchanged; per-unit summary =
mean of unit means; the stat is inert without a declared unit; two dot layers in
one plottable keep unique gids; the `/analyze` stack renders with n = units and
the unit named. `e2e/superplot_test.mjs` written following the documented import
→ map → `.add-layer-btn` pattern (unverified in the build sandbox — no Chromium).
