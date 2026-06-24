import { CollapseRoutingPanel } from "../../components/CollapseRoutingPanel";
import type { CardBodyProps } from "../cardRegistry";

/* The collapse edge's editor: the aggregation routing (per-level grain + fn and
   the grain the test reads). The routing is per-analysis (one plan), so every
   collapse edge opens the same panel; CollapseRoutingPanel binds to the active
   analysis, so the card needs no target. */
export function CollapseCard(_props: CardBodyProps) {
  return (
    <div className="txw-card-collapse" data-testid="collapse-card">
      <CollapseRoutingPanel />
    </div>
  );
}
