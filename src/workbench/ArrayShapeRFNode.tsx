import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { useSetAtom, useAtomValue } from "jotai";
import { ArrayShapeNode, type ArrayShapeNodeProps, type NodeVariant } from "../components/ArrayShapeNode";
import { cannedExample } from "../explorer/cannedExamples";
import type { EdgeKind, ExplorerNode } from "../explorer/graph";
import { insertStepAtom } from "../state";
import { openCardAtom, stashAtom } from "./state";
import { EDGE_CARD } from "./cardRegistry";
import { EDGE_TYPE } from "./edgeMeta";
import type { NodeDelta } from "./nodeDelta";
import { affordances, authorDispatch, type AuthorAction, type AuthorOption } from "./authoring";
import { AddStepMenu } from "./AddStepMenu";

/* node -> variant, from the phase buildGraph stamped. Terminals get their own
   glyph + accent by kind; the root source and a join input share the "source"
   glyph; a grain its own; reduce/post steps the plain table. removed/onKeys
   highlighting is deferred to a later phase, so they are not derived here. */
function variantOf(node: ExplorerNode): NodeVariant {
  switch (node.phase) {
    case "terminal": return node.kind === "plot" ? "plot" : "stats";
    case "source": case "join-input": return "source";
    case "grain": return "grain";
    default: return "table";   // reduce / post
  }
}

/* the RF node data: the presentational props plus a `missing` flag (an unfilled
   required input — see ExplorerNode.missing) that drives the open-circle handle,
   the `+`-menu options fitting this node's phase (see authoring.affordances), and
   the incoming edge (so the detail click can open that step's editor). */
export type RFNodeData = ArrayShapeNodeProps & {
  missing?: boolean;
  options?: AuthorOption[];
  inEdge?: { id: string; kind: EdgeKind };
  /* the reduce-step index this node inserts after (source = -1); routed to
     authorDispatch when a `+`-pick splices a step. */
  stepIndex?: number;
};

/* the root source or a join's right input: both render as a source, with no
   incoming-step detail line. */
const isSource = (node: ExplorerNode): boolean =>
  node.phase === "source" || node.phase === "join-input";

/* the step kind that produced this node — the accent + eyebrow key. */
function accentKind(node: ExplorerNode, delta?: NodeDelta): string {
  if (node.kind === "plot") return "geom";
  if (node.kind === "stats") return "test";
  if (isSource(node)) return "source";
  return delta?.inEdge?.kind ?? "table";
}
function eyebrowText(node: ExplorerNode, delta?: NodeDelta): string {
  if (node.kind === "plot") return "Plot";
  if (node.kind === "stats") return "Stats";
  if (isSource(node)) return "Source";
  return delta?.inEdge ? (EDGE_TYPE[delta.inEdge.kind] ?? "Step") : node.label;
}

/* an ExplorerNode (+ its computed delta) -> the RF node data. Pure + exported so
   the mapping is unit-tested without React Flow. Terminals (plot/stats) show
   their geom/test summary as `facts` chips (set on the node) instead of a grain
   bar + value chips, and clear their detail line. */
export function nodeShapeProps(node: ExplorerNode, delta?: NodeDelta): RFNodeData {
  const c = node.count;
  const isTerminal = node.kind === "plot" || node.kind === "stats";
  const ex = delta?.inEdge ? cannedExample(delta.inEdge.kind) : null;
  return {
    variant: variantOf(node),
    kind: accentKind(node, delta),
    eyebrow: eyebrowText(node, delta),
    detail: (isSource(node) || isTerminal) ? "" : (delta?.inEdge?.label ?? ""),
    facts: node.facts ?? [],
    spine: delta?.spine ?? [], live: delta?.live ?? [], shed: delta?.shed ?? [],
    values: c?.values ?? [], newValues: delta?.newValues ?? [],
    rows: c?.rows, cols: c?.cols,
    example: ex, definition: ex?.caption,
    inEdge: delta?.inEdge ? { id: delta.inEdge.id, kind: delta.inEdge.kind } : undefined,
    missing: node.missing,
    options: affordances(node),
    stepIndex: node.stepIndex,
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
  const { missing, options, inEdge, stepIndex, ...shape } = data;
  const insertStep = useSetAtom(insertStepAtom);
  const openCard = useSetAtom(openCardAtom);
  const [menuOpen, setMenuOpen] = useState(false);
  const canAdd = !!options && options.length > 0;

  // if this node is pinned in the stash, its 1-based slot number badges the
  // top-left corner — the matching numbered disc on the stash card ties the two
  // views together.
  const stash = useAtomValue(stashAtom);
  const slot = stash.findIndex((e) => e.target.kind === "node" && e.target.id === id);
  const slotNum = slot >= 0 ? slot + 1 : null;

  // clicking the detail line opens the editor for the step that produced this
  // node (the same card a click on its incoming edge opens).
  const onEdit = inEdge
    ? () => openCard({ target: { kind: "edge", id: inEdge.id }, cardKind: EDGE_CARD[inEdge.kind] })
    : undefined;

  const pick = (action: AuthorAction) => {
    setMenuOpen(false);
    const d = authorDispatch(stepIndex ?? -1, action);
    if (d.atom === "insertStep") insertStep(d.arg);
    else openCard(d.arg);
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
      <ArrayShapeNode {...shape} onEdit={onEdit} />
      <Handle
        id="out" type="source" position={Position.Right}
        className={canAdd ? "txw-handle-add" : undefined}
        style={canAdd ? undefined : { opacity: 0 }}
        onClick={canAdd ? (e) => { e.stopPropagation(); setMenuOpen((o) => !o); } : undefined}
      />
      {menuOpen && options && (
        <div className="txw-add-menu-anchor" onClick={(e) => e.stopPropagation()}>
          <AddStepMenu options={options} onPick={pick} />
        </div>
      )}
    </div>
  );
}
