import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, applyTemplateAtom, moveLayerAtom,
  registryAtom, removeLayerAtom, updateLayerAtom, TEMPLATES,
  type TemplateName,
} from "../state";
import type { Geom, Layer, Registry } from "../types";
import { LayerCard } from "./LayerCards";
import { EncodingsCard } from "./EncodingsCard";

/* one geom layer, independently collapsible so a tall stack stays scannable */
function LayerItem({ layer, registry, i, last, onMove, onRemove, onChange }: {
  layer: Layer; registry: Registry; i: number; last: boolean;
  onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onChange: (l: Layer) => void;
}) {
  const [open, setOpen] = useState(true);
  const name = registry.geoms[layer.geom]?.label ?? layer.geom;
  return (
    <li className="layer-card">
      <div className="layer-head">
        <button className="card-toggle" title={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}>
          <span className="chevron">{open ? "▾" : "▸"}</span>
          <span className="layer-name">{name}</span>
        </button>
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
        <strong>Encoding & layers</strong>
        <select className="template-pick" value=""
          onChange={(e) => { if (e.target.value) applyTemplate(e.target.value as TemplateName); }}>
          <option value="">Start from…</option>
          {(Object.keys(TEMPLATES) as TemplateName[]).map((t) => (
            <option key={t} value={t}>{TEMPLATES[t].label}</option>
          ))}
        </select>
      </div>

      <EncodingsCard />

      {layers.length === 0 && (
        <p className="rail-empty">No layers — add a geom or pick a template.</p>
      )}

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={i} layer={layer} registry={registry} i={i}
            last={i === layers.length - 1}
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
