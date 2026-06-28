import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { activePlottableAtom, selectedNodeIdAtom } from "../state";
import { explorerGraphAtom } from "../explorer/graphAtom";
import type { ExplorerNode } from "../explorer/graph";
import { NodeTable } from "./NodeTable";

export function DataTab() {
  const active = useAtomValue(activePlottableAtom);
  const selectedId = useAtomValue(selectedNodeIdAtom);

  /* the same graph the workbench canvas renders, so node ids line up exactly. */
  const graph = useAtomValue(explorerGraphAtom);

  /* the selected node, falling back to the figure node (the final reduced table)
     when nothing is selected or the id is stale. */
  const node: ExplorerNode | null = useMemo(() => {
    if (!graph) return null;
    return graph.nodes.find((n) => n.id === selectedId)
      ?? graph.nodes.find((n) => n.kind === "figure")
      ?? null;
  }, [graph, selectedId]);

  if (!active || !node) return <div className="reduced-empty">Building preview…</div>;
  return <NodeTable node={node} />;
}
