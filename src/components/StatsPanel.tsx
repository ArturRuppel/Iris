import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { activePlottableAtom, analysisAtom, effectiveSchemaAtom, guideAnchorAtom, viewModeAtom } from "../state";
import type { StatsResult, TestName } from "../types";
import type { RateModel } from "../channels";
import { InfoTip } from "./InfoTip";
import {
  GuidedTestPicker, overrideFor,
  RATE_MODELS, RATE_MODEL_LABELS, exposureColumns,
} from "./GuidedTestPicker";
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
  one_sample_t: "One-sample t-test",
  wilcoxon_signed: "Wilcoxon signed-rank",
  pearson: "Pearson r",
  spearman: "Spearman ρ",
  descriptive: "Descriptive summary",
  chi_square: "Chi-square",
  fisher_exact: "Fisher's exact",
  nb_glm: "Negative-binomial GLM",
  poisson_glm: "Poisson GLM",
};
/* the rate family's resolved test ids — its result reads per-lane estimates, so
   several render sites branch on this rather than on a single test name. */
const isRateTest = (t: string) => t === "nb_glm" || t === "poisson_glm";
/* rate estimates span orders of magnitude (events/h vs events/s), so fixed
   decimals misrender; 3 significant digits reads right across scales. */
const fmtRate = (v: number) => Number(v.toPrecision(3)).toString();
const GROUP_TESTS: TestName[] = ["welch_t", "mann_whitney", "paired_t", "wilcoxon"];
// >2 groups: the omnibus alternatives (parametric ANOVA vs robust Kruskal).
const MULTI_TESTS: TestName[] = ["one_way_anova", "kruskal"];
// vs-reference family: parametric one-sample t vs robust signed-rank.
const LOCATION_TESTS: TestName[] = ["one_sample_t", "wilcoxon_signed"];
const FAMILY_TESTS: Record<string, TestName[]> = {
  welch_t: GROUP_TESTS,
  mann_whitney: GROUP_TESTS,
  paired_t: GROUP_TESTS,
  wilcoxon: GROUP_TESTS,
  one_way_anova: MULTI_TESTS,
  kruskal: MULTI_TESTS,
  one_sample_t: LOCATION_TESTS,
  wilcoxon_signed: LOCATION_TESTS,
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
    case "one_sample_t":
    case "wilcoxon_signed": {
      // vs-reference family: each x-lane is tested against the constant on its
      // own, so the per-lane p/stars (s.per_group) are the result — not a single
      // between-group number. Fall back to the top-level result if a build
      // predates per_group.
      const ref = s.reference ?? r.reference ?? 0;
      const lanes = s.per_group ?? [];
      return (
        <>
          <dt>Reference (chance) <InfoTip k="one_sample_t" /></dt>
          <dd className="mono">{ref}</dd>
          {lanes.length > 0 ? lanes.map((g) => (
            <span key={g.level} style={{ display: "contents" }}>
              <dt>{g.level} vs ref</dt>
              <dd className="mono strong">
                {g.p == null ? `n = ${g.n} (too few to test)` : `${fmtP(g.p)} ${g.stars}`}
              </dd>
            </span>
          )) : (
            <>
              <dt>p (vs reference) <InfoTip k="p_value" /></dt>
              <dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
              <dt>n <InfoTip k="sample_n" /></dt><dd className="mono">{r.n}</dd>
            </>
          )}
        </>
      );
    }
    case "nb_glm":
    case "poisson_glm": {
      // rate family: the result is one GLM rate estimate per lane (with its
      // model CI); the single top-level p is the global "does group matter"
      // likelihood-ratio test, absent for a single group.
      const lanes = s.per_group ?? [];
      return (
        <>
          <dt>Model <InfoTip k="rate_model" /></dt>
          <dd>{TEST_LABELS[r.test]}</dd>
          {lanes.map((g) => (
            <span key={g.level} style={{ display: "contents" }}>
              <dt>{g.level}</dt>
              <dd className="mono">
                rate {fmtRate(g.rate ?? 0)}
                {g.ci ? ` (95% CI ${fmtRate(g.ci[0])}, ${fmtRate(g.ci[1])})` : " (no model CI)"}
                , n = {g.n}
              </dd>
            </span>
          ))}
          {r.p != null && (
            <>
              <dt>p (group effect, LR test) <InfoTip k="p_value" /></dt>
              <dd className="mono strong">{fmtP(r.p)} {stars(r.p)}</dd>
            </>
          )}
        </>
      );
    }
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

const WAITING = (
  <section className="pane stats-pane">
    <div className="pane-head"><h2>Statistics</h2></div>
    <p className="hint">Waiting for first analysis…</p>
  </section>
);

/* The test-result readout: the `Result`, per-group summary, and methods text for
   the active analysis. Reads only the analysis atom. */
export function StatsResults() {
  const analysis = useAtomValue(analysisAtom);
  if (!analysis) return WAITING;
  const s = analysis.stats;

  // The requested test couldn't run (e.g. paired on unpaired data): the figure
  // still rendered, but there is no inferential result to read out. Explain it
  // here; the test picker (right) is where the user switches to a valid test.
  if (s.error) return (
    <section className="pane stats-pane">
      <div className="stats-body">
        <h3>No test run</h3>
        <p className="stat-error">{s.error}.</p>
        <p className="reason">Pick an applicable test to run it.</p>
      </div>
    </section>
  );

  return (
    <section className="pane stats-pane">
      <div className="stats-body">
        <h3>Result <InfoTip k="significance_stars" /></h3>
        <dl>
          <ResultRows s={s} />
          {/* the rate family's summaries duplicate its per-lane estimates (mean =
              rate, sd = 0), so the value-based summary block is skipped there */}
          {s.result.test !== "descriptive" && !isRateTest(s.result.test) && s.summaries.length > 0 && (
            <>
              <dt className="pairwise-head">Per-group summary <InfoTip k="group_summary" /></dt><dd></dd>
            </>
          )}
          {s.result.test !== "descriptive" && !isRateTest(s.result.test) && s.summaries.map((g) => (
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

/* The test-choice editor: inferred model, the describe-only / vs-reference
   toggles, assumption checks, and the guided picker / recommendation chip-row.
   Reads the analysis + active plottable atoms (it writes test choices back). */
export function TestPicker() {
  const analysis = useAtomValue(analysisAtom);
  const [active, setActive] = useAtom(activePlottableAtom);
  const setViewMode = useSetAtom(viewModeAtom);
  const setGuideAnchor = useSetAtom(guideAnchorAtom);
  const setOverride = (t: TestName | null) => active && setActive({ ...active, override: t });
  const setDescribeOnly = (v: boolean) =>
    active && setActive({ ...active, describeOnly: v });
  // vs-reference opt-in: null = test groups against each other; a number = test
  // each lane against that constant (the `location` family). Toggling on resets
  // any group-comparison override so the location default (one-sample t) takes,
  // and clears the rate opt-in — the two designs are mutually exclusive.
  const setReference = (v: number | null) =>
    active && setActive({ ...active, reference: v, rate: null, override: null });
  // edit the constant while already in vs-reference mode — keeps any test pick.
  const setReferenceValue = (v: number) =>
    active && setActive({ ...active, reference: v });
  // count-rate opt-in: toggling on flips the family to `rate` (count GLM with an
  // exposure offset); clears the reference and any override for the same reason.
  const setRateOn = (on: boolean) =>
    active && setActive({
      ...active,
      rate: on ? { exposure: "", model: "nb" } : null,
      reference: null, override: null,
    });
  const setRateExposure = (exposure: string) =>
    active?.rate && setActive({ ...active, rate: { ...active.rate, exposure } });
  const setRateModel = (model: RateModel) =>
    active?.rate && setActive({ ...active, rate: { ...active.rate, model } });
  const schema = useAtomValue(effectiveSchemaAtom);
  if (!analysis) return WAITING;

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
      <div className="pane-head">
        <button type="button" className="link-btn methods-link"
          title="How Iris recommends a test — rules, thresholds, and sources"
          onClick={() => { setGuideAnchor("how-iris-chooses-the-test"); setViewMode("guide"); }}>
          Why this test?
        </button>
      </div>
      <div className="stats-body">
        {s.error && <p className="stat-error">{s.error}. No test ran — choose one below.</p>}
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
        {(model.family === "group_comparison" || model.family === "location"
          || model.family === "descriptive") && (
          /* Opt this numeric plot into a vs-reference (one-sample) test — each
             lane against a constant (chance/control/unity) instead of against
             the other lanes. Offered for the ungrouped case too (only Y mapped
             — the engine draws a single "all" lane), where the family reads
             `descriptive` until the toggle flips it. A design the column types
             can't imply, so it is an explicit toggle that round-trips via
             stats.reference. */
          <label className="describe-toggle">
            <input type="checkbox" checked={active?.reference != null}
              onChange={(e) => setReference(e.target.checked ? 0 : null)} />
            Test against a reference value
            <InfoTip k="one_sample_t" />
            {active?.reference != null && (
              <input type="number" className="ref-value" step="any" value={active.reference}
                aria-label="reference value"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setReferenceValue(e.target.value === "" ? 0 : Number(e.target.value))} />
            )}
          </label>
        )}
        {(model.family === "group_comparison" || model.family === "rate") && (
          /* Opt this grouped numeric plot into the count-rate family — per group,
             a Poisson/NB GLM turns the counts into a rate (per exposure) with a
             model CI. Grouped shapes only: the engine renders a rate only with a
             grouping column. Also not type-derivable, so an explicit toggle that
             round-trips via stats.exposure / stats.model. */
          <>
            <label className="describe-toggle">
              <input type="checkbox" checked={active?.rate != null}
                onChange={(e) => setRateOn(e.target.checked)} />
              Model counts as a rate
              <InfoTip k="rate_glm" />
            </label>
            {active?.rate != null && (
              <div className="rate-config">
                <label className="rate-row">
                  <span>per <InfoTip k="exposure_offset" /></span>
                  <select value={active.rate.exposure} aria-label="exposure column"
                    onChange={(e) => setRateExposure(e.target.value)}>
                    <option value="">(nothing — rate per row)</option>
                    {exposureColumns(schema, active.mappings).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="rate-row">
                  <span>count model <InfoTip k="rate_model" /></span>
                  <select value={active.rate.model} aria-label="count model"
                    onChange={(e) => setRateModel(e.target.value as RateModel)}>
                    {RATE_MODELS.map((m) => (
                      <option key={m} value={m}>{RATE_MODEL_LABELS[m]}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </>
        )}
        {!active?.describeOnly && s.result.test !== "descriptive" && (
          /* significance brackets drawn onto the figure — folded in from the
             retired annotate edge. Only meaningful when a real test runs. Binds
             the same style.show_significance flag the graph reads. */
          <label className="describe-toggle">
            <input type="checkbox" checked={active?.style.show_significance ?? false}
              onChange={(e) => active &&
                setActive({ ...active, style: { ...active.style, show_significance: e.target.checked } })} />
            Draw significance brackets on the figure
            <InfoTip k="significance_stars" />
          </label>
        )}
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
        ) : s.decision?.structural && s.decision?.assumption ? (
          /* Two-group numeric family: the engine emits a per-question `decision`
             with both axes, so guide the user through the questions and derive the
             test. The location family emits only an `assumption` axis (no
             structural pairing) and the rate family a model/global-LR record, so
             both fall through to the chip row below. */
          <GuidedTestPicker
            decision={{ structural: s.decision.structural, assumption: s.decision.assumption }}
            /* no test ran (recoverable error): preview where the recommended
               answers land rather than the "none" placeholder. */
            resolvedTest={(s.result.test === "none" ? rec.test : s.result.test) as TestName}
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
      </div>
    </section>
  );
}
