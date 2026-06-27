import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { cannedExample } from "../explorer/cannedExamples";
import { OpHoverExample } from "../components/OpHoverExample";
import type { EdgeKind } from "../explorer/graph";

export interface WorkbenchEdgeData { kind: EdgeKind; label: string; back: boolean }

/* the transformation TYPE shown as the label's first line; the edge's `label`
   carries the qualifier (the detail) on the second line. Keeps the annotation
   readable — type first, jargon demoted. */
const EDGE_TYPE: Record<EdgeKind, string> = {
  filter: "Filter", drop: "Drop", derive: "Derive", recode: "Recode",
  join: "Join", pivot: "Pivot", grid_complete: "Complete",
  collapse: "Collapse", geom: "Plot", test: "Test", annotate: "Annotate",
};

/* a graph edge: a horizontal side-to-side connector (orthogonal "blackbox" wiring)
   with a centred, hover-expandable two-line label. The label's colour class keys
   off the edge kind (reusing the existing per-kind styles). A back-edge (annotate)
   keeps a curved bezier so the stats->plot link reads as an overlay, not a flow
   step. */
export function WorkbenchEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const data = props.data as unknown as WorkbenchEdgeData | undefined;
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = data?.back
    ? getBezierPath({ sourceX, sourceY, targetX, targetY, curvature: 0.6 })
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY,
        sourcePosition, targetPosition, borderRadius: 8 });
  const ex = data ? cannedExample(data.kind) : null;
  const type = data ? EDGE_TYPE[data.kind] : "";
  return (
    <>
      <BaseEdge id={id} path={path} className={`txw-rfedge ${data?.kind ?? ""}${data?.back ? " back" : ""}`} />
      <EdgeLabelRenderer>
        <div
          className={`txw-rfedge-label ${data?.kind ?? ""}${hover ? " hover" : ""}`}
          style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          tabIndex={0}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
        >
          <span className="txw-edge-type">{type}</span>
          {data?.label && <span className="txw-edge-qual">{data.label}</span>}
          {hover && ex && <OpHoverExample example={ex} />}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
