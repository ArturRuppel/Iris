import type { ReactElement } from "react";
import type { AxisDesc, ValueDesc } from "../types";

export type NodeVariant = "source" | "table" | "grain" | "hub" | "plot" | "stats";

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

const TYPE_LABEL: Record<string, string> = {
  numeric: "number", categorical: "category", bool: "yes-no",
};

/* a tiny monochrome glyph per node variant, painted in the variant's accent via
   currentColor. Kept inline (no icon dep) and on a fixed 14×14 grid so every node
   reads as the same "box" with a type marker in the corner. */
function NodeIcon({ variant }: { variant: NodeVariant }): ReactElement {
  const p = { width: 13, height: 13, viewBox: "0 0 14 14", fill: "none",
    stroke: "currentColor", strokeWidth: 1.4,
    strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  switch (variant) {
    case "source":            // a data cylinder (the origin table)
      return (<svg {...p}><ellipse cx="7" cy="3" rx="4.5" ry="1.8" />
        <path d="M2.5 3v8a4.5 1.8 0 0 0 9 0V3" /></svg>);
    case "grain":             // stacked layers (a coarser grain)
      return (<svg {...p}><path d="M7 1.5 12.5 4 7 6.5 1.5 4Z" />
        <path d="M1.5 7 7 9.5 12.5 7" /><path d="M1.5 10 7 12.5 12.5 10" /></svg>);
    case "plot":              // bar chart
      return (<svg {...p}><path d="M1.5 12.5h11" />
        <path d="M3.5 12.5V8M7 12.5V3.5M10.5 12.5V6.5" strokeWidth="1.8" /></svg>);
    case "stats":             // a distribution bell
      return (<svg {...p}><path d="M1.5 12Q4 12 7 3 10 12 12.5 12" /></svg>);
    default:                  // table / hub: a grid
      return (<svg {...p}><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
        <path d="M1.5 5.5h11M5.5 1.5v11" /></svg>);
  }
}

export function ArrayShapeNode(
  { title, variant, axes, values, removed = [], onKeys = [], rows, cols }: ArrayShapeNodeProps,
) {
  const hasDescriptor = axes.length > 0 || values.length > 0 || removed.length > 0;
  return (
    <div className={`txw-node ${variant}`}>
      <div className="txw-ntitle">
        <span className="txw-nicon" aria-hidden><NodeIcon variant={variant} /></span>
        <span className="txw-ntitle-text">{title}</span>
      </div>

      {(axes.length > 0 || removed.length > 0) && (
        <div className="txw-sec">
          <div className="txw-sk">Organised by</div>
          <ul className="txw-tree" role="list">
            {axes.map((a, i) => (
              <li key={a.name} className={`txw-lvl${i > 0 ? " nested" : ""}`}>
                {i > 0 && <span className="txw-twig" aria-hidden>└</span>}
                <span className={`txw-dim${a.ragged ? " ragged" : ""}${onKeys.includes(a.name) ? " keyhi" : ""}`}>
                  {a.name}
                </span>
                <span
                  className={`txw-pill${a.ragged ? " varies" : ""}`}
                  title={a.ragged ? "count varies by parent (ragged)" : undefined}
                >
                  {a.ragged ? "varies" : a.n_levels}
                </span>
              </li>
            ))}
            {removed.map((name) => (
              <li key={name} className="txw-lvl">
                <span className="txw-dim gone">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {values.length > 0 && (
        <div className="txw-sec">
          <div className="txw-sk">Values</div>
          <ul className="txw-vlist" role="list">
            {values.map((v) => (
              <li key={v.name} className="txw-vrow">
                <span className={`txw-val ${VAL_CLASS[v.type] ?? "num"}`}>
                  {v.name}
                  {v.grain && <span className="txw-grain">@{v.grain}</span>}
                </span>
                <span className="txw-vtype">{TYPE_LABEL[v.type] ?? v.type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasDescriptor && rows != null && cols != null && (
        <div className="txw-count">{rows}×{cols}</div>
      )}
    </div>
  );
}
