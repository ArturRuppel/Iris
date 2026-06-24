import type { AxisDesc, ValueDesc } from "../types";

export type NodeVariant = "source" | "table" | "grain" | "hub";

export interface ArrayShapeNodeProps {
  title: string;
  variant: NodeVariant;
  axes: AxisDesc[];
  values: ValueDesc[];
  removed?: string[];   // axis names a downstream collapse removed (struck-through)
  onKeys?: string[];    // join-key axis names (amber highlight)
  rows?: number;        // fallback when the descriptor hasn't loaded
  cols?: number;
}

const VAL_CLASS: Record<string, string> = {
  numeric: "num", categorical: "catg", bool: "bool",
};

export function ArrayShapeNode(
  { title, variant, axes, values, removed = [], onKeys = [], rows, cols }: ArrayShapeNodeProps,
) {
  const hasDescriptor = axes.length > 0 || values.length > 0;
  return (
    <div className={`txw-node ${variant}`}>
      <div className="txw-ntitle">{title}</div>

      {axes.length > 0 && (
        <div className="txw-row">
          <span className="txw-rk">axes</span>
          {axes.map((a, i) => (
            <span key={a.name} className="txw-axwrap">
              <span className={`txw-ax${a.ragged ? " ragged" : ""}${onKeys.includes(a.name) ? " keyhi" : ""}`}>
                {a.name}
                <span className="txw-n">{a.ragged ? "~" : a.n_levels}</span>
              </span>
              {(i < axes.length - 1 || removed.length > 0) && <span className="txw-caret">▸</span>}
            </span>
          ))}
          {removed.map((name) => (
            <span key={name} className="txw-ax gone">{name}</span>
          ))}
        </div>
      )}

      {values.length > 0 && (
        <div className="txw-row">
          <span className="txw-rk">values</span>
          {values.map((v) => (
            <span key={v.name} className={`txw-val ${VAL_CLASS[v.type] ?? "num"}`}>
              {v.name}
              {v.grain && <span className="txw-grain">@{v.grain}</span>}
            </span>
          ))}
        </div>
      )}

      {!hasDescriptor && rows != null && cols != null && (
        <div className="txw-count">{rows}×{cols}</div>
      )}
    </div>
  );
}
