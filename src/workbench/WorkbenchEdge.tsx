import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useSetAtom } from "jotai";
import type { EdgeKind } from "../explorer/graph";
import { COL_GAP } from "./layout";
import { openCardAtom } from "./state";
import { EDGE_CARD } from "./cardRegistry";
import { EDGE_TYPE } from "./edgeMeta";

export interface WorkbenchEdgeData { kind: EdgeKind; label: string }

/* The geom/test wires feed the figure, whose Plot/Stats sections are their own
   editing surface — so only the table-producing steps (reduce/collapse/join/…)
   name themselves on the edge. */
const namesOnEdge = (kind: EdgeKind | undefined): boolean =>
  !!kind && kind !== "geom" && kind !== "test";

/* The collapse chain is the literal data flow and keeps the inline corridor.
   The fan-in families (geom -> the shared Plot, test -> Stats) only need special
   routing when their target is more than one column away — there the wire would
   otherwise run horizontally through the collapse corridor and tunnel under the
   nodes between source and target. A fan-in to the IMMEDIATELY adjacent column
   (the common terminal case: last grain -> Stats, grain -> the Plot stacked just
   off it) has nothing to clear, so it routes inline. For a far target the lane
   follows the TARGET: off the main row, the wire drops straight to that row (no
   detour); on the main row we lift it into a top (geom) / bottom (test) lane.
   LANE_Y clears a tall table node (title + Organised-by + Values); OFF_ROW is how
   far off-row counts as "its own row"; STUB is the short exit before the turn. */
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
   A fan-in whose target sits in the IMMEDIATELY adjacent column (e.g. the last
   grain -> Stats, or a grain -> the Plot stacked just off it) has no collapse node
   between source and target, so it routes inline with no detour — lifting it into a
   lane would only add a pointless loop. The lane is reserved for the real hazard: a
   target more than one column away, where collapse nodes would otherwise sit under
   a same-row horizontal wire. Pure + exported so the decision is unit-tested. */
export function laneOf(
  kind: EdgeKind | undefined,
  sourceX: number, sourceY: number, targetX: number, targetY: number,
): number | null {
  if (kind !== "geom" && kind !== "test") return null;
  if (targetX - sourceX < COL_GAP) return null;               // adjacent column: route inline
  if (Math.abs(targetY - sourceY) >= OFF_ROW) return targetY; // far + target on its own row
  return sourceY + (kind === "geom" ? -LANE_Y : LANE_Y);       // far + on-row: lift to a lane
}

/* a graph edge: the wire AND, for a table-producing step, the step's name written
   over it (just the verb — "filter", "collapse") as the edit affordance: click it
   to open that step's editor. The box below is the resulting table, the wire is the
   step, so the step is named on the wire. An inline edge is a gentle bezier: a flat
   horizontal line when its two nodes share a row, easing into a smooth S when one
   is dragged off-row (a centered orthogonal step would read as a detached squiggle
   in the gutter). Only the geom/test fan-in lanes stay orthogonal: their long
   top/bottom detour around the collapse corridor wants crisp right angles, not a
   sagging curve, to read as a deliberate bypass rather than a wandering wire. */
export function WorkbenchEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const data = props.data as unknown as WorkbenchEdgeData | undefined;
  const openCard = useSetAtom(openCardAtom);
  // geom -> Plot, test -> Stats: pick the lane the TARGET is on so the wire never
  // detours. Off-row target -> route straight to its row; on-row target -> lift
  // into a top (geom) / bottom (test) lane to clear the inline collapse corridor.
  const lane = laneOf(data?.kind, sourceX, sourceY, targetX, targetY);
  const [path, labelX, labelY] = lane != null
    ? laneRoute(sourceX, sourceY, targetX, targetY, lane)
    : getBezierPath({ sourceX, sourceY, targetX, targetY,
        sourcePosition, targetPosition });
  const kind = data?.kind;
  return (
    <>
      <BaseEdge id={id} path={path} className={`txw-rfedge ${kind ?? ""}`} />
      {namesOnEdge(kind) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`txw-edge-step k-${kind}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                     pointerEvents: "all" }}
            title={data?.label || undefined}
            onClick={(e) => {
              e.stopPropagation();
              openCard({ target: { kind: "edge", id }, cardKind: EDGE_CARD[kind!] });
            }}
          >
            {EDGE_TYPE[kind!].toLowerCase()}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
