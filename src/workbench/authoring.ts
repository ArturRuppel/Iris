import type { ExplorerNode } from "../explorer/graph";
import type { ReduceStepKind } from "../types";
import { REDUCE_KIND_LABEL, REDUCE_KIND_ORDER } from "../types";
import type { Target, CardKind } from "./cardRegistry";

/* What a node's `+` can produce. A `reduce` action splices a step (insertStepAtom);
   collapse/geom/test route to the existing terminal atoms. The gesture is uniform;
   the option set + mutation target depend on the source node's pipeline phase. */
export type AuthorAction =
  | { kind: "reduce"; step: ReduceStepKind }
  | { kind: "collapse" }
  | { kind: "geom"; pinNodeId?: string }
  | { kind: "test" };

export interface AuthorOption { label: string; action: AuthorAction }

/* the terminal options for a node. On an overlay-compatible UPSTREAM node
   (`node.pinSource`, spec 2.3) the Plot option becomes "Add to plot" and adds a
   layer pinned to that node — the raw-vs-filtered overlay. Everywhere else it
   opens the primary plot's editor, as before. Collapse/Stats are unchanged: they
   still edit the primary analysis (a test names one node — the output). */
function terminalOptions(node: ExplorerNode): AuthorOption[] {
  const geom: AuthorOption = node.pinSource
    ? { label: "Add to plot", action: { kind: "geom", pinNodeId: node.pinSource } }
    : { label: "Plot (geom)", action: { kind: "geom" } };
  return [
    { label: "Collapse", action: { kind: "collapse" } },
    geom,
    { label: "Stats (test)", action: { kind: "test" } },
  ];
}

type Phase = "reduce" | "grain" | "join-input" | "post" | "terminal";

/* a node's authoring phase, from the phase buildGraph stamped. The root source
   and a reduce step share the `reduce` menu (both splice into reduce.steps); a
   post-collapse step is out of scope (no `+` menu, lest a pick misroute into
   reduce.steps). */
export function phaseOf(node: ExplorerNode): Phase {
  return node.phase === "source" ? "reduce" : node.phase;
}

/* the options shown at a node's `+`. */
export function affordances(node: ExplorerNode): AuthorOption[] {
  switch (phaseOf(node)) {
    case "reduce":
      return [
        ...REDUCE_KIND_ORDER.map((step) => ({
          label: REDUCE_KIND_LABEL[step], action: { kind: "reduce", step } as AuthorAction,
        })),
        ...terminalOptions(node),
      ];
    case "grain":
      return terminalOptions(node);
    case "join-input":
    case "post":
    case "terminal":
      return [];
  }
}

/* a resolved `+`-pick: either a spec-mutating step insert, or opening a terminal
   editor card. Pure data so the dispatch is unit-tested without React Flow /
   Jotai; the canvas/handle just routes it to the matching atom. */
export type AuthorDispatch =
  | { atom: "insertStep"; arg: { afterIndex: number; kind: ReduceStepKind } }
  | { atom: "openCard"; arg: { target: Target; cardKind: CardKind } }
  | { atom: "addLayerAtNode"; arg: { nodeId: string } };

/* the terminal editor cards bind to the active analysis and ignore their target
   (see GeomCard/CollapseCard/TestCard), so each opens at a stable singleton id
   that matches the card a click on the real terminal edge would open. */
const TERMINAL_DISPATCH: Record<"collapse" | "geom" | "test", AuthorDispatch> = {
  collapse: { atom: "openCard", arg: { target: { kind: "edge", id: "e:collapse" }, cardKind: "collapse-editor" } },
  geom: { atom: "openCard", arg: { target: { kind: "edge", id: "g:plain" }, cardKind: "geom-editor" } },
  test: { atom: "openCard", arg: { target: { kind: "edge", id: "t:test" }, cardKind: "test-editor" } },
};

/* resolve a `+`-pick to the atom call it performs. A `reduce` action splices a
   blank step after the source node's reduce-step index (the root source is -1, so
   it inserts at 0); collapse/geom/test open the existing terminal editor where the
   real choice is made. */
export function authorDispatch(stepIndex: number, action: AuthorAction): AuthorDispatch {
  if (action.kind === "reduce") {
    return { atom: "insertStep", arg: { afterIndex: stepIndex, kind: action.step } };
  }
  // "Add to plot" on an upstream node pins a new layer to it (spec 2.3 Stage 1)
  // rather than opening the singleton primary-plot editor.
  if (action.kind === "geom" && action.pinNodeId) {
    return { atom: "addLayerAtNode", arg: { nodeId: action.pinNodeId } };
  }
  return TERMINAL_DISPATCH[action.kind];
}
