import { atom } from "jotai";
import type { CardKind, Target } from "./cardRegistry";
import { FIGURE_ID } from "../explorer/graph";

export type { CardKind, Target } from "./cardRegistry";

/* An open card: its target, which body to render, and ephemeral geometry. The
   id is derived from the target so there is exactly one card per target. */
export interface Card {
  id: string;
  target: Target;
  cardKind: CardKind;
  x: number; y: number;
  w: number; h: number;
  collapsed: boolean;
}

/* card id format: "node:{id}" | "node:{id}:{facet}" | "edge:{id}" — the facet
   suffix gives the two figure facets distinct cards. */
const cardId = (t: Target): string => `${t.kind}:${t.id}${t.facet ? `:${t.facet}` : ""}`;

const DEFAULT_W = 360;
const DEFAULT_H = 260;
/* new cards cascade so a fresh one never lands exactly on the previous one. */
const CASCADE = 28;

/* ---- session-only state (never serialized; design §2.1, §8) ---- */

/* The selected node or edge (generalizes the old selectedNodeIdAtom to edges
   too). null = nothing selected. */
export const selectedTargetAtom = atom<Target | null>(null);

/* Every open floating card. Now used only for edge editors — node data cards
   (table/plot/stats) show in the display panel on the right instead of floating. */
export const cardsAtom = atom<Card[]>([]);

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

/* Open (or re-select) a card for a target. Idempotent per target: if one is
   already open it is not duplicated; either way the target becomes selected.
   The geom editor is not a card of its own: its encoding lives in the Plot card,
   so it shows the figure's plot in the display panel, scrolled to Encoding. */
export const openCardAtom = atom(
  null,
  (get, set, arg: { target: Target; cardKind: CardKind }) => {
    if (arg.cardKind === "geom-editor") {
      set(pushStashAtom, { target: { kind: "node", id: FIGURE_ID, facet: "plot" }, cardKind: "plot" });
      set(displayFocusAtom, { section: "encoding", n: (get(displayFocusAtom)?.n ?? 0) + 1 });
      return;
    }
    set(selectedTargetAtom, arg.target);
    const id = cardId(arg.target);
    const cards = get(cardsAtom);
    if (cards.some((c) => c.id === id)) return;
    const n = cards.length;
    set(cardsAtom, [
      ...cards,
      {
        id, target: arg.target, cardKind: arg.cardKind,
        x: 60 + n * CASCADE, y: 80 + n * CASCADE,
        w: DEFAULT_W, h: DEFAULT_H, collapsed: false,
      },
    ]);
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
    if (stash.some((e) => e.id === id)) return;
    const next = [...stash, { id, target: arg.target, cardKind: arg.cardKind }];
    const sliced = next.slice(-STASH_SLOTS);
    set(stashAtom, sliced);
    // if the FIFO evicted the focused tile, clear focus — a stale id left the
    // canvas swallowing the next Escape.
    const focused = get(focusedStashIdAtom);
    if (focused && !sliced.some((e) => e.id === focused)) set(focusedStashIdAtom, null);
  },
);

/* The landing view of an analysis: the figure's plot in the display panel.
   Called after clearWorkbench on every analysis switch. The figure id is a stable
   graph constant, so no graph lookup is needed. */
export const seedDefaultStashAtom = atom(null, (_get, set) => {
  const plot: Target = { kind: "node", id: FIGURE_ID, facet: "plot" };
  set(stashAtom, [{ id: cardId(plot), target: plot, cardKind: "plot" }]);
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

export const closeCardAtom = atom(null, (get, set, id: string) => {
  set(cardsAtom, get(cardsAtom).filter((c) => c.id !== id));
});

export const moveCardAtom = atom(
  null,
  (get, set, arg: { id: string; x: number; y: number }) => {
    set(cardsAtom, get(cardsAtom).map((c) =>
      c.id === arg.id ? { ...c, x: arg.x, y: arg.y } : c));
  },
);

export const resizeCardAtom = atom(
  null,
  (get, set, arg: { id: string; w: number; h: number }) => {
    set(cardsAtom, get(cardsAtom).map((c) =>
      c.id === arg.id ? { ...c, w: arg.w, h: arg.h } : c));
  },
);

export const toggleCardCollapsedAtom = atom(null, (get, set, id: string) => {
  set(cardsAtom, get(cardsAtom).map((c) =>
    c.id === id ? { ...c, collapsed: !c.collapsed } : c));
});

export const collapseAllCardsAtom = atom(null, (get, set) => {
  set(cardsAtom, get(cardsAtom).map((c) => ({ ...c, collapsed: true })));
});

/* Reset everything session-only — called when the active analysis changes so a
   stale card/selection/nudge from another analysis never sticks (design §3). */
export const clearWorkbenchAtom = atom(null, (_get, set) => {
  set(cardsAtom, []);
  set(stashAtom, []);
  set(selectedTargetAtom, null);
  set(nodePositionsAtom, {});
  set(focusedStashIdAtom, null);
});
