import type { AxisDesc, CollapsePlan, GuardVerdict, Layer, ReduceStep, Schema, ValueDesc } from "../types";
import { RAW_LEVEL } from "../types";
import { grainKey, planGrains } from "../collapse";

/* Nodes are DATA (a table at some grain, or a terminal plot/stats output);
   edges are TRANSFORMATIONS (filter/drop/collapse between tables, geom into the
   plot, test into stats). The view is a left->right line for the MVP but is
   modelled as typed nodes + edges so branching plugs into the same frame. */
export type NodeKind = "table" | "plot" | "stats";
export type EdgeKind =
  | "filter" | "drop" | "derive" | "recode" | "join"
  | "pivot" | "grid_complete"
  | "collapse" | "geom" | "test" | "annotate";

export type NodeTable =
  | { via: "at_step"; at_step: number }
  | { via: "level"; level: string }
  | { via: "grain"; grain: string }
  | { via: "none" };

export interface NodeCount {
  rows: number;
  cols: number;
  axes?: AxisDesc[];
  values?: ValueDesc[];
}

export interface ExplorerNode {
  id: string;
  kind: NodeKind;
  label: string;
  table: NodeTable;
  count?: NodeCount;
  /* a required input this node doesn't yet have (an unfilled join right): rendered
     as an open "missing" circle prompting a drag to fill it. */
  missing?: boolean;
}

export interface Edge {
  id: string;
  kind: EdgeKind;
  label: string;
  fromId: string;
  toId: string;
  guards?: GuardVerdict[];
  onKeys?: string[];   // raw join-key column names (join edges only), for keyhi matching
}

export interface ExplorerGraph {
  nodes: ExplorerNode[];
  edges: Edge[];
}

export interface StatsInput { test: string | null; describeOnly: boolean; annotate?: boolean }

const SOURCE_ID = "source";
const PLOT_ID = "plot";
const STATS_ID = "stats";
const stepId = (i: number) => `step:${i}`;

export function nodeIdForGrain(key: string, rawNodeId: string): string {
  return key === "" ? rawNodeId : `grain:${key}`;
}

const labelForCol = (schema: Schema | null, name: string): string =>
  schema?.columns.find((c) => c.name === name)?.label ?? name;

const labelForGrain = (schema: Schema | null, kept: string[]): string =>
  kept.length === 1 ? `per ${labelForCol(schema, kept[0])}`
    : `per ${kept.map((d) => labelForCol(schema, d)).join(" × ")}`;

/* white #3: what this step pools, from the dims it removed. */
const flattenInfo = (schema: Schema | null, fn: string, removed: string[], kept: string[]): GuardVerdict => ({
  id: "flatten_info", severity: "info",
  text: `${fn} over ${removed.map((d) => labelForCol(schema, d)).join(", ") || "—"}; ` +
        (kept.length ? `grouped per ${kept.map((d) => labelForCol(schema, d)).join(" × ")}` : "one value overall"),
});

/* the collapse edge's primary label: the reduction in array language. A chain step
   that removes no dim (the raw -> full-spine identity) is a regroup, not a collapse. */
const collapseEdgeLabel = (schema: Schema | null, fn: string,
                           removed: string[], kept: string[]): string =>
  removed.length
    ? `${fn} over ${removed.map((d) => labelForCol(schema, d)).join(", ")}`
    : `group per ${kept.map((d) => labelForCol(schema, d)).join(" × ")}`;

/* the grain node a layer's `level` (a single spine dim, or RAW) maps to: the plan
   step whose finest kept dim is that level. null if no such node (skip the edge). */
function levelGrainNode(level: string, plan: CollapsePlan, rawNodeId: string): string | null {
  if (level === RAW_LEVEL) return rawNodeId;
  const step = plan.find((s) => s.keep[s.keep.length - 1] === level);
  return step ? `grain:${grainKey(step.keep)}` : null;
}

const STEP_NODE_LABEL: Record<string, string> = {
  filter: "filtered", drop: "dropped", derive: "derived",
  recode: "recoded", join: "joined",
  pivot: "pivoted", grid_complete: "gridded",
};

const condText = (c: { column: string; op: string; value?: unknown; bound?: string },
                  schema: Schema | null): string =>
  `${labelForCol(schema, c.column)} ${c.op} ${c.bound ?? String(c.value ?? "")}`.trim();

