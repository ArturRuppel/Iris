import { atom } from "jotai";
import {
  activePlottableAtom, hierarchyAtom, effectiveSchemaAtom, analysisAtom,
  effectivePlanAtom, effectiveTestGrainAtom,
} from "../state";
import { buildGraph, type ExplorerGraph, type ExplorerNode, type StatsInput, type NodeCount, type Edge } from "./graph";
import type { ShapeCountsGuards, GuardVerdict, StyleOverrides } from "../types";

/* significance annotation is enabled per-analysis via the style override the
   render layer already reads. Pure so the graph wiring is unit-testable without
   a store. */
export const annotateEnabled = (style: StyleOverrides): boolean =>
  !!style.show_significance;

/* the chosen test's display name + describe-only flag. The chosen test comes
   from the live analyze result (StatsResult.result.test); before a result lands
   it falls back to the user's pinned override, else null. describeOnly lives
   directly on the Plottable. */
const statsInputAtom = atom<StatsInput | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const res = get(analysisAtom);
  return {
    test: res?.stats?.result?.test ?? p.override ?? null,
    describeOnly: p.describeOnly,
    annotate: annotateEnabled(p.style),
  };
});

/* per-node counts (keyed by node id) fetched via /shape_counts; null until loaded. */
export const shapeCountsAtom = atom<Record<string, NodeCount> | null>(null);

/* the raw guard verdicts /shape_counts returns; null until loaded (or guard not
   run). mergeGuards turns these into GuardVerdicts placed on the right edges. */
export const guardsAtom = atom<ShapeCountsGuards | null>(null);

/* Place the raw guard verdicts onto the edges they belong to. Pure: returns a
   fresh edges array (and fresh edge objects where a verdict is appended). The
   nodes carry the grain dims (node.dims, set by buildGraph): a `grain` node holds
   a subset; every other node carries the full spine, so it always "includes" and
   never "excludes" a dim. */
export function mergeGuards(edges: Edge[], guards: ShapeCountsGuards, nodes: ExplorerNode[]): Edge[] {
  const dimsOf = new Map<string, Set<string> | null>(
    nodes.map((n) => [n.id, n.phase === "grain" ? new Set(n.dims ?? []) : null]));
  const nodeIncludes = (id: string, dim: string): boolean => {
    const dims = dimsOf.get(id) ?? null;
    return dims === null ? true : dims.has(dim);
  };
  const nodeExcludes = (id: string, dim: string): boolean => {
    const dims = dimsOf.get(id) ?? null;
    return dims === null ? false : !dims.has(dim);
  };
  const out = edges.map((e) => ({ ...e, guards: e.guards ? [...e.guards] : e.guards }));
  const append = (e: Edge, v: GuardVerdict) => {
    e.guards = e.guards ? [...e.guards, v] : [v];
  };

  /* --- test edge: pseudoreplication + pairing-flip --- */
  const testEdge = out.find((e) => e.kind === "test");
  if (testEdge) {
    const pr = guards.pseudoreplication;
    if (pr?.risk) {
      append(testEdge, {
        id: "pseudoreplication", severity: "caution",
        text: `Testing here uses ${pr.n_test} from ${pr.n_coarsest} ${pr.coarsest_grain}; ` +
          `consider testing per ${pr.coarsest_grain} (n = ${pr.n_coarsest}).`,
      });
    }
    const pf = guards.pairing_flip;
    if (pf?.flipped) {
      append(testEdge, {
        id: "pairing_flip", severity: "caution",
        text: `Pairing changed: ${pf.from} → ${pf.to}${pf.across ? " (over " + pf.across + ")" : ""}.`,
      });
    }
  }

  /* --- collapse edges: identity-merge (one per detected dim) --- */
  const collapseEdges = out.filter((e) => e.kind === "collapse");
  for (const m of guards.identity_merge ?? []) {
    // the collapse edge whose target grain DROPS m.dim while its source grain
    // still carried it. If none matches unambiguously, fall back to the first
    // collapse edge whose target excludes m.dim — never drop the verdict.
    let edge =
      collapseEdges.find((e) => nodeExcludes(e.toId, m.dim) && nodeIncludes(e.fromId, m.dim)) ??
      collapseEdges.find((e) => nodeExcludes(e.toId, m.dim));
    if (!edge) edge = collapseEdges[0];
    if (!edge) continue;
    append(edge, {
      id: "identity_merge", severity: "caution",
      text: `Collapsing out ${m.dim} while keeping a finer level merges ${m.before} → ${m.after} units.`,
    });
  }

  /* --- join edges: join-key guard. The engine emits one verdict per OFFENDING
     join, carrying its step index; match the join node it feeds (`step:<i>`)
     rather than by position (a non-offending earlier join would misalign). --- */
  for (const m of guards.join_leaf_key ?? []) {
    const edge = out.find((e) => e.kind === "join" && e.toId === `step:${m.step}`);
    if (edge) append(edge, { id: "join_leaf_key", severity: "caution", text: m.text });
  }

  return out;
}

