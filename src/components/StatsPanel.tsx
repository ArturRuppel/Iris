import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, analysisAtom } from "../state";
import type { StatsResult, TestName } from "../types";
import { InfoTip } from "./InfoTip";
import { GuidedTestPicker, overrideFor } from "./GuidedTestPicker";
import type { GlossaryKey } from "./statsGlossary";

const fmtP = (p: number) => (p < 0.001 ? "< 0.001" : "= " + p.toFixed(3));
const stars = (p: number) => (p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "ns");
const TEST_LABELS: Record<string, string> = {
  welch_t: "Welch's t-test",
  mann_whitney: "Mann–Whitney U",
  paired_t: "Paired t-test",
  wilcoxon: "Wilcoxon signed-rank",
  one_way_anova: "One-way ANOVA",
  kruskal: "Kruskal–Wallis",
  pearson: "Pearson r",
  spearman: "Spearman ρ",
  descriptive: "Descriptive summary",
  chi_square: "Chi-square",
  fisher_exact: "Fisher's exact",
};
const GROUP_TESTS: TestName[] = ["welch_t", "mann_whitney", "paired_t", "wilcoxon"];
// >2 groups: the omnibus alternatives (parametric ANOVA vs robust Kruskal).
const MULTI_TESTS: TestName[] = ["one_way_anova", "kruskal"];
const FAMILY_TESTS: Record<string, TestName[]> = {
  welch_t: GROUP_TESTS,
  mann_whitney: GROUP_TESTS,
  paired_t: GROUP_TESTS,
  wilcoxon: GROUP_TESTS,
  one_way_anova: MULTI_TESTS,
  kruskal: MULTI_TESTS,
  pearson: ["pearson", "spearman"],
  spearman: ["pearson", "spearman"],
  // Fisher's exact is offered only for 2×2; the engine falls back to chi-square
  // for larger tables, so the override is harmless there.
  chi_square: ["chi_square", "fisher_exact"],
  fisher_exact: ["chi_square", "fisher_exact"],
};

