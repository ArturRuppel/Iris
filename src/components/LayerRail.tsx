import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, effectiveSchemaAtom,
  registryAtom,
} from "../state";
import { axisTypes, geomAddable } from "../channels";
import type { Geom } from "../types";
import { EncodingsCard } from "./EncodingsCard";
import { LayerStrip } from "./LayerStrip";

export function LayerRail() {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const addLayer = useSetAtom(addLayerAtom);
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (!active || !registry) return null;
  if (collapsed) {
    return (
      <div className="layer-rail collapsed">
        <button className="rail-expand" title="Show encoding & layers"
          onClick={() => setCollapsed(false)}>⋮ Encoding</button>
      </div>
    );
  }

  /* type-driven gating (Phase 3): a geom is offerable iff the current axis types
     satisfy its (x_type, y_type). Incompatible geoms stay visible but disabled
     with a teaching reason, instead of being hidden by a stored family. */
  const { xType, yType } = axisTypes(active.mappings, schema);

  const allGeoms = Object.keys(registry.geoms) as Geom[];
  /* the add menu offers every geom the current encoding doesn't *rule out* —
     a geom whose mapped axis is the wrong type is hidden (item 6), but an
     UNMAPPED axis no longer hides it (geom-first: pick a geom before any column,
     then it narrows the encoding). Item K: a geom may be added more than once
     (e.g. faint raw dots + bold aggregate dots at a coarser level), so the stack
     no longer excludes already-used geoms; a count tells the user some were
     hidden as incompatible. */
  const addable = allGeoms.filter((g) => {
    const meta = registry.geoms[g];
    return meta ? geomAddable(meta, xType, yType) : false;
  });
  const hiddenCount = allGeoms.length - addable.length;
  const noEncoding = xType === null && yType === null;

  return (
    <div className="layer-rail">
      <div className="rail-head">
        <strong>Encoding & layers</strong>
        <button className="icon" title="Hide encoding & layers"
          onClick={() => setCollapsed(true)}>⟨</button>
      </div>

      <EncodingsCard />

      <LayerStrip addSlot={
        adding ? (
          <div className="add-layer-menu">
            {addable.length === 0 && (
              <em className="rail-empty">
                No layer fits the current encoding — change X / Y to enable layers.
              </em>
            )}
            {addable.length > 0 && noEncoding && (
              <em className="rail-hint">Pick a geom — it will narrow what X / Y can map.</em>
            )}
            {addable.map((g) => (
              <button key={g} onClick={() => { addLayer(g); setAdding(false); }}>
                {registry.geoms[g].label}
              </button>
            ))}
            {hiddenCount > 0 && addable.length > 0 && (
              <em className="rail-empty">
                {hiddenCount} more hidden — incompatible with the current encoding
              </em>
            )}
            <button className="cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="add-layer-btn" onClick={() => setAdding(true)}>+ Add layer</button>
        )
      } />
    </div>
  );
}
