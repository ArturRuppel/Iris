import { useAtomValue } from "jotai";
import { useState } from "react";
import { specAtom, effectiveSchemaAtom } from "../state";
import { heroCardStates } from "./cardGating";
import { TableCard } from "./cards/TableCard";
import { FigurePane } from "../components/FigurePane";
import { StatsResults, TestPicker } from "../components/StatsPanel";
import { LayerStrip } from "../components/LayerStrip";
import { PlotWizard } from "../components/PlotWizard";
import type { WizardMode } from "../components/plotWizard";
import type { ExplorerGraph } from "../explorer/graph";

/* One framed hero card. Disabled cards get .txw-card-disabled so the row reads
   "one done, two waiting." */
function HeroCard({ title, disabled, testid, children }: {
  title: string; disabled?: boolean; testid: string; children: React.ReactNode;
}) {
  return (
    <section className={`txw-hero-card${disabled ? " txw-card-disabled" : ""}`} data-testid={testid}>
      <header className="txw-hero-bar">{title}</header>
      <div className="txw-hero-body">{children}</div>
    </section>
  );
}

/* The always-on landing row: source Table, the Plot, and the Stats. Table is
   always live; Plot/Stats gate on the live spec (heroCardStates). The Plot card is
   the home of the guided add-plot/add-layer wizard. */
export function HeroCards({ graph }: { graph: ExplorerGraph }) {
  const spec = useAtomValue(specAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const { plotEnabled, statsEnabled } = heroCardStates(spec, schema);
  const [wizard, setWizard] = useState<WizardMode | null>(null);

  const sourceId = graph.nodes.find((n) => n.phase === "source")?.id ?? "source";

  return (
    <div className="txw-hero-row" data-testid="hero-row">
      <HeroCard title="Table" testid="hero-table">
        <TableCard target={{ kind: "node", id: sourceId }} />
      </HeroCard>

      <HeroCard title="Plot" disabled={!plotEnabled && !wizard} testid="hero-plot">
        {wizard ? (
          <PlotWizard mode={wizard}
            onDone={() => setWizard(null)} onCancel={() => setWizard(null)} />
        ) : plotEnabled ? (
          <>
            <FigurePane />
            <LayerStrip addSlot={
              <button className="add-layer-btn" onClick={() => setWizard("addLayer")}>
                + add layer
              </button>
            } />
          </>
        ) : (
          <button className="txw-add-plot" onClick={() => setWizard("first")}>+ add plot</button>
        )}
      </HeroCard>

      <HeroCard title="Stats" disabled={!statsEnabled} testid="hero-stats">
        {statsEnabled ? (
          <>
            <StatsResults />
            <TestPicker />
          </>
        ) : (
          <p className="txw-card-stub">Add a plot to see a test.</p>
        )}
      </HeroCard>
    </div>
  );
}
