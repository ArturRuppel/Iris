# Choosing a test

On the Stats half of the figure, add a test. Iris looks at the shape of your
data and suggests one, and it shows the reasoning as a short chain of questions
it answered to get there. You can accept the suggestion or pick a different
test. A test you choose yourself is recorded as your choice, not marked as a
mistake. This page explains how the suggestion is reached, so that when you
accept it or override it you know exactly what it rests on.

## Two questions

Once the plot has fixed the kind of comparison, for example a numeric value
across two groups, the specific test is settled by two questions.

- **Are the groups independent or paired?** This is read from the structure of
  your data, not from the numbers. A paired test is suggested only when a
  shared coarser unit spans both groups, such as one subject measured under
  both conditions. If no shared unit links the groups, they are independent.
- **Parametric or robust?** This is proposed from a check on whether the data
  are consistent with a normal distribution.

The two answers pick one test. Independent and parametric gives a two-group
*t*-test; paired and robust gives a signed-rank test, and so on. Three or more
groups switch to an omnibus test with corrected pairwise comparisons.

## The independent-or-paired question

Pairing comes from the [hierarchy](../data-in.md#describe-the-hierarchy) you
declared, not from the order of the rows. Iris suggests a paired test only when
the same unit appears in both groups, so the two values in a pair really do come
from one thing measured twice. If they do not, pairing would claim a link that
is not there, and Iris keeps the groups independent.

Which level to pair at is a real decision, and it is yours. The same subject
measured before and after is a different claim from two different samples that
happen to share a day. Iris pairs at the level your hierarchy names as the
shared unit; if that is not the level you mean, change it.

## The parametric-or-robust question

A parametric test (mean-based, like the *t*-test) assumes the data are roughly
normal. A robust test (rank-based, like Mann-Whitney or the signed-rank test)
does not. Iris proposes one or the other from a normality check, with two
guards around it so the check stays meaningful.

### The normality check

Iris runs the Shapiro-Wilk test on each group, or on the paired differences
when the test is paired. If the result is consistent with normality, the
parametric test is eligible; if not, Iris proposes the robust test. Shapiro-Wilk
is the usual general-purpose normality test.

This check has a weakness at large samples: with many thousands of rows it will
flag tiny, harmless departures from normality that would not affect a
parametric test at all. To keep the check informative rather than
always-rejecting, Iris runs it on a capped sample (a fixed subsample, so the
suggestion is reproducible) once the group is very large.

### Small samples default to robust

Below a dozen values per group, Iris suggests the robust test whatever the
normality check returns. The reason is that a normality check has almost no
power at small n: it cannot detect a departure from normal, so a passing result
is not evidence of normality, only absence of a signal. The rank-based test
assumes nothing about the distribution, so it is the safer default when
normality cannot be checked. The dozen-value threshold is a convention, not a
law; override it if you have a field standard or a pre-registered plan.

### When a rank test cannot reach significance

The small-sample default has a sharp edge, and Iris guards against it. A
rank-based test computes its p-value from a finite set of equally likely
arrangements of the data under the null. That set has a smallest possible
p-value, fixed by the sample size alone, and no data can push the result below
it. Below a certain n, that floor sits above 0.05, so the rank test cannot
reach significance no matter what the data show.

The signed-rank test is the clearest case. With *n* nonzero differences the
smallest two-sided p it can report is 2 divided by 2 to the power *n*:

| n | smallest possible two-sided p |
|---|---|
| 3 | 0.250 |
| 4 | 0.125 |
| 5 | 0.062 |
| 6 | 0.031 |

So at five or fewer values the signed-rank test can never cross 0.05, whatever
the differences are.

When the rank test Iris would otherwise suggest cannot reach 0.05 at your
sample size, it does not suggest it. It suggests the parametric test instead and
says why: the normality assumption cannot be verified at this n, so you report
the parametric result with that caveat noted. The same guard covers the other
rank tests, each with its own floor;
[Troubleshooting](../troubleshooting.md#a-rank-test-that-cannot-reach-significance)
lists them. You can still choose the rank test if you want it; the guard changes
only the suggestion.

## Overriding

Every suggestion can be pinned to a different test. An override is checked for
applicability, so you cannot ask for a paired test on data with no pairing, but
it is otherwise yours to make, and the rank-floor guard never blocks one. The
choice is written into the methods text, so a reader sees exactly which test was
run and whether it matched the suggestion. Overriding is a normal part of using
Iris, not a warning to work around.

## What gets suggested, by design

For reference, the parametric suggestion and its robust alternative for each
common design:

| Design | Parametric | Robust |
|---|---|---|
| One group vs a reference value | One-sample *t* | Wilcoxon signed-rank |
| Two independent groups | Welch's *t* | Mann-Whitney *U* |
| Two paired groups | Paired *t* | Wilcoxon signed-rank |
| Three or more independent groups | One-way ANOVA with Tukey | Kruskal-Wallis with Holm |
| Association of two numbers | Pearson *r* | Spearman *ρ* |
| Two categorical variables | Chi-square | Fisher's exact (2×2) |

Welch's *t* is the default for two independent groups rather than Student's *t*,
because it holds up when the groups have unequal variance and costs nothing when
they do not. For three or more groups the pairwise comparisons are adjusted so
that testing several pairs does not inflate the error rate.

With a test chosen, the [next page](./interpreting.md) covers reading the
result: what the statistic, the p-value, and the effect size mean, and how the
result is drawn onto the figure.
