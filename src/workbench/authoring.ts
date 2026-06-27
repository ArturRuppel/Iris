import type { ExplorerNode } from "../explorer/graph";
import type { ReduceStepKind } from "../types";
import type { Target, CardKind } from "./cardRegistry";

/* What a node's `+` can produce. A `reduce` action splices a step (insertStepAtom);
   collapse/geom/test route to the existing terminal atoms. The gesture is uniform;
   the option set + mutation target depend on the source node's pipeline phase. */
export type AuthorAction =
  | { kind: "reduce"; step: ReduceStepKind }
  | { kind: "collapse" }
  | { kind: "geom" }
  | { kind: "test" };

export interface AuthorOption { label: string; action: AuthorAction }

/* the reduce vocabulary, in menu order (mirrors TableCard's KIND_LABEL order). */
const REDUCE_LABEL: Record<ReduceStepKind, string> = {
  filter: "Filter rows", drop: "Drop columns", derive: "Derive column",
  recode: "Recode column", join: "Join table", pivot: "Pivot column",
  grid_complete: "Complete grid",
};
const REDUCE_ORDER: ReduceStepKind[] =
  ["filter", "drop", "derive", "recode", "join", "pivot", "grid_complete"];

const TERMINAL_OPTIONS: AuthorOption[] = [
  { label: "Collapse", action: { kind: "collapse" } },
  { label: "Plot (geom)", action: { kind: "geom" } },
  { label: "Stats (test)", action: { kind: "test" } },
];

type Phase = "reduce" | "grain" | "join-input" | "post" | "terminal";

/* a node's pipeline phase, from its id/kind (the conventions buildGraph emits):
   plot/stats are terminals; `grain:…` is a collapsed grain; `source:i` is a join's
   right input (an input, not a forward stage); `post:i` is a post-collapse step
   (whose authoring is out of scope — no `+` menu, lest a pick misroute into
   `reduce.steps`); `source` and `step:i` are the raw/reduce stage. */
export function phaseOf(node: ExplorerNode): Phase {
  if (node.kind === "plot" || node.kind === "stats") return "terminal";
  if (node.id.startsWith("grain:")) return "grain";
  if (node.id.startsWith("source:")) return "join-input";
  if (node.id.startsWith("post:")) return "post";
  return "reduce";  // "source" (root) or "step:i"
}

/* the options shown at a node's `+`. */
export function affordances(node: ExplorerNode): AuthorOption[] {
  switch (phaseOf(node)) {
    case "reduce":
      return [
        ...REDUCE_ORDER.map((step) => ({
          label: REDUCE_LABEL[step], action: { kind: "reduce", step } as AuthorAction,
        })),
        ...TERMINAL_OPTIONS,
      ];
    case "grain":
      return TERMINAL_OPTIONS;
    case "join-input":
    case "post":
    case "terminal":
      return [];
  }
}

/* during a drag from a node's `+`, which targets light up. v1: the only binary op
   is `join`, so a drop is valid onto any *other* data table (terminals excluded by
   kind). The open-circle fill path is handled separately on the canvas. */
export function isValidDropTarget(sourceId: string, target: ExplorerNode): boolean {
  return target.kind === "table" && target.id !== sourceId;
}

/* the step index a node's `+` inserts AFTER: the root `source` is -1 (insert at 0),
   a `step:i` node is i. Only reduce-phase nodes (source / step:i) are ever asked. */
export function stepIndexOf(nodeId: string): number {
  if (nodeId === "source") return -1;
  const m = /^step:(\d+)$/.exec(nodeId);
  return m ? Number(m[1]) : -1;
}

/* a resolved `+`-pick: either a spec-mutating step insert, or opening a terminal
   editor card. Pure data so the dispatch is unit-tested without React Flow /
   Jotai; the canvas/handle just routes it to the matching atom. */
export type AuthorDispatch =
  | { atom: "insertStep"; arg: { afterIndex: number; kind: ReduceStepKind } }
  | { atom: "openCard"; arg: { target: Target; cardKind: CardKind } };

/* the terminal editor cards bind to the active analysis and ignore their target
   (see GeomCard/CollapseCard/TestCard), so each opens at a stable singleton id
   that matches the card a click on the real terminal edge would open. */
const TERMINAL_DISPATCH: Record<"collapse" | "geom" | "test", AuthorDispatch> = {
  collapse: { atom: "openCard", arg: { target: { kind: "edge", id: "e:collapse" }, cardKind: "collapse-editor" } },
  geom: { atom: "openCard", arg: { target: { kind: "edge", id: "g:plain" }, cardKind: "geom-editor" } },
  test: { atom: "openCard", arg: { target: { kind: "edge", id: "t:test" }, cardKind: "test-editor" } },
};

/* resolve a `+`-pick on `nodeId` to the atom call it performs. A `reduce` action
   splices a blank step after this node; collapse/geom/test open the existing
   terminal editor where the real choice is made. */
export function authorDispatch(nodeId: string, action: AuthorAction): AuthorDispatch {
  if (action.kind === "reduce") {
    return { atom: "insertStep", arg: { afterIndex: stepIndexOf(nodeId), kind: action.step } };
  }
  return TERMINAL_DISPATCH[action.kind];
}
