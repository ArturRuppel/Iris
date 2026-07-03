# Troubleshooting

Iris guides rather than blocks. When a recommendation looks surprising — a rank
test swapped for a *t*-test, a caution on a step that ran anyway — it is usually
one of the failure modes below, each a place where the obvious choice is quietly
wrong. This page is the catalogue: what bites, where, and how Iris handles it.
Every handling is a default you can override.

## A rank test that cannot reach significance

A rank or permutation test computes its p-value from a finite set of equally
likely arrangements of the data under the null. That set has a **smallest
attainable p, fixed by the sample size alone**, and no data can push the result
below it. Below the *n* where that floor crosses α, the rank test can never
reject — so the "safe" small-sample default would hand you a test that is, by
construction, incapable of a significant result.

The signed-rank test is the clearest case. With *n* nonzero differences, the two
arrangements where every difference shares a sign each have null probability
2⁻ⁿ, so the smallest two-sided p is 2 · 2⁻ⁿ:

| n | smallest attainable two-sided p |
|---|---|
| 3 | 0.250 |
| 4 | 0.125 |
| 5 | 0.062 |
| 6 | 0.031 |

At *n ≤ 5* the signed-rank test has zero power at α = 0.05: it cannot cross 0.05
until *n ≥ 6*.

**Iris's handling — the rank-floor guard.** When the recommended rank test cannot
attain α at the data's *n*, Iris does not recommend it. It falls back to the
parametric counterpart and says so, flagging that the normality assumption is
unverifiable at this *n* — you report the parametric test with that caveat. The
guard covers every family where a rank test is recommended, each with its own
floor:

| test (family) | smallest attainable two-sided p | resolves at α = 0.05 from |
|---|---|---|
| Wilcoxon signed-rank, *n* diffs | 2 · 2⁻ⁿ | *n ≥ 6* |
| Mann–Whitney *U*, sizes *n₁, n₂* | 2 / C(n₁+n₂, n₁) | 3 vs 3 → 0.10 (no); 3 vs 5 → 0.036 (yes); 4 vs 4 → 0.029 (yes) |
| Spearman *ρ*, *n* pairs | 2 / n! | *n ≥ 5* |
| Kruskal–Wallis, *k* groups of *n* | k! · (n!)ᵏ / N! | 3×2 → 0.067 (no); 3×3 → 0.0036 (yes) |

The override is untouched: you can still pin the rank test. The guard changes only
the default.

## A normality test with no power

Below a dozen values per group a normality test cannot see a departure from
normal, so a passing result is not evidence of normality — only absence of a
signal. Iris therefore defaults to the robust test below *n = 12*, whatever the
check returns, then re-checks that default against the rank-floor guard above. The
threshold is a convention, not a theorem; override it with a field standard or a
pre-registered plan.

## A normality test that rejects on nothing

At the other end, a significance-based normality test over-rejects at large *n*:
with many thousands of rows it flags a tiny, practically irrelevant departure
from normal, one that would not affect a parametric test. Iris caps the sample
the Shapiro–Wilk check sees at 5000 rows — a fixed-seed subsample, so the
recommendation stays reproducible — to keep the check informative rather than
always-rejecting.

## Pseudoreplication inflates n

Nested data — many cells per replicate — is not independent, so counting each
cell as an observation manufactures significance. Iris collapses to the replicate
grain declared in the hierarchy before testing, and if you route a test to a
finer grain it keeps drawing but raises a pseudoreplication caution.
[Nested data](./nesting.md) works this through with SuperPlots.

## A pooled correlation points the wrong way

In nested data a pooled correlation can invert: strongly negative within each
replicate, strongly positive across all points pooled — Simpson's paradox.
Declare the replicate and Iris computes the coefficient within each unit and tests
across units, recovering the honest sign. See
[the same trap in a correlation](./nesting.md#the-same-trap-in-a-correlation).

## Pairing claimed at the wrong grain

A paired test at the wrong level either invents pairing that is not there or
throws away real pairing power. Iris pairs only at the grain the hierarchy names
as the shared unit, and cautions when a re-pairing crosses it; see
[which level to pair at](./nesting.md#which-level-to-pair-at).

## Chi-square on small expected counts

Pearson's chi-square is unreliable when an expected cell count falls below 5. For
a 2×2 table Iris recommends Fisher's exact instead, the standard
small-expected-count rule.

## Overdispersed counts break Poisson

A Poisson model assumes the variance equals the mean; real counts are often more
dispersed, which makes Poisson p-values too small. Iris defaults count models to
the negative binomial and, under `auto`, switches to it when the Poisson fit's
dispersion (Pearson χ²/df) exceeds 1.5.

---

Every number and rule above is sourced in the
[references](./reference/citations.md). The grammar behind the recommendations —
types to marks to test families — is
[How the pieces fit](./reference/composition.md).
