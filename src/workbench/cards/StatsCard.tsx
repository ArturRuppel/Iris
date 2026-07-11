import { useAtomValue } from "jotai";
import { specAtom, effectiveSchemaAtom } from "../../state";
import { dataCardStates } from "../cardGating";
import { StatsResults, TestPicker } from "../../components/StatsPanel";
import type { CardBodyProps } from "../cardRegistry";

/* The figure's stats card. Gates on the plot (nothing to test without a rendered
   figure): the results + test picker when a plot exists, otherwise the "add a plot
   first" stub. Binds to the active spec via atoms, like PlotCard — so the seeded
   default slot shows the stub until a plot is drawn. */
export function StatsCard(_props: CardBodyProps) {
  const spec = useAtomValue(specAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const { statsEnabled } = dataCardStates(spec, schema);

  return (
    <div className="txw-card-stats" data-testid="stats-card" data-tour="stats">
      {statsEnabled ? (
        <>
          <StatsResults />
          <TestPicker />
        </>
      ) : (
        <p className="txw-card-stub">Add a plot to see a test.</p>
      )}
    </div>
  );
}
