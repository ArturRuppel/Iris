import { TestPicker } from "../../components/StatsPanel";
import type { CardBodyProps } from "../cardRegistry";

/* The test edge's editor: the test-choice picker (inferred model, describe-only /
   vs-reference toggles, assumption checks, and the guided/recommendation picker).
   TestPicker binds to the active analysis + plottable, so the card needs no
   target. The result readout lives in StatsCard (design §5 split). */
export function TestCard(_props: CardBodyProps) {
  return (
    <div className="txw-card-test" data-testid="test-card">
      <TestPicker />
    </div>
  );
}
