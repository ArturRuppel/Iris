import type { Layer, ParamSpec, Registry } from "../types";

/* One geom's param editors, generated from the registry's param_specs so the
   engine stays the single source of truth for what's configurable. Plus a
   "Data level" dropdown (data-hierarchy redesign): the layer draws from that
   level of the nesting — raw rows, or one mark per grain (per cell / per date).
   This is how a superplot is composed: a faint dot at the raw level, a bold dot
   at a coarse level, a summary at a coarse level. */
export function LayerCard(
  { layer, registry, levels, onChange }:
  { layer: Layer; registry: Registry;
    levels: { value: string; label: string }[];
    onChange: (l: Layer) => void },
) {
  const meta = registry.geoms[layer.geom];
  const setParam = (key: string, value: unknown) =>
    onChange({ ...layer, params: { ...layer.params, [key]: value } });
  const setLevel = (level: string) => onChange({ ...layer, level });
  // only worth offering when the hierarchy has more than the raw level
  const showLevel = levels.length > 1;
  if (!meta || (meta.param_specs.length === 0 && !showLevel)) {
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
      {meta.param_specs.map((spec: ParamSpec) => {
        const cur = layer.params[spec.key] ?? meta.params[spec.key];
        if (spec.type === "select") {
          return (
            <label key={spec.key} className="layer-param">
              <span>{spec.label}</span>
              <select value={String(cur ?? "")}
                onChange={(e) => setParam(spec.key, e.target.value)}>
                {(spec.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          );
        }
        if (spec.type === "bool") {
          return (
            <label key={spec.key} className="layer-param">
              <span>{spec.label}</span>
              <input type="checkbox" checked={Boolean(cur)}
                onChange={(e) => setParam(spec.key, e.target.checked)} />
            </label>
          );
        }
        return (
          <label key={spec.key} className="layer-param">
            <span>{spec.label}</span>
            <input type="number" value={cur === undefined ? "" : Number(cur)}
              min={spec.min} max={spec.max} step={spec.step}
              onChange={(e) => setParam(spec.key,
                e.target.value === "" ? undefined : Number(e.target.value))} />
          </label>
        );
      })}
    </div>
  );
}
