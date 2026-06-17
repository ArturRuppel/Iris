# Info boxes for the statistics module

**Date:** 2026-06-17
**Status:** Draft

## Problem

The statistics pane (`src/components/StatsPanel.tsx`) reports a guided test
choice, assumption checks, and a result table full of terms a working
biologist may not carry in their head: *Welch's t-test*, *Hedges' g*,
*rank-biserial r*, *η²*, *Holm-adjusted*, *Cramér's V*. The pane already
explains *why* a test was picked (the `reason` strings the engine emits), but
it never explains *what* each term means, *what it assumes*, or *how to read
it*. A user who doesn't already know the vocabulary can run a correct analysis
without understanding it — which is exactly the failure mode Iris exists to
prevent (see [[digital-cell-book]]: the target user knows their biology, not
their statistics).

We want a hover info box (`?` affordance) on every term and test name in the
pane. Hovering explains, in one short paragraph: **what it is**, **what it
assumes**, and — where it matters — **how to read the number**. No math
derivations; plain language aimed at a bench scientist.

This spec defines the affordance, the placement, and the **exact copy** for
every info box. Copy is the deliverable here — the component work is small.

## Decision summary

- One reusable `InfoTip` component: a small `?` glyph next to a term that, on
  hover/focus, shows a popover with the copy. Keyboard-focusable and
  screen-reader-readable (it is content, not decoration).
- Copy lives in a single keyed dictionary (`statsGlossary.ts`), not inline in
  JSX, so the prose is reviewable in one place and reused across the pane,
  the methods text, and any future export.
- Every entry has the same shape: `{ term, what, assumes?, read? }`. The
  popover renders `what` always; `assumes` and `read` as labelled lines when
  present. Descriptive/structural concepts have no `assumes`; raw statistics
  (t, U, W) have no `assumes` of their own.
- Info boxes are **attached to the labels the pane already renders** (the
  `<dt>` terms, the `<h3>` headings, the test chips). We are annotating
  existing UI, not adding a new panel.
- The glossary is keyed by a stable id, *not* by display string, so
  "p (two-tailed)" and "p (omnibus)" can share or differ deliberately.

## Affordance

```
Hedges' g (95% CI)  ⓘ        0.42 (0.10, 0.74)
                    └─ hover/focus ─┐
                    ┌───────────────────────────────────────┐
                    │ Hedges' g                             │
                    │                                       │
                    │ A standardised effect size: the       │
                    │ difference between the two group       │
                    │ means measured in pooled standard      │
                    │ deviations…                            │
                    │                                       │
                    │ Read · ~0.2 small, ~0.5 medium,        │
                    │ ~0.8 large. Sign follows the order     │
                    │ of the groups.                         │
                    └───────────────────────────────────────┘
```

- Trigger: an inline `ⓘ`/`?` button after the term. `tabindex=0`,
  `aria-label="About {term}"`, popover shown on `mouseenter`/`focus`,
  dismissed on `mouseleave`/`blur`/`Escape`.
- The popover is `role="tooltip"` referenced by `aria-describedby`.
- Width capped (~320px), positioned to stay in the viewport (flip above when
  near the bottom of the pane — the pane is a tall right rail).
- No click required; no modal. It must never cover the value it explains —
  offset to the side.

### What gets an info box

