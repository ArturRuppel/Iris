import type { Hierarchy, Layer, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";

/* Nodes are DATA (a table at some grain, or a terminal plot/stats output);
   edges are TRANSFORMATIONS (filter/drop/collapse between tables, geom into the
   plot, test into stats). The view is a left->right line for the MVP but is
   modelled as typed nodes + edges so branching plugs into the same frame. */
export type NodeKind = "table" | "plot" | "stats";
export type EdgeKind =
  | "filter" | "drop" | "derive" | "recode" | "join"
  | "collapse" | "geom" | "test";

export type NodeTable =
  | { via: "at_step"; at_step: number }
  | { via: "level"; level: string }
  | { via: "none" };

export interface NodeCount { rows: number; cols: number }

export interface ExplorerNode {
  id: string;
  kind: NodeKind;
  label: string;
  table: NodeTable;
  count?: NodeCount;
}

export interface Edge {
  id: string;
  kind: EdgeKind;
  label: string;
  fromId: string;
  toId: string;
}

export interface ExplorerGraph {
  nodes: ExplorerNode[];
  edges: Edge[];
}

export interface StatsInput { test: string | null; describeOnly: boolean }

const SOURCE_ID = "source";
const PLOT_ID = "plot";
const STATS_ID = "stats";
const stepId = (i: number) => `step:${i}`;
const levelId = (level: string) => `level:${level}`;

export function nodeIdForLevel(level: string, rawNodeId: string = SOURCE_ID): string {
  return level === RAW_LEVEL ? rawNodeId : levelId(level);
}

const labelForCol = (schema: Schema | null, name: string): string =>
  schema?.columns.find((c) => c.name === name)?.label ?? name;

const STEP_NODE_LABEL: Record<string, string> = {
  filter: "filtered", drop: "dropped", derive: "derived",
  recode: "recoded", join: "joined",
};

function stepEdgeLabel(step: ReduceStep): string {
  switch (step.kind) {
    case "filter": return `filter (${step.conditions.length})`;
    case "drop": return `drop (${step.columns.length})`;
    case "derive": return `derive ${step.column}`;
    case "recode": return `recode ${step.column}`;
    case "join": return `join (${step.how})`;
  }
}

const GEOM_LABEL: Record<string, string> = {
  dot: "dots", box: "box", violin: "violin", bar: "bars", line: "line",
  distribution: "distribution", summary: "mean ± SD", interval: "mean ± SD",
};
const geomLabel = (geom: string): string => GEOM_LABEL[geom] ?? geom;

/* engine test id -> readable edge label. Unknown ids fall back to a de-snaked
   form ("foo_bar" -> "foo bar") so a new test still reads sensibly. */
const TEST_LABEL: Record<string, string> = {
  welch_t: "Welch's t-test", paired_t: "paired t-test",
  one_sample_t: "one-sample t-test", mann_whitney: "Mann–Whitney",
  wilcoxon: "Wilcoxon", wilcoxon_signed: "Wilcoxon signed-rank",
  one_way_anova: "one-way ANOVA", kruskal: "Kruskal–Wallis",
  fisher_exact: "Fisher's exact", chi_square: "χ² test",
  likelihood_ratio: "likelihood-ratio", none: "describe", descriptive: "describe",
};
const testLabel = (test: string): string =>
  TEST_LABEL[test] ?? test.replace(/_/g, " ");

export function buildGraph(
  steps: ReduceStep[],
  hierarchy: Hierarchy,
  layers: Layer[],
  schema: Schema | null,
  stats: StatsInput | null,
): ExplorerGraph {
  const nodes: ExplorerNode[] = [
    { id: SOURCE_ID, kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
  ];
  const edges: Edge[] = [];

  let prev = SOURCE_ID;
  steps.forEach((step, i) => {
    const id = stepId(i);
    nodes.push({ id, kind: "table",
      label: STEP_NODE_LABEL[step.kind] ?? step.kind,
      table: { via: "at_step", at_step: i } });
    if (step.kind === "join") {
      // a second source feeds the join: draw it converging into this node
      const srcId = `source:${i}`;
      nodes.push({ id: srcId, kind: "table", label: "join source",
        table: { via: "none" } });
      edges.push({ id: `e:${prev}->${id}`, kind: "join", label: "join (inner)",
        fromId: prev, toId: id });
      edges.push({ id: `e:${srcId}->${id}`, kind: "join", label: "join (inner)",
        fromId: srcId, toId: id });
    } else {
      edges.push({ id: `e:${prev}->${id}`, kind: step.kind,
        label: stepEdgeLabel(step), fromId: prev, toId: id });
    }
    prev = id;
  });
  const rawNodeId = prev;

  const spine = hierarchy.spine;
  let cprev = rawNodeId;
  for (let i = spine.length - 1; i >= 0; i--) {
    const level = spine[i];
    const id = levelId(level);
    nodes.push({ id, kind: "table", label: `per ${labelForCol(schema, level)}`,
      table: { via: "level", level } });
    edges.push({ id: `e:${cprev}->${id}`, kind: "collapse", label: "collapse",
      fromId: cprev, toId: id });
    cprev = id;
  }

  nodes.push({ id: PLOT_ID, kind: "plot", label: "Plot", table: { via: "none" } });
  nodes.push({ id: STATS_ID, kind: "stats", label: "Stats", table: { via: "none" } });

  const spineSet = new Set(spine);
  const seenGeom = new Set<string>();
  for (const layer of layers) {
    const level = layer.level;
    if (level !== RAW_LEVEL && !spineSet.has(level)) continue;
    const fromId = nodeIdForLevel(level, rawNodeId);
    const label = geomLabel(layer.geom);
    const key = `${fromId}:${label}`;
    if (seenGeom.has(key)) continue;
    seenGeom.add(key);
    edges.push({ id: `g:${key}`, kind: "geom", label, fromId, toId: PLOT_ID });
  }
  if (seenGeom.size === 0) {
    edges.push({ id: "g:plain", kind: "geom", label: "plotted", fromId: rawNodeId, toId: PLOT_ID });
  }

  const boundIdx = layers
    .map((l) => spine.indexOf(l.level))
    .filter((i) => i >= 0);
  const testFromId = boundIdx.length ? levelId(spine[Math.min(...boundIdx)]) : rawNodeId;
  edges.push({ id: "t:test", kind: "test",
    label: stats?.describeOnly ? "describe" : (stats?.test ? testLabel(stats.test) : "describe"),
    fromId: testFromId, toId: STATS_ID });

  return { nodes, edges };
}
