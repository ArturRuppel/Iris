import { useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { useSetAtom, useAtomValue } from "jotai";
import { ArrayShapeNode, type ArrayShapeNodeProps, type FigureSection, type NodeVariant } from "../components/ArrayShapeNode";
import { reduceStepInEdgeId, type EdgeKind, type ExplorerNode } from "../explorer/graph";
import { insertStepAtom, activePlottableAtom } from "../state";
import { openCardAtom, pushStashAtom, stashAtom } from "./state";
import { nodeTableName } from "./nodeName";
import type { NodeDelta } from "./nodeDelta";
import { affordances, authorDispatch, type AuthorAction, type AuthorOption } from "./authoring";
import { AddStepMenu } from "./AddStepMenu";

/* node -> variant, from the phase buildGraph stamped. The terminal gets the
   figure glyph + accent; the root source and a join input share the "source"
   glyph; a grain its own; reduce/post steps the plain table. removed/onKeys
   highlighting is deferred to a later phase, so they are not derived here. */
function variantOf(node: ExplorerNode): NodeVariant {
  switch (node.phase) {
    case "terminal": return "figure";
    case "source": case "join-input": return "source";
    case "grain": return "grain";
    default: return "table";   // reduce / post
  }
}

/* the RF node data: the presentational props plus a `missing` flag (an unfilled
   required input — see ExplorerNode.missing) that drives the open-circle handle,
   the `+`-menu options fitting this node's phase (see authoring.affordances), and
   the incoming edge kind (the accent colour tying the box to its wire). */
export type RFNodeData = ArrayShapeNodeProps & {
  missing?: boolean;
  options?: AuthorOption[];
  inEdge?: { id: string; kind: EdgeKind };
  /* the reduce-step index this node inserts after (source = -1); routed to
     authorDispatch when a `+`-pick splices a step. */
  stepIndex?: number;
  /* a join node: renders a distinct right-input (slot 1) target handle that a
     dragged wire fills. */
  acceptsRightInput?: boolean;
};

/* the root source or a join's right input: both render as a source, with no
   incoming-step detail line. */
const isSource = (node: ExplorerNode): boolean =>
  node.phase === "source" || node.phase === "join-input";

/* the step kind that produced this node — the accent + eyebrow key. */
function accentKind(node: ExplorerNode, delta?: NodeDelta): string {
  // the figure variant early-returns in ArrayShapeNode before any k- accent is
  // applied, so this is a nominal value; geom teal reads closest to the figure.
  if (node.kind === "figure") return "geom";
  if (isSource(node)) return "source";
  return delta?.inEdge?.kind ?? "table";
}
/* an ExplorerNode (+ its computed delta) -> the RF node data. Pure + exported so
   the mapping is unit-tested without React Flow. The node's eyebrow names the
   TABLE it holds (see nodeName): the step that produced it is named on its
   incoming edge, so the box reads as data and the wire above it as the verb. The
   terminal (figure) carries two named sections (plot + stats) instead. */
export function nodeShapeProps(
  node: ExplorerNode, delta?: NodeDelta, sourceName = "Table",
): RFNodeData {
  const c = node.count;
  return {
    variant: variantOf(node),
    kind: accentKind(node, delta),
    eyebrow: nodeTableName(node, sourceName),
    detail: "",
    sections: node.sections?.map((s): FigureSection => ({
      kind: s.kind, label: s.kind === "plot" ? "Plot" : "Stats", facts: s.facts,
    })),
    spine: delta?.spine ?? [], live: delta?.live ?? [], shed: delta?.shed ?? [],
    values: c?.values ?? [], newValues: delta?.newValues ?? [],
    rows: c?.rows, cols: c?.cols,
    inEdge: delta?.inEdge ? { id: delta.inEdge.id, kind: delta.inEdge.kind } : undefined,
    missing: node.missing,
    options: affordances(node),
    stepIndex: node.stepIndex,
    acceptsRightInput: node.acceptsRightInput,
  };
}

/* React Flow custom node: the existing presentational node, flanked by connection
   handles (left = target, right = source). The left handle is hidden by default;
   an unfilled-input node shows it as an open "missing" circle. The right (source)
   handle is the authoring `+`: a node with fitting options shows it as a visible
   `+` that opens the phase-keyed add menu. */
export function ArrayShapeRFNode(
  { id, data }: { id?: string; selected?: boolean; data: RFNodeData },
) {
  const { missing, options, inEdge, stepIndex, acceptsRightInput, ...shape } = data;
  const insertStep = useSetAtom(insertStepAtom);
  const active = useAtomValue(activePlottableAtom);
  const openCard = useSetAtom(openCardAtom);
  const pushStash = useSetAtom(pushStashAtom);
  // the add menu is positioned in screen space and portalled to <body>, not
  // nested in this node: each React Flow node is its own stacking context, so a
  // menu drawn inside an upstream node would paint UNDER any node stacked over
  // it (e.g. the source's menu hiding behind the Figure) and swallow the pick.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const canAdd = !!options && options.length > 0;

  // if this node is pinned in the stash, its 1-based slot number badges the
  // top-left corner — the matching numbered disc on the stash card ties the two
  // views together.
  const stash = useAtomValue(stashAtom);
  const slot = stash.findIndex((e) => e.target.kind === "node" && e.target.id === id && !e.target.facet);
  const slotNum = slot >= 0 ? slot + 1 : null;

  const sections = shape.sections?.map((sec) => {
    const secSlot = stash.findIndex(
      (e) => e.target.kind === "node" && e.target.id === id && e.target.facet === sec.kind);
    return {
      ...sec,
      slotNum: secSlot >= 0 ? secSlot + 1 : null,
      onView: () => pushStash({
        target: { kind: "node", id: id!, facet: sec.kind },
        cardKind: sec.kind,
      }),
    };
  });

  const pick = (action: AuthorAction) => {
    setMenuAt(null);
    const d = authorDispatch(stepIndex ?? -1, action);
    if (d.atom === "insertStep") {
      // splice the blank step, then open its editor at once — a new step is empty,
      // so dropping the user straight into it is the whole point of adding one. The
      // edge id is derivable from the new index before the async graph rebuild.
      // authorDispatch still speaks pipeline-step-index (source = -1); translate
      // to the DAG node id insertStepAtom takes (Phase D routes the canvas
      // through real ids directly — array order still matches chain order for
      // Phase B's linear-only authoring, see insertStepAtom).
      const afterId = d.arg.afterIndex < 0
        ? (active?.reduce.sources[0]?.id ?? "src")
        : (active?.reduce.steps[d.arg.afterIndex]?.id ?? "src");
      insertStep({ afterId, kind: d.arg.kind });
      const index = d.arg.afterIndex + 1;
      openCard({ target: { kind: "edge", id: reduceStepInEdgeId(index) }, cardKind: "op-editor" });
    } else openCard(d.arg);
  };

  return (
    <div className={`txw-rfnode${slotNum ? " pinned" : ""}`}
         data-slot={slotNum ?? undefined}>
      {slotNum && <div className="txw-node-badge" aria-hidden>{slotNum}</div>}
      <Handle
        id="in" type="target" position={Position.Left}
        className={missing ? "txw-handle-missing" : undefined}
        style={missing ? undefined : { opacity: 0 }}
      />
      {/* a join's right (slot 1) input: a distinct drop target, lower on the left
          edge, that a dragged wire fills — the second path in beside the picker. */}
      {acceptsRightInput && (
        <Handle
          id="in-1" type="target" position={Position.Left}
          className="txw-handle-right-input"
          style={{ top: "75%" }}
        />
      )}
      <ArrayShapeNode {...shape} sections={sections} />
      <Handle
        id="out" type="source" position={Position.Right}
        className={canAdd ? "txw-handle-add" : undefined}
        style={canAdd ? undefined : { opacity: 0 }}
        onClick={canAdd ? (e) => {
          e.stopPropagation();
          const r = (e.target as HTMLElement).getBoundingClientRect();
          setMenuAt((cur) => (cur ? null : { x: r.right + 8, y: r.top }));
        } : undefined}
      />
      {menuAt && options && createPortal(
        <>
          <div className="txw-add-scrim" onClick={() => setMenuAt(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenuAt(null); }} />
          <div className="txw-add-menu-float" style={{ left: menuAt.x, top: menuAt.y }}
            onClick={(e) => e.stopPropagation()}>
            <AddStepMenu options={options} onPick={pick} />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
