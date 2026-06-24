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

/* an ExplorerNode -> the presentational ArrayShapeNode props. Pure + exported so
   the mapping is unit-tested without React Flow. */
export function nodeShapeProps(node: ExplorerNode): ArrayShapeNodeProps {
  const c = node.count;
  return {
    title: node.label, variant: variantOf(node.id),
    axes: c?.axes ?? [], values: c?.values ?? [], rows: c?.rows, cols: c?.cols,
  };
}

/* React Flow custom node: the existing presentational node, flanked by hidden
   connection handles (left = target, right = source) so edges attach. */
export function ArrayShapeRFNode({ data }: { id?: string; selected?: boolean; data: ArrayShapeNodeProps }) {
  return (
    <div className="txw-rfnode">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <ArrayShapeNode {...data} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
