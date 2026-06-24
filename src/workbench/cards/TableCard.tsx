import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { addStepAtom } from "../../state";
import { explorerGraphAtom } from "../../explorer/graphAtom";
import { NodeTable } from "../../components/NodeTable";
import type { ReduceStepKind } from "../../types";
import type { CardBodyProps } from "../cardRegistry";

const KIND_LABEL: Record<ReduceStepKind, string> = {
  drop: "Drop columns", filter: "Filter rows",
  derive: "Derive column", recode: "Recode column", join: "Join table",
  pivot: "Pivot column", grid_complete: "Complete grid",
};

/* The table node's body: the reduced table at this node (delegated to NodeTable,
   shared with the data tab) plus an append-step menu mirroring PipelineSection —
   addStepAtom appends a drop/filter to the active plottable's pipeline. */
export function TableCard({ target }: CardBodyProps) {
  const graph = useAtomValue(explorerGraphAtom);
  const addStep = useSetAtom(addStepAtom);
  const [adding, setAdding] = useState(false);

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
      <NodeTable node={node} />
      <div className="add-step">
        {adding ? (
          <div className="add-step-menu">
            {(["drop", "filter"] as ReduceStepKind[]).map((k) => (
              <button key={k} onClick={() => { addStep(k); setAdding(false); }}>
                {KIND_LABEL[k]}
              </button>
            ))}
            <button className="cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="add-step-btn" onClick={() => setAdding(true)}>
            + Filter / Drop
          </button>
        )}
      </div>
    </div>
  );
}
