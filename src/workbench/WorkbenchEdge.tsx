import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cannedExample } from "../explorer/cannedExamples";
import { OpHoverExample } from "../components/OpHoverExample";
import type { EdgeKind } from "../explorer/graph";

export interface WorkbenchEdgeData { kind: EdgeKind; label: string; back: boolean }

/* a graph edge: a bezier path with a centred, hover-expandable label. The label's
   colour class keys off the edge kind (reusing the existing .<kind> styles). A
   back-edge (annotate) gets extra curvature so the stats->plot link reads as an
   overlay, not a flow step. */
export function WorkbenchEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY } = props;
  const data = props.data as unknown as WorkbenchEdgeData | undefined;
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    curvature: data?.back ? 0.6 : 0.25,
  });
  const ex = data ? cannedExample(data.kind) : null;
  return (
    <>
      <BaseEdge id={id} path={path} className={`txw-rfedge ${data?.kind ?? ""}${data?.back ? " back" : ""}`} />
      <EdgeLabelRenderer>
        <div
          className={`txw-rfedge-label ${data?.kind ?? ""}`}
          style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          tabIndex={0}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
        >
          {data?.label}
          {hover && ex && <OpHoverExample example={ex} />}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
