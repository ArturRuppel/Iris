import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { lanesEnabledAtom } from "./lanesFlag";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { ExplorerGraph } from "../explorer/graph";
import { analysisTableAtom } from "../state";
import {
  stashAtom, selectedTargetAtom, focusedStashIdAtom, displayCollapsedAtom,
  type StashEntry,
} from "./state";
import { CARD } from "./cardRegistry";
import { nodeTableName } from "./nodeName";
import type { Target } from "./cardRegistry";

/* the slot bar's subtitle: the table a node holds, or the step an edge is
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

/* the shown data card: a header (which node) over the registry body.
   Pointer-down anywhere selects its target so the canvas highlights the node. */
function StashCard({ entry, label }: { entry: StashEntry; label: string }) {
  const setCollapsed = useSetAtom(displayCollapsedAtom);
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
         onPointerDown={() => select(entry.target)}>
      <div className="txw-slot-bar">
        <span className="txw-slot-title">{title}</span>
        <span className="txw-slot-sub" title={label}>{label}</span>
        <button className="txw-slot-max" aria-label="Maximize card"
                title="Maximize — fill the workspace"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => focus(entry.id)}>⤢</button>
        <button className="txw-slot-close" aria-label="Hide display"
                title="Hide display"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setCollapsed(true)}>⟩</button>
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
  const lanes = useAtomValue(lanesEnabledAtom);
  const entry = stash.find((e) => e.id === focusedId);
  if (!entry) return null;
  const { body: Body, title } = CARD[entry.cardKind];
  const label = cardLabel(graph, entry.target, sourceName);
  // a step's editor is a few controls: with lanes (no docked panel) it opens as
  // a sheet over the canvas instead of taking the whole workspace
  const sheet = lanes && (entry.cardKind === "op-editor" || entry.cardKind === "collapse-editor");
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

const WIDTH_KEY = "iris-display-width";
const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 560;
function initialWidth() {
  try { return Math.max(MIN_WIDTH, Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH); }
  catch { return DEFAULT_WIDTH; }
}

/* The display panel: a collapsible, resizable column on the right of the canvas
   showing the one card last clicked on the graph, node or edge. The DAG keeps the remaining
   width through --display-w, which this sets on its parent overlay. */
export function Stash({ graph }: { graph: ExplorerGraph }) {
  const stash = useAtomValue(stashAtom);
  const sourceName = useAtomValue(analysisTableAtom)?.name ?? "Table";
  const [collapsed, setCollapsed] = useAtom(displayCollapsedAtom);
  const [width, setWidth] = useState(initialWidth);
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    panel.current?.parentElement?.style.setProperty("--display-w", `${width}px`);
  }, [width, collapsed]);

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const parentW = panel.current?.parentElement?.clientWidth ?? window.innerWidth;
    const clamp = (w: number) => Math.min(Math.max(MIN_WIDTH, w), Math.max(MIN_WIDTH, parentW - 200));
    const startX = e.clientX, startW = panel.current?.offsetWidth ?? width;
    let last = startW;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => { last = clamp(startW + startX - ev.clientX); setWidth(last); };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove as EventListener);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      try { localStorage.setItem(WIDTH_KEY, String(last)); } catch { /* private mode */ }
    };
    handle.addEventListener("pointermove", onMove as EventListener);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  if (collapsed) {
    return (
      <aside className="txw-stash collapsed" aria-label="Display">
        <button className="rail-expand" title="Show display"
                onClick={() => setCollapsed(false)}>⋮ Display</button>
      </aside>
    );
  }

  const entry = stash[stash.length - 1];
  const label = entry ? cardLabel(graph, entry.target, sourceName) : "";
  return (
    <aside className="txw-stash" aria-label="Display" ref={panel}>
      <div className="txw-display-resize" onPointerDown={startResize} title="Drag to resize" />
      {entry
        ? <StashCard key={entry.id} entry={entry} label={label} />
        : (
          <div className="txw-display-empty">
            <button className="txw-slot-close" aria-label="Hide display" title="Hide display"
                    onClick={() => setCollapsed(true)}>⟩</button>
            <span>Click a table, the plot or the stats to show them here.</span>
          </div>
        )}
    </aside>
  );
}
