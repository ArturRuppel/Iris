import { atom } from "jotai";
import {
  activePlottableAtom, hierarchyAtom, effectiveSchemaAtom, analysisAtom,
} from "../state";
import { buildGraph, type ExplorerGraph, type StatsInput, type NodeCount } from "./graph";

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

export const explorerGraphAtom = atom<ExplorerGraph | null>((get) => {
  const p = get(activePlottableAtom);
  if (!p) return null;
  const g = buildGraph(p.reduce.steps, get(hierarchyAtom), p.layers,
    get(effectiveSchemaAtom), get(statsInputAtom));
  const counts = get(shapeCountsAtom);
  if (!counts) return g;
  return {
    ...g,
    nodes: g.nodes.map((n) => (counts[n.id] ? { ...n, count: counts[n.id] } : n)),
  };
});
