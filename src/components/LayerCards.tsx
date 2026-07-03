import type { Layer } from "../types";

/* A layer card now shows only the "Data level" dropdown — geom knobs moved to
   the centralized StylePane (driven by the style registry). The card remains
   the place to choose which hierarchy level this layer draws from. */
export function LayerCard(
  { layer, levels, onChange }:
  { layer: Layer;
    levels: { value: string; label: string }[];
    onChange: (l: Layer) => void },
) {
  const setLevel = (level: string) => onChange({ ...layer, level });
  // only worth offering when the hierarchy has more than the raw level
  const showLevel = levels.length > 1;
  if (!showLevel) {
    return <div className="layer-meta"><em>no options</em></div>;
  }

  return (
    <div className="layer-params">
      <label className="layer-param layer-level"
        title="Which level of the data hierarchy this layer draws — raw rows, or one mark per grain (e.g. one per cell, one per date).">
        <span>Data level</span>
        <select value={layer.level ?? ""}
          onChange={(e) => setLevel(e.target.value)}>
          {levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </label>
    </div>
  );
}
