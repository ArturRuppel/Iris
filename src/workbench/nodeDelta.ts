import type { EdgeKind, ExplorerGraph } from "../explorer/graph";

/* What each step CHANGED, relative to its predecessor — the data behind the
   redesigned node. The card shows only the delta, so consecutive cards stop
   repeating the full table:
     - spine: the full nesting (the finest-grain axis list), in order, shared by
       every node so the per-node segment bar is interpretable.
     - live:  the spine levels this node still carries (its own axes).
     - shed:  the levels THIS step pooled away (predecessor had them, this node
       doesn't) — the ones lit in the step's accent on the grain bar.
     - newValues: value columns this step introduced (added/derived/joined).
     - inEdge: the primary incoming transformation, so the card can show its
       label and open its editor on click. */
export interface NodeDelta {
  spine: string[];
  live: string[];
  shed: string[];
  newValues: string[];
  inEdge?: { id: string; kind: EdgeKind; label: string };
}

const axisNames = (g: ExplorerGraph, id: string): string[] =>
  (g.nodes.find((n) => n.id === id)?.count?.axes ?? []).map((a) => a.name);
const valueNames = (g: ExplorerGraph, id: string): string[] =>
  (g.nodes.find((n) => n.id === id)?.count?.values ?? []).map((v) => v.name);

/* the spine = the finest grain = the node carrying the most axes; its axis order
   defines the nesting order every per-node segment bar is read against. */
export function spineOf(graph: ExplorerGraph): string[] {
  let spine: string[] = [];
  for (const n of graph.nodes) {
    const ax = (n.count?.axes ?? []).map((a) => a.name);
    if (ax.length > spine.length) spine = ax;
  }
  return spine;
}

/* one glyph per nesting level — the first letter, shared by the segment bar and
   the canvas legend that decodes it. */
export const levelInitial = (name: string): string => {
  const m = name.match(/[a-zA-Z]/);
  return (m ? m[0] : name[0] ?? "?").toUpperCase();
};

/* the primary incoming edge of a node: a forward (non-annotate) edge into it,
   preferring the main-chain input over a join's secondary `source:` input. */
function primaryIn(graph: ExplorerGraph, nodeId: string) {
  const incoming = graph.edges.filter((e) => e.toId === nodeId && e.kind !== "annotate");
  return incoming.find((e) => !e.fromId.startsWith("source:")) ?? incoming[0];
}

export function nodeDeltas(graph: ExplorerGraph): Map<string, NodeDelta> {
  const spine = spineOf(graph);
  const inSpine = (names: string[]) => names.filter((n) => spine.includes(n));

  const out = new Map<string, NodeDelta>();
  for (const node of graph.nodes) {
    const edge = primaryIn(graph, node.id);
    const live = inSpine(axisNames(graph, node.id));
    // a node with no axes of its own is a terminal (Plot/Stats): it consumes the
    // table, it doesn't pool a level — so it sheds nothing and shows no grain bar.
    const hasOwnGrain = (node.count?.axes?.length ?? 0) > 0;
    const predAxes = edge ? inSpine(axisNames(graph, edge.fromId)) : [];
    const predVals = edge ? valueNames(graph, edge.fromId) : [];
    const shed = hasOwnGrain ? predAxes.filter((n) => !live.includes(n)) : [];
    const newValues = edge
      ? valueNames(graph, node.id).filter((v) => !predVals.includes(v))
      : [];
    out.set(node.id, {
      spine, live, shed, newValues,
      inEdge: edge ? { id: edge.id, kind: edge.kind, label: edge.label } : undefined,
    });
  }
  return out;
}
