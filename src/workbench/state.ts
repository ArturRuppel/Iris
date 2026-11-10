import { atom } from "jotai";
import type { CardKind, Target } from "./cardRegistry";
import { FIGURE_ID } from "../explorer/graph";
import { activePlottableAtom } from "../state";
import { lanesEnabledAtom } from "./lanesFlag";

export type { CardKind, Target } from "./cardRegistry";

/* card id format: "node:{id}" | "node:{id}:{facet}" | "edge:{id}" — the facet
   suffix gives the two figure facets distinct cards. */
const cardId = (t: Target): string => `${t.kind}:${t.id}${t.facet ? `:${t.facet}` : ""}`;


/* ---- session-only state (never serialized; design §2.1, §8) ---- */

/* The selected node or edge (generalizes the old selectedNodeIdAtom to edges
   too). null = nothing selected. */
export const selectedTargetAtom = atom<Target | null>(null);

/* ---- the display panel: the one node data card being shown ---- */

/* The shown data card. No geometry — the panel lays it out itself. */
export interface StashEntry {
  id: string;
  target: Target;
  cardKind: CardKind;
}

/* the panel shows one card; showing another replaces it. */
export const STASH_SLOTS = 1;

/* The shown card, capped at STASH_SLOTS. */
export const stashAtom = atom<StashEntry[]>([]);

/* Per-node position overrides for nudged nodes on the canvas; cleared by tidy
   and on analysis switch. Keyed by node id. */
export const nodePositionsAtom = atom<Record<string, { x: number; y: number }>>({});

/* The display panel's collapsed state: session-only, like the panel's content.
   Showing a card opens it, so a click on a node is never silently lost. */
export const displayCollapsedAtom = atom(false);

/* Which section of the shown card an editor click asked for: the geom edge asks
   the Plot card for its encoding section, the test edge the Stats card for its
   test picker. `n` bumps on every request so a repeat click scrolls again. */
export const displayFocusAtom = atom<{ section: "encoding" | "test"; n: number } | null>(null);

/* ---- writer atoms ---- */

/* Show the card for a clicked node or edge in the display panel. Nothing floats
   over the canvas: a step's editor (op, collapse) is the panel's card like a
   table is. The geom editor is the Plot card, scrolled to its Encoding section,
   and the test editor is the Stats card, scrolled to its test picker. */
export const openCardAtom = atom(
  null,
  (get, set, arg: { target: Target; cardKind: CardKind }) => {
    const bump = (section: "encoding" | "test") =>
      set(displayFocusAtom, { section, n: (get(displayFocusAtom)?.n ?? 0) + 1 });
    if (arg.cardKind === "geom-editor") {
      set(pushStashAtom, { target: { kind: "node", id: FIGURE_ID, facet: "plot" }, cardKind: "plot" });
      bump("encoding");
      return;
    }
    if (arg.cardKind === "test-editor") {
      // asking for the test on a no-statistics analysis is "Add statistics"
      if (get(activePlottableAtom)?.statsOff) set(setStatsOffAtom, false);
      set(pushStashAtom, { target: { kind: "node", id: FIGURE_ID, facet: "stats" }, cardKind: "stats" });
      bump("test");
      return;
    }
    set(pushStashAtom, arg);
  },
);

/* Pin a node's data card into the stash ring. Idempotent per target: re-pinning
   one already stashed just re-selects it (no duplicate, no reorder). A new card
   appends; once past STASH_SLOTS the oldest drops off the front. */
export const pushStashAtom = atom(
  null,
  (get, set, arg: { target: Target; cardKind: CardKind }) => {
    set(selectedTargetAtom, arg.target);
    set(displayCollapsedAtom, false);
    const id = cardId(arg.target);
    const stash = get(stashAtom);
    // the lanes experiment has no docked panel: a card opens full-screen
    const lanes = get(lanesEnabledAtom);
    if (stash.some((e) => e.id === id)) { if (lanes) set(focusedStashIdAtom, id); return; }
    const next = [...stash, { id, target: arg.target, cardKind: arg.cardKind }];
    const sliced = next.slice(-STASH_SLOTS);
    set(stashAtom, sliced);
    // if the FIFO evicted the focused tile, clear focus — a stale id left the
    // canvas swallowing the next Escape.
    const focused = get(focusedStashIdAtom);
    if (focused && !sliced.some((e) => e.id === focused)) set(focusedStashIdAtom, null);
    if (lanes) set(focusedStashIdAtom, id);
  },
);

