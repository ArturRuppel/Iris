import type { Edge, EdgeKind, ExplorerGraph, ExplorerNode } from "../explorer/graph";

/* Nodes are a fixed ~172px-wide box (see .txw-node). The transformation label now
   lives INSIDE each node (eyebrow + detail), not in the gap, so COL_GAP only needs
   a slim gutter for the connector. ROW_GAP stacks same-rank nodes with clearance
   for a compact node (eyebrow + detail + grain bar + values). */
export const NODE_W = 172;
export const COL_GAP = NODE_W + 74;
export const ROW_GAP = 150;

export interface PositionedNode { id: string; x: number; y: number; node: ExplorerNode }
export interface LayoutEdge {
  id: string; source: string; target: string;
  kind: EdgeKind; label: string; guards?: Edge["guards"];
}
export interface GraphLayout { nodes: PositionedNode[]; edges: LayoutEdge[] }

export function layoutGraph(graph: ExplorerGraph): GraphLayout {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const forward = graph.edges.filter((e) => byId.has(e.fromId) && byId.has(e.toId));

  // longest-path rank over forward edges (Kahn relaxation). Roots start at 0.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  graph.nodes.forEach((n) => { indeg.set(n.id, 0); adj.set(n.id, []); });
  for (const e of forward) {
    adj.get(e.fromId)!.push(e.toId);
    indeg.set(e.toId, (indeg.get(e.toId) ?? 0) + 1);
  }
  const rank = new Map<string, number>();
  const work = new Map(indeg);
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  queue.forEach((id) => rank.set(id, 0));
  while (queue.length) {
    const id = queue.shift()!;
    const r = rank.get(id) ?? 0;
    for (const to of adj.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, r + 1));
      work.set(to, (work.get(to) ?? 0) - 1);
      if ((work.get(to) ?? 0) === 0) queue.push(to);
    }
  }

  // a join's right-input (the join-input phase) is a forward root, so it lands at
  // rank 0; pull it to just left of the join node it feeds instead.
  for (const e of forward) {
    if (byId.get(e.fromId)?.phase === "join-input") {
      const jr = rank.get(e.toId);
      if (jr != null) rank.set(e.fromId, Math.max(0, jr - 1));
    }
  }

  // y: stack nodes sharing a rank in node order (deterministic, since buildGraph
  // emits nodes in a stable order). A node alone in its rank sits on y = 0.
  const order = new Map<number, number>();
  const yOf = new Map<string, number>();
  for (const n of graph.nodes) {
    const r = rank.get(n.id) ?? 0;
    const i = order.get(r) ?? 0;
    yOf.set(n.id, i * ROW_GAP);
    order.set(r, i + 1);
  }

  // A terminal figure with a fan-in that spans more than one column (the superplot
  // case: a raw layer AND a coarser-grain layer both feed the plot) would force the
  // far geom/test wire into an off-row lane that lifts ABOVE the top node — outside
  // the node bounding box fitView frames, so it clips off-canvas and reads as a
  // MISSING input edge. Drop such a figure onto its own row below the chain: each
  // fan-in then routes as a clean orthogonal drop UNDER the intermediate collapse
  // nodes, on-canvas, so every source table keeps a visible edge into the figure. A
  // figure whose only fan-ins are from the adjacent column stays inline (unchanged).
  for (const n of graph.nodes) {
    if (n.kind !== "figure") continue;
    const figRank = rank.get(n.id) ?? 0;
    const spans = forward.some((e) => e.toId === n.id
      && (e.kind === "geom" || e.kind === "test")
      && (rank.get(e.fromId) ?? 0) <= figRank - 2);
    if (!spans) continue;
    const below = Math.max(0, ...graph.nodes
      .filter((m) => m.id !== n.id).map((m) => yOf.get(m.id) ?? 0)) + ROW_GAP;
    yOf.set(n.id, below);
  }

  const nodes: PositionedNode[] = graph.nodes.map((n) => ({
    id: n.id, x: (rank.get(n.id) ?? 0) * COL_GAP, y: yOf.get(n.id) ?? 0, node: n,
  }));
  const edges: LayoutEdge[] = graph.edges.map((e) => ({
    id: e.id, source: e.fromId, target: e.toId,
    kind: e.kind, label: e.label, guards: e.guards,
  }));
  return { nodes, edges };
}
