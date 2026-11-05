import type { Layer } from "../types";
import { Row } from "./inspector/KnobControls";

/* A layer's data rows: which hierarchy level it draws from and which panel it
   draws into. Its style knobs follow these rows in the layer card (LayerStrip). */
export function LayerCard(
  { layer, levels, maxPanel = 0, faceted = false, onChange }:
  { layer: Layer;
    levels: { value: string; label: string }[];
    maxPanel?: number; faceted?: boolean;
    onChange: (l: Layer) => void },
) {
  const setLevel = (level: string) => onChange({ ...layer, level });
  const setPanel = (panel: number) =>
    onChange({ ...layer, panel: panel === 0 ? undefined : panel });
  // only worth offering when the hierarchy has more than the raw level
  const showLevel = levels.length > 1;
  // panel authoring (spec 2.3 Stage 2): choose which side-by-side panel this layer
  // draws into — the existing panels plus one "New panel". Hidden under faceting,
  // where the engine ignores panels (faceting wins), so it's never offered as a
  // no-op. `maxPanel + 2` options = panels 0…maxPanel, then a fresh one.
  const showPanel = !faceted;
  const lid = layer.id ?? "layer";

  return (
    <>
      {showLevel && (
        <Row label="Data level" labelFor={`${lid}-level`} className="layer-level">
          <select id={`${lid}-level`} className="insp-select" value={layer.level ?? ""}
            title="Which level of the data hierarchy this layer draws — raw rows, or one mark per grain (e.g. one per cell, one per date)."
            onChange={(e) => setLevel(e.target.value)}>
            {levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </Row>
      )}
      {showPanel && (
        <Row label="Panel" labelFor={`${lid}-panel`} className="layer-panel">
          <select id={`${lid}-panel`} className="insp-select" value={String(layer.panel ?? 0)}
            title="Which side-by-side figure panel this layer draws into. Move it to a new panel to show its data stage beside the primary plot instead of overlaid on it."
            onChange={(e) => setPanel(Number(e.target.value))}>
            {Array.from({ length: maxPanel + 2 }, (_, p) => (
              <option key={p} value={p}>
                {p === 0 ? "Primary" : p === maxPanel + 1 ? "New panel" : `Panel ${p + 1}`}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  );
}
