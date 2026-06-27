import type { EdgeKind } from "../explorer/graph";

/* The transformation TYPE shown as a node's eyebrow (the step that produced it).
   Shared by the node (eyebrow) and anywhere else that names an edge kind. */
export const EDGE_TYPE: Record<EdgeKind, string> = {
  filter: "Filter", drop: "Drop", derive: "Derive", recode: "Recode",
  join: "Join", pivot: "Pivot", grid_complete: "Complete",
  collapse: "Collapse", geom: "Plot", test: "Test", annotate: "Annotate",
};
