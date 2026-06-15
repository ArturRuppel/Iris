import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, analysisAtom } from "../state";
import type { StatsResult, TestName } from "../types";

const fmtP = (p: number) => (p < 0.001 ? "< 0.001" : "= " + p.toFixed(3));
const stars = (p: number) => (p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "ns");
const TEST_LABELS: Record<string, string> = {
  welch_t: "Welch's t-test",
  mann_whitney: "Mann–Whitney U",
  pearson: "Pearson r",
  spearman: "Spearman ρ",
  descriptive: "Descriptive summary",
};
const FAMILY_TESTS: Record<string, TestName[]> = {
  welch_t: ["welch_t", "mann_whitney"],
  mann_whitney: ["welch_t", "mann_whitney"],
  pearson: ["pearson", "spearman"],
  spearman: ["pearson", "spearman"],
};

function ResultRows({ s }: { s: StatsResult }) {
  const r = s.result;
  switch (r.test) {
    case "welch_t":
      return (
        <>
          <dt>t ({r.df!.toFixed(1)} df)</dt><dd className="mono">{r.t!.toFixed(2)}</dd>
          <dt>p (two-tailed)</dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Mean difference</dt>
          <dd className="mono">{r.mean_diff!.toFixed(2)} (95% CI {r.mean_diff_ci![0].toFixed(2)}, {r.mean_diff_ci![1].toFixed(2)})</dd>
          <dt>Hedges' g (95% CI)</dt>
          <dd className="mono">{r.effect.value.toFixed(2)} ({r.effect.ci![0].toFixed(2)}, {r.effect.ci![1].toFixed(2)})</dd>
        </>
      );
    case "mann_whitney":
      return (
        <>
          <dt>U</dt><dd className="mono">{r.U!.toFixed(0)}</dd>
          <dt>p (two-tailed)</dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>Rank-biserial r</dt><dd className="mono">{r.effect.value.toFixed(2)}</dd>
        </>
      );
    case "pearson":
    case "spearman":
      return (
        <>
          <dt>{r.test === "pearson" ? "r" : "ρ"} (95% CI)</dt>
          <dd className="mono">{r.r!.toFixed(2)} ({r.effect.ci![0].toFixed(2)}, {r.effect.ci![1].toFixed(2)})</dd>
          <dt>p (two-tailed)</dt><dd className="mono strong">{fmtP(r.p!)} {stars(r.p!)}</dd>
          <dt>n (complete pairs)</dt><dd className="mono">{r.n}</dd>
        </>
      );
    case "descriptive":
      return (
        <>
          <dt>n</dt><dd className="mono">{r.n}</dd>
          <dt>Mean (SD)</dt><dd className="mono">{r.mean!.toFixed(2)} ({r.sd!.toFixed(2)})</dd>
          <dt>Median (IQR)</dt>
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
  const override = active?.override ?? null;
  const setOverride = (t: TestName | null) => active && setActive({ ...active, override: t });
  const setDescribeOnly = (v: boolean) =>
    active && setActive({ ...active, describeOnly: v });
  if (!analysis) return <section className="pane stats-pane"><div className="pane-head"><h2>Statistics</h2></div><p className="hint">Waiting for first analysis…</p></section>;

  const s = analysis.stats;
  const model = analysis.stat_model;
  const rec = s.recommendation;
  const alternatives = FAMILY_TESTS[s.result.test] ?? [];

  return (
    <section className="pane stats-pane">
      <div className="pane-head"><h2>Statistics</h2></div>
      <div className="stats-body">
        <h3>Inferred model</h3>
        <p className="reason">{model.design}.</p>
        <label className="describe-toggle">
          <input type="checkbox" checked={active?.describeOnly ?? false}
            onChange={(e) => setDescribeOnly(e.target.checked)} />
          Describe only — run no test
        </label>
        <h3>Assumption checks</h3>
        {s.checks.map((c) => (
          <div className="row" key={c.group}>
            <span>Shapiro–Wilk · {c.group}</span>
            {c.ok
              ? <span className="mono">W = {c.W!.toFixed(3)}, p {fmtP(c.p!)}{" "}
                  <em className={c.p! > s.alpha ? "ok" : "warn"}>{c.p! > s.alpha ? "normal" : "non-normal"}</em></span>
              : <span className="warn">unavailable ({c.reason})</span>}
          </div>
        ))}

        <h3>{s.result.test === "descriptive" ? "Reading the distribution" : "Recommended test"}</h3>
        <p className="reason"><strong>{TEST_LABELS[rec.test] ?? rec.test}</strong> — {rec.reason}.</p>
        {alternatives.length > 0 && (
          <div className="btn-row">
            {alternatives.map((t) => (
              <button key={t}
                className={s.result.test === t ? "chip active" : "chip"}
                onClick={() => setOverride(t === rec.test ? null : t)}>
                {TEST_LABELS[t]}{t === rec.test ? " ✓" : ""}
              </button>
            ))}
          </div>
        )}
        {override && <p className="override-note">User override — recorded as "user_override" in the spec.</p>}

        <h3>Result</h3>
        <dl>
          <ResultRows s={s} />
          {s.result.test !== "descriptive" && s.summaries.map((g) => (
            <span key={g.group} style={{ display: "contents" }}>
              <dt>{g.group}</dt>
              <dd className="mono">n = {g.n}, mean {g.mean.toFixed(1)} (SD {g.sd.toFixed(1)})</dd>
            </span>
          ))}
        </dl>

        <h3>Methods text</h3>
        <p className="methods">{s.methods_text}</p>
        <button className="chip" onClick={() => navigator.clipboard.writeText(s.methods_text)}>Copy</button>
      </div>
    </section>
  );
}
