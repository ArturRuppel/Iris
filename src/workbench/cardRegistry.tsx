import type { ExplorerGraph, EdgeKind } from "../explorer/graph";
import { PlotCard } from "./cards/PlotCard";
import { StatsCard } from "./cards/StatsCard";
import { CollapseCard } from "./cards/CollapseCard";
import { GeomCard } from "./cards/GeomCard";
import { AnnotateCard } from "./cards/AnnotateCard";
import { OpEditorCard } from "./cards/OpEditorCard";
import { TableCard } from "./cards/TableCard";

/* One card kind per clickable thing (design §5). Node kinds map to the three
   display/table cards; edge kinds map to the five editor cards. */
export type CardKind =
  | "table" | "plot" | "stats"
  | "op-editor" | "collapse-editor" | "geom-editor"
  | "test-editor" | "annotate-editor";

/* A click target: a graph node or a graph edge, addressed by id. */
export interface Target { kind: "node" | "edge"; id: string; }

/* reduce-step edges all share the one op-editor; collapse/geom/test/annotate
   each have their own editor. */
const EDGE_CARD: Record<EdgeKind, CardKind> = {
  filter: "op-editor", drop: "op-editor", derive: "op-editor",
  recode: "op-editor", join: "op-editor", pivot: "op-editor",
  grid_complete: "op-editor",
  collapse: "collapse-editor", geom: "geom-editor",
  test: "test-editor", annotate: "annotate-editor",
};

/* Resolve which card a click opens. Pure; null if the id is not in the graph
   (stale selection after a structural change). */
export function targetToCardKind(graph: ExplorerGraph, target: Target): CardKind | null {
  if (target.kind === "node") {
    const node = graph.nodes.find((n) => n.id === target.id);
    if (!node) return null;
    return node.kind === "plot" ? "plot" : node.kind === "stats" ? "stats" : "table";
  }
  const edge = graph.edges.find((e) => e.id === target.id);
  return edge ? EDGE_CARD[edge.kind] : null;
}

/* Props every card body receives. Phase 4 bodies read the graph/atoms they need
   on their own; the shell only hands them the target. */
export interface CardBodyProps { target: Target; }

/* Phase 3 stub: each body just announces its kind. Phase 4 replaces these with
   the real panels (FigurePane, StatsPanel, GuidedTestPicker, …). */
const stub = (kind: CardKind) =>
  function StubBody({ target }: CardBodyProps) {
    return (
      <div className="txw-card-stub" data-testid="card-stub" data-card-kind={kind}>
        {kind} — {target.kind}:{target.id}
      </div>
    );
  };

export const CARD_BODIES: Record<CardKind, (p: CardBodyProps) => JSX.Element> = {
  "table": TableCard,
  "plot": PlotCard,
  "stats": StatsCard,
  "op-editor": OpEditorCard,
  "collapse-editor": CollapseCard,
  "geom-editor": GeomCard,
  "test-editor": stub("test-editor"),
  "annotate-editor": AnnotateCard,
};

/* Human title for a card's bar, by kind. */
export const CARD_TITLE: Record<CardKind, string> = {
  "table": "Table", "plot": "Plot", "stats": "Stats",
  "op-editor": "Edit step", "collapse-editor": "Collapse",
  "geom-editor": "Geom & encoding", "test-editor": "Test",
  "annotate-editor": "Annotate",
};
