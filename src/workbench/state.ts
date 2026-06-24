import { atom } from "jotai";
import type { CardKind, Target } from "./cardRegistry";

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

const cardId = (t: Target): string => `${t.kind}:${t.id}`;

const DEFAULT_W = 360;
const DEFAULT_H = 260;
/* new cards cascade so a fresh one never lands exactly on the previous one. */
const CASCADE = 28;

/* ---- session-only state (never serialized; design §2.1, §8) ---- */

/* The selected node or edge (generalizes the old selectedNodeIdAtom to edges
   too). null = nothing selected. */
export const selectedTargetAtom = atom<Target | null>(null);

/* Every open floating card. */
export const cardsAtom = atom<Card[]>([]);

/* Per-node position overrides for nudged nodes on the canvas; cleared by tidy
   and on analysis switch. Keyed by node id. */
export const nodePositionsAtom = atom<Record<string, { x: number; y: number }>>({});

/* ---- writer atoms ---- */

/* Open (or re-select) a card for a target. Idempotent per target: if one is
   already open it is not duplicated; either way the target becomes selected. */
export const openCardAtom = atom(
  null,
  (get, set, arg: { target: Target; cardKind: CardKind }) => {
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
  set(selectedTargetAtom, null);
  set(nodePositionsAtom, {});
});
