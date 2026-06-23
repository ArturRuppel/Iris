# How Iris recommends a statistical test

Iris never silently "runs the stats". For every figure that carries an inferential
result it makes a *recommendation* — a safe default — and shows you why, as a chain
of answered questions you can override. This document is the single source of truth
for those rules: each rule, its threshold, its rationale, its sources, and its
known failure modes.

The logic lives in `engine/iris_engine/stats.py`; this document and the in-app
stats glossary (`src/components/statsGlossary.ts`) are its prose face. If you change
a threshold in the code, change it here too.

> **Recommendations are defaults, not verdicts.** Every rule below can be
> overridden. A pick that differs from the recommendation is recorded as *your*
> choice, not flagged as an error. The point of the recommendation is to be
> defensible when you have no reason to deviate — and to *tell you* when the
> default would mislead (see [the rank-floor guard](#the-rank-floor-guard)).

---

## The shape of the decision

For a comparison, the test is chosen along two independent axes, each a question
with a recommended answer:

1. **Structural — independent or paired?** Read from the data's hierarchy, not
   declared. Paired tests are offered *only* when a shared coarser unit spans both
   groups (e.g. two measurements of the same cell/animal). This axis is
   structural: it comes from the spine — the replicate is the unit of inference [1]
   — never from the values.
2. **Assumption — parametric or robust?** Proposed from a normality check on
   exactly what the chosen test will see (each group when independent, the paired
   differences when paired), and confirmable.

The two answers select one test from the grid (e.g. independent × parametric →
Welch's *t*; paired × robust → Wilcoxon signed-rank). More than two groups switch
to an omnibus test plus corrected pairwise comparisons. Correlation, one-sample
(vs-reference) location, count/rate, and categorical×categorical each have their
own family, but reuse the same assumption axis where it applies.

---

## Rule 1 — Structural axis: independent vs paired

| | |
|---|---|
| **Default** | Independent, unless the spine shows a shared unit across both groups |
| **Threshold** | A paired test needs ≥ 3 *complete* pairs; partial pairs are dropped |
| **Source** | Read from `hierarchy.pairing`; the replicate-as-unit principle follows SuperPlots [1] |

Pairing is never inferred from how similar the numbers look — only from whether the
data model says the same unit appears in both groups. A paired test is more
sensitive when the pairing is real and **wrong** when it isn't, so Iris refuses to
offer one without structural evidence.

---

## Rule 2 — Assumption axis: parametric vs robust

The choice between a mean-based parametric test and a rank-based robust test turns
on whether the data are consistent with normality, **gated by whether the sample is
large enough for that check to mean anything.**

### 2a. The normality check (Shapiro–Wilk)

Iris runs the Shapiro–Wilk test [2] on each group (or the paired differences).
`p > α` → "consistent with normality" → parametric is eligible; `p ≤ α` → evidence
of non-normality → robust.

- **Source.** Shapiro & Wilk [2]. Shapiro–Wilk is the standard general-purpose
  normality test and is among the most powerful for small samples [3].
- **Failure mode — large N.** Significance-based normality tests (Shapiro–Wilk
  included) over-reject at large N — a large sample yields a significant result
  even for a small, practically irrelevant deviation from normality, one that would
  not affect a parametric test [4] (§3, restating [5, 6]). Iris caps the sample the
  check sees at **`NORMALITY_CAP = 5000`** (a fixed-seed subsample, so the
  recommendation is reproducible) to keep it informative rather than
  always-rejecting.

### 2b. The small-sample rule (`n < 12 → robust`)

Below **`MIN_N_FOR_NORMALITY_RULE = 12`**, Iris recommends the robust test
*regardless of the Shapiro–Wilk result*.

- **Rationale.** Normality tests have low power at small n — they cannot *see* a
  departure from normality, so a "passing" Shapiro–Wilk at n = 6 is not evidence of
  normality, just absence of power [3, 4]. The rank-based test makes no normality
  assumption, so it is the conservative default when normality is unverifiable.
- **The threshold (12) is a pragmatic convention, not a theorem.** It is in the
  range commonly cited for "small sample"; Iris fixes it so the default is
  predictable. Override when you have a field convention or a pre-registered plan.

> ⚠️ This rule, applied naively, has a sharp failure mode at *very* small n — it can
> recommend a rank test that **cannot reach significance no matter the data.** That
> is what the next rule fixes.

---

## The rank-floor guard

**The problem (item R, found via the COV2D §3 contact-enrichment plot at N = 3
biological replicates).** A rank / permutation test computes its p-value from a
*finite* set of equally likely arrangements under the null, so it has a **smallest
attainable p set by the sample size alone** — no data can push it below that floor.
Below the n where the floor crosses α, the rank test can *never* reject. Rule 2b's
"safe default" then hands you a test that is, by construction, incapable of a
significant result.

The clearest case is the **Wilcoxon signed-rank test** (one-sample-vs-reference,
or paired): with *n* nonzero differences, the two arrangements where every
difference shares a sign each have null probability 2⁻ⁿ, so the smallest two-sided
p the test can ever report is **2 · 2⁻ⁿ**:

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
does **not** recommend it. It falls back to the parametric counterpart and says so
in the reason — explicitly flagging that the normality assumption is *unverifiable*
at this n, so you report the parametric test with that caveat. The override is
untouched: you can still pin the rank test if you want it.

This guard covers every family where a rank test is recommended. Each floor is the
smallest two-sided p attainable, derived from the count of equally likely null
arrangements:

| Test (family) | Smallest attainable two-sided p | Resolves at α = 0.05 from |
|---|---|---|
| Wilcoxon signed-rank — *n* diffs (location / paired) | 2 · 2⁻ⁿ | n ≥ 6 |
| Mann–Whitney U — sizes *n₁, n₂* (independent two-group) | 2 / C(n₁+n₂, n₁) | e.g. 3 vs 3 → 0.10 (no); 3 vs 5 → 0.036 (yes); 4 vs 4 → 0.029 (yes) |
| Spearman ρ — *n* pairs (correlation) | 2 / n! | n ≥ 5 |
| Kruskal–Wallis — *k* groups of *n* (multi-group omnibus) | k! · (n!)ᵏ / N! | e.g. 3×2 → 0.067 (no); 3×3 → 0.0036 (yes) |

Notes on the Kruskal–Wallis floor: it is **exact for equal group sizes** (H is
maximal under perfect rank separation, and the k! block orderings are the only
maximal arrangements out of N!/∏nᵢ! equally likely ones). For *unequal* sizes the
maximal-H count is not a clean closed form, so Iris uses the necessary-condition
bound 2 / (total arrangements): the guard then fires only when the test *provably*
cannot resolve — it may under-warn on borderline unequal designs, but never
over-claims. The implementation is `_signed_rank_min_p` / `_mann_whitney_min_p` /
`_spearman_min_p` / `_kruskal_min_p` in `stats.py`.

> The same combinatorial floor is *general* to permutation tests — it is why exact
> rank tests carry minimum-n tables. Iris's contribution is to make the
> *recommendation* aware of it, so the guided picker never presents a non-test as
> the default.

---

## Per-family specifics

### Two independent groups → Welch's *t* (parametric) / Mann–Whitney U (robust)
Welch's *t* (unequal-variance) is the parametric default rather than Student's *t*:
it controls Type I error across unequal variances and sample sizes at no real cost
when variances *are* equal [9]. Effect sizes: Hedges' g [10] (small-sample-corrected
Cohen's d) for the *t*; rank-biserial r for Mann–Whitney.

### Three or more groups → omnibus + corrected pairwise
Parametric: one-way ANOVA with **Tukey's HSD** pairwise (HSD controls the
family-wise error, so each pairwise p is already adjusted) [11]. Robust:
**Kruskal–Wallis** [12] with **Holm-adjusted** pairwise Mann–Whitney [13]. Paired
multi-group designs (RM-ANOVA / Friedman) are not yet supported — this path treats
the groups as independent.

### One-sample (vs-reference) location → one-sample *t* / Wilcoxon signed-rank
Each group is tested against a constant reference (default 0), not against another
group — the honest design when the groups are not mutually independent (e.g.
fractions that sum to 1). The assumption axis is decided **once** for the figure
(the least-normal group wins, as in the omnibus). Subject to the
[rank-floor guard](#the-rank-floor-guard) — this is the family where the bug was
found. No automatic multiplicity correction; the test count is stated in the
methods text.

### Correlation → Pearson / Spearman
Same normality rule as the comparison axis. With a hierarchy spine the inferential
unit is the replicate, not the row: a per-unit coefficient is computed and the
association tested across units (Fisher-z one-sample *t*) — the SuperPlots [1]
principle, which avoids the pseudoreplicated pooled fit whose sign can invert
(Simpson's paradox). Subject to the [rank-floor guard](#the-rank-floor-guard)
(Spearman's floor is 2/n!).

### Categorical × categorical → chi-square / Fisher's exact
Pearson's chi-square is the default; **Fisher's exact** is recommended for a 2×2
table when any expected cell count < 5 — the standard small-expected-count rule
[14]. Effect size: Cramér's V (general) or the odds ratio with a 95% CI (2×2).

### Count / rate → negative-binomial / Poisson GLM
Per-group event rates from a count GLM with a log-exposure offset. The default is
**negative binomial** (robust to overdispersion); `auto` fits Poisson, reads the
overdispersion (Pearson χ²/df, with **`_OVERDISPERSION_RATIO = 1.5`** as the
switch), and refits NB if dispersed — the standard count-model choice [15]. A
global likelihood-ratio test answers "does group matter".

---

## The override channel

Any recommendation can be pinned to a specific test. Overrides are validated for
applicability (you cannot request a paired test on data with no pairing structure)
but are otherwise authoritative — and **the rank-floor guard never blocks an
override**, it only changes the *default*. The choice is recorded in the methods
text so a reader sees exactly what was run and whether the recommendation was
accepted.

---

## Known failure modes (and how Iris handles them)

| Failure mode | Where it bites | Iris's handling |
|---|---|---|
| Rank test cannot reach α at small n | signed-rank n ≤ 5, MW small n, Spearman n ≤ 4, KW tiny groups | [Rank-floor guard](#the-rank-floor-guard): recommend the parametric test with an "unverifiable normality" caveat |
| Shapiro–Wilk rejects on trivial deviations | large N (10⁴+) | Subsample cap `NORMALITY_CAP = 5000` |
| Normality test has no power | small n (< 12) | Default to robust (Rule 2b) — *then* re-checked by the rank-floor guard |
| Pseudoreplication inflates n | nested/replicate data | Collapse to the spine's inferential unit before testing [1] |
| Pooled correlation sign inverts | nested data (Simpson's paradox) | Replicate-level coefficient + per-unit regression lines |
| Many pairwise comparisons inflate error | k > 2 groups | Tukey HSD (ANOVA) / Holm (Kruskal) adjustment |
| Chi-square unreliable at small expected counts | 2×2, expected < 5 | Recommend Fisher's exact |
| Overdispersed counts break Poisson | count/rate data | Negative-binomial default; `auto` switch on χ²/df |

---

## References

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
