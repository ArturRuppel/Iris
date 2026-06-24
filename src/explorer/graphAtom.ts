import { atom } from "jotai";
import {
  activePlottableAtom, hierarchyAtom, effectiveSchemaAtom, analysisAtom,
  effectivePlanAtom, effectiveTestGrainAtom,
} from "../state";
import { buildGraph, type ExplorerGraph, type StatsInput, type NodeCount, type Edge } from "./graph";
import type { ShapeCountsGuards, GuardVerdict } from "../types";

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
  };
});

/* per-node counts (keyed by node id) fetched via /shape_counts; null until loaded. */
export const shapeCountsAtom = atom<Record<string, NodeCount> | null>(null);

/* the raw guard verdicts /shape_counts returns; null until loaded (or guard not
   run). mergeGuards turns these into GuardVerdicts placed on the right edges. */
export const guardsAtom = atom<ShapeCountsGuards | null>(null);

/* dims a grain-keyed node carries. A `grain:<key>` node carries the key's dims;
   the raw source/step node (no `grain:` prefix) is treated as carrying ALL dims,
   so it is never matched as "excludes <dim>" but always "includes <dim>". */
function dimsForNode(id: string): { dims: Set<string> | null } {
  if (id.startsWith("grain:")) {
    const key = id.slice("grain:".length);
    return { dims: new Set(key ? key.split("/") : []) };
  }
  return { dims: null };   // raw: contains every dim
}
const nodeIncludes = (id: string, dim: string): boolean => {
  const { dims } = dimsForNode(id);
  return dims === null ? true : dims.has(dim);
};
const nodeExcludes = (id: string, dim: string): boolean => {
  const { dims } = dimsForNode(id);
  return dims === null ? false : !dims.has(dim);
};

/* Place the raw guard verdicts onto the edges they belong to. Pure: returns a
   fresh edges array (and fresh edge objects where a verdict is appended). */
export function mergeGuards(edges: Edge[], guards: ShapeCountsGuards): Edge[] {
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

  return out;
}

export const explorerGraphAtom = atom<ExplorerGraph | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const h = get(hierarchyAtom);
  const plan = get(effectivePlanAtom);
  void get(effectiveTestGrainAtom);   // keep the test grain in the dep graph
  const g = buildGraph(p.reduce.steps, h.spine, plan, p.layers,
    get(effectiveSchemaAtom), get(statsInputAtom), p.reduce.post ?? []);
  const counts = get(shapeCountsAtom);
  const guards = get(guardsAtom);
  let nodes = g.nodes, edges = g.edges;
  if (counts) nodes = nodes.map((n) => (counts[n.id] ? { ...n, count: counts[n.id] } : n));
  if (guards) edges = mergeGuards(edges, guards);
  return { ...g, nodes, edges };
});