/* Drop `grain` nodes that are a true no-op: they drop no spine dim (node.regroup,
   set structurally by buildGraph) AND their row count equals their collapse
   PREDECESSOR's, so the collapsed table is identical to the table feeding it. This
   removes the default prefix chain's leading full-spine grain — confusing in the
   editor, since it shows the same rows as its input under a coarser-looking label.

   Count-gated against the immediate predecessor, NOT the source: a regroup whose
   count is below its input still merges rows and is KEPT. Comparing to the source
   was wrong both ways — a row-changing step upstream (e.g. a filter) left the
   leading full-spine grain with fewer rows than the source, so it was falsely
   KEPT; and a `grid_complete` that restored the source count was falsely PRUNED
   though it genuinely densifies. Pure: returns rewired nodes/edges — edges INTO a
   pruned node are dropped; edges OUT of one are rewired to its collapse
   predecessor (itself possibly pruned, so resolved transitively in node order). */
export function pruneIdentityGrains(
  nodes: ExplorerNode[], edges: Edge[], counts: Record<string, NodeCount>,
): { nodes: ExplorerNode[]; edges: Edge[] } {
  // prunedId -> the upstream node that replaces it (its collapse predecessor).
  const replacement = new Map<string, string>();
  for (const n of nodes) {
    if (n.phase !== "grain" || !n.regroup) continue;
    const inEdge = edges.find((e) => e.kind === "collapse" && e.toId === n.id);
    if (!inEdge) continue;
    const myRows = counts[n.id]?.rows;
    const predRows = counts[inEdge.fromId]?.rows;
    if (myRows == null || predRows == null) continue; // counts unknown -> keep
    if (myRows !== predRows) continue;                // still aggregates -> keep
    const from = replacement.get(inEdge.fromId) ?? inEdge.fromId;
    replacement.set(n.id, from);
  }
  if (replacement.size === 0) return { nodes, edges };
  const remap = (id: string): string => replacement.get(id) ?? id;
  return {
    nodes: nodes.filter((n) => !replacement.has(n.id)),
    edges: edges
      .filter((e) => !replacement.has(e.toId))
      .map((e) => (replacement.has(e.fromId) ? { ...e, fromId: remap(e.fromId) } : e)),
  };
}

export const explorerGraphAtom = atom<ExplorerGraph | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const h = get(hierarchyAtom);
  const plan = get(effectivePlanAtom);
  void get(effectiveTestGrainAtom);   // keep the test grain in the dep graph
  const g = buildGraph(p.reduce, h.spine, plan, p.layers,
    get(effectiveSchemaAtom), get(statsInputAtom));
  const counts = get(shapeCountsAtom);
  const guards = get(guardsAtom);
  let nodes = g.nodes, edges = g.edges;
  if (counts) {
    nodes = nodes.map((n) => (counts[n.id] ? { ...n, count: counts[n.id] } : n));
    // prune the leading identity grain once counts confirm it's a true no-op,
    // before guards merge so verdicts land on the surviving collapse edges.
    ({ nodes, edges } = pruneIdentityGrains(nodes, edges, counts));
  }
  if (guards) edges = mergeGuards(edges, guards, nodes);
  return { ...g, nodes, edges };
});
