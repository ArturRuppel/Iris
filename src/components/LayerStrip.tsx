import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  activePlottableAtom, effectiveSchemaAtom, hierarchyAtom,
  moveLayerAtom, registryAtom, removeLayerAtom, updateLayerAtom,
} from "../state";
import { axisTypes, geomGateReason } from "../channels";
import type { Geom, Layer, Registry, StyleKnob } from "../types";
import { levelOptions } from "../levels";
import { LayerCard } from "./LayerCards";
import { KnobRow } from "./inspector/KnobControls";
import { useStyleEditor, type KnobTarget, type StyleEditor } from "./inspector/useStyleEditor";

/* one geom layer, independently collapsible so a tall stack stays scannable,
   holding its data rows and then its own style knobs.
   The plot type is a dropdown so a layer can be re-typed in place (e.g. box →
   violin) without removing and re-adding it. Geoms incompatible with the current
   encoding types appear disabled-with-reason rather than hidden. */
function LayerItem({ layer, registry, i, last, retypeGeoms, gateReason, levels, maxPanel, faceted, knobs, target, ed, onMove, onRemove, onChange }: {
  layer: Layer; registry: Registry; i: number; last: boolean; retypeGeoms: Geom[];
  knobs: StyleKnob[]; target: KnobTarget; ed: StyleEditor;
  gateReason: (g: Geom) => string | null;
  levels: { value: string; label: string }[];
  maxPanel: number; faceted: boolean;
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
        levels={levels} maxPanel={maxPanel} faceted={faceted} onChange={onChange} />}
      {open && knobs.map((k) => <KnobRow key={k.key} knob={k} ed={ed} target={target} />)}
    </li>
  );
}

/* The always-on layer list. Self-contained — reads the active plottable and the
   layer-CRUD atoms itself — so the Plot card can drop it in. */
export function LayerStrip({ addSlot }: { addSlot?: ReactNode }) {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
  const ed = useStyleEditor();
  if (!active || !registry) return null;

  const { xType, yType } = axisTypes(active.mappings, schema);
  const gateReason = (g: Geom): string | null => {
    const meta = registry.geoms[g];
    return meta ? geomGateReason(meta, xType, yType) : null;
  };
  const allGeoms = Object.keys(registry.geoms) as Geom[];
  const layers = active.layers;
  // panel authoring (spec 2.3 Stage 2): the highest panel any layer uses, so the
  // card can offer the existing panels plus one "New panel". Suppressed under
  // faceting — the engine defers the panels×faceting combo (faceting wins).
  const maxPanel = Math.max(0, ...layers.map((l) => l.panel ?? 0));
  const faceted = !!(active.facetRow || active.facetCol);

  /* each card carries its geom's style knobs. A geom drawn once edits the shared
     style.geoms.<geom> tier; a geom drawn more than once (item K — e.g. raw dots +
     aggregate dots) edits each instance's own style.layers.<id> tier instead. */
  const counts: Record<string, number> = {};
  for (const l of layers) counts[l.geom] = (counts[l.geom] ?? 0) + 1;
  const knobsOf = (geom: string) =>
    ed.registry.filter((k) => k.scope === "geom" && k.group === geom);
  const targetOf = (l: Layer): KnobTarget =>
    counts[l.geom] > 1 && l.id ? { geom: l.geom, layerId: l.id } : { geom: l.geom };

  return (
    <div className="layer-strip" data-testid="layer-strip">
      {layers.length === 0 && <p className="rail-empty">No layers — add a geom.</p>}
      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={layer.id ?? i} layer={layer} registry={registry} i={i}
            last={i === layers.length - 1} retypeGeoms={allGeoms}
            gateReason={gateReason} levels={levelOptions(hierarchy, schema)}
            maxPanel={maxPanel} faceted={faceted}
            knobs={knobsOf(layer.geom)} target={targetOf(layer)} ed={ed}
            onMove={(dir) => moveLayer({ index: i, dir })}
            onRemove={() => removeLayer(i)}
            onChange={(l) => updateLayer({ index: i, layer: l })} />
        ))}
      </ol>
      {addSlot && <div className="add-layer">{addSlot}</div>}
    </div>
  );
}
