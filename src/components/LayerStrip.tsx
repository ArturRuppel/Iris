import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  activePlottableAtom, effectiveSchemaAtom, hierarchyAtom,
  moveLayerAtom, registryAtom, removeLayerAtom, updateLayerAtom,
} from "../state";
import { axisTypes, geomGateReason } from "../channels";
import type { Geom, Layer, Registry } from "../types";
import { levelOptions } from "../levels";
import { LayerCard } from "./LayerCards";

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
  /* switching geom keeps the data level — same result as removing the layer
     and adding the new one in place. Geom knobs live in style.overrides.geoms.
     The layer `id` is preserved: it keys this layer's per-instance style
     (style.overrides.layers.<id>), so dropping it would orphan those overrides
     and let a repeated geom collapse into the shared tier (item K). */
  const retype = (geom: Geom) =>
    onChange({ ...layer, geom, level: layer.level });
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
      {open && <LayerCard layer={layer}
        levels={levels} onChange={onChange} />}
    </li>
  );
}

/* The always-on layer list. Self-contained — reads the active plottable and the
   layer-CRUD atoms itself — so both LayerRail and the Plot hero card can drop it in. */
export function LayerStrip({ addSlot }: { addSlot?: ReactNode }) {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
  if (!active || !registry) return null;

  const { xType, yType } = axisTypes(active.mappings, schema);
  const gateReason = (g: Geom): string | null => {
    const meta = registry.geoms[g];
    return meta ? geomGateReason(meta, xType, yType) : null;
  };
  const allGeoms = Object.keys(registry.geoms) as Geom[];
  const layers = active.layers;

  return (
    <div className="layer-strip" data-testid="layer-strip">
      {layers.length === 0 && <p className="rail-empty">No layers — add a geom.</p>}
      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={layer.id ?? i} layer={layer} registry={registry} i={i}
            last={i === layers.length - 1} retypeGeoms={allGeoms}
            gateReason={gateReason} levels={levelOptions(hierarchy, schema)}
            onMove={(dir) => moveLayer({ index: i, dir })}
            onRemove={() => removeLayer(i)}
            onChange={(l) => updateLayer({ index: i, layer: l })} />
        ))}
      </ol>
      {addSlot && <div className="add-layer">{addSlot}</div>}
    </div>
  );
}
