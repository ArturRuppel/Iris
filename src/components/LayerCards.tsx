import type { Layer, ParamSpec, Registry } from "../types";

/* One geom's param editors, generated from the registry's param_specs so the
   engine stays the single source of truth for what's configurable. */
export function LayerCard(
  { layer, registry, onChange }:
  { layer: Layer; registry: Registry; onChange: (l: Layer) => void },
) {
  const meta = registry.geoms[layer.geom];
  if (!meta || meta.param_specs.length === 0) {
    return <div className="layer-meta"><em>no options</em></div>;
  }
  const setParam = (key: string, value: unknown) =>
    onChange({ ...layer, params: { ...layer.params, [key]: value } });

  return (
    <div className="layer-params">
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