/* The landing view of an analysis: the figure's plot in the display panel.
   Called after clearWorkbench on every analysis switch. The figure id is a stable
   graph constant, so no graph lookup is needed. */
const DEFAULT_PLOT: Target = { kind: "node", id: FIGURE_ID, facet: "plot" };
export const seedDefaultStashAtom = atom(null, (_get, set) => {
  set(stashAtom, [{ id: cardId(DEFAULT_PLOT), target: DEFAULT_PLOT, cardKind: "plot" }]);
});

/* Focus mode: a pinned tile maximized to fill the whole workbench, hiding the
   DAG — for styling a plot, where you want the entire workspace (the docked stash
   is clamped to leave the canvas room; this bypasses that). Holds the focused
   stash entry id, or null. Reversible (Exit / Esc). */
export const focusedStashIdAtom = atom<string | null>(null);

/* Unpin one card from the stash by id. Clears focus if it was the focused tile. */
export const popStashAtom = atom(null, (get, set, id: string) => {
  set(stashAtom, get(stashAtom).filter((e) => e.id !== id));
  if (get(focusedStashIdAtom) === id) set(focusedStashIdAtom, null);
});

/* Reset everything session-only — called when the active analysis changes so a
   stale card/selection/nudge from another analysis never sticks (design §3). */
export const clearWorkbenchAtom = atom(null, (get, set) => {
  set(stashAtom, []);
  set(selectedTargetAtom, null);
  set(nodePositionsAtom, {});
  /* the maximized plot stays maximized across an analysis switch: its card id
     is the same for every analysis and seedDefaultStash recreates it, so the
     focus carries over and the next plot opens full-size too */
  const focused = get(focusedStashIdAtom);
  set(focusedStashIdAtom, focused === cardId(DEFAULT_PLOT) ? focused : null);
});

/* Turn statistics off (the "No statistics" choice) or back on for the active
   analysis. Off: the plot is all there is, so a Stats card on show gives way to
   the figure's plot card — nothing stats-shaped is left on screen. On: the Stats
   card opens at its test picker so the user lands where the choice is made. */
export const setStatsOffAtom = atom(null, (get, set, off: boolean) => {
  const p = get(activePlottableAtom);
  if (!p) return;
  if (!!p.statsOff !== off) {
    const { statsOff: _drop, ...rest } = p;
    void _drop;
    // a reference line that is the tested constant (the location test defaults
    // style.reference_value to it, and a save keeps it) goes with the test; a
    // line the user set to some other value stays as style
    const style = off && p.reference != null && p.style.reference_value === p.reference
      ? (({ reference_value: _r, ...st }) => (void _r, st))(p.style) : p.style;
    set(activePlottableAtom, off ? { ...rest, style, statsOff: true } : rest);
  }
  if (off) {
    const stash = get(stashAtom);
    if (stash.some((e) => e.cardKind === "stats" || e.cardKind === "test-editor")) {
      const kept = stash.filter((e) => e.cardKind !== "stats" && e.cardKind !== "test-editor");
      const plotId = cardId(DEFAULT_PLOT);
      set(stashAtom, kept.some((e) => e.id === plotId) ? kept
        : [...kept, { id: plotId, target: DEFAULT_PLOT, cardKind: "plot" as const }].slice(-STASH_SLOTS));
      const focused = get(focusedStashIdAtom);
      if (focused && !get(stashAtom).some((e) => e.id === focused)) set(focusedStashIdAtom, null);
    }
    const sel = get(selectedTargetAtom);
    if (sel && (sel.facet === "stats" || sel.id === "t:test")) set(selectedTargetAtom, null);
  } else {
    set(pushStashAtom, { target: { kind: "node", id: FIGURE_ID, facet: "stats" }, cardKind: "stats" });
    set(displayFocusAtom, { section: "test", n: (get(displayFocusAtom)?.n ?? 0) + 1 });
  }
});
