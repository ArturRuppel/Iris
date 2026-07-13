import type { AxisDesc, CollapsePlan, GuardVerdict, Layer, ReduceDag, ReduceStep, Schema, ValueDesc } from "../types";
import { RAW_LEVEL } from "../types";
import { grainKey, planGrains } from "../collapse";
import { labelForCol } from "../levels";

/* Nodes are DATA (a table at some grain, or a terminal figure output); edges
   are TRANSFORMATIONS (filter/drop/collapse between tables, geom + test into the
   figure). The view is a left->right line for the MVP but is modelled as typed
   nodes + edges so branching plugs into the same frame. */
export type NodeKind = "table" | "figure";
/* a node's pipeline phase — the single discriminant consumers read instead of
   parsing the id string. `source` is the root table; `reduce` a reduce step;
   `join-input` a join's right (secondary) input; `grain` a collapsed grain;
   `post` a post-collapse step; `terminal` the figure output. */
export type NodePhase =
  | "source" | "reduce" | "join-input" | "grain" | "post" | "terminal";
export type EdgeKind =
  | "filter" | "drop" | "derive" | "recode" | "join"
  | "pivot" | "grid_complete"
  | "collapse" | "geom" | "test";

export type NodeTable =
  | { via: "at_step"; at_step: number }
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
  /* the pipeline phase, set once by buildGraph — read this, never the id prefix. */
  phase: NodePhase;
  /* the spine dims a `grain` node carries (its kept levels). Absent on non-grain
     nodes, which carry the full spine. */
  dims?: string[];
  /* a `grain` node that drops NO spine dim — the prefix chain's leading raw ->
     full-spine "regroup". A structural identity *candidate*: graphAtom prunes it
     once counts confirm its row count matches the source (a true no-op). It is
     KEPT when counts show it still merges rows — an explicit collapse over a
     spine coarser than the source rows aggregates without dropping a spine dim. */
  regroup?: boolean;
  /* the reduce-step index this node represents: the root source is -1, a reduce
     `step:i` is i. Absent on grain/post/join-input/terminal nodes. */
  stepIndex?: number;
  label: string;
  table: NodeTable;
  count?: NodeCount;
  /* a required input this node doesn't yet have (an unfilled join right): rendered
     as an open "missing" circle prompting a drag to fill it. */
  missing?: boolean;
  /* a join node accepts a second (right) input: the canvas renders a distinct
     right-input handle (slot 1) that a dragged wire fills, superseding the picker. */
  acceptsRightInput?: boolean;
  /* terminal (figure) sections: the plot's geom chips and the stats' test chip,
     kept distinct so the node renders two labeled sections. Set only on the
     terminal; absent elsewhere. */
  sections?: { kind: "plot" | "stats"; facts: string[]; caution?: boolean }[];
  /* the DAG node id a `+`→Plot on this node pins a new layer to (spec 2.3 Stage
     1). Present only on an UPSTREAM, overlay-compatible node (the raw source or a
     column-preserving step, never the output or a shape-changing op) — its
     presence is the compatibility gate. Absent -> `+`→Plot edits the primary
     plot, as before. */
  pinSource?: string;
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
  /* the full nesting (finest-grain axis order) every per-node grain bar is read
     against — the hierarchy spine buildGraph was given, recorded so consumers
     don't reverse-engineer it from async counts. */
  spine: string[];
}

export interface StatsInput { test: string | null; describeOnly: boolean; annotate?: boolean }

export const SOURCE_ID = "source";
export const FIGURE_ID = "figure";
const stepId = (i: number) => `step:${i}`;

/* the id of the edge feeding the reduce step at `index` (its `prev -> step:index`
   wire). Exported so authoring can open a freshly-spliced step's editor by id
   before the async graph rebuild lands — the id scheme lives here, not there. */
export function reduceStepInEdgeId(index: number): string {
  const prev = index <= 0 ? SOURCE_ID : stepId(index - 1);
  return `e:${prev}->${stepId(index)}`;
}

export function nodeIdForGrain(key: string, rawNodeId: string): string {
  return key === "" ? rawNodeId : `grain:${key}`;
}

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
  pivot: "pivoted", grid_complete: "counted",
};

/* reduce step kinds whose output still carries the plot's mapped columns on a
   compatible scale, so the node can be overlaid as a layer (spec 2.3 Stage 1's
   structural compatibility gate). Row-preserving/column-superset kinds only;
   shape-changing kinds (drop / pivot / grid_complete) are excluded — the finer
   "did THIS mapped column survive a drop" check is a deferred refinement. */
