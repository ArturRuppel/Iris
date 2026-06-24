import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, analysisAtom } from "../../state";
import type { CardBodyProps } from "../cardRegistry";

/* The stats->plot "annotate" edge's editor: a single toggle for whether the
   figure draws significance brackets/stars from the test result. Reuses the
   existing style.show_significance flag (Phase 1 already derives the annotate
   graph edge from it) — no new spec field. Decorative annotations (reference
   lines, bands) live in the geom config, not here (design §2.5). */
export function AnnotateCard(_props: CardBodyProps) {
  const [p, setP] = useAtom(activePlottableAtom);
  const analysis = useAtomValue(analysisAtom);
  if (!p) return <p className="hint">No active analysis.</p>;

  const on = !!p.style.show_significance;
  const test = analysis?.stats?.result?.test;

  return (
    <div className="txw-card-annotate" data-testid="annotate-card">
      <label className="describe-toggle">
        <input type="checkbox" checked={on}
          onChange={(e) =>
            setP({ ...p, style: { ...p.style, show_significance: e.target.checked } })} />
        Draw significance brackets on the figure
      </label>
      <p className="hint">
        {test ? `Brackets use the ${test} result.`
              : "Configure a test to annotate the figure."}
      </p>
    </div>
  );
}
