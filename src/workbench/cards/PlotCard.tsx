import { FigurePane } from "../../components/FigurePane";
import type { CardBodyProps } from "../cardRegistry";

/* The plot terminal: the rendered figure + its in-figure style controls. No
   encoding here — encoding lives on the geom edge (design §5). FigurePane binds
   to the active analysis's render result, so the card needs no target. */
export function PlotCard(_props: CardBodyProps) {
  return (
    <div className="txw-card-plot" data-testid="plot-card">
      <FigurePane />
    </div>
  );
}
