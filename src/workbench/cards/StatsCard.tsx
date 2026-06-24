import { StatsPanel } from "../../components/StatsPanel";
import type { CardBodyProps } from "../cardRegistry";

/* The stats terminal: the test-result readout. StatsPanel binds to the active
   analysis's stats result, so the card needs no target. (StatsPanel currently
   also embeds the test picker; the result-vs-picker split per design §5 is
   deferred to the Phase 5 canvas wiring.) */
export function StatsCard(_props: CardBodyProps) {
  return (
    <div className="txw-card-stats" data-testid="stats-card">
      <StatsPanel />
    </div>
  );
}
