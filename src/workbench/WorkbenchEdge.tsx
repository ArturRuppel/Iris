import { BaseEdge, getBezierPath, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { EdgeKind } from "../explorer/graph";

export interface WorkbenchEdgeData { kind: EdgeKind; label: string; back: boolean }

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

/* the lane Y a fan-in (geom/test) wire runs in, or null for a normal inline edge.
   Pure + exported so the routing decision is unit-tested without React Flow. */
export function laneOf(kind: EdgeKind | undefined, sourceY: number, targetY: number): number | null {
  if (kind !== "geom" && kind !== "test") return null;
  if (Math.abs(targetY - sourceY) >= OFF_ROW) return targetY; // target on its own row
  return sourceY + (kind === "geom" ? -LANE_Y : LANE_Y);       // on-row: lift to a lane
}

/* a graph edge: a pure orthogonal "blackbox" wire — the transformation it carries
   is now named inside the TARGET node (eyebrow + detail), so the edge no longer
   renders a label. A back-edge (annotate) keeps a curved bezier so the
   stats->plot link reads as an overlay, not a flow step. geom/test fan-in edges
   route through a top/bottom lane so the wire never crosses the inline collapse
   row on its way to the shared Plot/Stats node. */
export function WorkbenchEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const data = props.data as unknown as WorkbenchEdgeData | undefined;
  // geom -> Plot, test -> Stats: pick the lane the TARGET is on so the wire never
  // detours. Off-row target -> route straight to its row; on-row target -> lift
  // into a top (geom) / bottom (test) lane to clear the inline collapse corridor.
  const lane = laneOf(data?.kind, sourceY, targetY);
  const [path] = data?.back
    ? getBezierPath({ sourceX, sourceY, targetX, targetY, curvature: 0.6 })
    : lane != null
      ? laneRoute(sourceX, sourceY, targetX, targetY, lane)
      : getSmoothStepPath({ sourceX, sourceY, targetX, targetY,
          sourcePosition, targetPosition, borderRadius: 8 });
  return (
    <BaseEdge id={id} path={path} className={`txw-rfedge ${data?.kind ?? ""}${data?.back ? " back" : ""}`} />
  );
}
