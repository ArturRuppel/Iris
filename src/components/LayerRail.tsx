import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, effectiveSchemaAtom, hierarchyAtom,
  moveLayerAtom, registryAtom, removeLayerAtom, updateLayerAtom,
} from "../state";
import { axisTypes, geomAddable, geomGateReason } from "../channels";
import type { Geom, Layer, Registry } from "../types";
import { levelOptions } from "../levels";
import { LayerCard } from "./LayerCards";
import { EncodingsCard } from "./EncodingsCard";
import { PipelineSection } from "./PipelineSection";

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
  /* retype options: every geom (a geom may now repeat, so re-typing to one
     already in the stack is allowed). */
  const retypeOptions = (_geom: Geom) => allGeoms;

  return (
    <div className="layer-rail">
      <div className="rail-head">
        <strong>Encoding & layers</strong>
        <button className="icon" title="Hide encoding & layers"
          onClick={() => setCollapsed(true)}>⟨</button>
      </div>

      <EncodingsCard />

      {layers.length === 0 && (
        <p className="rail-empty">No layers — add a geom.</p>
      )}

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={layer.id ?? i} layer={layer} registry={registry} i={i}
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
        )}
      </div>

      <PipelineSection />
    </div>
  );
}
