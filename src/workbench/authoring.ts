import type { ExplorerNode } from "../explorer/graph";
import type { ReduceStepKind } from "../types";

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

type Phase = "reduce" | "grain" | "join-input" | "terminal";

/* a node's pipeline phase, from its id/kind (the conventions buildGraph emits):
   plot/stats are terminals; `grain:…` is a collapsed grain; `source:i` is a join's
   right input (an input, not a forward stage); `source` and `step:i` are the
   raw/reduce stage. */
export function phaseOf(node: ExplorerNode): Phase {
  if (node.kind === "plot" || node.kind === "stats") return "terminal";
  if (node.id.startsWith("grain:")) return "grain";
  if (node.id.startsWith("source:")) return "join-input";
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
