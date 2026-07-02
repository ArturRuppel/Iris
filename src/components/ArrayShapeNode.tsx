import { Fragment, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { ValueDesc } from "../types";
import type { CannedExample } from "../explorer/cannedExamples";
import { OpHoverExample } from "./OpHoverExample";

export type NodeVariant = "source" | "table" | "grain" | "hub" | "figure";

export interface FigureSection {
  kind: "plot" | "stats";
  label: string;          // "Plot" | "Stats"
  facts: string[];        // geom chips / test chip
  onView?: () => void;    // left-click → pin this facet's card
  slotNum?: number | null;// stash slot badge when this facet is pinned
}

export interface ArrayShapeNodeProps {
  variant: NodeVariant;
  /* accent class (the step kind: collapse/join/derive/… or source/geom/test) —
     drives the --accent colour for the eyebrow, top bar, and shed segment. */
  kind: string;
  eyebrow: string;          // the step that produced this node ("Collapse", "Source"…)
  detail: string;           // the step's specifics ("median over frame"); "" hides it
  spine: string[];          // full nesting (every level), in order
  live: string[];           // levels this node still carries
  shed: string[];           // levels THIS step pooled away (lit in the accent)
  values: ValueDesc[];      // measured columns
  newValues?: string[];     // value names this step introduced (ringed)
  rows?: number;            // fallback when no descriptor / grain (terminals)
  cols?: number;
  example?: CannedExample | null;  // before/after schematic, shown hovering the eyebrow
  definition?: string;             // one-line definition, shown hovering the detail
  /* terminal (figure) sections: plot + stats, each its own labeled, clickable
     block. Present only on the figure variant. */
  sections?: FigureSection[];
  onEdit?: () => void;             // detail click → open this step's editor
}

const VAL_CLASS: Record<string, string> = { numeric: "num", categorical: "catg", bool: "bool" };

/* one glyph per nesting level — the first letter, decoded by the canvas legend. */
const initial = (name: string): string => {
  const m = name.match(/[a-zA-Z]/);
  return (m ? m[0] : name[0] ?? "?").toUpperCase();
};

/* a tiny monochrome glyph per node variant, painted in the variant's accent via
   currentColor. Inline (no icon dep), on a fixed 14×14 grid. */
function NodeIcon({ variant }: { variant: NodeVariant | "plot" | "stats" }): ReactElement {
  const p = { width: 13, height: 13, viewBox: "0 0 14 14", fill: "none",
    stroke: "currentColor", strokeWidth: 1.4,
    strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  switch (variant) {
    case "source":
      return (<svg {...p}><ellipse cx="7" cy="3" rx="4.5" ry="1.8" />
        <path d="M2.5 3v8a4.5 1.8 0 0 0 9 0V3" /></svg>);
    case "grain":
      return (<svg {...p}><path d="M7 1.5 12.5 4 7 6.5 1.5 4Z" />
        <path d="M1.5 7 7 9.5 12.5 7" /><path d="M1.5 10 7 12.5 12.5 10" /></svg>);
    case "plot":
      return (<svg {...p}><path d="M1.5 12.5h11" />
        <path d="M3.5 12.5V8M7 12.5V3.5M10.5 12.5V6.5" strokeWidth="1.8" /></svg>);
    case "stats":
      return (<svg {...p}><path d="M1.5 12Q4 12 7 3 10 12 12.5 12" /></svg>);
    default:
      return (<svg {...p}><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
        <path d="M1.5 5.5h11M5.5 1.5v11" /></svg>);
  }
}

/* The canvas node, redesigned to show only the DELTA: an eyebrow naming the step
   that produced it, the step's specifics, a segment bar showing the grain (which
   nesting levels survive, which this step shed), and the measured values (newly
   added ones ringed). Hovering the eyebrow reveals a before/after example;
   hovering the specifics shows the definition; clicking them opens the editor. */
export function ArrayShapeNode(props: ArrayShapeNodeProps) {
  const { variant, kind, eyebrow, detail, spine, live, shed, values,
    newValues = [], rows, cols, example, definition, onEdit } = props;

  // Hooks BEFORE the figure-variant early return: a node transitioning between
  // the two branches under one React key must see the same hook order.
  // the example follows the cursor: we track its position so the popup can be
  // portalled to <body> (escaping React Flow's per-node stacking context) and
  // float just above the mouse, on top of the whole canvas.
  const [exAt, setExAt] = useState<{ x: number; y: number } | null>(null);
  const [showDef, setShowDef] = useState(false);

  if (variant === "figure" && props.sections) {
    return (
      <div className="txw-node figure">
        <div className="txw-nbar" aria-hidden />
        <div className="txw-nbody txw-figsections">
          {props.sections.map((sec) => (
            <button
              key={sec.kind}
              type="button"
              className={`txw-figsec k-${sec.kind === "plot" ? "geom" : "test"}${sec.slotNum ? " pinned" : ""}`}
              aria-label={`${sec.label} summary`}
              onClick={sec.onView ? (e) => { e.stopPropagation(); sec.onView!(); } : undefined}
            >
              {sec.slotNum && <span className="txw-node-badge" aria-hidden>{sec.slotNum}</span>}
              <span className="txw-figsec-head">
                <span className="txw-nicon" aria-hidden><NodeIcon variant={sec.kind} /></span>
                <span className="txw-eyebrow-text">{sec.label}</span>
              </span>
              <span className="txw-facts" role="list">
                {sec.facts.map((f) => (
                  <span key={f} className="txw-fact" role="listitem">{f}</span>
                ))}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // show the grain bar only when this node carries a grain of its own (a table) —
  // the figure terminal has no live/shed levels and skips it.
  const hasGrain = live.length > 0 || shed.length > 0;
  const hasVals = values.length > 0;

  return (
    <div className={`txw-node ${variant} k-${kind}`}>
      <div className="txw-nbar" aria-hidden />
      <div className="txw-nbody">
        <div
          className="txw-eyebrow"
          onMouseEnter={example ? (e) => setExAt({ x: e.clientX, y: e.clientY }) : undefined}
          onMouseMove={example ? (e) => setExAt({ x: e.clientX, y: e.clientY }) : undefined}
          onMouseLeave={example ? () => setExAt(null) : undefined}
        >
          <span className="txw-nicon" aria-hidden><NodeIcon variant={variant} /></span>
          <span className="txw-eyebrow-text">{eyebrow}</span>
          {example && exAt && createPortal(
            <div className="txw-pop" role="tooltip"
                 style={{ left: exAt.x, top: exAt.y - 12 }}>
              <OpHoverExample example={example} />
            </div>,
            document.body,
          )}
        </div>

        {detail && (
          <div
            className={`txw-ndetail${onEdit ? " editable" : ""}`}
            onClick={onEdit ? (e) => { e.stopPropagation(); onEdit(); } : undefined}
            onMouseEnter={definition ? () => setShowDef(true) : undefined}
            onMouseLeave={definition ? () => setShowDef(false) : undefined}
            aria-label={definition ? `${detail} — ${definition}` : undefined}
          >
            <span className="txw-ndetail-text">{detail}</span>
            {onEdit && <span className="txw-edit-hint" aria-hidden>✎</span>}
            {definition && showDef && <div className="txw-deftip" role="tooltip">{definition}</div>}
          </div>
        )}

        {(hasGrain || hasVals) && <div className="txw-nhr" aria-hidden />}

        {hasGrain && (
          <div className={`txw-grain${shed.length === 0 ? " calm" : ""}`} role="list" aria-label="grain">
            {spine.map((lvl, i) => {
              const cls = shed.includes(lvl) ? "txw-seg shed"
                : live.includes(lvl) ? "txw-seg live" : "txw-seg gone";
              return (
                <Fragment key={lvl}>
                  {i > 0 && <span className="txw-gtick" aria-hidden>›</span>}
                  <span className={cls} title={lvl} role="listitem">{initial(lvl)}</span>
                </Fragment>
              );
            })}
          </div>
        )}

        {hasVals && (
          <div className="txw-vrow">
            {values.map((v) => (
              <span
                key={v.name}
                className={`txw-vchip ${VAL_CLASS[v.type] ?? "num"}${newValues.includes(v.name) ? " isnew" : ""}`}
              >
                {v.name}{v.grain && <span className="txw-vgrain">@{v.grain}</span>}
              </span>
            ))}
          </div>
        )}

        {!hasGrain && !hasVals && rows != null && cols != null && (
          <div className="txw-count">{rows}×{cols}</div>
        )}
      </div>
    </div>
  );
}
