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

/* The collapse chain is the literal data flow and keeps the inline corridor.
   The fan-in families (geom -> the shared Plot, test -> Stats) get routed so
   their labels never stack on the collapse labels. The lane follows the TARGET:
   when Plot/Stats is stacked off the main row, the wire drops straight to that
   row (no detour); only when the target sits ON the main row (so the edge would
   otherwise run horizontally through the collapse corridor) do we lift the wire
   into a top (geom) / bottom (test) lane. LANE_Y clears a tall table node (title
   + Organised-by + Values); OFF_ROW is how far off-row counts as "its own row";
   STUB is the short horizontal exit before the wire turns. */
const LANE_Y = 150;
const OFF_ROW = 90;
const STUB = 16;

/* An orthogonal path through the given corner points, with rounded elbows of
   radius `r`. getSmoothStepPath's `centerY` moves the label but not the drawn
   path when the endpoints share a row, leaving the label floating off its wire —
   so geom/test lanes are routed explicitly here, label riding the lane segment. */
function laneRoute(
  sx: number, sy: number, tx: number, ty: number, laneY: number, r = 8,
): [string, number, number] {
  const pts: [number, number][] = [
    [sx, sy], [sx + STUB, sy], [sx + STUB, laneY],
    [tx - STUB, laneY], [tx - STUB, ty], [tx, ty],
  ];
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
    const din = Math.hypot(cx - px, cy - py) || 1, dout = Math.hypot(nx - cx, ny - cy) || 1;
    const rr = Math.min(r, din / 2, dout / 2);
    const ix = cx - ((cx - px) / din) * rr, iy = cy - ((cy - py) / din) * rr;
    const ox = cx + ((nx - cx) / dout) * rr, oy = cy + ((ny - cy) / dout) * rr;
    d += ` L ${ix},${iy} Q ${cx},${cy} ${ox},${oy}`;
  }
  const [lx, lyy] = pts[pts.length - 1];
  d += ` L ${lx},${lyy}`;
  return [d, (sx + tx) / 2, laneY]; // label rides the across segment, mid-span
}

/* a graph edge: a horizontal side-to-side connector (orthogonal "blackbox" wiring)
   with a centred, hover-expandable two-line label. The label's colour class keys
   off the edge kind (reusing the existing per-kind styles). A back-edge (annotate)
   keeps a curved bezier so the stats->plot link reads as an overlay, not a flow
   step. geom/test fan-in edges route through a top/bottom lane so the horizontal
   run — and the label that rides it — clears the inline collapse row. */
export function WorkbenchEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const data = props.data as unknown as WorkbenchEdgeData | undefined;
  const [hover, setHover] = useState(false);
  // geom -> Plot, test -> Stats: pick the lane the TARGET is on so the wire never
  // detours. Off-row target -> route straight to its row; on-row target -> lift
  // into a top (geom) / bottom (test) lane to clear the inline collapse corridor.
  const fanIn = data?.kind === "geom" || data?.kind === "test";
  const laneY = !fanIn ? 0
    : Math.abs(targetY - sourceY) >= OFF_ROW ? targetY
    : sourceY + (data?.kind === "geom" ? -LANE_Y : LANE_Y);
  const [path, labelX, labelY] = data?.back
    ? getBezierPath({ sourceX, sourceY, targetX, targetY, curvature: 0.6 })
    : fanIn
      ? laneRoute(sourceX, sourceY, targetX, targetY, laneY)
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
