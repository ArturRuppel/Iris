import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, applyTemplateAtom, moveLayerAtom,
  registryAtom, removeLayerAtom, updateLayerAtom, TEMPLATES,
  type TemplateName,
} from "../state";
import type { Geom } from "../types";
import { LayerCard } from "./LayerCards";

export function LayerRail() {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const addLayer = useSetAtom(addLayerAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
  const applyTemplate = useSetAtom(applyTemplateAtom);
  const [adding, setAdding] = useState(false);

  if (!active || !registry) return null;
  const layers = active.layers;

  /* only geoms whose family matches this plottable are addable (Phase 1 keeps
     geoms tied to the family the encodings imply) */
  const addable = (Object.keys(registry.geoms) as Geom[])
    .filter((g) => registry.geoms[g].family === active.family)
    .filter((g) => !layers.some((l) => l.geom === g));

  return (
    <div className="layer-rail">
      <div className="rail-head">
        <strong>Layers</strong>
        <select className="template-pick" value=""
          onChange={(e) => { if (e.target.value) applyTemplate(e.target.value as TemplateName); }}>
          <option value="">Start from…</option>
          {(Object.keys(TEMPLATES) as TemplateName[]).map((t) => (
            <option key={t} value={t}>{TEMPLATES[t].label}</option>
          ))}
        </select>
      </div>

      {layers.length === 0 && (
        <p className="rail-empty">No layers — add a geom or pick a template.</p>
      )}

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <li key={i} className="layer-card">
            <div className="layer-head">
              <span className="layer-name">{registry.geoms[layer.geom]?.label ?? layer.geom}</span>
              <span className="layer-actions">
                <button className="icon" title="Move up" disabled={i === 0}
                  onClick={() => moveLayer({ index: i, dir: -1 })}>↑</button>
                <button className="icon" title="Move down" disabled={i === layers.length - 1}
                  onClick={() => moveLayer({ index: i, dir: 1 })}>↓</button>
                <button className="icon" title="Remove layer"
                  onClick={() => removeLayer(i)}>✕</button>
              </span>
            </div>
            <LayerCard layer={layer} registry={registry}
              onChange={(l) => updateLayer({ index: i, layer: l })} />
          </li>
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
