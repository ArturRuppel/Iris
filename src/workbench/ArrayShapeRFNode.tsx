import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { useSetAtom } from "jotai";
import { ArrayShapeNode, type ArrayShapeNodeProps, type NodeVariant } from "../components/ArrayShapeNode";
import type { ExplorerNode } from "../explorer/graph";
import { insertStepAtom } from "../state";
import { openCardAtom } from "./state";
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
   and the `+`-menu options fitting this node's phase (see authoring.affordances). */
export type RFNodeData = ArrayShapeNodeProps & { missing?: boolean; options?: AuthorOption[] };

/* an ExplorerNode -> the RF node data. Pure + exported so the mapping is
   unit-tested without React Flow. */
export function nodeShapeProps(node: ExplorerNode): RFNodeData {
  const c = node.count;
  return {
    title: node.label, variant: variantOf(node),
    axes: c?.axes ?? [], values: c?.values ?? [], rows: c?.rows, cols: c?.cols,
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
  const { missing, options, ...shape } = data;
  const insertStep = useSetAtom(insertStepAtom);
  const openCard = useSetAtom(openCardAtom);
  const [menuOpen, setMenuOpen] = useState(false);
  const canAdd = !!options && options.length > 0;

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
      <ArrayShapeNode {...shape} />
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
