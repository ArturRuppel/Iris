import { useAtomValue, useSetAtom } from "jotai";
import type { ExplorerGraph } from "../explorer/graph";
import {
  stashAtom, popStashAtom, selectedTargetAtom, STASH_SLOTS, type StashEntry,
} from "./state";
import { CARD_BODIES, CARD_TITLE } from "./cardRegistry";

/* one pinned data card: a header (which node + unpin) over the registry body.
   Pointer-down anywhere selects its target so the canvas highlights the node. */
function StashCard({ entry, label }: { entry: StashEntry; label: string }) {
  const pop = useSetAtom(popStashAtom);
  const select = useSetAtom(selectedTargetAtom);
  const selected = useAtomValue(selectedTargetAtom);
  const Body = CARD_BODIES[entry.cardKind];
  const title = CARD_TITLE[entry.cardKind];
  const isSel = selected?.kind === entry.target.kind && selected?.id === entry.target.id;

  return (
    <div className={`txw-slot${isSel ? " sel" : ""}`} role="group" aria-label={`${title}: ${label}`}
         onPointerDown={() => select(entry.target)}>
      <div className="txw-slot-bar">
        <span className="txw-slot-title">{title}</span>
        <span className="txw-slot-sub" title={label}>{label}</span>
        <button className="txw-slot-close" aria-label="Unpin card"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => pop(entry.id)}>✕</button>
      </div>
      <div className="txw-slot-body"><Body target={entry.target} /></div>
    </div>
  );
}

/* The pop stash: a docked row of STASH_SLOTS at the canvas bottom. Clicking a
   table/plot/stat pins it here (newest on the right) instead of opening a
   floating popup; a 4th distinct card pushes the oldest out. Hidden when empty;
   once in use the remaining slots show as ghosts so the capacity is visible. */
export function Stash({ graph }: { graph: ExplorerGraph }) {
  const stash = useAtomValue(stashAtom);
  if (stash.length === 0) return null;

  const labelOf = (e: StashEntry) =>
    graph.nodes.find((n) => n.id === e.target.id)?.label ?? e.target.id;
  const ghosts = Math.max(0, STASH_SLOTS - stash.length);

  return (
    <div className="txw-stash" role="region" aria-label="Pinned cards">
      {stash.map((e) => <StashCard key={e.id} entry={e} label={labelOf(e)} />)}
      {Array.from({ length: ghosts }, (_, i) => (
        <div key={`ghost-${i}`} className="txw-slot ghost" aria-hidden />
      ))}
    </div>
  );
}
