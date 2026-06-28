import type { EdgeKind, ExplorerGraph, ExplorerNode } from "../explorer/graph";

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

/* one glyph per nesting level — the first letter, shared by the segment bar and
   the canvas legend that decodes it. */
export const levelInitial = (name: string): string => {
  const m = name.match(/[a-zA-Z]/);
  return (m ? m[0] : name[0] ?? "?").toUpperCase();
};

/* the primary incoming edge of a node: a forward edge into it,
   preferring the main-chain input over a join's secondary (join-input) input. */
function primaryIn(graph: ExplorerGraph, nodeId: string, byId: Map<string, ExplorerNode>) {
  const incoming = graph.edges.filter((e) => e.toId === nodeId);
  return incoming.find((e) => byId.get(e.fromId)?.phase !== "join-input") ?? incoming[0];
}

export function nodeDeltas(graph: ExplorerGraph): Map<string, NodeDelta> {
  const spine = graph.spine;
  const inSpine = (names: string[]) => names.filter((n) => spine.includes(n));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  /* The grain a node carries for the SHED diff — read from the collapse PLAN, not
     from async /shape_counts axes. A `grain` node holds its plan-chosen dims;
     every other node (source/reduce/join) carries the full spine. This is the
     same structural rule mergeGuards uses, and unlike axes it survives the
     leading-identity-grain prune: when that prune rewires the first collapse onto
     the source, the source still reports the full spine here, so the first
     collapse still sheds its level (e.g. the innermost `frame`). Reading the
     predecessor's axes instead left that first collapse calm, because the source's
     materialized axes can omit a level the plan still pools. */
  const grainOf = (id: string): string[] => {
    const n = byId.get(id);
    if (!n) return [];
    return n.phase === "grain" ? inSpine(n.dims ?? []) : spine;
  };

  const out = new Map<string, NodeDelta>();
  for (const node of graph.nodes) {
    const edge = primaryIn(graph, node.id, byId);
    // live: the levels this node still carries. A grain node reads its plan dims
    // (the materialized axes can keep reporting an already-pooled innermost level
    // like `frame`, which would leave it filled instead of fading to 'gone'); any
    // other node reads its axes, so a join's narrower side-input grain stays true.
    const live = node.phase === "grain" ? grainOf(node.id) : inSpine(axisNames(graph, node.id));
    // shed: only a grain step pools a spine level — diff its plan grain against
    // its predecessor's grain (the full spine at the collapse-chain head).
    const shed = node.phase === "grain" && edge
      ? grainOf(edge.fromId).filter((d) => !grainOf(node.id).includes(d))
      : [];
    const predVals = edge ? valueNames(graph, edge.fromId) : [];
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
