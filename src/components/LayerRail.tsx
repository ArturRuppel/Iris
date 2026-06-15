import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, effectiveSchemaAtom, moveLayerAtom,
  PRIMITIVES, registryAtom, removeLayerAtom, seedPrimitiveAtom, updateLayerAtom,
} from "../state";
import { axisTypes, geomGateReason } from "../channels";
import type { Geom, Layer, Registry } from "../types";
import { LayerCard } from "./LayerCards";
import { EncodingsCard } from "./EncodingsCard";

/* one geom layer, independently collapsible so a tall stack stays scannable.
   The plot type is a dropdown so a layer can be re-typed in place (e.g. box →
   violin) without removing and re-adding it. Geoms incompatible with the current
   encoding types appear disabled-with-reason rather than hidden. */
function LayerItem({ layer, registry, i, last, retypeGeoms, gateReason, onMove, onRemove, onChange }: {
  layer: Layer; registry: Registry; i: number; last: boolean; retypeGeoms: Geom[];
  gateReason: (g: Geom) => string | null;
  onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onChange: (l: Layer) => void;
}) {
  const [open, setOpen] = useState(true);
  /* switching geom resets params to that geom's defaults — same result as
     removing the layer and adding the new one, just in place. */
  const retype = (geom: Geom) =>
    onChange({ geom, params: { ...(registry.geoms[geom]?.params ?? {}) } });
  return (
    <li className="layer-card">
      <div className="layer-head">
        <button className="card-toggle layer-toggle" title={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}>
          <span className="chevron">{open ? "▾" : "▸"}</span>
        </button>
        <select className="layer-geom" value={layer.geom} title="Change plot type"
          onChange={(e) => retype(e.target.value as Geom)}>
          {retypeGeoms.map((g) => {
            const reason = g === layer.geom ? null : gateReason(g);
            return (
              <option key={g} value={g} disabled={!!reason}>
                {registry.geoms[g]?.label ?? g}{reason ? ` — ${reason}` : ""}
              </option>
            );
          })}
        </select>
        <span className="layer-actions">
          <button className="icon" title="Move up" disabled={i === 0}
            onClick={() => onMove(-1)}>↑</button>
          <button className="icon" title="Move down" disabled={last}
            onClick={() => onMove(1)}>↓</button>
          <button className="icon" title="Remove layer" onClick={onRemove}>✕</button>
        </span>
      </div>
      {open && <LayerCard layer={layer} registry={registry} onChange={onChange} />}
    </li>
  );
}

export function LayerRail() {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const addLayer = useSetAtom(addLayerAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
  const seedPrimitive = useSetAtom(seedPrimitiveAtom);
  const [adding, setAdding] = useState(false);

  if (!active || !registry) return null;
  const layers = active.layers;

  /* type-driven gating (Phase 3): a geom is offerable iff the current axis types
     satisfy its (x_type, y_type). Incompatible geoms stay visible but disabled
     with a teaching reason, instead of being hidden by a stored family. */
  const { xType, yType } = axisTypes(active.mappings, schema);
  const gateReason = (g: Geom): string | null => {
    const meta = registry.geoms[g];
    return meta ? geomGateReason(meta, xType, yType) : null;
  };

  const allGeoms = Object.keys(registry.geoms) as Geom[];
  const used = new Set(layers.map((l) => l.geom));
  /* every geom not already in the stack is shown in the add menu; incompatible
     ones are disabled-with-reason rather than dropped. */
  const addable = allGeoms.filter((g) => !used.has(g));
  /* retype options: all geoms minus those used by *other* layers, but always
     keeping this layer's own current geom. */
  const retypeOptions = (geom: Geom) =>
    allGeoms.filter((g) => g === geom || !used.has(g));

  return (
    <div className="layer-rail">
      <div className="rail-head">
        <strong>Encoding & layers</strong>
        <select className="template-pick" value=""
          onChange={(e) => { if (e.target.value) seedPrimitive(e.target.value as Geom); }}>
          <option value="">Start from…</option>
          {PRIMITIVES.map((p) => {
            const reason = gateReason(p.geom);
            return (
              <option key={p.geom} value={p.geom} disabled={!!reason}>
                {p.label}{reason ? ` — ${reason}` : ""}
              </option>
            );
          })}
        </select>
      </div>

      <EncodingsCard />

      {layers.length === 0 && (
        <p className="rail-empty">No layers — add a geom or pick a template.</p>
      )}

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={i} layer={layer} registry={registry} i={i}
            last={i === layers.length - 1} retypeGeoms={retypeOptions(layer.geom)}
            gateReason={gateReason}
            onMove={(dir) => moveLayer({ index: i, dir })}
            onRemove={() => removeLayer(i)}
            onChange={(l) => updateLayer({ index: i, layer: l })} />
        ))}
      </ol>

      <div className="add-layer">
        {adding ? (
          <div className="add-layer-menu">
            {addable.length === 0 && <em className="rail-empty">all geoms added</em>}
            {addable.map((g) => {
              const reason = gateReason(g);
              return (
                <button key={g} disabled={!!reason} title={reason ?? undefined}
                  onClick={() => { addLayer(g); setAdding(false); }}>
                  {registry.geoms[g].label}{reason ? ` — ${reason}` : ""}
                </button>
              );
            })}
            <button className="cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="add-layer-btn" onClick={() => setAdding(true)}>+ Add layer</button>
        )}
      </div>
    </div>
  );
}
