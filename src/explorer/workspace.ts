import type { AxisDesc, ValueDesc } from "../types";
import type { Edge, EdgeKind, ExplorerGraph, ExplorerNode, NodeKind } from "./graph";

export type WsVariant = "source" | "table" | "grain" | "hub";

export interface WsNode {
  id: string;
  kind: NodeKind;
  title: string;
  variant: WsVariant;
  axes: AxisDesc[];
  values: ValueDesc[];
  rows?: number;
  cols?: number;
}
export interface WsEdge { id: string; kind: EdgeKind; op: string; guards?: Edge["guards"] }
export interface SpineEntry {
  node: WsNode;
  inEdge?: WsEdge;
  removed: string[];
  rightInput?: WsNode;
  onKeys?: string[];
}
export interface ForkEntry { terminal: WsNode; edges: (WsEdge & { fromTitle: string })[] }
export interface WorkspaceModel { spine: SpineEntry[]; fork: ForkEntry[] }

const BRANCH: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["geom", "test"]);
const isTerminal = (n?: ExplorerNode) => n?.kind === "plot" || n?.kind === "stats";

function variantOf(node: ExplorerNode, isHub: boolean): WsVariant {
  if (isHub) return "hub";
  if (node.id === "source" || node.id.startsWith("source:")) return "source";
  if (node.id.startsWith("grain:")) return "grain";
  return "table";
}

function toWsNode(node: ExplorerNode, isHub = false): WsNode {
  const c = node.count;
  return {
    id: node.id, kind: node.kind, title: node.label, variant: variantOf(node, isHub),
    axes: c?.axes ?? [], values: c?.values ?? [], rows: c?.rows, cols: c?.cols,
  };
}

export function buildWorkspaceModel(graph: ExplorerGraph): WorkspaceModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const opEdges = graph.edges.filter((e) => !BRANCH.has(e.kind));

  // right inputs: a `source:<i>` node feeds a join; map join node -> {right, keys}
  const rightOf = new Map<string, { node: ExplorerNode; keys: string[] }>();
  for (const e of opEdges) {
    if (e.fromId.startsWith("source:")) {
      const r = byId.get(e.fromId);
      if (r) rightOf.set(e.toId, { node: r, keys: e.onKeys ?? [] });
    }
  }

  // walk the main chain from `source` via outgoing op edges (skipping edges into a
  // right-input or a terminal); each step's edge is the NEXT node's in-edge.
  const spine: SpineEntry[] = [];
  let curId: string | null = "source";
  let prevEdge: Edge | undefined;
  const seen = new Set<string>();
  while (curId && byId.has(curId) && !seen.has(curId)) {
    seen.add(curId);
    const node = byId.get(curId)!;
    const ws = toWsNode(node, rightOf.has(curId));
    const parent = prevEdge ? byId.get(prevEdge.fromId) : undefined;
    const removed = (parent?.count?.axes ?? [])
      .map((a) => a.name)
      .filter((n) => !ws.axes.some((a) => a.name === n));
    const right = rightOf.get(curId);
    spine.push({
      node: ws,
      inEdge: prevEdge ? { id: prevEdge.id, kind: prevEdge.kind, op: prevEdge.label, guards: prevEdge.guards } : undefined,
      removed,
      rightInput: right ? toWsNode(right.node) : undefined,
      onKeys: right ? right.keys : undefined,
    });
    const out: Edge | undefined = opEdges.find(
      (e) => e.fromId === curId && !e.toId.startsWith("source:") && !isTerminal(byId.get(e.toId)),
    );
    prevEdge = out;
    curId = out ? out.toId : null;
  }

  // terminal fork: each plot/stats node + its incoming branch (geom/test) edges
  const fork: ForkEntry[] = graph.nodes
    .filter((n) => isTerminal(n))
    .map((t) => ({
      terminal: toWsNode(t),
      edges: graph.edges
        .filter((e) => e.toId === t.id && BRANCH.has(e.kind))
        .map((e) => ({ id: e.id, kind: e.kind, op: e.label, guards: e.guards,
          fromTitle: byId.get(e.fromId)?.label ?? "" })),
    }))
    .filter((f) => f.edges.length > 0);

  return { spine, fork };
}
