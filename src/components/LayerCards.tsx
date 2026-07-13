import type { Layer } from "../types";

/* A layer card now shows only the "Data level" dropdown — geom knobs moved to
   the centralized StylePane (driven by the style registry). The card remains
   the place to choose which hierarchy level this layer draws from. */
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
  if (!showLevel && !showPanel) {
    return <div className="layer-meta"><em>no options</em></div>;
  }

  return (
    <div className="layer-params">
      {showLevel && (
        <label className="layer-param layer-level"
          title="Which level of the data hierarchy this layer draws — raw rows, or one mark per grain (e.g. one per cell, one per date).">
          <span>Data level</span>
          <select value={layer.level ?? ""}
            onChange={(e) => setLevel(e.target.value)}>
            {levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
      )}
      {showPanel && (
        <label className="layer-param layer-panel"
          title="Which side-by-side figure panel this layer draws into. Move it to a new panel to show its data stage beside the primary plot instead of overlaid on it.">
          <span>Panel</span>
          <select value={String(layer.panel ?? 0)}
            onChange={(e) => setPanel(Number(e.target.value))}>
            {Array.from({ length: maxPanel + 2 }, (_, p) => (
              <option key={p} value={p}>
                {p === 0 ? "Primary" : p === maxPanel + 1 ? "New panel" : `Panel ${p + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