function ResultRows({ s }: { s: StatsResult }) {
  const r = s.result;
  switch (r.test) {
    case "welch_t":
      return (
        <>
          <dt>t ({r.df!.toFixed(1)} df) <InfoTip k="t_statistic" /></dt><dd className="mono">{r.t!.toFixed(2)}</dd>
          <dt>p (two-tailed) <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Mean difference <InfoTip k="mean_difference" /></dt>
          <dd className="mono">{r.mean_diff!.toFixed(2)} (95% CI {r.mean_diff_ci![0].toFixed(2)}, {r.mean_diff_ci![1].toFixed(2)})</dd>
          <dt>Hedges' g (95% CI) <InfoTip k="hedges_g" /></dt>
          <dd className="mono">{r.effect.value.toFixed(2)} ({r.effect.ci![0].toFixed(2)}, {r.effect.ci![1].toFixed(2)})</dd>
        </>
      );
    case "mann_whitney":
      return (
        <>
          <dt>U <InfoTip k="u_statistic" /></dt><dd className="mono">{r.U!.toFixed(0)}</dd>
          <dt>p (two-tailed) <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Rank-biserial r <InfoTip k="rank_biserial" /></dt><dd className="mono">{r.effect.value.toFixed(2)}</dd>
        </>
      );
    case "paired_t":
      return (
        <>
          <dt>t ({r.df!.toFixed(0)} df) <InfoTip k="t_statistic" /></dt><dd className="mono">{r.t!.toFixed(2)}</dd>
          <dt>p (two-tailed) <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Mean difference <InfoTip k="mean_difference" /></dt>
          <dd className="mono">{r.mean_diff!.toFixed(2)} (95% CI {r.mean_diff_ci![0].toFixed(2)}, {r.mean_diff_ci![1].toFixed(2)})</dd>
          <dt>Hedges' g <InfoTip k="hedges_g" /></dt><dd className="mono">{r.effect.value.toFixed(2)}</dd>
          <dt>n (pairs) <InfoTip k="sample_n" /></dt><dd className="mono">{r.n}</dd>
        </>
      );
    case "wilcoxon":
      return (
        <>
          <dt>W <InfoTip k="w_statistic" /></dt><dd className="mono">{r.W!.toFixed(0)}</dd>
          <dt>p (two-tailed) <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Rank-biserial r <InfoTip k="rank_biserial" /></dt><dd className="mono">{r.effect.value.toFixed(2)}</dd>
          <dt>n (pairs) <InfoTip k="sample_n" /></dt><dd className="mono">{r.n}</dd>
        </>
      );
    case "one_way_anova":
    case "kruskal":
      return (
        <>
          {r.test === "one_way_anova" ? (
            <>
              <dt>F ({r.df_between}, {r.df_within} df) <InfoTip k="f_statistic" /></dt>
              <dd className="mono">{r.F!.toFixed(2)}</dd>
            </>
          ) : (
            <>
              <dt>H ({r.df} df) <InfoTip k="h_statistic" /></dt><dd className="mono">{r.H!.toFixed(2)}</dd>
            </>
          )}
          <dt>p (omnibus) <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>{r.effect.name === "eta_squared" ? "η²" : "ε²"} <InfoTip k={r.effect.name === "eta_squared" ? "eta_squared" : "epsilon_squared"} /></dt>
          <dd className="mono">{r.effect.value.toFixed(2)}</dd>
          <dt>N (k groups) <InfoTip k="sample_n" /></dt><dd className="mono">{r.n} ({r.k})</dd>
          <dt className="pairwise-head">
            Pairwise ({r.correction === "tukey" ? "Tukey HSD" : "Holm-adjusted"}) <InfoTip k="pairwise_correction" />
          </dt><dd></dd>
          {(r.pairwise ?? []).map((pw) => (
            <span key={`${pw.a}-${pw.b}`} style={{ display: "contents" }}>
              <dt className="pairwise-row">{pw.a} vs {pw.b}</dt>
              <dd className="mono">{fmtP(pw.p_adj)} {pw.stars}</dd>
            </span>
          ))}
        </>
      );
    case "pearson":
    case "spearman":
      return (
        <>
          <dt>{r.test === "pearson" ? "r" : "ρ"} (95% CI) <InfoTip k="correlation_r" /></dt>
          <dd className="mono">{r.r!.toFixed(2)} ({r.effect.ci![0].toFixed(2)}, {r.effect.ci![1].toFixed(2)})</dd>
          <dt>p (two-tailed) <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>n (complete pairs) <InfoTip k="sample_n" /></dt><dd className="mono">{r.n}</dd>
        </>
      );
    case "chi_square":
      return (
        <>
          <dt>χ² ({r.dof} df) <InfoTip k="chi2_statistic" /></dt><dd className="mono">{r.chi2!.toFixed(2)}</dd>
          <dt>p <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Cramér's V <InfoTip k="cramers_v" /></dt><dd className="mono">{r.effect.value.toFixed(2)}</dd>
          <dt>n <InfoTip k="sample_n" /></dt><dd className="mono">{r.n}</dd>
        </>
      );
    case "fisher_exact":
      return (
        <>
          <dt>p (two-sided) <InfoTip k="p_value" /></dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Odds ratio (95% CI) <InfoTip k="odds_ratio" /></dt>
          <dd className="mono">{r.odds_ratio!.toFixed(2)} ({r.effect.ci![0].toFixed(2)}, {r.effect.ci![1].toFixed(2)})</dd>
          <dt>n <InfoTip k="sample_n" /></dt><dd className="mono">{r.n}</dd>
        </>
      );
    case "descriptive":
      return (
        <>
          <dt>n <InfoTip k="sample_n" /></dt><dd className="mono">{r.n}</dd>
          <dt>Mean (SD) <InfoTip k="group_summary" /></dt><dd className="mono">{r.mean!.toFixed(2)} ({r.sd!.toFixed(2)})</dd>
          <dt>Median (IQR) <InfoTip k="group_summary" /></dt>
          <dd className="mono">{r.median!.toFixed(2)} ({r.q1!.toFixed(2)}–{r.q3!.toFixed(2)})</dd>
          <dt>Range</dt><dd className="mono">{r.min!.toFixed(2)} to {r.max!.toFixed(2)}</dd>
        </>
      );
    default:
      return null;
  }
}