const OVERLAY_COMPATIBLE_KINDS = new Set(["filter", "derive", "recode", "join"]);

const condText = (c: { column: string; op: string; value?: unknown; bound?: string },
                  schema: Schema | null): string =>
  `${labelForCol(schema, c.column)} ${c.op} ${c.bound ?? String(c.value ?? "")}`.trim();

/* the edge's QUALIFIER line (the detail). The transformation type word lives on
   the edge's first line (WorkbenchEdge.EDGE_TYPE), so these deliberately omit the
   verb — "speed ≤ 98", not "filter speed ≤ 98". */
function stepEdgeLabel(step: ReduceStep, schema: Schema | null): string {
  switch (step.kind) {
    case "filter":
      return step.conditions.length === 1
        ? condText(step.conditions[0], schema)
        : `${step.conditions.length} conditions`;
    case "drop":
      return step.columns.map((c) => labelForCol(schema, c)).join(", ");
    case "derive":
      return `${step.column} = ${step.expr}`;
    case "recode":
      return labelForCol(schema, step.column);
    case "join":
      return `on ${step.on.join(", ")}`;
    case "pivot":
      return `${labelForCol(schema, step.column)} → {${step.names.map(([, to]) => to).join(", ")}}`;
    case "grid_complete":
      return `${step.by.map((c) => labelForCol(schema, c)).join(" × ")} × ` +
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
  dag: ReduceDag,
  spine: string[],
  plan: CollapsePlan,
  layers: Layer[],
  schema: Schema | null,
  stats: StatsInput | null,
): ExplorerGraph {
  const post: ReduceStep[] = dag.post ?? [];
  // Map every DAG node id -> its graph node id. The primary source is "source";
  // any further source is "source:<its id>". A step keeps the index-based id
  // `step:<i>` (i = its position in reduce.steps) so per-node shape-counts, keyed
  // by the same array index in App.tsx, still line up. Edges are drawn from each
  // node's `inputs`, so true adjacency (fan-out, a wired join right) renders even
  // though the ids are positional. Built in a first pass so an input may name a
  // node appearing later in the array (a branch need not be array-ordered).
  const graphId = new Map<string, string>();
  dag.sources.forEach((s, si) =>
    graphId.set(s.id, si === 0 ? SOURCE_ID : `source:${s.id}`));
  dag.steps.forEach((n, i) => graphId.set(n.id, stepId(i)));
  const mapId = (id: string): string => graphId.get(id) ?? SOURCE_ID;

  const nodes: ExplorerNode[] = dag.sources.map((s, si) => ({
    id: mapId(s.id), kind: "table", phase: "source",
    stepIndex: si === 0 ? -1 : undefined,
    label: si === 0 ? "Source" : s.tableId,
    // the primary source is always overlay-compatible (the raw table), unless it
    // IS the output (a no-step DAG — then it's the primary plot, not an overlay).
    ...(si === 0 && s.id !== dag.output ? { pinSource: s.id } : {}),
    table: { via: "at_step", at_step: -1 } }));
  const edges: Edge[] = [];

  dag.steps.forEach((step, i) => {
    const id = stepId(i);
    nodes.push({ id, kind: "table", phase: "reduce", stepIndex: i,
      label: STEP_NODE_LABEL[step.kind] ?? step.kind,
      table: { via: "at_step", at_step: i },
      // an upstream column-preserving step can be overlaid as a layer; the output
      // itself is the primary plot, so it never advertises a pin source.
      ...(step.id !== dag.output && OVERLAY_COMPATIBLE_KINDS.has(step.kind)
        ? { pinSource: step.id } : {}),
      ...(step.kind === "join" ? { acceptsRightInput: true } : {}) });
    if (step.kind === "join") {
      const onLabel = step.on.join(", ");
      const leftId = mapId(step.inputs[0]);
      edges.push({ id: `e:${leftId}->${id}`, kind: "join", label: `on ${onLabel}`,
        fromId: leftId, toId: id, onKeys: step.on });
      // Right input: a WIRED second input (inputs[1]) wins and points at a real
      // upstream node; otherwise the PICKER's rightTableId synthesizes a right
      // source, an unset id being the unfilled "missing input" open circle.
      if (step.inputs[1]) {
        const rightId = mapId(step.inputs[1]);
        edges.push({ id: `e:${rightId}->${id}`, kind: "join", label: `on ${onLabel}`,
          fromId: rightId, toId: id, onKeys: step.on });
      } else {
        const srcId = `source:${i}`;
        const filled = step.rightTableId.length > 0;
        nodes.push({ id: srcId, kind: "table", phase: "join-input",
          label: filled ? step.rightTableId : "drop a table here",
          table: { via: "none" }, missing: !filled });
        edges.push({ id: `e:${srcId}->${id}`, kind: "join", label: `on ${onLabel}`,
          fromId: srcId, toId: id, onKeys: step.on });
      }
    } else {
      step.inputs.forEach((inId) => {
        const fromId = mapId(inId);
        edges.push({ id: `e:${fromId}->${id}`, kind: step.kind,
          label: stepEdgeLabel(step, schema), fromId, toId: id });
      });
    }
  });
  const rawNodeId = mapId(dag.output);

  let cprev = rawNodeId;
  let prevKeep: string[] = spine;            // raw carries the full spine identity
  for (const step of plan) {
    const kept = step.keep.filter((d) => spine.includes(d));
    const key = grainKey(kept);
    const id = `grain:${key}`;
    const removed = prevKeep.filter((d) => !kept.includes(d));
    nodes.push({ id, kind: "table", phase: "grain", dims: kept, regroup: removed.length === 0,
      label: labelForGrain(schema, kept), table: { via: "grain", grain: key } });
    edges.push({ id: `e:${cprev}->${id}`, kind: "collapse",
      label: collapseEdgeLabel(schema, step.fn, removed, kept),
      fromId: cprev, toId: id, guards: [flattenInfo(schema, step.fn, removed, kept)] });
    cprev = id;
    prevKeep = kept;
  }

  // terminal facts: the plot's distinct geoms (first-seen order) and the stats'
  // test, kept as two sections on ONE figure node. A `stats` "on figure" marker
  // replaces the old Stats->Plot annotate back-edge when a real test is drawn
  // onto the figure. Derived here, where layers + stats are in hand.
  const geomFacts: string[] = [];
  for (const layer of layers) {
    const g = geomLabel(layer.geom);
    if (!geomFacts.includes(g)) geomFacts.push(g);
  }
  const testFact = stats?.describeOnly ? "describe"
    : (stats?.test ? testLabel(stats.test) : "describe");
  const annotated = !!(stats && !stats.describeOnly && stats.annotate);
  nodes.push({ id: FIGURE_ID, kind: "figure", phase: "terminal", label: "Figure",
    table: { via: "none" },
    sections: [
      { kind: "plot", facts: geomFacts },
      { kind: "stats", facts: [testFact, ...(annotated ? ["on figure"] : [])] },
    ] });

  // one edge per grain the plot reads, labelled with the geom(s) at that grain
  // (distinct, in first-seen order, comma-joined). A plot is composable over any
  // number of grains. § Topology / Settled decisions #3.
  const geomByNode = new Map<string, string[]>();
  for (const layer of layers) {
    // A layer pinned to a non-output DAG node (2.3 Stage 1) roots at that node
    // directly (its raw grain); an unpinned layer, or one pinned to the output,
    // roots at the output's collapse grain via `level` (the superplot path). A
    // pin to a node that no longer exists (deleted upstream) drops the edge —
    // honest orphaning, not a silent reroute to the source.
    const pinned = layer.nodeId;
    const fromId = pinned && pinned !== dag.output
      ? (graphId.has(pinned) ? mapId(pinned) : null)
      : levelGrainNode(layer.level, plan, rawNodeId);
    if (!fromId) continue;
    const label = geomLabel(layer.geom);
    const list = geomByNode.get(fromId) ?? [];
    if (!list.includes(label)) list.push(label);
    geomByNode.set(fromId, list);
  }
  for (const [fromId, labels] of geomByNode) {
    edges.push({ id: `g:${fromId}`, kind: "geom", label: labels.join(", "),
      fromId, toId: FIGURE_ID });
  }
  if (geomByNode.size === 0) {
    edges.push({ id: "g:plain", kind: "geom", label: "", fromId: rawNodeId, toId: FIGURE_ID });
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
    nodes.push({ id, kind: "table", phase: "post",
      label: STEP_NODE_LABEL[step.kind] ?? step.kind, table: { via: "none" } });
    const guards = step.kind === "derive"
      ? [postAggregateDerive(step.column, grainLabel)] : undefined;
    edges.push({ id: `e:${id}`, kind: step.kind, label: stepEdgeLabel(step, schema),
      fromId: testFromId, toId: id, guards });
    testFromId = id;
  });
  edges.push({ id: "t:test", kind: "test",
    label: testFact, fromId: testFromId, toId: FIGURE_ID });

  return { nodes, edges, spine };
}
