# Reading the result

A test turns your shaped table into numbers you report: a test statistic, a
p-value, an effect size, and a per-group summary. Iris shows them in the Stats
half of the figure and writes a methods sentence you can paste into a paper. This
page is what those numbers mean, and how to read the ones Iris draws back onto the
figure.

## The statistic and its p-value

The **test statistic** measures how far your groups sit from the null hypothesis
of no difference, in the test's own units — a *t*, a *U*, an *H*. On its own it
means little; the **p-value** places it: the probability of a statistic this
extreme if the null were true. A small p is evidence against the null. Iris
reports both, so a reader can see the test that was run, not just its verdict.

A p-value is not an effect size. It answers whether a difference is
distinguishable from noise, not how large it is. For size, read the effect size
beside it.

## Effect sizes

Every test carries an effect size sized to its family, reported with the
statistic:

- **Hedges' *g*** for the *t*-tests: a small-sample-corrected Cohen's *d*, the
  difference in means in units of pooled standard deviation.
- **rank-biserial *r*** for Mann–Whitney and the signed-rank test: the
  rank-based counterpart, robust like the test it accompanies.
- **Cramér's *V*** for chi-square, or the **odds ratio** with a 95% CI for a 2×2
  table.
- **Pearson *r*** or **Spearman *ρ*** for a correlation: the coefficient is
  itself the effect size.

An effect size and a p-value answer different questions. A large sample can make
a trivial difference significant; a small one can leave a real difference
undetected. Report both.

## The result on the figure

Iris can draw the result onto the plot. For a two-group comparison it draws a
**significance bracket** spanning the groups; for three or more it draws a bracket
per pairwise comparison, each carrying its corrected p. Turn this on when the
figure should carry its own evidence — a slide, a paper panel — and off when the
Stats half is enough.

## The tests, design by design

Iris infers the test from the shaped table and its grain. These are the tests it
picks per design, each with the parametric default and the robust alternative it
takes when the
[normality check](./choosing.md#the-parametric-or-robust-question) fails.
[Choosing a test](./choosing.md) is *how* the choice is made; here is what each
one produces.

### One group vs a reference

Each group is tested against a constant, not another group — the honest design
when groups are not independent, such as fractions that sum to 1. The reference is
drawn as a horizontal line.

**Parametric: one-sample *t*.**

![A single group of values tested against a horizontal reference line at the null value](example:one-sample-location/one-sample-location-01)

[Open this example in Iris](iris-open:one-sample-location)

**Robust: Wilcoxon signed-rank**, chosen automatically at small *n*.

![The same one-sample design at small n, tested with the rank-based signed-rank test against the reference line](example:one-sample-wilcoxon/one-sample-wilcoxon-01)

[Open this example in Iris](iris-open:one-sample-wilcoxon)

### Two independent groups

**Parametric: Welch's *t*.** The unequal-variance *t* is the default rather than
Student's: it holds Type I error across unequal variances and sample sizes, and
costs nothing when the variances are equal. See
[the box-plot example](../plots.md#box-plot).

**Robust: Mann–Whitney *U*.**

![Two groups compared with the rank-based Mann-Whitney U test, a significance bracket between them](example:mann-whitney/mann-whitney-01)

[Open this example in Iris](iris-open:mann-whitney)

### Two paired groups

A paired test removes between-unit variance, but only when the pairing is real;
see [which level to pair at](../nesting.md#which-level-to-pair-at).

**Parametric: paired *t*.** The Cushny–Peebles sleep data, each subject measured
under two drugs.

![Paired sleep data, each subject a connector between its two drug conditions, tested with the paired t-test](example:sleep-paired-t/sleep-paired-t-01)

[Open this example in Iris](iris-open:sleep-paired-t)

**Robust: Wilcoxon signed-rank**, on the same data.

![The same paired sleep data tested with the rank-based signed-rank test](example:sleep-wilcoxon/sleep-wilcoxon-01)

[Open this example in Iris](iris-open:sleep-wilcoxon)

### Three or more independent groups

More than two groups switch to an omnibus test plus corrected pairwise
comparisons, so testing several pairs does not inflate the error rate.

**Parametric: one-way ANOVA with Tukey's HSD**, whose pairwise p-values are
already family-wise adjusted.

![Petal length across three iris species, one-way ANOVA with Tukey HSD pairwise brackets](example:iris-species-anova/iris-species-anova-01)

[Open this example in Iris](iris-open:iris-species-anova)

**Robust: Kruskal–Wallis with Holm-adjusted pairwise Mann–Whitney.**

![Three groups compared with the rank-based Kruskal-Wallis omnibus and Holm-corrected pairwise brackets](example:kruskal/kruskal-01)

[Open this example in Iris](iris-open:kruskal)

Paired multi-group designs (RM-ANOVA, Friedman) are not yet supported; this path
treats the groups as independent.

### Association of two numbers

**Parametric: Pearson *r*** for a linear association; **robust: Spearman *ρ***
for a monotone one, robust to outliers. Same normality rule as the comparison
families.

![Two measurements per unit tested with Spearman's rank correlation](example:iris-petal-spearman/iris-petal-spearman-01)

[Open this example in Iris](iris-open:iris-petal-spearman)

### Two categorical variables

The question is whether two categorical variables are associated, read from a
contingency table.

**Parametric: chi-square**, the default for independence in a contingency table.

**Robust: Fisher's exact**, for a 2×2 table where an expected cell count falls
below 5 — Fisher's lady tasting tea.

![A 2x2 contingency table tested with Fisher's exact test](example:fisher-exact-tea/fisher-exact-tea-01)

[Open this example in Iris](iris-open:fisher-exact-tea)

## Counts and rates

A count is not a measurement on a scale: it is a tally of events — spots per
cell, divisions per field — a non-negative integer whose variance grows with its
mean. A normal-theory test is the wrong model. Iris fits a **count GLM with a
log-exposure offset** and reports each group's *rate*, events per unit of
exposure, with a model confidence interval. The default is the **negative
binomial**, robust to overdispersion; `auto` fits a Poisson first, reads the
overdispersion, and refits as negative binomial if the counts are dispersed. A
likelihood-ratio test answers whether the group matters.

![Event rate per group as an estimate with its confidence interval, from a count GLM with a log-exposure offset](example:event-rate-by-group/event-rate-by-group-01)

[Open this example in Iris](iris-open:event-rate-by-group)

---

When a recommendation surprises you — a rank test replaced by its parametric
counterpart, a caution on a collapse — [Troubleshooting](../troubleshooting.md)
explains what tripped and what to do. The sources behind every rule are in the
[references](../reference/citations.md).