export function StatsPanel() {
  const analysis = useAtomValue(analysisAtom);
  const [active, setActive] = useAtom(activePlottableAtom);
  const setOverride = (t: TestName | null) => active && setActive({ ...active, override: t });
  const setDescribeOnly = (v: boolean) =>
    active && setActive({ ...active, describeOnly: v });
  if (!analysis) return <section className="pane stats-pane"><div className="pane-head"><h2>Statistics</h2></div><p className="hint">Waiting for first analysis…</p></section>;

  const s = analysis.stats;
  const model = analysis.stat_model;
  const rec = s.recommendation;
  // Paired cells are only offered when the data has a pairing structure (derived
  // from the spine). Without it, drop them so the user can't pick an invalid test.
  const paired = model.pairing?.verdict === "paired"
    || model.pairing?.verdict === "partially_paired";
  const alternatives = (FAMILY_TESTS[s.result.test] ?? []).filter(
    (t) => paired || (t !== "paired_t" && t !== "wilcoxon"));
  // The chip row spans the assumption axis (normal-theory vs rank-based) for the
  // numeric families; the chi-square family instead switches on small-sample
  // correction, so the "parametric vs robust" caption only fits the former.
  const assumptionAxis =
    s.result.test !== "chi_square" && s.result.test !== "fisher_exact";

  return (
    <section className="pane stats-pane">
      <div className="pane-head"><h2>Statistics</h2></div>
      <div className="stats-body">
        <h3>Inferred model <InfoTip k="independent_vs_paired" /></h3>
        <p className="reason">{model.design}.</p>
        {(model.issues as { code?: string; message?: string }[])
          .filter((i) => i.code === "color_second_factor")
          .map((i, k) => (
            <p className="reason stat-notice" key={k}>{i.message}</p>
          ))}
        <label className="describe-toggle">
          <input type="checkbox" checked={active?.describeOnly ?? false}
            onChange={(e) => setDescribeOnly(e.target.checked)} />
          Describe only — run no test
          <InfoTip k="describe_only" />
        </label>
        {s.checks.length > 0 && <h3>Assumption checks <InfoTip k="normality" /></h3>}
        {s.checks.map((c) => (
          <div className="row" key={c.group}>
            <span>Shapiro–Wilk · {c.group} <InfoTip k="shapiro_wilk" /></span>
            {c.ok
              ? <span className="mono">W = {c.W!.toFixed(3)}, p {fmtP(c.p!)}{" "}
                  <em className={c.p! > s.alpha ? "ok" : "warn"}>{c.p! > s.alpha ? "normal" : "non-normal"}</em></span>
              : <span className="warn">unavailable ({c.reason})</span>}
          </div>
        ))}

        {model.chosen_by === "describe_only" ? (
          <p className="reason">No test was run — describing only. Untick “Describe only” to run a test.</p>
        ) : s.decision ? (
          /* Two-group numeric family: the engine emits a per-question `decision`,
             so guide the user through the questions and derive the test. */
          <GuidedTestPicker
            decision={s.decision}
            resolvedTest={s.result.test as TestName}
            onChange={(structural, assumption) =>
              setOverride(overrideFor(structural, assumption, rec.test))}
          />
        ) : (
          /* Families the engine doesn't (yet) emit a `decision` for — multi-group,
             correlation, contingency — keep the recommendation + chip-row fallback. */
          <>
            <h3>
              {s.result.test === "descriptive" ? "Reading the distribution" : "Recommended test"}{" "}
              <InfoTip k={s.result.test === "descriptive" ? "descriptive" : "recommended_test"} />
            </h3>
            <p className="reason"><strong>{TEST_LABELS[rec.test] ?? rec.test}</strong> — {rec.reason}.</p>
            {alternatives.length > 1 && assumptionAxis && (
              <p className="reason assumption-axis">
                Parametric vs robust <InfoTip k="parametric_vs_robust" />
              </p>
            )}
            {alternatives.length > 0 && (
              <div className="btn-row">
                {alternatives.map((t) => (
                  <span className="chip-wrap" key={t}>
                    <button
                      className={s.result.test === t ? "chip active" : "chip"}
                      onClick={() => setOverride(t === rec.test ? null : t)}>
                      {TEST_LABELS[t]}{t === rec.test ? " ✓" : ""}
                    </button>
                    <InfoTip k={t as GlossaryKey} />
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        <h3>Result <InfoTip k="significance_stars" /></h3>
        <dl>
          <ResultRows s={s} />
          {s.result.test !== "descriptive" && s.summaries.length > 0 && (
            <>
              <dt className="pairwise-head">Per-group summary <InfoTip k="group_summary" /></dt><dd></dd>
            </>
          )}
          {s.result.test !== "descriptive" && s.summaries.map((g) => (
            <span key={g.group} style={{ display: "contents" }}>
              <dt>{g.group}</dt>
              <dd className="mono">n = {g.n}, mean {g.mean.toFixed(1)} (SD {g.sd.toFixed(1)})</dd>
            </span>
          ))}
        </dl>

        <h3>Methods text <InfoTip k="methods_text" /></h3>
        <p className="methods">{s.methods_text}</p>
        <button className="chip" onClick={() => navigator.clipboard.writeText(s.methods_text)}>Copy</button>
      </div>
    </section>
  );
}
