import type { Hierarchy, Layer, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";

/* The transformation graph is rendered as a line for the MVP (one source, nested
   design), but it is modelled as typed nodes + edges from day one so branching
   (joins, crossed factors) plugs into the same frame later. */
export type NodeKind = "source" | "filter" | "drop" | "flatten" | "outputs";

/* A node in the explorer line. `id` is stable across renders (used by the
   selection atom). `table` describes HOW the data tab fetches this node's table:
   - source/filter/drop → `/reduce` with `at_step` (source = -1, the k-th step = k)
   - flatten            → `/reduce` with `level` (the spine column it collapses to)
   - outputs            → no table (terminal; the figure/stats render it). */
export type NodeTable =
  | { via: "at_step"; at_step: number }
  | { via: "level"; level: string }
  | { via: "none" };

export interface ExplorerNode {
  id: string;
  kind: NodeKind;
  label: string;
  table: NodeTable;
}

/* A fan-in edge into the outputs node: one per distinct grain level the layers
   read. `level` is the spine column ("" = raw); `targetId` is always the outputs
   node. Drawn as an incoming arrow so the figure's provenance is explicit (a
   SuperPlot reads several levels → several arrows). */
export interface FanInEdge {
  fromId: string;   // the source/flatten node the level resolves to
  toId: string;     // the outputs node
  level: string;    // "" = raw reduced rows
}

export interface ExplorerGraph {
  nodes: ExplorerNode[];
  fanIn: FanInEdge[];
}

const SOURCE_ID = "source";
const OUTPUTS_ID = "outputs";
const stepId = (i: number) => `step:${i}`;
const flattenId = (level: string) => `flatten:${level}`;

/* The id of the node a layer's `level` reads from: a spine level is its flatten
   node; the raw reduced rows are the OUTPUT of the reduce chain, so callers pass
   `rawNodeId` (the last reduce-step node, or the source when there are no steps). */
export function nodeIdForLevel(level: string, rawNodeId: string = SOURCE_ID): string {
  return level === RAW_LEVEL ? rawNodeId : flattenId(level);
}

const labelForCol = (schema: Schema | null, name: string): string =>
  schema?.columns.find((c) => c.name === name)?.label ?? name;

/* Build the ordered node line + fan-in edges from the active analysis's shaping
   config. Pure: no side effects, no atom/React reads. */
export function buildGraph(
  steps: ReduceStep[],
  hierarchy: Hierarchy,
  layers: Layer[],
  schema: Schema | null,
): ExplorerGraph {
  const nodes: ExplorerNode[] = [
    { id: SOURCE_ID, kind: "source", label: "Source",
      table: { via: "at_step", at_step: -1 } },
  ];

  steps.forEach((step, i) => {
    if (step.kind === "filter") {
      const n = step.conditions.length;
      nodes.push({
        id: stepId(i), kind: "filter",
        label: n === 0 ? "Filter" : `Filter (${n})`,
        table: { via: "at_step", at_step: i },
      });
    } else {
      const n = step.columns.length;
      nodes.push({
        id: stepId(i), kind: "drop",
        label: n === 0 ? "Drop" : `Drop (${n})`,
        table: { via: "at_step", at_step: i },
      });
    }
  });

  // one flatten node per spine level (coarsest → finest, mirroring the spine order)
  hierarchy.spine.forEach((level) => {
    nodes.push({
      id: flattenId(level), kind: "flatten",
      label: `per ${labelForCol(schema, level)}`,
      table: { via: "level", level },
    });
  });

  nodes.push({ id: OUTPUTS_ID, kind: "outputs", label: "Figure / stats",
    table: { via: "none" } });

  // fan-in: one edge per DISTINCT level the layer stack reads. A plain plot reads
  // one level (one arrow); a SuperPlot reads several. Only keep levels that have a
  // node (raw always exists; a spine level only if it is on the spine).
  // raw reduced rows = the output of the reduce chain (the last step), or the
  // source table when there are no steps.
  const rawNodeId = steps.length ? stepId(steps.length - 1) : SOURCE_ID;
  const spineSet = new Set(hierarchy.spine);
  const seen = new Set<string>();
  const fanIn: FanInEdge[] = [];
  for (const layer of layers) {
    const level = layer.level;
    if (seen.has(level)) continue;
    if (level !== RAW_LEVEL && !spineSet.has(level)) continue;  // stale level: skip
    seen.add(level);
    fanIn.push({ fromId: nodeIdForLevel(level, rawNodeId), toId: OUTPUTS_ID, level });
  }
  // a layer-less analysis still shows the raw arrow so the figure never floats.
  if (fanIn.length === 0) {
    fanIn.push({ fromId: rawNodeId, toId: OUTPUTS_ID, level: RAW_LEVEL });
  }

  return { nodes, fanIn };
}
