import { useAtomValue } from "jotai";
import { explorerGraphAtom } from "../../explorer/graphAtom";
import { NodeTable } from "../../components/NodeTable";
import type { CardBodyProps } from "../cardRegistry";

/* The table node's body: the reduced table at this node (delegated to NodeTable,
   shared with the data tab). Adding a step is owned by the on-canvas `+` handle
   (the single way to author a step), so this card is table-only. */
export function TableCard({ target }: CardBodyProps) {
  const graph = useAtomValue(explorerGraphAtom);

  const node = graph?.nodes.find((n) => n.id === target.id);
  if (!node) {
    return (
      <div className="txw-card-stub" data-testid="table-card">
        This node is no longer in the graph.
      </div>
    );
  }

  return (
    <div className="txw-card-table" data-testid="table-card">
      <NodeTable node={node} groupRoles />
    </div>
  );
}
