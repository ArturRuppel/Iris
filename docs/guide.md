# Iris — a guided tour

Iris turns a tidy table into a publication-grade figure **and** the right
statistical test, and shows its reasoning at every step. This guide has four
parts, each a different lens on the same set of worked examples:

- **[Plot types](#plot-types)** — the grammar of marks: what each one shows.
- **[Data types](#data-types)** — what you measured, and the family of tests it
  selects.
- **[How Iris chooses the test](#how-iris-chooses-the-test)** — the decision
  logic, its thresholds, and its sources.
- **[Experimental design and nesting](#experimental-design-and-nesting)** — what
  counts as *one observation*, and why it decides everything.

Every example is a real, citable dataset. Click **Open this example in Iris** to
load it into the app and explore or adapt it; opened examples save as a *new*
file, so the originals stay intact.

> **Recommendations are defaults, not verdicts.** For every figure that carries
> an inferential result Iris makes a *recommendation* — a safe default — and
> tells you why, as a chain of answered questions you can override. A pick that
> differs from the recommendation is recorded as *your* choice, not flagged as an
> error.

## At a glance

| Experimental design | Parametric | Robust / non-parametric | Typical plot |
|---|---|---|---|
| One sample vs a reference value | One-sample *t* | Wilcoxon signed-rank | box/dot + reference line |
| Two independent groups | Welch's *t* | Mann–Whitney *U* | box / violin |
| Two paired groups | Paired *t* | Wilcoxon signed-rank | box + connectors |
| Three+ independent groups | One-way ANOVA + Tukey | Kruskal–Wallis + Holm | box + brackets |
| Association of two numbers | Pearson *r* | Spearman *ρ* | scatter + regression |
| Two categorical variables | Chi-square | Fisher's exact (2×2) | heatmap |
| A count of events | Poisson / negative-binomial rate | — | rate ± CI |
| One distribution | *descriptive* | *descriptive* | histogram |
| A time course | *descriptive* | *descriptive* | line / trend |

---

# Plot types

Every mark in the grammar, with what it shows and when to reach for it.

## Box plot

The default for comparing a number across groups: median, quartiles, whiskers,
and outliers in one compact summary. Here, petal length for two iris species
(Fisher 1936).

![](example:iris-species-comparison/iris-species-comparison-01)

[Open this example in Iris](iris-open:iris-species-comparison)

## Violin plot

A violin shows the full distribution shape — a mirrored kernel density —
revealing skew or bimodality a box would hide.

![](example:iris-species-comparison/iris-species-comparison-02)

[Open this example in Iris](iris-open:iris-species-comparison)

## Bar plot

Mean ± error. Familiar, but it hides the distribution behind a single bar —
prefer box or dots when the sample is small enough to show.

![](example:iris-species-comparison/iris-species-comparison-03)

[Open this example in Iris](iris-open:iris-species-comparison)

## Summary (mean ± error)

The estimate and its uncertainty, without the bar's ink — a clean view of the
effect and its confidence interval.

![](example:iris-species-comparison/iris-species-comparison-04)

[Open this example in Iris](iris-open:iris-species-comparison)

## Dot plot

Every observation as a point — the most honest small-sample view. This example
also turns on per-group **n labels**.

![](example:iris-species-comparison/iris-species-comparison-05)

[Open this example in Iris](iris-open:iris-species-comparison)

## Scatter + regression

Two numbers per observation, with an OLS fit and a 95% confidence band. Here,
petal width against petal length.

![](example:iris-petal-correlation/iris-petal-correlation-01)

[Open this example in Iris](iris-open:iris-petal-correlation)

## Line (trajectories)

One curve per unit over an ordered x — orange-tree circumference at successive
ages, one line per tree (Draper & Smith 1998).

![](example:timeseries-growth/timeseries-growth-01)

[Open this example in Iris](iris-open:timeseries-growth)

## Trend (mean ± band)

The average trajectory with a spread band, summarising many units into one
curve.

![](example:timeseries-growth/timeseries-growth-02)

[Open this example in Iris](iris-open:timeseries-growth)

## Histogram / distribution

The shape of a single variable — sepal length across all 150 irises.

![](example:iris-sepal-descriptive/iris-sepal-descriptive-01)

[Open this example in Iris](iris-open:iris-sepal-descriptive)

## Grouped potential curves

One density curve per group on shared bins, Boltzmann-inverted to the
"potential" U = −ln P. A signed reaction coordinate with a double well, drawn
with adaptive `sinh` bins (tighter near the x = 0 vertex) and the effective
barrier ΔE = U(0) − min U labelled per curve.

![](example:potential-double-well/potential-double-well-01)

[Open this example in Iris](iris-open:potential-double-well)

---

# Data types

Before Iris picks a test, the *kind of thing you measured* fixes the **family**
of tests in play. A length and a count of events are both "numbers", but they
are generated by different processes and obey different statistics — so they get
different models. Get the data type right and the rest of the decision (see
[how Iris chooses the test](#how-iris-chooses-the-test)) follows.

## A continuous measurement

A quantity that can in principle take any value on a scale — a length, an
intensity, a concentration, a ratio. This is the default family: describe it
with a mean and SD (or median and IQR), and compare groups with the *t* /
ANOVA family or their rank-based robust counterparts. Most examples in this
guide are of this type — e.g. petal length across iris [species](#box-plot).

How Iris chooses *within* this family — Welch's *t* vs Mann–Whitney, ANOVA vs
Kruskal–Wallis — is the subject of the [next part](#how-iris-chooses-the-test).
Effect sizes come along with the test: Hedges' *g* [10] (a small-sample-corrected
Cohen's *d*) for the *t*-tests, rank-biserial *r* for Mann–Whitney.

## A count of random events

A tally of how many times something happened — spots per cell, divisions per
field, events per unit time or area. Counts are non-negative integers whose
variance grows with their mean, so a normal-theory test is the wrong model.
Iris fits a **count GLM with a log-exposure offset**, reporting each group's
*rate* (events per unit of exposure) with a model confidence interval. The
default is the **negative binomial** (robust to overdispersion); `auto` fits a
Poisson first, reads the overdispersion (Pearson χ²/df, switching at
**`_OVERDISPERSION_RATIO = 1.5`**), and refits as negative binomial if the
counts are dispersed — the standard count-model choice [15]. A global
likelihood-ratio test answers "does the group matter?".

![](example:event-rate-by-group/event-rate-by-group-01)

[Open this example in Iris](iris-open:event-rate-by-group)

## A proportion or category

Each unit falls into one of a few classes — alive/dead, mitotic or not, one of
three phenotypes. The data are *counts in a contingency table*, and the question
is whether two categorical variables are associated. Iris's default is Pearson's
**chi-square**; for a 2×2 table where any expected cell count < 5 it recommends
**Fisher's exact** — the standard small-expected-count rule [14]. Effect size:
Cramér's *V* (general) or the odds ratio with a 95% CI (2×2). The worked
examples live with the [test logic](#two-categorical-variables).

![](example:contingency-2x2/contingency-2x2-01)

[Open this example in Iris](iris-open:contingency-2x2)

## An association of two numbers

Two measurements on the same unit, and the question is whether they move
together. This is the **correlation** family — Pearson's *r* for a linear
relationship, Spearman's *ρ* for a monotone one, chosen by the same normality
rule as the comparison families. See
[the scatter example](#scatter--regression) for the plot and
[correlation](#association-of-two-numeric-variables) for the test. When the data
are nested, *which units* you correlate matters enormously — see
[experimental design and nesting](#experimental-design-and-nesting).

## A time course or ordered measurement

A quantity measured over an ordered axis — time, dose, position. Iris describes
the time course in this tier: it reports the timepoints and span and draws the
[trajectories](#line-trajectories), but does not yet attach an inferential test
(that needs mixed-effects or functional-data methods). Treat it as descriptive
until a model is declared.

---

# How Iris chooses the test

This part is the decision logic behind every comparison above — each rule, its
threshold, its rationale, its sources, and its known failure modes. The logic
lives in `engine/iris_engine/stats.py`; this document and the in-app stats
glossary (`src/components/statsGlossary.ts`) are its prose face.

## The shape of the decision

Once the [data type](#data-types) has fixed the family, a comparison is chosen
along two independent axes, each a question with a recommended answer:

1. **Structural — independent or paired?** Read from the data's hierarchy, not
   declared. Paired tests are offered *only* when a shared coarser unit spans
   both groups. This axis is structural: it comes from the spine — the replicate
   is the unit of inference [1] — never from the values. *Which* level you pair
   at is itself a design decision; see
   [which level are we pairing at?](#which-level-are-we-pairing-at).
2. **Assumption — parametric or robust?** Proposed from a normality check on
   exactly what the chosen test will see (each group when independent, the paired
   differences when paired), and confirmable.

The two answers select one test from the grid (e.g. independent × parametric →
Welch's *t*; paired × robust → Wilcoxon signed-rank). More than two groups
switch to an omnibus test plus corrected pairwise comparisons.

## The assumption axis: parametric vs robust

The choice between a mean-based parametric test and a rank-based robust test
turns on whether the data are consistent with normality, **gated by whether the
sample is large enough for that check to mean anything.**

### The normality check (Shapiro–Wilk)

Iris runs the Shapiro–Wilk test [2] on each group (or the paired differences).
`p > α` → "consistent with normality" → parametric is eligible; `p ≤ α` →
evidence of non-normality → robust. Shapiro–Wilk is the standard general-purpose
normality test and is among the most powerful for small samples [3].

**Failure mode — large N.** Significance-based normality tests (Shapiro–Wilk
included) over-reject at large N — a large sample yields a significant result
even for a small, practically irrelevant deviation from normality, one that would
not affect a parametric test [4] (§3, restating [5, 6]). Iris caps the sample the
check sees at **`NORMALITY_CAP = 5000`** (a fixed-seed subsample, so the
recommendation is reproducible) to keep it informative rather than
always-rejecting.

### The small-sample rule (`n < 12 → robust`)

Below **`MIN_N_FOR_NORMALITY_RULE = 12`**, Iris recommends the robust test
*regardless of the Shapiro–Wilk result*. Normality tests have low power at small
n — they cannot *see* a departure from normality, so a "passing" Shapiro–Wilk at
n = 6 is not evidence of normality, just absence of power [3, 4]. The rank-based
test makes no normality assumption, so it is the conservative default when
normality is unverifiable. The threshold (12) is a pragmatic convention, not a
theorem; Iris fixes it so the default is predictable. Override it when you have a
field convention or a pre-registered plan.

> ⚠️ This rule, applied naively, has a sharp failure mode at *very* small n — it
> can recommend a rank test that **cannot reach significance no matter the
> data.** That is what the next rule fixes.

## The rank-floor guard

**The problem.** A rank / permutation test computes its p-value from a *finite*
set of equally likely arrangements under the null, so it has a **smallest
attainable p set by the sample size alone** — no data can push it below that
floor. Below the n where the floor crosses α, the rank test can *never* reject.
The small-sample rule's "safe default" then hands you a test that is, by
construction, incapable of a significant result.

The clearest case is the **Wilcoxon signed-rank test** (one-sample-vs-reference,
or paired): with *n* nonzero differences, the two arrangements where every
difference shares a sign each have null probability 2⁻ⁿ, so the smallest
two-sided p the test can ever report is **2 · 2⁻ⁿ**:

| n | smallest attainable two-sided p |
|---|---|
| 3 | 0.250 |
| 4 | 0.125 |
| 5 | 0.062 |
| 6 | 0.031 |

So at n ≤ 5 the signed-rank test has **zero power** at α = 0.05 — it cannot cross
0.05 until n ≥ 6. GraphPad Prism documents exactly this and *reports* the limit
rather than recommending the test: "With five or fewer data pairs, the Wilcoxon
matched pairs test has zero power" [7, 8].

**The fix.** When the recommended rank test cannot attain α at the data's n, Iris
does **not** recommend it. It falls back to the parametric counterpart and says
so in the reason — explicitly flagging that the normality assumption is
*unverifiable* at this n, so you report the parametric test with that caveat. The
override is untouched: you can still pin the rank test if you want it.

This guard covers every family where a rank test is recommended. Each floor is
the smallest two-sided p attainable, derived from the count of equally likely
null arrangements:

| Test (family) | Smallest attainable two-sided p | Resolves at α = 0.05 from |
|---|---|---|
| Wilcoxon signed-rank — *n* diffs (location / paired) | 2 · 2⁻ⁿ | n ≥ 6 |
| Mann–Whitney U — sizes *n₁, n₂* (independent two-group) | 2 / C(n₁+n₂, n₁) | e.g. 3 vs 3 → 0.10 (no); 3 vs 5 → 0.036 (yes); 4 vs 4 → 0.029 (yes) |
| Spearman ρ — *n* pairs (correlation) | 2 / n! | n ≥ 5 |
| Kruskal–Wallis — *k* groups of *n* (multi-group omnibus) | k! · (n!)ᵏ / N! | e.g. 3×2 → 0.067 (no); 3×3 → 0.0036 (yes) |

The Kruskal–Wallis floor is **exact for equal group sizes** (H is maximal under
perfect rank separation, and the k! block orderings are the only maximal
arrangements out of N!/∏nᵢ! equally likely ones). For *unequal* sizes the
maximal-H count is not a clean closed form, so Iris uses the necessary-condition
bound 2 / (total arrangements): the guard then fires only when the test
*provably* cannot resolve — it may under-warn on borderline unequal designs, but
never over-claims. The implementation is `_signed_rank_min_p` /
`_mann_whitney_min_p` / `_spearman_min_p` / `_kruskal_min_p` in `stats.py`.

> The same combinatorial floor is *general* to permutation tests — it is why
> exact rank tests carry minimum-n tables. Iris's contribution is to make the
> *recommendation* aware of it, so the guided picker never presents a non-test as
> the default.

## The tests, design by design

For each design, the parametric default and the robust alternative Iris picks
when assumptions don't hold. Iris infers the test from the data — these examples
show what that inference produces.

### One sample vs a reference

Each group is tested against a constant reference (default 0), not against
another group — the honest design when the groups are not mutually independent
(e.g. fractions that sum to 1). The assumption axis is decided **once** for the
figure (the least-normal group wins, as in the omnibus). This is the family where
the [rank-floor guard](#the-rank-floor-guard) was first found.

**Parametric — one-sample *t*.** A single group tested against a fixed reference
value, drawn as a horizontal line.

![](example:one-sample-location/one-sample-location-01)

[Open this example in Iris](iris-open:one-sample-location)

**Robust — Wilcoxon signed-rank.** With a small sample (n < 12), Iris switches
to the rank-based test automatically.

![](example:one-sample-wilcoxon/one-sample-wilcoxon-01)

[Open this example in Iris](iris-open:one-sample-wilcoxon)

### Two independent groups

Welch's *t* (unequal-variance) is the parametric default rather than Student's
*t*: it controls Type I error across unequal variances and sample sizes at no
real cost when variances *are* equal [9].

**Parametric — Welch's *t*.** Two iris species' petal lengths, with a
significance bracket — see [the box-plot example](#box-plot).

**Robust — Mann–Whitney *U*.** The rank-based two-group test, for when normality
doesn't hold.

![](example:mann-whitney/mann-whitney-01)

[Open this example in Iris](iris-open:mann-whitney)

### Two paired groups

A paired test removes between-unit variance — but only when the pairing is real.
What level it pairs at matters; see
[which level are we pairing at?](#which-level-are-we-pairing-at).

**Parametric — paired *t*.** The classic Cushny–Peebles sleep data (Student
1908): each subject measured under two drugs.

![](example:sleep-paired-t/sleep-paired-t-01)

[Open this example in Iris](iris-open:sleep-paired-t)

**Robust — Wilcoxon signed-rank.** The paired rank-based alternative on the same
data.

![](example:sleep-wilcoxon/sleep-wilcoxon-01)

[Open this example in Iris](iris-open:sleep-wilcoxon)

### Three or more independent groups

Parametric: one-way ANOVA with **Tukey's HSD** pairwise — HSD controls the
family-wise error, so each pairwise p is already adjusted [11]. Robust:
**Kruskal–Wallis** [12] with **Holm-adjusted** pairwise Mann–Whitney [13].
Paired multi-group designs (RM-ANOVA / Friedman) are not yet supported — this
path treats the groups as independent.

**Parametric — one-way ANOVA + Tukey HSD.** Petal length across all three iris
species, with post-hoc pairwise brackets controlling the family-wise error rate.

![](example:iris-species-anova/iris-species-anova-01)

[Open this example in Iris](iris-open:iris-species-anova)

**Robust — Kruskal–Wallis + Holm.** The rank-based omnibus with Holm-corrected
pairwise comparisons.

![](example:kruskal/kruskal-01)

[Open this example in Iris](iris-open:kruskal)

### Association of two numeric variables

Same normality rule as the comparison axis. Subject to the
[rank-floor guard](#the-rank-floor-guard) (Spearman's floor is 2/n!).

**Parametric — Pearson *r*.** Linear association of petal width and length — see
[the scatter example](#scatter--regression).

**Robust — Spearman *ρ*.** The rank correlation — robust to outliers and to
monotone-but-nonlinear relationships.

![](example:iris-petal-spearman/iris-petal-spearman-01)

[Open this example in Iris](iris-open:iris-petal-spearman)

### Two categorical variables

The chi-square / Fisher's-exact logic is described under
[a proportion or category](#a-proportion-or-category).

**Parametric — chi-square.** Independence in a contingency table: aspirin versus
myocardial infarction (Physicians' Health Study) — see
[the heatmap example](#a-proportion-or-category).

**Robust — Fisher's exact.** The exact 2×2 test for small expected counts —
Fisher's lady tasting tea (Fisher 1935).

![](example:fisher-exact-tea/fisher-exact-tea-01)

[Open this example in Iris](iris-open:fisher-exact-tea)

## The override channel

Any recommendation can be pinned to a specific test. Overrides are validated for
applicability (you cannot request a paired test on data with no pairing
structure) but are otherwise authoritative — and **the rank-floor guard never
blocks an override**, it only changes the *default*. The choice is recorded in
the methods text so a reader sees exactly what was run and whether the
recommendation was accepted.

## Known failure modes (and how Iris handles them)

| Failure mode | Where it bites | Iris's handling |
|---|---|---|
| Rank test cannot reach α at small n | signed-rank n ≤ 5, MW small n, Spearman n ≤ 4, KW tiny groups | [Rank-floor guard](#the-rank-floor-guard): recommend the parametric test with an "unverifiable normality" caveat |
| Shapiro–Wilk rejects on trivial deviations | large N (10⁴+) | Subsample cap `NORMALITY_CAP = 5000` |
| Normality test has no power | small n (< 12) | Default to robust — *then* re-checked by the rank-floor guard |
| Pseudoreplication inflates n | nested/replicate data | Collapse to the spine's inferential unit before testing [1] |
| Pooled correlation sign inverts | nested data (Simpson's paradox) | Replicate-level coefficient + per-unit regression lines |
| Pairing claimed at the wrong grain | shared session vs same subject | Pair only at the spine's declared shared unit; see [pairing level](#which-level-are-we-pairing-at) |
| Many pairwise comparisons inflate error | k > 2 groups | Tukey HSD (ANOVA) / Holm (Kruskal) adjustment |
| Chi-square unreliable at small expected counts | 2×2, expected < 5 | Recommend Fisher's exact |
| Overdispersed counts break Poisson | count/rate data | Negative-binomial default; `auto` switch on χ²/df |

---

# Experimental design and nesting

The two axes above choose *a test*; this part is about the input every test
depends on and none can recover on its own — **what counts as one observation.**
Get the unit of inference wrong and the most carefully chosen test answers the
wrong question.

## The unit of inference

Cell-biology data is usually **nested**: many cells measured within each of a few
biological replicates (subjects, animals, dishes). The cells from one replicate
are correlated, so treating each cell as an independent observation —
**pseudoreplication** — inflates *n* and manufactures significance. The fix is to
test at the *replicate* grain, not the cell grain. Iris reads that grain from the
**hierarchy spine** you declare in the Data tab and collapses to it before
testing [1].

## Which level are we pairing at?

A paired test is valid only when the two values in a pair come from the *same
unit of inference*: the same individual measured before and after treatment, or
one dish split into treated and untreated halves. That pairing removes
*between-subject* variance and is the classic, powerful paired design — and the
subjects are usually measured across several sessions, so "paired" here means
*same subject, different time*, not *same time*.

Pairing on a **shared session** is a weaker and different claim. Two conditions
imaged on the same day, but on *different* samples, are independent experimental
units that merely share a batch. "Day" is then a nuisance **block**, not the
experimental unit; pairing on it removes only day-to-day variance, and is
justified only if each condition appears once per day and the day genuinely
induces correlated noise. It is *not* interchangeable with within-subject
pairing.

Iris pairs at whatever grain the spine declares as the shared unit. Choosing that
grain — subject vs session — is yours: the two answer different questions, and
the wrong grain either throws away real pairing power or invents pairing that
isn't there.

## SuperPlots: showing both grains

A **SuperPlot** (Lord et al. 2020) shows both grains at once: every cell as a
faint dot and one bold dot per biological replicate, coloured by replicate. Iris
composes it as layers bound to a **hierarchy** — a `dot` at the raw (cell) level
and a `dot` bound to the `subject` level — and runs the comparison on the grain
the prominent dots sit at.

In this example, three cells are measured in each of three subjects per group.
Because the bold replicate dots are bound to `subject`, Iris reports **n = 3 per
group, not n = 9** (see the `n = 9  N = 3` labels under each group) — the
cell-level spread is visible, but pseudoreplication can't sneak into the test.

![](example:superplot-nested/superplot-nested-01)

[Open this example in Iris](iris-open:superplot-nested)

> Lord SJ, Velle KB, Mullins RD, Fritz-Laylin LK (2020). SuperPlots:
> Communicating reproducibility and variability in cell biology.
> *Journal of Cell Biology* 219(6):e202001064.
> [doi:10.1083/jcb.202001064](https://doi.org/10.1083/jcb.202001064)

## The same trap in a correlation

Pseudoreplication is not only about comparing groups — it distorts an
**association** just as badly. Here 20 cells are measured in each of three
replicates; within every replicate *x* and *y* are strongly **negatively**
correlated, but the replicates are offset so pooling all 60 cells manufactures a
strong **positive** correlation (ρ = +0.79). Declare the **hierarchy spine**
(`replicate`) and Iris computes the coefficient within each replicate and tests
across the three — recovering the honest negative association (mean ρ = -0.91,
**n = 3**). The same spine that fixes the SuperPlot fixes the correlation; without
it, pooling doesn't just inflate *n*, it points the wrong way.

![](example:nested-correlation/nested-correlation-01)

[Open this example in Iris](iris-open:nested-correlation)

## Stratifying: one coefficient per group

Put a categorical variable on the colour channel and Iris computes the
association *within each group* rather than pooling them. This is the textbook
Simpson's paradox: pooled across the three species, sepal length and width look
slightly **negatively** associated, but *within* every species the association is
clearly **positive**. Each species gets its own regression line and *r*/*p*
readout, so the structure the pooled number hides is read straight off the
figure.

![](example:iris-sepal-stratified/iris-sepal-stratified-01)

[Open this example in Iris](iris-open:iris-sepal-stratified)

---

# References

References are cited above by number in square brackets. A machine-readable
bibliography is provided alongside this document in
[`stats-recommendations.bib`](stats-recommendations.bib); its DOI-bearing entries
were generated from each DOI with [doi2bib.org](https://www.doi2bib.org/).

1. Lord SJ, Velle KB, Mullins RD, Fritz-Laylin LK. SuperPlots: communicating reproducibility and variability in cell biology. *Journal of Cell Biology*. 2020;219(6):e202001064. doi:[10.1083/jcb.202001064](https://doi.org/10.1083/jcb.202001064)
2. Shapiro SS, Wilk MB. An analysis of variance test for normality (complete samples). *Biometrika*. 1965;52(3–4):591–611. doi:[10.1093/biomet/52.3-4.591](https://doi.org/10.1093/biomet/52.3-4.591)
3. Razali NM, Wah YB. Power comparisons of Shapiro–Wilk, Kolmogorov–Smirnov, Lilliefors and Anderson–Darling tests. *Journal of Statistical Modeling and Analytics*. 2011;2(1):21–33.
4. Ghasemi A, Zahediasl S. Normality tests for statistical analysis: a guide for non-statisticians. *International Journal of Endocrinology and Metabolism*. 2012;10(2):486–489. doi:[10.5812/ijem.3505](https://doi.org/10.5812/ijem.3505)
5. Field A. *Discovering Statistics Using SPSS*. 3rd ed. London: SAGE Publications; 2009.
6. Öztuna D, Elhan AH, Tüccar E. Investigation of four different normality tests in terms of type 1 error rate and power under different distributions. *Turkish Journal of Medical Sciences*. 2006;36(3):171–176.
7. GraphPad Software. Why can't the Wilcoxon matched pairs test ever report a P value less than 0.05 (two tailed) with five or fewer pairs of data? *GraphPad Prism FAQ 1684*. Accessed June 23, 2026. <https://www.graphpad.com/support/faq/why-cant-the-wilcoxon-matched-pair-test-ever-report-a-p-value-less-than-005-two-tailed-with-five-or-fewer-pairs-of-data/>
8. GraphPad Software. Interpreting results: Wilcoxon signed rank test. *GraphPad Prism Statistics Guide*. Accessed June 23, 2026. <https://www.graphpad.com/guides/prism/latest/statistics/stat_interpreting_results_wilcoxon_.htm>
9. Delacre M, Lakens D, Leys C. Why psychologists should by default use Welch's t-test instead of Student's t-test. *International Review of Social Psychology*. 2017;30(1):92–101. doi:[10.5334/irsp.82](https://doi.org/10.5334/irsp.82)
10. Hedges LV. Distribution theory for Glass's estimator of effect size and related estimators. *Journal of Educational Statistics*. 1981;6(2):107–128. doi:[10.3102/10769986006002107](https://doi.org/10.3102/10769986006002107)
11. Tukey JW. Comparing individual means in the analysis of variance. *Biometrics*. 1949;5(2):99–114. doi:[10.2307/3001913](https://doi.org/10.2307/3001913)
12. Kruskal WH, Wallis WA. Use of ranks in one-criterion variance analysis. *Journal of the American Statistical Association*. 1952;47(260):583–621. doi:[10.1080/01621459.1952.10483441](https://doi.org/10.1080/01621459.1952.10483441)
13. Holm S. A simple sequentially rejective multiple test procedure. *Scandinavian Journal of Statistics*. 1979;6(2):65–70.
14. Cochran WG. Some methods for strengthening the common χ² tests. *Biometrics*. 1954;10(4):417–451. doi:[10.2307/3001616](https://doi.org/10.2307/3001616)
15. Cameron AC, Trivedi PK. *Regression Analysis of Count Data*. 2nd ed. Cambridge: Cambridge University Press; 2013. doi:[10.1017/CBO9781139013567](https://doi.org/10.1017/CBO9781139013567)
</content>
</invoke>
