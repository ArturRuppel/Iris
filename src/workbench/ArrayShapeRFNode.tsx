import { Handle, Position } from "@xyflow/react";
import { ArrayShapeNode, type ArrayShapeNodeProps, type NodeVariant } from "../components/ArrayShapeNode";
import type { ExplorerNode } from "../explorer/graph";

/* id -> node variant (mirrors workspace.ts's variantOf; removed/onKeys highlighting
   is deferred to a later phase, so they are not derived here). */
function variantOf(id: string): NodeVariant {
  if (id === "source" || id.startsWith("source:")) return "source";
  if (id.startsWith("grain:")) return "grain";
  return "table";
}

/* the RF node data: the presentational props plus a `missing` flag (an unfilled
   required input — see ExplorerNode.missing) that drives the open-circle handle. */
export type RFNodeData = ArrayShapeNodeProps & { missing?: boolean };

/* an ExplorerNode -> the RF node data. Pure + exported so the mapping is
   unit-tested without React Flow. */
export function nodeShapeProps(node: ExplorerNode): RFNodeData {
  const c = node.count;
  return {
    title: node.label, variant: variantOf(node.id),
    axes: c?.axes ?? [], values: c?.values ?? [], rows: c?.rows, cols: c?.cols,
    missing: node.missing,
  };
}

/* React Flow custom node: the existing presentational node, flanked by connection
   handles (left = target, right = source). The handles are hidden by default; an
   unfilled-input node shows its target handle as an open "missing" circle. */
export function ArrayShapeRFNode({ data }: { id?: string; selected?: boolean; data: RFNodeData }) {
  const { missing, ...shape } = data;
  return (
    <div className="txw-rfnode">
      <Handle
        type="target" position={Position.Left}
        className={missing ? "txw-handle-missing" : undefined}
        style={missing ? undefined : { opacity: 0 }}
      />
      <ArrayShapeNode {...shape} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
