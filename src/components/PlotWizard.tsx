import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, effectiveSchemaAtom, hierarchyAtom,
  registryAtom, updateLayerAtom,
} from "../state";
import { geomSatisfiableByColumns } from "../channels";
import type { Geom } from "../types";
import { levelOptions } from "../levels";
import { EncodingsCard } from "./EncodingsCard";
import { firstStep, nextStep, type WizardMode, type WizardStep } from "./plotWizard";

/* The guided add-plot / add-layer shell. It does not own plot state — it sequences
   existing surfaces over the existing atoms. onDone/onCancel are owned by the host. */
export function PlotWizard({ mode, onDone, onCancel }: {
  mode: WizardMode; onDone: () => void; onCancel: () => void;
}) {
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const active = useAtomValue(activePlottableAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const addLayer = useSetAtom(addLayerAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const [step, setStep] = useState<WizardStep>(() => firstStep(mode));

  if (!registry || !active) return null;
  const columns = schema?.columns ?? [];
  const lastIndex = active.layers.length - 1;

  const pickGeom = (g: Geom) => {
    addLayer(g);
    setStep(nextStep(mode, "type"));
  };

  const xyMapped = !!active.mappings.x && !!active.mappings.y;

  return (
    <div className="plot-wizard" data-testid="plot-wizard">
      {step === "type" && (
        <div className="wiz-step wiz-type">
          <p className="wiz-head">Choose a plot type</p>
          <div className="wiz-gallery">
            {(Object.keys(registry.geoms) as Geom[])
              .filter((g) => {
                const meta = registry.geoms[g];
                return meta ? geomSatisfiableByColumns(meta, columns, registry) : false;
              })
              .map((g) => (
                <button key={g} className="wiz-geom" onClick={() => pickGeom(g)}>
                  {registry.geoms[g].label}
                </button>
              ))}
          </div>
          <button className="cancel" onClick={onCancel}>cancel</button>
        </div>
      )}

      {step === "map" && (
        <div className="wiz-step wiz-map">
          <p className="wiz-head">Map your data</p>
          <EncodingsCard />
          <div className="wiz-actions">
            <button className="cancel" onClick={onCancel}>cancel</button>
            <button className="wiz-done" disabled={!xyMapped} onClick={onDone}>Done</button>
          </div>
        </div>
      )}

      {step === "grain" && (
        <div className="wiz-step wiz-grain">
          <p className="wiz-head">Choose the grain for this layer</p>
          <select
            value={active.layers[lastIndex]?.level ?? ""}
            onChange={(e) =>
              updateLayer({ index: lastIndex,
                layer: { ...active.layers[lastIndex], level: e.target.value } })
            }
          >
            {levelOptions(hierarchy, schema).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="wiz-inherited">
            X = {active.mappings.x || "—"}, Y = {active.mappings.y || "—"} (inherited from the figure)
          </p>
          <div className="wiz-actions">
            <button className="cancel" onClick={onCancel}>cancel</button>
            <button className="wiz-done" onClick={onDone}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
