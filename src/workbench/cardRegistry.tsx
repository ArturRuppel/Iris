import type { ExplorerGraph, EdgeKind } from "../explorer/graph";
import { TestPicker } from "../components/StatsPanel";
import { CollapseRoutingPanel } from "../components/CollapseRoutingPanel";
import { LayerRail } from "../components/LayerRail";
import { OpEditorCard } from "./cards/OpEditorCard";
import { TableCard } from "./cards/TableCard";
import { PlotCard } from "./cards/PlotCard";
import { StatsCard } from "./cards/StatsCard";

/* One card kind per clickable thing (design §5). Node kinds map to the three
   display/table cards; edge kinds map to the five editor cards. */
export type CardKind =
  | "table" | "plot" | "stats"
  | "op-editor" | "collapse-editor" | "geom-editor"
  | "test-editor";

/* A click target: a graph node or edge, addressed by id. For the figure node a
   `facet` picks which half (plot vs stats) the click addresses. */
export interface Target { kind: "node" | "edge"; id: string; facet?: "plot" | "stats"; }

/* reduce-step edges all share the one op-editor; collapse/geom/test
   each have their own editor. */
export const EDGE_CARD: Record<EdgeKind, CardKind> = {
  filter: "op-editor", drop: "op-editor", derive: "op-editor",
  recode: "op-editor", join: "op-editor", pivot: "op-editor",
  grid_complete: "op-editor",
  collapse: "collapse-editor", geom: "geom-editor",
  test: "test-editor",
};

/* Resolve which card a click opens. Pure; null if the id is not in the graph
   (stale selection after a structural change). */
export function targetToCardKind(graph: ExplorerGraph, target: Target): CardKind | null {
  if (target.kind === "node") {
    const node = graph.nodes.find((n) => n.id === target.id);
    if (!node) return null;
    if (node.kind === "figure") return target.facet === "stats" ? "stats" : "plot";
    return "table";
  }
  const edge = graph.edges.find((e) => e.id === target.id);
  return edge ? EDGE_CARD[edge.kind] : null;
}

/* Props every card body receives. Card bodies read the graph/atoms they need on
   their own; the shell only hands them the target. */
export interface CardBodyProps { target: Target; }

/* Most editor/terminal cards are static: they ignore the target and render fixed
   panels (which bind to the active analysis themselves) inside a classed wrapper.
   Only TableCard / OpEditorCard read the target or atoms, so they
   stay as their own components. */
const staticBody = (className: string, testid: string, render: () => JSX.Element) =>
  function StaticCardBody(_props: CardBodyProps) {
    return <div className={className} data-testid={testid}>{render()}</div>;
  };

/* One entry per card kind: its bar title + body component. */
export interface CardSpec { title: string; body: (p: CardBodyProps) => JSX.Element; }
export const CARD: Record<CardKind, CardSpec> = {
  "table": { title: "Table", body: TableCard },
  "plot": { title: "Plot", body: PlotCard },
  "stats": { title: "Stats", body: StatsCard },
  "op-editor": { title: "Edit step", body: OpEditorCard },
  "collapse-editor": { title: "Collapse",
    body: staticBody("txw-card-collapse", "collapse-card", () => <CollapseRoutingPanel />) },
  "geom-editor": { title: "Geom & encoding",
    body: staticBody("txw-card-geom", "geom-card", () => <LayerRail />) },
  "test-editor": { title: "Test",
    body: staticBody("txw-card-test", "test-card", () => <TestPicker />) },
};