| Location in pane | Terms |
|---|---|
| `Inferred model` heading | the design line; the structural idea (independent vs paired) |
| `Describe only` toggle | what "describe only" means |
| `Assumption checks` heading | Shapiro–Wilk, normality, the n-cap and small-n rule |
| `Recommended test` heading | parametric vs robust; "recommended" vs override |
| test chips | each test name (Welch's t, Mann–Whitney U, …) |
| `Result` `<dt>`s | p, significance stars, df, t/U/W/F/H/χ², CI, the effect sizes, pairwise + correction, N/k/n |
| per-group summary | mean, SD, median, IQR, 95% CI of the mean |
| `Methods text` heading | what the methods paragraph is for |

## Copy

The voice: second person, present tense, one idea per line. "Assumes" states
the precondition in terms the engine actually enforces (so the copy and the
recommendation logic never contradict each other). Numbers cited below match
`stats.py` constants: small-n threshold `MIN_N_FOR_NORMALITY_RULE = 12`,
normality subsample cap `NORMALITY_CAP = 5000`, default `alpha = 0.05`.

### Concepts

**`independent_vs_paired`** (structural axis)
- *What:* Whether the two groups are separate samples (different cells, animals,
  wells) or two measurements of the *same* unit (before/after, two stains on one
  cell). Iris reads this from your data's hierarchy — it is not something you
  declare.
- *Read:* Paired tests are offered only when a shared unit spans both groups.
  They are more sensitive when the pairing is real, and wrong when it isn't.

**`parametric_vs_robust`** (assumption axis)
- *What:* Parametric tests (t-test, ANOVA, Pearson) assume the data follow a
  normal distribution and compare means. Robust / rank-based tests
  (Mann–Whitney, Kruskal–Wallis, Spearman, Wilcoxon) make no normality
  assumption — they compare ranks, so they tolerate skew and outliers.
- *Read:* Iris recommends parametric when the normality check passes and the
  sample is large enough to trust it; otherwise robust. Either is valid to
  report — the override lets you switch.

**`describe_only`**
- *What:* Skips the inferential test entirely. You get group means, spread, and
  the figure, but no p-value or effect size.
- *Read:* Use it when a test isn't warranted — exploratory looks, pilot data, or
  when the comparison isn't the point of the figure.

**`recommended_vs_override`**
- *What:* Iris proposes the test that matches your design and data. You can pin a
  different one with the chips; the choice is recorded as a user override in the
  methods record.
- *Read:* Overriding is legitimate when you have a reason (a field convention, a
  pre-registered plan). The recommendation is a safe default, not a rule.

### Assumption checks

**`shapiro_wilk`**
- *What:* A test of whether a sample is consistent with a normal (bell-curve)
  distribution. Iris runs it on each group (or on the paired differences) to
  decide between a parametric and a robust test.
- *Assumes:* Needs at least 3 values. It is the input to the recommendation, not
  a result you report.
- *Read:* `p` above 0.05 → no evidence against normality ("normal"); `p` below →
  evidence of non-normality ("non-normal"). `W` near 1 means close to normal.

**`normality`**
- *What:* The shape assumption behind parametric tests: that values scatter
  symmetrically around a mean in a bell curve.
- *Read:* Shapiro–Wilk "normal" doesn't prove normality — it means the data are
  *consistent* with it. With very small samples the check can't see departures,
  so Iris falls back to the robust test regardless (below n = 12).

**`normality_large_n`** (shown when n > 5000)
- *What:* On very large samples Shapiro–Wilk flags trivially small, irrelevant
  departures from normal as "non-normal". To stay informative, Iris assesses
  normality on a fixed random subsample of 5000 values.
- *Read:* The recommendation reflects the subsample; every value still appears in
  the figure and the test itself.

### Tests

**`welch_t`** — Welch's t-test
- *What:* Compares the means of two independent groups. Welch's version does not
  assume the two groups have equal variance, so it is the safe default t-test.
- *Assumes:* Roughly normal values in each group; independent observations.
- *Read:* A small p means the group means differ by more than sampling noise
  would explain. Report it with Hedges' g and the mean difference.

**`mann_whitney`** — Mann–Whitney U
- *What:* The rank-based ("robust") alternative to the two-group t-test. It tests
  whether values in one group tend to be larger than the other by comparing
  ranks, not means.
- *Assumes:* Independent observations. No normality assumption.
- *Read:* Small p → the groups' distributions are shifted apart. Pair it with the
  rank-biserial r effect size.

**`paired_t`** — Paired t-test
- *What:* Compares two measurements of the *same* unit (before/after) by testing
  whether their differences average to zero.
- *Assumes:* The per-unit differences are roughly normal; pairs are complete.
- *Read:* Small p → a consistent within-unit change. The mean difference and its
  95% CI describe the size of that change.

**`wilcoxon`** — Wilcoxon signed-rank
- *What:* The rank-based alternative to the paired t-test. Tests whether the
  paired differences are symmetric around zero, using their ranks.
- *Assumes:* Paired observations. No normality assumption on the differences.
- *Read:* Small p → a consistent within-unit shift. Report with rank-biserial r.

**`one_way_anova`** — One-way ANOVA
- *What:* The omnibus test for comparing the means of three or more independent
  groups at once. Answers "do any of these groups differ?" before looking at
  individual pairs.
- *Assumes:* Roughly normal values in each group; independent observations.
- *Read:* A small omnibus p means at least one group differs; the pairwise rows
  (Tukey HSD) tell you which. η² is the share of variance explained.

**`kruskal`** — Kruskal–Wallis
- *What:* The rank-based omnibus test for three or more independent groups — the
  robust counterpart to one-way ANOVA.
- *Assumes:* Independent observations. No normality assumption.
- *Read:* Small omnibus p → at least one group is shifted; the pairwise rows
  (Holm-adjusted Mann–Whitney) localise it. ε² is the rank-based effect size.

**`pearson`** — Pearson r
- *What:* Measures the strength and direction of a *linear* association between
  two numeric variables.
- *Assumes:* Both variables roughly normal; the relationship is linear.
- *Read:* r runs from −1 (perfect inverse) through 0 (none) to +1 (perfect). The
  p tests whether r differs from zero.

**`spearman`** — Spearman ρ
- *What:* The rank-based correlation — the strength of a *monotonic* association
  (consistently increasing or decreasing), not necessarily a straight line.
- *Assumes:* No normality assumption; tolerates outliers and curved-but-monotonic
  relationships.
- *Read:* ρ runs −1 to +1 like r. Preferred over Pearson when the data are skewed
  or the relationship bends.

**`chi_square`** — Chi-square test of independence
- *What:* Tests whether two categorical variables are associated by comparing the
  observed counts to the counts expected if they were unrelated.
- *Assumes:* Independent observations; expected count ≥ 5 in (almost) every cell.
  For a 2×2 table with an expected count below 5, Iris recommends Fisher's exact
  instead.
- *Read:* Small p → the variables are associated. Cramér's V gives the strength.

**`fisher_exact`** — Fisher's exact test
- *What:* An exact test of association for a 2×2 table. Used when expected counts
  are too small for the chi-square approximation to be reliable.
- *Assumes:* Independent observations; a 2×2 table (Iris falls back to chi-square
  for larger tables).
- *Read:* Small p → an association. The odds ratio (with 95% CI) gives the
  direction and size.

**`descriptive`** — Descriptive summary
- *What:* No test — a one-variable distribution summary for a histogram: centre,
  spread, and range.
- *Read:* If the data look normal, report mean (SD); if not, median (IQR). Iris
  picks the line to highlight from the same normality check.

### Statistics and result terms

**`p_value`** — p (two-tailed / omnibus)
- *What:* The probability of seeing a difference this large (or larger) if there
  were truly no effect.
- *Read:* Smaller = stronger evidence against "no effect". Below α (default 0.05)
  is conventionally "significant". A p-value is not the size of the effect — read
  it next to the effect size, not instead of it.

**`significance_stars`**
- *What:* A shorthand for the p-value: `*` p < 0.05, `**` p < 0.01, `***`
  p < 0.001, `ns` not significant.
- *Read:* These are the bracket labels drawn on the figure. They compress the p;
  they don't add information beyond it.

**`alpha`**
- *What:* The significance threshold (default 0.05) — the false-positive rate you
  accept. p below α is called significant.
- *Read:* It also sets the normality cutoff for the assumption check. Lowering it
  makes every test more conservative.

**`degrees_of_freedom`** — df
- *What:* Roughly, how many values were free to vary given the sample size and
  the number of groups. It indexes the reference distribution the p comes from.
- *Read:* Reported for completeness (e.g. `t(38)`); you rarely interpret it
  directly. Larger df generally means more power.

**`t_statistic`** — t
- *What:* The mean difference expressed in units of its own standard error.
- *Read:* Farther from zero → stronger signal relative to noise. The p translates
  it into a probability.

**`u_statistic`** — U
- *What:* The Mann–Whitney rank-sum statistic — how often values in one group
  outrank the other.
- *Read:* Interpret through the p and the rank-biserial r; the raw U scales with
  sample size.

**`w_statistic`** — W
- *What:* The Wilcoxon signed-rank statistic, summed from the ranks of the paired
  differences.
- *Read:* Interpret through the p and rank-biserial r.

**`f_statistic`** — F
- *What:* The ANOVA ratio of between-group variance to within-group variance.
- *Read:* Larger F → groups differ more relative to their internal spread. The
  omnibus p translates it.

**`h_statistic`** — H
- *What:* The Kruskal–Wallis statistic — the rank-based analogue of F.
- *Read:* Interpret through the omnibus p; ε² gives the effect size.

**`chi2_statistic`** — χ²
- *What:* The total squared gap between observed and expected counts, scaled by
  the expected counts.
- *Read:* Larger → observed counts depart further from independence. The p and
  Cramér's V are what you report.

**`confidence_interval`** — 95% CI
- *What:* A range that, across repeated samples, would contain the true value 95%
  of the time. Iris reports it for differences, effect sizes, and correlations.
- *Read:* Narrow = precise; wide = uncertain. If a difference's CI excludes 0 (or
  an odds ratio's CI excludes 1), the effect is significant at α = 0.05.

**`mean_difference`**
- *What:* The plain difference between the two group means, in the data's own
  units.
- *Read:* The effect on the scale you measured — read alongside the standardised
  effect size, which is unit-free.

**`hedges_g`** — Hedges' g
- *What:* A standardised effect size: the difference between two means measured in
  pooled standard deviations (a small-sample-corrected Cohen's d).
- *Read:* ~0.2 small, ~0.5 medium, ~0.8 large. Unit-free, so it is comparable
  across studies. Sign follows the order of the groups.

**`rank_biserial`** — rank-biserial r
- *What:* The effect size for rank-based two-group tests — the net proportion of
  pairs favouring one group.
- *Read:* Runs −1 to +1; 0 means no tendency. The robust counterpart to Hedges' g.

**`eta_squared`** — η²
- *What:* The proportion of the variance in the outcome explained by the grouping
  factor, for ANOVA.
- *Read:* 0 to 1; ~0.01 small, ~0.06 medium, ~0.14 large.

**`epsilon_squared`** — ε²
- *What:* The rank-based effect size for Kruskal–Wallis — the analogue of η².
- *Read:* 0 to 1, larger = stronger group separation.

**`correlation_r`** — r / ρ
- *What:* The correlation coefficient: strength and direction of association
  between two numeric variables.
- *Read:* −1 to +1; 0 is no association. r (Pearson) is linear, ρ (Spearman) is
  monotonic.

**`cramers_v`** — Cramér's V
- *What:* The effect size for a chi-square test — how strongly two categorical
  variables are associated.
- *Read:* 0 (independent) to 1 (perfectly associated). Interpret thresholds
  relative to table size.

**`odds_ratio`** — odds ratio
- *What:* For a 2×2 table, how many times higher the odds of an outcome are in one
  group than the other.
- *Read:* 1 = no difference; >1 and <1 are opposite directions. If the 95% CI
  excludes 1, the association is significant.

**`pairwise_correction`** — Tukey HSD / Holm-adjusted
- *What:* When you compare every pair of groups, you run many tests, which inflates
  the false-positive rate. These corrections adjust the per-pair p-values to keep
  the overall error controlled.
- *Read:* The pairwise p-values shown are already adjusted — compare them to α
  directly. Tukey HSD pairs with ANOVA, Holm with Kruskal–Wallis.

**`sample_n`** — n / N / k
- *What:* `n` is the number of observations (or complete pairs); `N` the total
  across all groups; `k` the number of groups compared.
- *Read:* Larger n means more power to detect a real effect. For paired tests, n
  counts complete pairs, not raw rows.

**`group_summary`** — mean (SD), median (IQR), 95% CI of the mean
- *What:* Per-group descriptives. SD is the spread of the values; the 95% CI of
  the mean is the precision of the average; IQR is the middle 50% of values.
- *Read:* SD and IQR describe the data's spread; the CI of the mean describes how
  well you've pinned the average — it shrinks as n grows.

**`methods_text`**
- *What:* A ready-to-paste sentence describing the test, the numbers, and any
  excluded observations, in journal methods style.
- *Read:* Copy it into a manuscript. It records exactly what was run, including
  whether you accepted the recommendation or overrode it.

## Implementation sketch

- `src/components/InfoTip.tsx` — the trigger + popover. ~40 lines; CSS in
  `index.css` alongside the existing `.stats-pane` rules. Positioning: CSS
  anchor or a tiny `useFloating`-style flip; given the pane is a fixed right
  rail, "flip above past the halfway point" is enough — no positioning library.
- `src/components/statsGlossary.ts` — the keyed dictionary above, typed as
  `Record<GlossaryKey, { term: string; what: string; assumes?: string; read?: string }>`.
- `StatsPanel.tsx` — wrap the relevant `<dt>`/`<h3>`/chip labels with the term
  plus `<InfoTip k="…" />`. Result-row terms map to keys by the `r.test`
  switch we already have, so the wiring is local.
- The test-chip tooltips reuse the same keys as the `TEST_LABELS` map (one key
  per test name), so the chips and the result heading stay in sync.

## Out of scope

- Per-value interpretation that depends on the actual numbers ("your g of 0.4 is
  medium") — the copy gives the user the rule of thumb; we do not compute a
  verdict.
- A standalone glossary page or search. The info boxes are in-context only.
- Localisation. English copy only for now.
- Changing any statistic, recommendation, or threshold — this is annotation,
  not new analysis.

## Open questions

1. **Glyph vs dotted underline.** A trailing `ⓘ` is explicit but adds visual
   noise to a dense table. A dotted underline on the term is quieter but less
   discoverable. Recommend the dotted underline for `<dt>` terms (dense) and a
   visible `ⓘ` on the section `<h3>`s (sparse). Confirm.
2. **Should the copy ship in the methods export?** The methods text is already
   self-contained; the glossary is for on-screen learning. Leaning no.
3. **Hover-only vs pinnable.** Hover/focus dismiss-on-leave is simplest. If users
   want to read several in a row, a click-to-pin variant is a later add.
