# Iris examples

A guided tour of every plot Iris can draw and every experimental design it can
analyse. Each example opens a real, citable dataset — click **Open this example
in Iris** to load it into the app and explore or adapt it. Opened examples save
as a *new* file, so the originals stay intact.

## At a glance

| Experimental design | Parametric | Robust / non-parametric | Typical plot |
|---|---|---|---|
| One sample vs a reference value | One-sample *t* | Wilcoxon signed-rank | box/dot + reference line |
| Two independent groups | Welch's *t* | Mann–Whitney *U* | box / violin |
| Two paired groups | Paired *t* | Wilcoxon signed-rank | box + connectors |
| Three+ independent groups | One-way ANOVA + Tukey | Kruskal–Wallis + Holm | box + brackets |
| Association of two numbers | Pearson *r* | Spearman *ρ* | scatter + regression |
| Two categorical variables | Chi-square | Fisher's exact (2×2) | heatmap |
| One distribution | *descriptive* | *descriptive* | histogram |
| A time course | *descriptive* | *descriptive* | line / trend |

---

# Part I — Plot types

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

## Event rate by group

A per-group event rate estimated from counts with an exposure offset — a
Poisson / negative-binomial GLM, drawn as each group's rate ± its model CI. A
global likelihood-ratio test answers whether the group matters.

![](example:event-rate-by-group/event-rate-by-group-01)

[Open this example in Iris](iris-open:event-rate-by-group)

## Heatmap / contingency tile

Counts for every combination of two categories — the natural picture of a
contingency table.

![](example:contingency-2x2/contingency-2x2-01)

[Open this example in Iris](iris-open:contingency-2x2)

---

# Part II — Experimental designs & their tests

For each design, the parametric default and the robust alternative Iris picks
when assumptions don't hold. Iris infers the test from the data — these examples
show what that inference produces.

## One sample vs a reference

**Parametric — one-sample *t*.** A single group tested against a fixed reference
value, drawn as a horizontal line.

![](example:one-sample-location/one-sample-location-01)

[Open this example in Iris](iris-open:one-sample-location)

**Robust — Wilcoxon signed-rank.** With a small sample (n < 12), Iris switches
to the rank-based test automatically.

![](example:one-sample-wilcoxon/one-sample-wilcoxon-01)

[Open this example in Iris](iris-open:one-sample-wilcoxon)

## Two independent groups

**Parametric — Welch's *t*.** Two iris species' petal lengths, with a
significance bracket. Welch's t does not assume equal variances.

![](example:iris-species-comparison/iris-species-comparison-01)

[Open this example in Iris](iris-open:iris-species-comparison)

**Robust — Mann–Whitney *U*.** The rank-based two-group test, for when normality
doesn't hold.

![](example:mann-whitney/mann-whitney-01)

[Open this example in Iris](iris-open:mann-whitney)

## Two paired groups

**Parametric — paired *t*.** The classic Cushny–Peebles sleep data (Student
1908): each subject measured under two drugs.

![](example:sleep-paired-t/sleep-paired-t-01)

[Open this example in Iris](iris-open:sleep-paired-t)

**Robust — Wilcoxon signed-rank.** The paired rank-based alternative on the same
data.

![](example:sleep-wilcoxon/sleep-wilcoxon-01)

[Open this example in Iris](iris-open:sleep-wilcoxon)

## Three or more independent groups

**Parametric — one-way ANOVA + Tukey HSD.** Petal length across all three iris
species, with post-hoc pairwise brackets controlling the family-wise error rate.

![](example:iris-species-anova/iris-species-anova-01)

[Open this example in Iris](iris-open:iris-species-anova)

**Robust — Kruskal–Wallis + Holm.** The rank-based omnibus with Holm-corrected
pairwise comparisons.

![](example:kruskal/kruskal-01)

[Open this example in Iris](iris-open:kruskal)

## Association of two numeric variables

**Parametric — Pearson *r*.** Linear association of petal width and length.

![](example:iris-petal-correlation/iris-petal-correlation-01)

[Open this example in Iris](iris-open:iris-petal-correlation)

**Robust — Spearman *ρ*.** The rank correlation — robust to outliers and to
monotone-but-nonlinear relationships.

![](example:iris-petal-spearman/iris-petal-spearman-01)

[Open this example in Iris](iris-open:iris-petal-spearman)

## Two categorical variables

**Parametric — chi-square.** Independence in a contingency table: aspirin versus
myocardial infarction (Physicians' Health Study).

![](example:contingency-2x2/contingency-2x2-01)

[Open this example in Iris](iris-open:contingency-2x2)

**Robust — Fisher's exact.** The exact 2×2 test for small expected counts —
Fisher's lady tasting tea (Fisher 1935).

![](example:fisher-exact-tea/fisher-exact-tea-01)

[Open this example in Iris](iris-open:fisher-exact-tea)

## A distribution (descriptive)

Summary statistics and a histogram, with no inferential test.

![](example:iris-sepal-descriptive/iris-sepal-descriptive-01)

[Open this example in Iris](iris-open:iris-sepal-descriptive)

## A time course (descriptive)

Trajectories over time. Iris describes the time course in this tier — it reports
timepoints and span and draws the curves — with no inferential test yet.

![](example:timeseries-growth/timeseries-growth-01)

[Open this example in Iris](iris-open:timeseries-growth)
