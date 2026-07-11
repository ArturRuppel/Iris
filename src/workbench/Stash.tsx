import { forwardRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ExplorerGraph } from "../explorer/graph";
import { analysisTableAtom } from "../state";
import {
  stashAtom, popStashAtom, selectedTargetAtom, focusedStashIdAtom,
  STASH_SLOTS, type StashEntry,
} from "./state";
import { gridCols } from "./WorkbenchResize";
import { CARD } from "./cardRegistry";
import { nodeTableName } from "./nodeName";

/* one pinned data card: a header (which node + unpin) over the registry body.
   Pointer-down anywhere selects its target so the canvas highlights the node. */
function StashCard({ entry, label, slot }: { entry: StashEntry; label: string; slot: number }) {
  const pop = useSetAtom(popStashAtom);
  const select = useSetAtom(selectedTargetAtom);
  const selected = useAtomValue(selectedTargetAtom);
  const focus = useSetAtom(focusedStashIdAtom);
  const { body: Body, title } = CARD[entry.cardKind];
  // compare facet too: the seeded plot and stats slots share id "figure", so
  // ignoring facet lit both when only one was selected.
  const isSel = selected?.kind === entry.target.kind
    && selected?.id === entry.target.id
    && selected?.facet === entry.target.facet;

  return (
    <div className={`txw-slot${isSel ? " sel" : ""}`} role="group" aria-label={`${title}: ${label}`}
         data-slot={slot} onPointerDown={() => select(entry.target)}>
      <div className="txw-slot-bar">
        <span className="txw-slot-num" aria-hidden>{slot}</span>
        <span className="txw-slot-title">{title}</span>
        <span className="txw-slot-sub" title={label}>{label}</span>
        <button className="txw-slot-max" aria-label="Maximize card"
                title="Maximize — fill the workspace"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => focus(entry.id)}>⤢</button>
        <button className="txw-slot-close" aria-label="Unpin card"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => pop(entry.id)}>✕</button>
      </div>
      <div className="txw-slot-body"><Body target={entry.target} /></div>
    </div>
  );
}

/* Focus mode: the maximized tile, filling the whole workbench below the topbar
   (over the DAG + stash). Reversible via Exit / Esc. Renders null when nothing is
   focused or the focused entry was unpinned. */
export function StashFocus({ graph }: { graph: ExplorerGraph }) {
  const focusedId = useAtomValue(focusedStashIdAtom);
  const setFocused = useSetAtom(focusedStashIdAtom);
  const stash = useAtomValue(stashAtom);
  const sourceName = useAtomValue(analysisTableAtom)?.name ?? "Table";
  const entry = stash.find((e) => e.id === focusedId);
  if (!entry) return null;
  const { body: Body, title } = CARD[entry.cardKind];
  const node = graph.nodes.find((n) => n.id === entry.target.id);
  const label = node ? nodeTableName(node, sourceName) : entry.target.id;
  return (
    <div className="txw-focus" role="region" aria-label={`${title}: ${label} (maximized)`}>
      <div className="txw-focus-bar">
        <span className="txw-slot-title">{title}</span>
        <span className="txw-slot-sub" title={label}>{label}</span>
        <button className="txw-focus-exit" onClick={() => setFocused(null)}
                title="Exit (Esc)" aria-label="Exit focus">⤢ Exit</button>
      </div>
      <div className="txw-focus-body"><Body target={entry.target} /></div>
    </div>
  );
}

/* The pop stash: a docked row of STASH_SLOTS at the canvas bottom. Clicking a
   table/plot/stat pins it here (newest on the right) instead of opening a
   floating popup; a 4th distinct card pushes the oldest out. Hidden when empty;
   once in use the remaining slots show as ghosts so the capacity is visible.
   `cols` are the resizable column weights (rendered as grid `fr` units). */
export const Stash = forwardRef<HTMLDivElement, {
  graph: ExplorerGraph;
  cols?: number[];
}>(function Stash({ graph, cols = Array(STASH_SLOTS).fill(1) }, ref) {
  const stash = useAtomValue(stashAtom);
  const sourceName = useAtomValue(analysisTableAtom)?.name ?? "Table";
  if (stash.length === 0) return null;

  const labelOf = (e: StashEntry) => {
    const node = graph.nodes.find((n) => n.id === e.target.id);
    return node ? nodeTableName(node, sourceName) : e.target.id;
  };
  const ghosts = Math.max(0, STASH_SLOTS - stash.length);

  return (
    <div className="txw-stash" role="region" aria-label="Pinned cards" ref={ref}
         style={{ gridTemplateColumns: gridCols(cols) }}>
      {stash.map((e, i) => <StashCard key={e.id} entry={e} label={labelOf(e)} slot={i + 1} />)}
      {Array.from({ length: ghosts }, (_, i) => (
        <div key={`ghost-${i}`} className="txw-slot ghost" aria-hidden />
      ))}
    </div>
  );
});
