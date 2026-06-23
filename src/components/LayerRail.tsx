import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, moveLayerAtom, PRIMITIVES,
  registryAtom, removeLayerAtom, seedPrimitiveAtom, updateLayerAtom,
} from "../state";
import type { Geom, Layer, Registry } from "../types";
import { LayerCard } from "./LayerCards";
import { EncodingsCard } from "./EncodingsCard";

/* one geom layer, independently collapsible so a tall stack stays scannable.
   The plot type is a dropdown so a layer can be re-typed in place (e.g. box →
   violin) without removing and re-adding it. */
function LayerItem({ layer, registry, i, last, geomOptions, onMove, onRemove, onChange }: {
  layer: Layer; registry: Registry; i: number; last: boolean; geomOptions: Geom[];
  onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onChange: (l: Layer) => void;
}) {
  const [open, setOpen] = useState(true);
  /* switching geom resets params to that geom's defaults — same result as
     removing the layer and adding the new one, just in place. */
  const retype = (geom: Geom) =>
    onChange({ _key: layer._key, geom, params: { ...(registry.geoms[geom]?.params ?? {}) } });
  return (
    <li className="layer-card">
      <div className="layer-head">
        <button className="card-toggle layer-toggle" title={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}>
          <span className="chevron">{open ? "▾" : "▸"}</span>
        </button>
        <select className="layer-geom" value={layer.geom} title="Change plot type"
          onChange={(e) => retype(e.target.value as Geom)}>
          {geomOptions.map((g) => (
            <option key={g} value={g}>{registry.geoms[g]?.label ?? g}</option>
          ))}
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
  const addLayer = useSetAtom(addLayerAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
  const seedPrimitive = useSetAtom(seedPrimitiveAtom);
  const [adding, setAdding] = useState(false);

  if (!active || !registry) return null;
  const layers = active.layers;

  /* only geoms whose family matches this plottable are addable (Phase 1 keeps
     geoms tied to the family the encodings imply) */
  const inFamily = (Object.keys(registry.geoms) as Geom[])
    .filter((g) => registry.geoms[g].family === active.family);
  const used = new Set(layers.map((l) => l.geom));
  const addable = inFamily.filter((g) => !used.has(g));
  /* options offered when re-typing a layer: same family, minus geoms already
     used by *other* layers, but always keeping this layer's own current geom. */
  const retypeOptions = (geom: Geom) =>
    inFamily.filter((g) => g === geom || !used.has(g));

  return (
    <div className="layer-rail">
      <div className="rail-head">
        <strong>Encoding & layers</strong>
        <select className="template-pick" value=""
          onChange={(e) => { if (e.target.value) seedPrimitive(e.target.value as Geom); }}>
          <option value="">Start from…</option>
          {PRIMITIVES.map((p) => (
            <option key={p.geom} value={p.geom}>{p.label}</option>
          ))}
        </select>
      </div>

      <EncodingsCard />

      {layers.length === 0 && (
        <p className="rail-empty">No layers — add a geom or pick a template.</p>
      )}

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={layer._key ?? i} layer={layer} registry={registry} i={i}
            last={i === layers.length - 1} geomOptions={retypeOptions(layer.geom)}
            onMove={(dir) => moveLayer({ index: i, dir })}
            onRemove={() => removeLayer(i)}
            onChange={(l) => updateLayer({ index: i, layer: l })} />
        ))}
      </ol>

      <div className="add-layer">
        {adding ? (
          <div className="add-layer-menu">
            {addable.length === 0 && <em className="rail-empty">all geoms added</em>}
            {addable.map((g) => (
              <button key={g} onClick={() => { addLayer(g); setAdding(false); }}>
                {registry.geoms[g].label}
              </button>
            ))}
            <button className="cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="add-layer-btn" onClick={() => setAdding(true)}>+ Add layer</button>
        )}
      </div>
    </div>
  );
}
