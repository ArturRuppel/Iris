import { useAtomValue, useSetAtom } from "jotai";
import type { ExplorerGraph } from "../explorer/graph";
import { analysisTableAtom } from "../state";
import { stashAtom, focusedStashIdAtom } from "./state";
import { CARD } from "./cardRegistry";
import { nodeTableName } from "./nodeName";
import type { Target } from "./cardRegistry";

/* the header's subtitle: the table a node holds, or the step an edge is
   (its label, e.g. "z_um = z - nucleus_z"). An editor opened from the + menu
   has no graph edge yet, so it shows no subtitle. */
function cardLabel(graph: ExplorerGraph, target: Target, sourceName: string): string {
  if (target.kind === "node") {
    const node = graph.nodes.find((n) => n.id === target.id);
    return node ? nodeTableName(node, sourceName) : target.id;
  }
  const edge = graph.edges.find((e) => e.id === target.id);
  return edge ? (edge.label || edge.kind) : "";
}

/* The open card, over the canvas: full-screen below the topbar, or a sheet for
   a step's editor. Closed by Back / Done / Esc. Renders null when nothing is
   focused or the focused entry was unpinned. */
export function StashFocus({ graph }: { graph: ExplorerGraph }) {
  const focusedId = useAtomValue(focusedStashIdAtom);
  const setFocused = useSetAtom(focusedStashIdAtom);
  const stash = useAtomValue(stashAtom);
  const sourceName = useAtomValue(analysisTableAtom)?.name ?? "Table";
  const entry = stash.find((e) => e.id === focusedId);
  if (!entry) return null;
  const { body: Body, title } = CARD[entry.cardKind];
  const label = cardLabel(graph, entry.target, sourceName);
  // a step's editor is a few controls: it opens as a sheet over the canvas
  // instead of taking the whole workspace
  const sheet = entry.cardKind === "op-editor" || entry.cardKind === "collapse-editor";
  const view = (
    <div className={`txw-focus k-${entry.cardKind}${sheet ? " sheet" : ""}`} role="region"
         aria-label={`${title}: ${label} (maximized)`}>
      <div className="txw-focus-bar">
        <button className="txw-focus-exit" onClick={() => setFocused(null)}
                title={sheet ? "Close (Esc)" : "Back to the canvas (Esc)"} aria-label="Exit focus">
          {sheet ? "Done" : "‹ Back"}</button>
        <span className="txw-slot-title">{title}</span>
        <span className="txw-slot-sub" title={label}>{label}</span>
      </div>
      <div className="txw-focus-body"><Body target={entry.target} /></div>
    </div>
  );
  return sheet
    ? <><div className="txw-sheet-scrim" onClick={() => setFocused(null)} />{view}</>
    : view;
}
