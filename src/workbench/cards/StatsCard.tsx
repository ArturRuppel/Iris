import { StatsResults } from "../../components/StatsPanel";
import type { CardBodyProps } from "../cardRegistry";

/* The stats terminal: the test-result readout. StatsResults binds to the active
   analysis's stats result, so the card needs no target. The test picker lives in
   its own TestCard (design §5 result-vs-picker split). */
export function StatsCard(_props: CardBodyProps) {
  return (
    <div className="txw-card-stats" data-testid="stats-card">
      <StatsResults />
    </div>
  );
}