function stepEdgeLabel(step: ReduceStep, schema: Schema | null): string {
  switch (step.kind) {
    case "filter":
      return step.conditions.length === 1
        ? `mask: ${condText(step.conditions[0], schema)}`
        : `mask (${step.conditions.length} conditions)`;
    case "drop":
      return `drop ${step.columns.map((c) => labelForCol(schema, c)).join(", ")}`;
    case "derive":
      return `${step.column} = ${step.expr}`;
    case "recode":
      return `relabel ${labelForCol(schema, step.column)}`;
    case "join":
      return `join on ${step.on.join(", ")}`;
    case "pivot":
      return `unstack ${labelForCol(schema, step.column)} → {${Object.values(step.names).join(", ")}}`;
    case "grid_complete":
      return `densify ${step.by.map((c) => labelForCol(schema, c)).join(" × ")} × ` +
             `${labelForCol(schema, step.column)} · fill ${step.fill}`;
    default: {
      // exhaustiveness: a new ReduceStep kind becomes a compile error here,
      // not a silent `undefined` label (tsconfig has no noImplicitReturns).
      const _exhaustive: never = step;
      return _exhaustive;
    }
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

/* caution: a derive in the post-collapse phase runs on already-aggregated rows,
   so what it computes depends on the grain. Synthesized locally (like flattenInfo)
   — fully derivable from the spec, no data round-trip. */
const postAggregateDerive = (column: string, grainLabel: string): GuardVerdict => ({
  id: "post_aggregate_derive", severity: "caution",
  text: `${column} is derived after collapsing to ${grainLabel}; its inputs are ` +
        "already summarized, so the result's meaning depends on this grain.",
});

export function buildGraph(
  steps: ReduceStep[],
  spine: string[],
  plan: CollapsePlan,
  layers: Layer[],
  schema: Schema | null,
  stats: StatsInput | null,
  post: ReduceStep[] = [],
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
      // a second source feeds the join: draw it converging into this node. An
      // unset rightTableId is the unfilled "missing input" state — an open circle
      // labelled to invite a drop, not the referenced table name.
      const srcId = `source:${i}`;
      const filled = step.rightTableId.length > 0;
      const onLabel = step.on.join(", ");
      nodes.push({ id: srcId, kind: "table",
        label: filled ? step.rightTableId : "drop a table here",
        table: { via: "none" }, missing: !filled });
      edges.push({ id: `e:${prev}->${id}`, kind: "join", label: `join on ${onLabel}`,
        fromId: prev, toId: id, onKeys: step.on });
      edges.push({ id: `e:${srcId}->${id}`, kind: "join", label: `join on ${onLabel}`,
        fromId: srcId, toId: id, onKeys: step.on });
    } else {
      edges.push({ id: `e:${prev}->${id}`, kind: step.kind,
        label: stepEdgeLabel(step, schema), fromId: prev, toId: id });
    }
    prev = id;
  });
  const rawNodeId = prev;

  let cprev = rawNodeId;
  let prevKeep: string[] = spine;            // raw carries the full spine identity
  for (const step of plan) {
    const kept = step.keep.filter((d) => spine.includes(d));
    const key = grainKey(kept);
    const id = `grain:${key}`;
    const removed = prevKeep.filter((d) => !kept.includes(d));
    nodes.push({ id, kind: "table", label: labelForGrain(schema, kept),
      table: { via: "grain", grain: key } });
    edges.push({ id: `e:${cprev}->${id}`, kind: "collapse",
      label: collapseEdgeLabel(schema, step.fn, removed, kept),
      fromId: cprev, toId: id, guards: [flattenInfo(schema, step.fn, removed, kept)] });
    cprev = id;
    prevKeep = kept;
  }

  nodes.push({ id: PLOT_ID, kind: "plot", label: "Plot", table: { via: "none" } });
  nodes.push({ id: STATS_ID, kind: "stats", label: "Stats", table: { via: "none" } });

  // one edge per grain the plot reads, labelled with the geom(s) at that grain
  // (distinct, in first-seen order, comma-joined). A plot is composable over any
  // number of grains. § Topology / Settled decisions #3.
  const geomByNode = new Map<string, string[]>();
  for (const layer of layers) {
    const fromId = levelGrainNode(layer.level, plan, rawNodeId);
    if (!fromId) continue;
    const label = geomLabel(layer.geom);
    const list = geomByNode.get(fromId) ?? [];
    if (!list.includes(label)) list.push(label);
    geomByNode.set(fromId, list);
  }
  for (const [fromId, labels] of geomByNode) {
    edges.push({ id: `g:${fromId}`, kind: "geom", label: labels.join(", "),
      fromId, toId: PLOT_ID });
  }
  if (geomByNode.size === 0) {
    edges.push({ id: "g:plain", kind: "geom", label: "plotted", fromId: rawNodeId, toId: PLOT_ID });
  }

  const grainsList = planGrains(plan);            // ["", ...keys]
  const coarsest = grainsList[grainsList.length - 1] ?? "";
  // post-collapse reduce phase: steps run on the chosen test grain, drawn as a
  // chain after the collapse chain; the test then reads the post-phase output. A
  // post `derive` carries the post-aggregate caution badge.
  let testFromId = nodeIdForGrain(coarsest, rawNodeId);
  const grainLabel = coarsest
    ? labelForGrain(schema, coarsest.split("/")) : "the raw grain";
  post.forEach((step, i) => {
    const id = `post:${i}`;
    nodes.push({ id, kind: "table",
      label: STEP_NODE_LABEL[step.kind] ?? step.kind, table: { via: "none" } });
    const guards = step.kind === "derive"
      ? [postAggregateDerive(step.column, grainLabel)] : undefined;
    edges.push({ id: `e:${id}`, kind: step.kind, label: stepEdgeLabel(step, schema),
      fromId: testFromId, toId: id, guards });
    testFromId = id;
  });
  edges.push({ id: "t:test", kind: "test",
    label: stats?.describeOnly ? "describe" : (stats?.test ? testLabel(stats.test) : "describe"),
    fromId: testFromId, toId: STATS_ID });

  // the stats result drawn back onto the figure as significance brackets: an edge
  // because it CONSUMES the stats node's output (test -> comparisons -> brackets).
  // Emitted only when a real test runs (not describe-only) and the analysis has
  // significance annotation enabled. The plot node thereby gains a second input.
  if (stats && !stats.describeOnly && stats.annotate) {
    edges.push({ id: "a:annotate", kind: "annotate", label: "significance",
      fromId: STATS_ID, toId: PLOT_ID });
  }

  return { nodes, edges };
}
