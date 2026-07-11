import { useAtomValue } from "jotai";
import { useState } from "react";
import { specAtom, effectiveSchemaAtom } from "../../state";
import { dataCardStates } from "../cardGating";
import { FigurePane } from "../../components/FigurePane";
import { LayerStrip } from "../../components/LayerStrip";
import { PlotWizard } from "../../components/PlotWizard";
import type { WizardMode } from "../../components/plotWizard";
import type { CardBodyProps } from "../cardRegistry";

/* The figure's plot card. When the live spec is renderable it shows the figure
   plus its add-layer strip; otherwise the guided "+ add plot" CTA. Hosts the
   add-plot / add-layer wizard. Binds to the active spec via atoms (the target only
   ties the card to the figure node for the slot badge), so it renders correctly
   wherever it is pinned — including the seeded default slot before any plot exists.
   This is what the old fixed Plot hero card carried, now portable per design A. */
export function PlotCard(_props: CardBodyProps) {
  const spec = useAtomValue(specAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const { plotEnabled } = dataCardStates(spec, schema);
  const [wizard, setWizard] = useState<WizardMode | null>(null);

  return (
    <div className="txw-card-plot" data-testid="plot-card" data-tour="plot">
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
        <button className="txw-add-plot" data-tour="add-plot" onClick={() => setWizard("first")}>+ add plot</button>
      )}
    </div>
  );
}
