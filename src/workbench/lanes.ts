import { atom } from "jotai";
import { Position, type Node, type Edge as RFEdge } from "@xyflow/react";
import {
  plottablesAtom, activePlottableIdAtom, reduceStoreAtom, poolFor, dagView,
  tablesAtom, analysisByIdAtom, registryAtom,
} from "../state";
import { byId } from "../tables";
import { defaultPlan } from "../collapse";
import { buildGraph, type ExplorerGraph } from "../explorer/graph";
import { explorerGraphAtom } from "../explorer/graphAtom";
import { layoutGraph } from "./layout";
import { nodeDeltas } from "./nodeDelta";
import { nodeShapeProps } from "./ArrayShapeRFNode";

/* EXPERIMENT: every analysis as a lane on the one canvas, in place of the
   Analyses list. Each lane is one analysis's graph with a header on its left;
   the active lane is the editable graph the workbench has always shown, the
   others are read-only previews that become active on a click. Off by default:
   the ⋯ menu's "Analyses on the canvas" or ?lanes=1 turns it on. */

export { lanesEnabledAtom } from "./lanesFlag";

export interface Lane {
  id: string;              // the analysis (plottable) id
  name: string;
  tag: string;
  marks: string;           // "Box + Dots"
  active: boolean;
  tableName: string;
  statsOff: boolean;
  graph: ExplorerGraph;
  svg: string | null;      // the last rendered figure, when one is cached
}

export const lanesAtom = atom<Lane[]>((get) => {
  const activeId = get(activePlottableIdAtom);
  const activeGraph = get(explorerGraphAtom);
  const tables = get(tablesAtom);
  const store = get(reduceStoreAtom);
  const results = get(analysisByIdAtom);
  const registry = get(registryAtom);
  const out: Lane[] = [];
  for (const p of get(plottablesAtom)) {
    const table = byId(tables, p.tableId);
    const active = p.id === activeId;
    let graph: ExplorerGraph | null = active ? activeGraph : null;
    if (!graph) {
      // an inactive lane: the same projection, without the engine's row counts
      const h = table?.hierarchy ?? { spine: [], fn: {} };
      const faceted = !!(p.facetRow || p.facetCol);
      const layers = faceted ? p.layers.map((l) => ({ ...l, panel: 0 })) : p.layers;
      const res = results[p.id];
      graph = buildGraph(dagView(poolFor(store, p.tableId), p), h.spine,
        p.collapse ?? defaultPlan(h.spine, h.fn), layers, table?.schema ?? null, {
          test: res?.stats?.result?.test ?? p.override ?? null,
          describeOnly: p.describeOnly, annotate: !!p.style.show_significance, off: !!p.statsOff,
        });
    }
    out.push({
      id: p.id, name: p.name, tag: p.tag ?? "", active,
      marks: [...new Set(p.layers.map((l) => registry?.geoms[l.geom]?.label ?? l.geom))].join(" + "),
      tableName: table?.name ?? "Table", statsOff: !!p.statsOff, graph,
      svg: results[p.id]?.figure?.svg ?? null,
    });
  }
  return out;
});

/* ---- composing the lanes into one React Flow graph ---- */

export const LANE_HEAD_W = 190;
const HEAD_GAP = 46;
const NODE_H = 150;
const THUMB_H = 190;
const LANE_GAP = 56;
export const ADD_LANE_ID = "laneadd";
export const headId = (laneId: string) => `lanehead:${laneId}`;
const ghostPrefix = (laneId: string) => `lane:${laneId}::`;
/* a ghost node's id back to the id it has inside its own (active) graph */
export const rawNodeId = (id: string): string => id.replace(/^lane:[^:]*::/, "");

export interface LaneHeadData { lane: Lane; [k: string]: unknown }

export function toRFLanes(
  lanes: Lane[], overrides: Record<string, { x: number; y: number }>,
): { nodes: Node[]; edges: RFEdge[]; activeOffset: number } {
  const nodes: Node[] = [];
  const edges: RFEdge[] = [];
  let y = 0, activeOffset = 0;
  for (const lane of lanes) {
    const L = layoutGraph(lane.graph);
    const deltas = nodeDeltas(lane.graph);
    const pre = lane.active ? "" : ghostPrefix(lane.id);
    if (lane.active) activeOffset = y;
    nodes.push({
      id: headId(lane.id), type: "laneHead", position: { x: -(LANE_HEAD_W + HEAD_GAP), y },
      draggable: false, selectable: false,
      data: { lane } as LaneHeadData,
    });
    let bottom = NODE_H;
    for (const n of L.nodes) {
      const isFig = n.node.kind === "figure";
      const o = lane.active ? overrides[n.id] : undefined;
      nodes.push({
        id: pre + n.id, type: lane.active ? "arrayShape" : "ghost",
        position: o ? { x: o.x, y: o.y + y } : { x: n.x, y: n.y + y },
        draggable: lane.active, selectable: lane.active,
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: {
          ...nodeShapeProps(n.node, deltas.get(n.id), lane.tableName, lane.statsOff),
          ...(isFig && lane.svg ? { thumb: lane.svg } : {}),
          laneId: lane.id,
        } as unknown as Record<string, unknown>,
      });
      bottom = Math.max(bottom, n.y + (isFig && lane.svg ? THUMB_H + 40 : NODE_H));
    }
    for (const e of L.edges) {
      edges.push({
        id: pre + e.id, source: pre + e.source, target: pre + e.target, type: "workbench",
        sourceHandle: "out",
        targetHandle: e.kind === "geom" ? (e.panel ? `in-plot-${e.panel}` : "in-plot")
          : e.kind === "test" ? "in-test" : "in",
        className: lane.active ? undefined : "txw-ghost-edge",
        data: { kind: e.kind, label: e.label, guards: lane.active ? e.guards : undefined,
          ...(lane.active ? {} : { ghostLane: lane.id }) },
      });
    }
    y += bottom + LANE_GAP;
  }
  nodes.push({
    id: ADD_LANE_ID, type: "laneAdd", position: { x: -(LANE_HEAD_W + HEAD_GAP), y },
    draggable: false, selectable: false, data: {},
  });
  return { nodes, edges, activeOffset };
}
