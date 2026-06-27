import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { useSetAtom } from "jotai";
import { ArrayShapeNode, type ArrayShapeNodeProps, type NodeVariant } from "../components/ArrayShapeNode";
import { cannedExample } from "../explorer/cannedExamples";
import type { EdgeKind, ExplorerNode } from "../explorer/graph";
import { insertStepAtom } from "../state";
import { openCardAtom } from "./state";
import { EDGE_CARD } from "./cardRegistry";
import { EDGE_TYPE } from "./edgeMeta";
import type { NodeDelta } from "./nodeDelta";
import { affordances, authorDispatch, type AuthorAction, type AuthorOption } from "./authoring";
import { AddStepMenu } from "./AddStepMenu";

/* node -> variant. Terminals key off kind (plot/stats get their own glyph + accent);
   data tables key off id (source / grain / plain table). removed/onKeys highlighting
   is deferred to a later phase, so they are not derived here. */
function variantOf(node: ExplorerNode): NodeVariant {
  if (node.kind === "plot") return "plot";
  if (node.kind === "stats") return "stats";
  const id = node.id;
  if (id === "source" || id.startsWith("source:")) return "source";
  if (id.startsWith("grain:")) return "grain";
  return "table";
}

/* the RF node data: the presentational props plus a `missing` flag (an unfilled
   required input — see ExplorerNode.missing) that drives the open-circle handle,
   the `+`-menu options fitting this node's phase (see authoring.affordances), and
   the incoming edge (so the detail click can open that step's editor). */
export type RFNodeData = ArrayShapeNodeProps & {
  missing?: boolean;
  options?: AuthorOption[];
  inEdge?: { id: string; kind: EdgeKind };
};

const isSource = (id: string): boolean => id === "source" || id.startsWith("source:");

/* the step kind that produced this node — the accent + eyebrow key. */
function accentKind(node: ExplorerNode, delta?: NodeDelta): string {
  if (node.kind === "plot") return "geom";
  if (node.kind === "stats") return "test";
  if (isSource(node.id)) return "source";
  return delta?.inEdge?.kind ?? "table";
}
function eyebrowText(node: ExplorerNode, delta?: NodeDelta): string {
  if (node.kind === "plot") return "Plot";
  if (node.kind === "stats") return "Stats";
  if (isSource(node.id)) return "Source";
  return delta?.inEdge ? (EDGE_TYPE[delta.inEdge.kind] ?? "Step") : node.label;
}

/* an ExplorerNode (+ its computed delta) -> the RF node data. Pure + exported so
   the mapping is unit-tested without React Flow. */
export function nodeShapeProps(node: ExplorerNode, delta?: NodeDelta): RFNodeData {
  const c = node.count;
  const ex = delta?.inEdge ? cannedExample(delta.inEdge.kind) : null;
  return {
    variant: variantOf(node),
    kind: accentKind(node, delta),
    eyebrow: eyebrowText(node, delta),
    detail: isSource(node.id) ? "" : (delta?.inEdge?.label ?? ""),
    spine: delta?.spine ?? [], live: delta?.live ?? [], shed: delta?.shed ?? [],
    values: c?.values ?? [], newValues: delta?.newValues ?? [],
    rows: c?.rows, cols: c?.cols,
    example: ex, definition: ex?.caption,
    inEdge: delta?.inEdge ? { id: delta.inEdge.id, kind: delta.inEdge.kind } : undefined,
    missing: node.missing,
    options: affordances(node),
  };
}

/* React Flow custom node: the existing presentational node, flanked by connection
   handles (left = target, right = source). The left handle is hidden by default;
   an unfilled-input node shows it as an open "missing" circle. The right (source)
   handle is the authoring `+`: a node with fitting options shows it as a visible
   `+` that opens the phase-keyed add menu (and is the drag source for join). */
export function ArrayShapeRFNode(
  { id, data }: { id?: string; selected?: boolean; data: RFNodeData },
) {
  const { missing, options, inEdge, ...shape } = data;
  const insertStep = useSetAtom(insertStepAtom);
  const openCard = useSetAtom(openCardAtom);
  const [menuOpen, setMenuOpen] = useState(false);
  const canAdd = !!options && options.length > 0;

  // clicking the detail line opens the editor for the step that produced this
  // node (the same card a click on its incoming edge opens).
  const onEdit = inEdge
    ? () => openCard({ target: { kind: "edge", id: inEdge.id }, cardKind: EDGE_CARD[inEdge.kind] })
    : undefined;

  const pick = (action: AuthorAction) => {
    setMenuOpen(false);
    const d = authorDispatch(id ?? "", action);
    if (d.atom === "insertStep") insertStep(d.arg);
    else openCard(d.arg);
  };

  return (
    <div className="txw-rfnode">
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
