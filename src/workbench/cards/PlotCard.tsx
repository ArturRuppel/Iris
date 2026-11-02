import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { specAtom, effectiveSchemaAtom, plotWizardOpenCountAtom } from "../../state";
import { dataCardStates } from "../cardGating";
import { FigurePane } from "../../components/FigurePane";
import { EncodingsCard } from "../../components/EncodingsCard";
import { StylePane } from "../../components/StylePane";
import { displayFocusAtom } from "../state";
import { LayerStrip } from "../../components/LayerStrip";
import { PlotWizard } from "../../components/PlotWizard";
import type { WizardMode } from "../../components/plotWizard";
import type { CardBodyProps } from "../cardRegistry";

/* The figure's plot card. When the live spec is renderable it shows the figure
   and, beside or below it depending on the card's width, its encoding (X, Y, colour,
   facets), its style, and the layer list with its add-layer button. The figure stays
   pinned in view while the controls scroll, so an edit is always seen as it is made
   (index.css, "plot card layout"). Otherwise the guided "+ add plot" CTA. Hosts the
   add-plot / add-layer wizard. Binds to the active spec via atoms (the target only
   ties the card to the figure node for the slot badge), so it renders correctly
   wherever it is pinned — including the seeded default slot before any plot exists.
   This is what the old fixed Plot hero card carried, now portable per design A. */
export function PlotCard(_props: CardBodyProps) {
  const spec = useAtomValue(specAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const { plotEnabled } = dataCardStates(spec, schema);
  const [wizard, setWizard] = useState<WizardMode | null>(null);

  /* Publish "a wizard is open here" while one is, so the tutorial can wait for the
     user to actually finish building rather than fire the moment a geom is picked. */
  const setWizardCount = useSetAtom(plotWizardOpenCountAtom);
  useEffect(() => {
    if (!wizard) return;
    setWizardCount((c) => c + 1);
    return () => setWizardCount((c) => c - 1);
  }, [wizard, setWizardCount]);

  /* the geom edge (and "Edit plot…") asks for the encoding section: open it and
     bring it into view, instead of floating a separate editor over the canvas. */
  const focus = useAtomValue(displayFocusAtom);
  const encRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (focus?.section !== "encoding" || !encRef.current) return;
    encRef.current.open = true;
    encRef.current.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [focus]);

  return (
    <div className="txw-card-plot" data-testid="plot-card" data-tour="plot">
      {wizard ? (
        <PlotWizard mode={wizard}
          onDone={() => setWizard(null)} onCancel={() => setWizard(null)} />
      ) : plotEnabled ? (
        <div className="plot-split">
          <div className="plot-figure-side"><FigurePane /></div>
          <div className="plot-controls">
            <details className="style-pane plot-encoding" open ref={encRef}>
              <summary>Encoding</summary>
              <EncodingsCard />
            </details>
            <StylePane />
            <LayerStrip addSlot={
              <button className="add-layer-btn" onClick={() => setWizard("addLayer")}>
                + add layer
              </button>
            } />
          </div>
        </div>
      ) : (
        <button className="txw-add-plot" data-tour="add-plot" onClick={() => setWizard("first")}>+ add plot</button>
      )}
    </div>
  );
}
