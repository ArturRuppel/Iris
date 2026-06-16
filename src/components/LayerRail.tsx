import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, effectiveSchemaAtom, hierarchyAtom,
  moveLayerAtom, registryAtom, removeLayerAtom, updateLayerAtom,
} from "../state";
import { axisTypes, geomGateReason } from "../channels";
import type { Geom, Layer, Registry } from "../types";
import { levelOptions } from "../levels";
import { LayerCard } from "./LayerCards";
import { EncodingsCard } from "./EncodingsCard";
import { HierarchyCard } from "./HierarchyCard";

/* one geom layer, independently collapsible so a tall stack stays scannable.
   The plot type is a dropdown so a layer can be re-typed in place (e.g. box →
   violin) without removing and re-adding it. Geoms incompatible with the current
   encoding types appear disabled-with-reason rather than hidden. */
function LayerItem({ layer, registry, i, last, retypeGeoms, gateReason, levels, onMove, onRemove, onChange }: {
  layer: Layer; registry: Registry; i: number; last: boolean; retypeGeoms: Geom[];
  gateReason: (g: Geom) => string | null;
  levels: { value: string; label: string }[];
  onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onChange: (l: Layer) => void;
}) {
  const [open, setOpen] = useState(true);
  /* switching geom resets params to that geom's defaults but keeps the data
     level — same result as removing the layer and adding the new one in place. */
  const retype = (geom: Geom) =>
    onChange({ geom, params: { ...(registry.geoms[geom]?.params ?? {}) },
               level: layer.level });
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
      {open && <LayerCard layer={layer} registry={registry}
        levels={levels} onChange={onChange} />}
    </li>
  );
}

export function LayerRail() {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const addLayer = useSetAtom(addLayerAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
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
  /* the add menu offers only geoms compatible with the current encoding (item
     6): an incompatible geom can't be drawn, so adding it just produces a broken
     layer. Already-used geoms are excluded too. Incompatible ones are hidden
     here (not disabled-with-reason as in the retype dropdown, where seeing why a
     switch is blocked is useful); a count tells the user some were hidden. */
  const notUsed = allGeoms.filter((g) => !used.has(g));
  const addable = notUsed.filter((g) => !gateReason(g));
  const hiddenCount = notUsed.length - addable.length;
  /* retype options: all geoms minus those used by *other* layers, but always
     keeping this layer's own current geom. */
  const retypeOptions = (geom: Geom) =>
    allGeoms.filter((g) => g === geom || !used.has(g));

  return (
    <div className="layer-rail">
      <div className="rail-head">
        <strong>Encoding & layers</strong>
        <button className="icon" title="Hide encoding & layers"
          onClick={() => setCollapsed(true)}>⟨</button>
      </div>

      <EncodingsCard />

      <HierarchyCard />

      {layers.length === 0 && (
        <p className="rail-empty">No layers — add a geom.</p>
      )}

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={i} layer={layer} registry={registry} i={i}
            last={i === layers.length - 1} retypeGeoms={retypeOptions(layer.geom)}
            gateReason={gateReason} levels={levelOptions(hierarchy, schema)}
            onMove={(dir) => moveLayer({ index: i, dir })}
            onRemove={() => removeLayer(i)}
            onChange={(l) => updateLayer({ index: i, layer: l })} />
        ))}
      </ol>

      <div className="add-layer">
        {adding ? (
          <div className="add-layer-menu">
            {addable.length === 0 && (
              <em className="rail-empty">
                {notUsed.length === 0 ? "all geoms added"
                  : "No layer fits the current encoding — map X / Y to enable layers."}
              </em>
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
        )}
      </div>
    </div>
  );
}
