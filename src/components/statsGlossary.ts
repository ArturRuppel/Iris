/* Plain-language copy for the statistics-pane info boxes. One entry per term,
   test, or statistic the pane can show. `what` always renders; `assumes` and
   `read` render as labelled lines when present. See the design spec:
   docs/superpowers/specs/2026-06-17-stats-info-boxes-design.md
   The full recommendation rules (thresholds, rationale, sources, failure modes)
   live in docs/stats-recommendations.md — keep this copy consistent with it.
   Copy lives here (not inline in JSX) so the prose is reviewable in one place. */

export interface GlossaryEntry {
  term: string;
  what: string;
  assumes?: string;
  read?: string;
}

export const STATS_GLOSSARY = {
  /* --- concepts --- */
  independent_vs_paired: {
    term: "Independent vs paired",
    what: "Whether the two groups are separate samples (different cells, animals, wells) or two measurements of the same unit (before/after, two stains on one cell). Iris reads this from your data's hierarchy — it is not something you declare.",
    read: "Paired tests are offered only when a shared unit spans both groups. They are more sensitive when the pairing is real, and wrong when it isn't.",
  },
  parametric_vs_robust: {
    term: "Parametric vs robust",
    what: "Parametric tests (t-test, ANOVA, Pearson) assume the data follow a normal distribution and compare means. Robust / rank-based tests (Mann–Whitney, Kruskal–Wallis, Spearman, Wilcoxon) make no normality assumption — they compare ranks, so they tolerate skew and outliers.",
    read: "Iris recommends parametric when the normality check passes and the sample is large enough to trust it; otherwise robust. Either is valid to report — the override lets you switch.",
    assumes: "At very small n a rank test can't reach significance no matter the data (e.g. Wilcoxon needs ≥ 6 pairs to cross p = 0.05). When that happens Iris recommends the parametric test instead and flags that normality is unverifiable — the “rank-floor guard”. Full rules + sources are in the Methods tab.",
  },
  rank_floor: {
    term: "Rank-floor guard",
    what: "A rank test computes its p-value from a finite set of equally likely arrangements, so it has a smallest possible p set by the sample size alone. Below that n it can never reach significance — the Wilcoxon signed-rank test's floor is 2/2ⁿ (0.25 at n = 3), so it needs ≥ 6 pairs to cross 0.05; Mann–Whitney, Spearman and Kruskal–Wallis have analogous floors.",
    read: "When the small-sample rule would pick a rank test that cannot resolve at your n, Iris recommends the parametric test instead and notes that its normality assumption is unverifiable at this n. The override still lets you pin the rank test. (GraphPad Prism FAQ 1684 documents the Wilcoxon case.)",
  },
  describe_only: {
    term: "Describe only",
    what: "Skips the inferential test entirely. You get group means, spread, and the figure, but no p-value or effect size.",
    read: "Use it when a test isn't warranted — exploratory looks, pilot data, or when the comparison isn't the point of the figure.",
  },
  recommended_test: {
    term: "Choosing the test",
    what: "Iris answers each question — study design, distribution — with the option that matches your data, and shows why. You own the choice: change any answer and the resolved test follows, recorded as your choice, not flagged as a deviation.",
    read: "The recommendation is a safe default, not a rule. Changing it is legitimate when you have a reason (a field convention, a pre-registered plan).",
  },

  /* --- assumption checks --- */
  shapiro_wilk: {
    term: "Shapiro–Wilk",
    what: "A test of whether a sample is consistent with a normal (bell-curve) distribution. Iris runs it on each group (or on the paired differences) to decide between a parametric and a robust test.",
    assumes: "Needs at least 3 values. It is the input to the recommendation, not a result you report.",
    read: "p above 0.05 → no evidence against normality (“normal”); p below → evidence of non-normality (“non-normal”). W near 1 means close to normal.",
  },
  normality: {
    term: "Normality",
    what: "The shape assumption behind parametric tests: that values scatter symmetrically around a mean in a bell curve.",
    read: "Shapiro–Wilk “normal” doesn't prove normality — it means the data are consistent with it. With very small samples the check can't see departures, so Iris falls back to the robust test regardless (below n = 12) — unless that rank test is too small to ever reach significance, in which case the parametric test is recommended with a caveat (see Rank-floor guard).",
  },

  /* --- tests --- */
  welch_t: {
    term: "Welch's t-test",
    what: "Compares the means of two independent groups. Welch's version does not assume the two groups have equal variance, so it is the safe default t-test.",
    assumes: "Roughly normal values in each group; independent observations.",
    read: "A small p means the group means differ by more than sampling noise would explain. Report it with Hedges' g and the mean difference.",
  },
  mann_whitney: {
    term: "Mann–Whitney U",
    what: "The rank-based (“robust”) alternative to the two-group t-test. It tests whether values in one group tend to be larger than the other by comparing ranks, not means.",
    assumes: "Independent observations. No normality assumption. Needs enough observations to resolve at α: its floor is 2/C(n₁+n₂, n₁), so e.g. 3 vs 3 cannot cross p = 0.05 (see Rank-floor guard).",
    read: "Small p → the groups' distributions are shifted apart. Pair it with the rank-biserial r effect size.",
  },
  paired_t: {
    term: "Paired t-test",
    what: "Compares two measurements of the same unit (before/after) by testing whether their differences average to zero.",
    assumes: "The per-unit differences are roughly normal; pairs are complete.",
    read: "Small p → a consistent within-unit change. The mean difference and its 95% CI describe the size of that change.",
  },
  wilcoxon: {
    term: "Wilcoxon signed-rank",
    what: "The rank-based alternative to the paired t-test. Tests whether the paired differences are symmetric around zero, using their ranks.",
    assumes: "Paired observations. No normality assumption on the differences. Needs ≥ 6 pairs to reach p = 0.05 (two-sided): its floor is 2/2ⁿ, so it has zero power at ≤ 5 pairs (see Rank-floor guard).",
    read: "Small p → a consistent within-unit shift. Report with rank-biserial r.",
  },
  one_way_anova: {
    term: "One-way ANOVA",
    what: "The omnibus test for comparing the means of three or more independent groups at once. Answers “do any of these groups differ?” before looking at individual pairs.",
    assumes: "Roughly normal values in each group; independent observations.",
    read: "A small omnibus p means at least one group differs; the pairwise rows (Tukey HSD) tell you which. η² is the share of variance explained.",
  },
  kruskal: {
    term: "Kruskal–Wallis",
    what: "The rank-based omnibus test for three or more independent groups — the robust counterpart to one-way ANOVA.",
    assumes: "Independent observations. No normality assumption. Needs enough per group to resolve at α (e.g. 3 groups of 2 cannot cross p = 0.05; 3 of 3 can) — see Rank-floor guard.",
    read: "Small omnibus p → at least one group is shifted; the pairwise rows (Holm-adjusted Mann–Whitney) localise it. ε² is the rank-based effect size.",
  },
  pearson: {
    term: "Pearson r",
    what: "Measures the strength and direction of a linear association between two numeric variables.",
    assumes: "Both variables roughly normal; the relationship is linear.",
    read: "r runs from −1 (perfect inverse) through 0 (none) to +1 (perfect). The p tests whether r differs from zero.",
  },
  spearman: {
    term: "Spearman ρ",
    what: "The rank-based correlation — the strength of a monotonic association (consistently increasing or decreasing), not necessarily a straight line.",
    assumes: "No normality assumption; tolerates outliers and curved-but-monotonic relationships. Needs ≥ 5 pairs to reach p = 0.05: its floor is 2/n! (see Rank-floor guard).",
    read: "ρ runs −1 to +1 like r. Preferred over Pearson when the data are skewed or the relationship bends.",
  },
  chi_square: {
    term: "Chi-square",
    what: "Tests whether two categorical variables are associated by comparing the observed counts to the counts expected if they were unrelated.",
    assumes: "Independent observations; expected count ≥ 5 in (almost) every cell. For a 2×2 table with an expected count below 5, Iris recommends Fisher's exact instead.",
    read: "Small p → the variables are associated. Cramér's V gives the strength.",
  },
  fisher_exact: {
    term: "Fisher's exact",
    what: "An exact test of association for a 2×2 table. Used when expected counts are too small for the chi-square approximation to be reliable.",
    assumes: "Independent observations; a 2×2 table (Iris falls back to chi-square for larger tables).",
    read: "Small p → an association. The odds ratio (with 95% CI) gives the direction and size.",
  },
  descriptive: {
    term: "Descriptive summary",
    what: "No test — a one-variable distribution summary for a histogram: centre, spread, and range.",
    read: "If the data look normal, report mean (SD); if not, median (IQR). Iris picks the line to highlight from the same normality check.",
  },

  /* --- statistics and result terms --- */
  p_value: {
    term: "p-value",
    what: "The probability of seeing a difference this large (or larger) if there were truly no effect.",
    read: "Smaller = stronger evidence against “no effect”. Below α (default 0.05) is conventionally “significant”. A p-value is not the size of the effect — read it next to the effect size, not instead of it.",
  },
  significance_stars: {
    term: "Significance stars",
    what: "A shorthand for the p-value: * p < 0.05, ** p < 0.01, *** p < 0.001, ns not significant.",
    read: "These are the bracket labels drawn on the figure. They compress the p; they don't add information beyond it.",
  },
  degrees_of_freedom: {
    term: "Degrees of freedom (df)",
    what: "Roughly, how many values were free to vary given the sample size and the number of groups. It indexes the reference distribution the p comes from.",
    read: "Reported for completeness (e.g. t(38)); you rarely interpret it directly. Larger df generally means more power.",
  },
  t_statistic: {
    term: "t",
    what: "The mean difference expressed in units of its own standard error.",
    read: "Farther from zero → stronger signal relative to noise. The p translates it into a probability.",
  },
  u_statistic: {
    term: "U",
    what: "The Mann–Whitney rank-sum statistic — how often values in one group outrank the other.",
    read: "Interpret through the p and the rank-biserial r; the raw U scales with sample size.",
  },
  w_statistic: {
    term: "W",
    what: "The Wilcoxon signed-rank statistic, summed from the ranks of the paired differences.",
    read: "Interpret through the p and rank-biserial r.",
  },
  f_statistic: {
    term: "F",
    what: "The ANOVA ratio of between-group variance to within-group variance.",
    read: "Larger F → groups differ more relative to their internal spread. The omnibus p translates it.",
  },
  h_statistic: {
    term: "H",
    what: "The Kruskal–Wallis statistic — the rank-based analogue of F.",
    read: "Interpret through the omnibus p; ε² gives the effect size.",
  },
  chi2_statistic: {
    term: "χ²",
    what: "The total squared gap between observed and expected counts, scaled by the expected counts.",
    read: "Larger → observed counts depart further from independence. The p and Cramér's V are what you report.",
  },
  confidence_interval: {
    term: "95% confidence interval",
    what: "A range that, across repeated samples, would contain the true value 95% of the time. Iris reports it for differences, effect sizes, and correlations.",
    read: "Narrow = precise; wide = uncertain. If a difference's CI excludes 0 (or an odds ratio's CI excludes 1), the effect is significant at α = 0.05.",
  },
  mean_difference: {
    term: "Mean difference",
    what: "The plain difference between the two group means, in the data's own units.",
    read: "The effect on the scale you measured — read alongside the standardised effect size, which is unit-free.",
  },
  hedges_g: {
    term: "Hedges' g",
    what: "A standardised effect size: the difference between two means measured in pooled standard deviations (a small-sample-corrected Cohen's d).",
    read: "~0.2 small, ~0.5 medium, ~0.8 large. Unit-free, so it is comparable across studies. Sign follows the order of the groups.",
  },
  rank_biserial: {
    term: "Rank-biserial r",
    what: "The effect size for rank-based two-group tests — the net proportion of pairs favouring one group.",
    read: "Runs −1 to +1; 0 means no tendency. The robust counterpart to Hedges' g.",
  },
  eta_squared: {
    term: "η² (eta-squared)",
    what: "The proportion of the variance in the outcome explained by the grouping factor, for ANOVA.",
    read: "0 to 1; ~0.01 small, ~0.06 medium, ~0.14 large.",
  },
  epsilon_squared: {
    term: "ε² (epsilon-squared)",
    what: "The rank-based effect size for Kruskal–Wallis — the analogue of η².",
    read: "0 to 1, larger = stronger group separation.",
  },
  correlation_r: {
    term: "Correlation coefficient",
    what: "Strength and direction of association between two numeric variables.",
    read: "−1 to +1; 0 is no association. r (Pearson) is linear, ρ (Spearman) is monotonic.",
  },
  cramers_v: {
    term: "Cramér's V",
    what: "The effect size for a chi-square test — how strongly two categorical variables are associated.",
    read: "0 (independent) to 1 (perfectly associated). Interpret thresholds relative to table size.",
  },
  odds_ratio: {
    term: "Odds ratio",
    what: "For a 2×2 table, how many times higher the odds of an outcome are in one group than the other.",
    read: "1 = no difference; >1 and <1 are opposite directions. If the 95% CI excludes 1, the association is significant.",
  },
  pairwise_correction: {
    term: "Pairwise correction",
    what: "When you compare every pair of groups, you run many tests, which inflates the false-positive rate. These corrections adjust the per-pair p-values to keep the overall error controlled.",
    read: "The pairwise p-values shown are already adjusted — compare them to α directly. Tukey HSD pairs with ANOVA, Holm with Kruskal–Wallis.",
  },
  sample_n: {
    term: "n / N / k",
    what: "n is the number of observations (or complete pairs); N the total across all groups; k the number of groups compared.",
    read: "Larger n means more power to detect a real effect. For paired tests, n counts complete pairs, not raw rows.",
  },
  group_summary: {
    term: "Group summary",
    what: "Per-group descriptives. SD is the spread of the values; the 95% CI of the mean is the precision of the average; IQR is the middle 50% of values.",
    read: "SD and IQR describe the data's spread; the CI of the mean describes how well you've pinned the average — it shrinks as n grows.",
  },
  methods_text: {
    term: "Methods text",
    what: "A ready-to-paste sentence describing the test and the numbers, in journal methods style.",
    read: "Copy it into a manuscript. It records exactly what was run, including whether you accepted the recommendation or overrode it.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof STATS_GLOSSARY;
