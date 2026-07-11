import type { Schema, StatsDecision, TestName } from "../types";
import type { RateModel } from "../channels";
import { InfoTip } from "./InfoTip";
import { TEST_LABELS, type GlossaryKey } from "./statsGlossary";

/* The guided two-group test picker. Instead of presenting the test as a fait
   accompli, it surfaces the two questions a statistician would ask — is the
   design independent or paired? are the data parametric or should we stay
   robust? — recommends an answer to each (from the engine's `decision`), and
   lets the user confirm or change it. The resolved test falls out of the two
   answers. See docs/superpowers/specs/2026-06-17-guided-test-picker-ui-design.md */

/* The engine's `_COMBINE` grid (stats.py:79), mirrored on the frontend so the
   two answers map back to the single-`override` engine API. */
const COMBINE: Record<string, Record<string, TestName>> = {
  independent: { parametric: "welch_t", robust: "mann_whitney" },
  paired: { parametric: "paired_t", robust: "wilcoxon" },
};

export function combineGroupTest(structural: string, assumption: string): TestName {
  return COMBINE[structural]?.[assumption] ?? "welch_t";
}

/* Map a (structural, assumption) answer pair to the engine's `override` slot:
   the test the answers produce, or `null` when that equals the recommendation
   so an unchanged pair sends no override (engine reports `recommendation_accepted`). */
export function overrideFor(
  structural: string,
  assumption: string,
  recommendedTest: string,
): TestName | null {
  const test = combineGroupTest(structural, assumption);
  return test === recommendedTest ? null : test;
}

/* ---- count-rate (GLM) design controls — picker logic for the `rate` family ----
   The design questions a rate plot asks are "counts per WHAT?" (the exposure
   offset) and "which count model?"; both live on the plottable's `rate` opt-in
   and reach the engine as stats.exposure / stats.model. */

export const RATE_MODELS: RateModel[] = ["nb", "poisson", "auto"];
export const RATE_MODEL_LABELS: Record<RateModel, string> = {
  nb: "Negative binomial (robust to overdispersion)",
  poisson: "Poisson",
  auto: "Auto — Poisson unless overdispersed",
};

/* The columns offerable as a rate's exposure offset: numeric columns other than
   the mapped count column itself (the numeric side of the mapping — either
   orientation). Bools (0/1 event flags) and identifiers are excluded — an
   exposure is a positive duration/area/size, and the engine rejects values ≤ 0. */
export function exposureColumns(
  schema: Schema | null, mappings: { x: string; y: string },
): string[] {
  if (!schema) return [];
  return schema.columns
    .filter((c) => c.type === "numeric")
    .map((c) => c.name)
    .filter((name) => name !== mappings.x && name !== mappings.y);
}

type Axis = "structural" | "assumption";

const AXIS_META: Record<Axis, {
  num: string; title: string; hint: string; tip: GlossaryKey;
  labels: Record<string, string>;
}> = {
  structural: {
    num: "①", title: "Study design", hint: "independent vs paired",
    tip: "independent_vs_paired",
    labels: { independent: "Independent", paired: "Paired" },
  },
  assumption: {
    num: "②", title: "Distribution", hint: "parametric vs robust",
    tip: "parametric_vs_robust",
    labels: { parametric: "Parametric", robust: "Robust" },
  },
};

function AxisCard({ axis, decision, onPick }: {
  axis: Axis; decision: StatsDecision; onPick: (value: string) => void;
}) {
  const meta = AXIS_META[axis];
  const label = (o: string) => meta.labels[o] ?? o;
  // A single-option axis isn't adjustable (e.g. paired needs a shared unit that
  // isn't present). Surface it as a stated fact with its reason, not a control —
  // the question is still shown and answered, just honestly not offerable.
  const single = decision.options.length === 1;

  return (
    <div className="qcard">
      <div className="qcard-head">
        <span className="qnum">{meta.num}</span>
        <span className="qtitle">{meta.title}</span>
        <span className="qhint">{meta.hint}</span>
        <InfoTip k={meta.tip} />
      </div>

      {single ? (
        <p className="qstatic"><strong>{label(decision.options[0])}</strong> — {decision.reason}</p>
      ) : (
        <>
          <div className="seg" role="radiogroup" aria-label={meta.title}>
            {decision.options.map((opt) => (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={opt === decision.chosen}
                className={"opt"
                  + (opt === decision.chosen ? " active" : "")
                  + (opt === decision.recommended ? " rec" : "")}
                onClick={() => onPick(opt)}
              >
                {label(opt)}
              </button>
            ))}
            <span className="seg-badge">✓ Recommended: {label(decision.recommended)}</span>
          </div>
          <p className="reason">{decision.reason}</p>
        </>
      )}
    </div>
  );
}

export function GuidedTestPicker({ decision, resolvedTest, onChange }: {
  decision: { structural: StatsDecision; assumption: StatsDecision };
  resolvedTest: TestName;
  onChange: (structural: string, assumption: string) => void;
}) {
  const pick = (axis: Axis, value: string) =>
    onChange(
      axis === "structural" ? value : decision.structural.chosen,
      axis === "assumption" ? value : decision.assumption.chosen,
    );

  return (
    <div className="guided-picker">
      <h3>Choosing the test <InfoTip k="recommended_test" /></h3>
      <AxisCard axis="structural" decision={decision.structural}
        onPick={(v) => pick("structural", v)} />
      <AxisCard axis="assumption" decision={decision.assumption}
        onPick={(v) => pick("assumption", v)} />
      <div className="qfooter">
        <span className="qresult">→ {TEST_LABELS[resolvedTest] ?? resolvedTest}</span>
        <InfoTip k={resolvedTest as GlossaryKey} />
      </div>
    </div>
  );
}
