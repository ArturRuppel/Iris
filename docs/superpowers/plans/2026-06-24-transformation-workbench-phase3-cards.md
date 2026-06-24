# Transformation Workbench — Phase 3: FloatingCard + Card Registry + Session State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ephemeral-card infrastructure — session-only Jotai state for selection/cards/node-nudges, a pure target→card-kind registry, and a generic move/resize/collapse/close `FloatingCard` shell — without yet wrapping any real panel (Phase 4) or wiring it into the canvas/App (Phase 5).

**Architecture:** Three new files under `src/workbench/`. `state.ts` holds the new session-only atoms (`selectedTargetAtom`, `cardsAtom`, `nodePositionsAtom`) and their writer atoms (open/close/move/resize/collapse/clear). `cardRegistry.tsx` is a pure resolver (`targetToCardKind`) plus a `CardKind → body component` map whose Phase-3 bodies are labeled stubs (Phase 4 swaps each for the real panel). `FloatingCard.tsx` is the generic shell that reads a `Card` and renders a draggable title bar, a registry-chosen body, a corner resize handle, and collapse/close controls — driving everything through the writer atoms. Nothing here is rendered by the app yet; it is exercised only by its own tests.

**Tech Stack:** TypeScript, React 18.3, Jotai (atoms + writer atoms), Vitest 4 + @testing-library/react (jsdom). No engine, no `.iris`, no React Flow changes. All new state is session-only and never serialized (per spec §2.1, §8).

---

## Context for the implementer

You are extending **Iris**, a statistics/plotting tool. The "Workbench" is a left→right DAG of a data pipeline (already rendered by `src/workbench/WorkbenchCanvas.tsx` using React Flow). The graph model is `ExplorerGraph = { nodes: ExplorerNode[]; edges: Edge[] }` from `src/explorer/graph.ts`.

This phase builds the **card layer**: when a user later (Phase 5) clicks a node or edge, an ephemeral floating **card** opens — a throwaway view/editor. Phase 3 builds only the *plumbing*: the state, the target→card-kind mapping, and the generic card shell. The card *bodies* are stubs here; Phase 4 replaces them with the real panels (`FigurePane`, `StatsPanel`, `GuidedTestPicker`, etc.).

**Key types you will import** (from `src/explorer/graph.ts`, already exists):
```ts
export type NodeKind = "table" | "plot" | "stats";
export type EdgeKind = "filter" | "drop" | "derive" | "recode" | "join"
  | "pivot" | "grid_complete" | "collapse" | "geom" | "test" | "annotate";
export interface ExplorerNode { id: string; kind: NodeKind; label: string; /* … */ }
export interface Edge { id: string; kind: EdgeKind; label: string; fromId: string; toId: string; /* … */ }
export interface ExplorerGraph { nodes: ExplorerNode[]; edges: Edge[]; }
```

**Hard constraints (from the design spec):**
- Session-only. Do NOT touch `src/types.ts`, the engine, or anything serialized to `.iris`. These atoms live in `src/workbench/state.ts`, separate from `src/state.ts`.
- One card per distinct target (a node id or edge id). Re-opening the same target must not create a duplicate.
- Reuse existing Jotai idioms: `import { atom } from "jotai"`; writer atoms are `atom(null, (get, set, arg) => { … })`.
- Match the existing test idiom (see `src/workbench/WorkbenchCanvas.test.tsx`): `describe`/`it` from `vitest`, `render`/`screen`/`fireEvent` from `@testing-library/react`.
- For atom-only tests, create a fresh store per test: `import { createStore } from "jotai"; const store = createStore();` then `store.get(...)` / `store.set(...)`.

Run the full frontend suite with: `npm test -- --run` (expected baseline before you start: **176 passed**). Type-check with: `npx tsc --noEmit`.

---

## File Structure

- **Create** `src/workbench/state.ts` — `Target`, `Card`, `CardKind` (re-exported from registry), the three state atoms, and writer atoms.
- **Create** `src/workbench/cardRegistry.tsx` — `CardKind`, `targetToCardKind(graph, target)`, `CARD_BODIES` map, `CardBodyProps`, stub body components.
- **Create** `src/workbench/FloatingCard.tsx` — the generic shell.
- **Create** the three matching `*.test.ts(x)` files.
- **Modify** `src/index.css` — append card styles (appended block only; do not edit existing rules).

`CardKind` is defined in `cardRegistry.tsx` (it is the registry's domain) and re-exported from `state.ts` for convenience. `state.ts` imports `CardKind` from `cardRegistry.tsx`. The registry does **not** import from `state.ts` (one-way dependency: state → registry).

---

## Task 1: Card registry (pure resolver + stub bodies)

**Files:**
- Create: `src/workbench/cardRegistry.tsx`
- Test: `src/workbench/cardRegistry.test.tsx`

The registry answers two questions: (1) given a click target, which *kind* of card opens? (2) given a card kind, which React body renders it? Phase 3 bodies are stubs.

- [ ] **Step 1: Write the failing test**

Create `src/workbench/cardRegistry.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { targetToCardKind, CARD_BODIES, type CardKind } from "./cardRegistry";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "plot", kind: "plot", label: "Plot", table: { via: "none" } },
    { id: "stats", kind: "stats", label: "Stats", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "plot" },
    { id: "c0", kind: "collapse", label: "mean", fromId: "source", toId: "plot" },
    { id: "g0", kind: "geom", label: "dots", fromId: "source", toId: "plot" },
    { id: "t0", kind: "test", label: "MW", fromId: "source", toId: "stats" },
    { id: "a0", kind: "annotate", label: "significance", fromId: "stats", toId: "plot" },
  ],
};

describe("targetToCardKind", () => {
  it("maps data/plot/stats nodes to their card kinds", () => {
    expect(targetToCardKind(graph, { kind: "node", id: "source" })).toBe("table");
    expect(targetToCardKind(graph, { kind: "node", id: "plot" })).toBe("plot");
    expect(targetToCardKind(graph, { kind: "node", id: "stats" })).toBe("stats");
  });

  it("maps each edge kind to its editor card", () => {
    expect(targetToCardKind(graph, { kind: "edge", id: "e0" })).toBe("op-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "c0" })).toBe("collapse-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "g0" })).toBe("geom-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "t0" })).toBe("test-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "a0" })).toBe("annotate-editor");
  });

  it("returns null for an id that is not in the graph", () => {
    expect(targetToCardKind(graph, { kind: "node", id: "nope" })).toBeNull();
    expect(targetToCardKind(graph, { kind: "edge", id: "nope" })).toBeNull();
  });
});

describe("CARD_BODIES", () => {
  const kinds: CardKind[] = ["table", "op-editor", "collapse-editor",
    "geom-editor", "test-editor", "annotate-editor", "plot", "stats"];

  it("has a body component for every card kind", () => {
    for (const k of kinds) expect(CARD_BODIES[k]).toBeTypeOf("function");
  });

  it("renders a stub body that identifies its kind", () => {
    const Body = CARD_BODIES["test-editor"];
    render(<Body target={{ kind: "edge", id: "t0" }} />);
    expect(screen.getByTestId("card-stub").dataset.cardKind).toBe("test-editor");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/workbench/cardRegistry.test.tsx`
Expected: FAIL — `cardRegistry` module not found / `targetToCardKind` not a function.

- [ ] **Step 3: Write the implementation**

Create `src/workbench/cardRegistry.tsx`:

```tsx
import type { ExplorerGraph, EdgeKind } from "../explorer/graph";

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
  "table": stub("table"),
  "plot": stub("plot"),
  "stats": stub("stats"),
  "op-editor": stub("op-editor"),
  "collapse-editor": stub("collapse-editor"),
  "geom-editor": stub("geom-editor"),
  "test-editor": stub("test-editor"),
  "annotate-editor": stub("annotate-editor"),
};

/* Human title for a card's bar, by kind. */
export const CARD_TITLE: Record<CardKind, string> = {
  "table": "Table", "plot": "Plot", "stats": "Stats",
  "op-editor": "Edit step", "collapse-editor": "Collapse",
  "geom-editor": "Geom & encoding", "test-editor": "Test",
  "annotate-editor": "Annotate",
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/workbench/cardRegistry.test.tsx`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/workbench/cardRegistry.tsx src/workbench/cardRegistry.test.tsx
git commit -m "feat(workbench): card registry — target→card-kind resolver + stub bodies"
```

---

## Task 2: Session-only card/selection state atoms

**Files:**
- Create: `src/workbench/state.ts`
- Test: `src/workbench/state.test.ts`

This is the session-only state for the workbench: the selected target, the list of open cards, and per-node nudge positions. Plus the writer atoms that mutate them. One card per target; opening also selects.

- [ ] **Step 1: Write the failing test**

Create `src/workbench/state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  selectedTargetAtom, cardsAtom, nodePositionsAtom,
  openCardAtom, closeCardAtom, moveCardAtom, resizeCardAtom,
  toggleCardCollapsedAtom, collapseAllCardsAtom, clearWorkbenchAtom,
} from "./state";
import type { Target } from "./cardRegistry";

const tNode = (id: string): Target => ({ kind: "node", id });

describe("workbench state", () => {
  it("openCard adds a card and selects its target", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    expect(s.get(cardsAtom)).toHaveLength(1);
    expect(s.get(cardsAtom)[0].cardKind).toBe("table");
    expect(s.get(selectedTargetAtom)).toEqual(tNode("source"));
  });

  it("openCard is idempotent per target (no duplicate, re-selects)", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    s.set(openCardAtom, { target: tNode("plot"), cardKind: "plot" as const });
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    expect(s.get(cardsAtom)).toHaveLength(2);
    expect(s.get(selectedTargetAtom)).toEqual(tNode("source"));
  });

  it("closeCard removes the card by id", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    const id = s.get(cardsAtom)[0].id;
    s.set(closeCardAtom, id);
    expect(s.get(cardsAtom)).toHaveLength(0);
  });

  it("moveCard and resizeCard update geometry by id", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    const id = s.get(cardsAtom)[0].id;
    s.set(moveCardAtom, { id, x: 123, y: 45 });
    s.set(resizeCardAtom, { id, w: 500, h: 320 });
    const card = s.get(cardsAtom)[0];
    expect([card.x, card.y, card.w, card.h]).toEqual([123, 45, 500, 320]);
  });

  it("toggleCardCollapsed flips one card; collapseAll collapses every card", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(openCardAtom, { target: tNode("b"), cardKind: "table" as const });
    const idA = s.get(cardsAtom)[0].id;
    s.set(toggleCardCollapsedAtom, idA);
    expect(s.get(cardsAtom)[0].collapsed).toBe(true);
    expect(s.get(cardsAtom)[1].collapsed).toBe(false);
    s.set(collapseAllCardsAtom);
    expect(s.get(cardsAtom).every((c) => c.collapsed)).toBe(true);
  });

  it("clearWorkbench resets cards, selection, and node positions", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    s.set(nodePositionsAtom, { source: { x: 10, y: 20 } });
    s.set(clearWorkbenchAtom);
    expect(s.get(cardsAtom)).toHaveLength(0);
    expect(s.get(selectedTargetAtom)).toBeNull();
    expect(s.get(nodePositionsAtom)).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/workbench/state.test.ts`
Expected: FAIL — `./state` module not found.

- [ ] **Step 3: Write the implementation**

Create `src/workbench/state.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/workbench/state.test.ts`
Expected: PASS (all six tests).

- [ ] **Step 5: Commit**

```bash
git add src/workbench/state.ts src/workbench/state.test.ts
git commit -m "feat(workbench): session-only card + selection + node-nudge atoms"
```

---

## Task 3: Generic FloatingCard shell

**Files:**
- Create: `src/workbench/FloatingCard.tsx`
- Test: `src/workbench/FloatingCard.test.tsx`
- Modify: `src/index.css` (append a card-styles block)

The shell positions itself from its `Card`, renders a title bar (drag to move), a registry-chosen body, a corner resize handle, and collapse/close buttons — all driving the writer atoms. When collapsed it hides the body and resize handle (just the bar remains).

- [ ] **Step 1: Write the failing test**

Create `src/workbench/FloatingCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { FloatingCard } from "./FloatingCard";
import { cardsAtom, type Card } from "./state";

const makeCard = (over: Partial<Card> = {}): Card => ({
  id: "node:stats", target: { kind: "node", id: "stats" }, cardKind: "stats",
  x: 40, y: 50, w: 360, h: 260, collapsed: false, ...over,
});

function mount(card: Card) {
  const store = createStore();
  store.set(cardsAtom, [card]);
  const utils = render(
    <Provider store={store}>
      <FloatingCard card={card} />
    </Provider>,
  );
  return { store, ...utils };
}

describe("FloatingCard", () => {
  it("renders the card title and the registry body for its kind", () => {
    mount(makeCard());
    expect(screen.getByText(/stats/i)).toBeInTheDocument();
    expect(screen.getByTestId("card-stub").dataset.cardKind).toBe("stats");
  });

  it("positions itself from the card geometry", () => {
    mount(makeCard({ x: 120, y: 90, w: 300, h: 200 }));
    const el = screen.getByRole("dialog");
    expect(el.style.left).toBe("120px");
    expect(el.style.top).toBe("90px");
    expect(el.style.width).toBe("300px");
  });

  it("close button removes the card from the store", () => {
    const { store } = mount(makeCard());
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(store.get(cardsAtom)).toHaveLength(0);
  });

  it("collapse button toggles the body off (collapsed in store)", () => {
    const { store } = mount(makeCard());
    expect(screen.getByTestId("card-stub")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(store.get(cardsAtom)[0].collapsed).toBe(true);
  });

  it("dragging the title bar updates the card position", () => {
    const { store } = mount(makeCard({ x: 40, y: 50 }));
    const bar = screen.getByTestId("card-bar");
    fireEvent.pointerDown(bar, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 130, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 130, clientY: 120 });
    const card = store.get(cardsAtom)[0];
    expect(card.x).toBe(70); // 40 + (130-100)
    expect(card.y).toBe(70); // 50 + (120-100)
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/workbench/FloatingCard.test.tsx`
Expected: FAIL — `./FloatingCard` module not found.

- [ ] **Step 3: Write the implementation**

Create `src/workbench/FloatingCard.tsx`:

```tsx
import { useSetAtom } from "jotai";
import {
  closeCardAtom, moveCardAtom, resizeCardAtom, toggleCardCollapsedAtom,
  type Card,
} from "./state";
import { CARD_BODIES, CARD_TITLE } from "./cardRegistry";

/* A pointer drag. At pointer-down it captures the pointer origin AND a base
   value (read fresh from the closure, i.e. the latest render's card geometry),
   then reports base+delta on every move. Capturing in the handler — not React
   state — avoids the stale-closure trap where a same-event bubble handler would
   read pre-update state, which would make the *second* drag start from a stale
   origin. */
function startDrag(
  e: React.PointerEvent,
  base: { x: number; y: number },
  onMove: (x: number, y: number) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const ox = e.clientX;
  const oy = e.clientY;
  const move = (ev: PointerEvent) => onMove(base.x + (ev.clientX - ox), base.y + (ev.clientY - oy));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* Generic ephemeral card: title bar (drag to move), registry-chosen body,
   corner resize, collapse + close. All mutations route through the session-only
   card atoms — nothing here is serialized. */
export function FloatingCard({ card }: { card: Card }) {
  const move = useSetAtom(moveCardAtom);
  const resize = useSetAtom(resizeCardAtom);
  const close = useSetAtom(closeCardAtom);
  const toggle = useSetAtom(toggleCardCollapsedAtom);

  // each handler reads card.* fresh from this render's closure at pointer-down,
  // so repeated drags always start from the current geometry.
  const onBarDown = (e: React.PointerEvent) =>
    startDrag(e, { x: card.x, y: card.y },
      (x, y) => move({ id: card.id, x, y }));
  const onResizeDown = (e: React.PointerEvent) =>
    startDrag(e, { x: card.w, y: card.h },
      (w, h) => resize({ id: card.id, w: Math.max(220, w), h: Math.max(120, h) }));

  const Body = CARD_BODIES[card.cardKind];
  const title = CARD_TITLE[card.cardKind];

  return (
    <div
      className={`txw-card${card.collapsed ? " collapsed" : ""}`}
      role="dialog" aria-label={`${title} card`}
      style={{ left: card.x, top: card.y, width: card.w,
               height: card.collapsed ? undefined : card.h }}
    >
      <div className="txw-card-bar" data-testid="card-bar" onPointerDown={onBarDown}>
        <span className="txw-card-title">{title}</span>
        <button className="txw-card-btn" aria-label="Collapse card"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggle(card.id)}>
          {card.collapsed ? "▢" : "—"}
        </button>
        <button className="txw-card-btn" aria-label="Close card"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => close(card.id)}>
          ✕
        </button>
      </div>
      {!card.collapsed && (
        <>
          <div className="txw-card-body">
            <Body target={card.target} />
          </div>
          <div className="txw-card-resize" data-testid="card-resize"
               onPointerDown={onResizeDown} aria-hidden />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/workbench/FloatingCard.test.tsx`
Expected: PASS (all five tests). The drag test relies on `onPointerDownCapture` refreshing `base` before `onPointerDown` registers the window listeners, so the delta applies to the current `card.x/y`.

- [ ] **Step 5: Append the card styles**

Append this block to the end of `src/index.css` (do not modify existing rules):

```css
/* ---- workbench floating cards (Phase 3) ---- */
.txw-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.18);
  overflow: hidden;
  z-index: 5;
}
.txw-card-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  cursor: move;
  user-select: none;
}
.txw-card.collapsed .txw-card-bar { border-bottom: none; }
.txw-card-title { flex: 1; font-size: 12px; font-weight: 600; color: #334155; }
.txw-card-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 5px;
  color: #475569;
  border-radius: 4px;
}
.txw-card-btn:hover { background: #e2e8f0; }
.txw-card-body { flex: 1; overflow: auto; padding: 10px; }
.txw-card-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background:
    linear-gradient(135deg, transparent 50%, #94a3b8 50%, #94a3b8 60%, transparent 60%);
}
.txw-card-stub { font-size: 12px; color: #64748b; }
```

- [ ] **Step 6: Run the full suite + type-check**

Run: `npm test -- --run`
Expected: PASS — baseline 176 + the new Phase 3 tests (cardRegistry: 5, state: 6, FloatingCard: 5 ≈ **192 passed**).

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 7: Commit**

```bash
git add src/workbench/FloatingCard.tsx src/workbench/FloatingCard.test.tsx src/index.css
git commit -m "feat(workbench): generic FloatingCard shell (move/resize/collapse/close)"
```

---

## Done criteria

- `cardRegistry.tsx`: `targetToCardKind` maps all node + edge kinds correctly and returns null for unknown ids; `CARD_BODIES` covers every `CardKind`.
- `state.ts`: open (idempotent + selects), close, move, resize, toggle-collapse, collapse-all, clear-workbench all proven by store tests; everything session-only (no `src/state.ts` / `src/types.ts` / engine edits).
- `FloatingCard.tsx`: renders title + body, positions from geometry, close/collapse drive the store, drag moves the card.
- Full suite green (~192), `tsc --noEmit` clean.
- **Not in this phase:** real card bodies (Phase 4), canvas click→openCard wiring, rendering cards in the overlay, App.tsx cutover, `clearWorkbenchAtom` call on analysis switch (Phase 5). The stubs and unused-by-app atoms are expected.

## Roadmap (remaining after Phase 3)

- **Phase 4** — replace each stub body with the real panel: `TableCard` (DataTable + "Extend from here"), `OpEditorCard` (StepCards field editors), `CollapseCard` (CollapseRoutingPanel), `GeomCard` (EncodingsCard + LayerRail + geom picker), `TestCard` (GuidedTestPicker), `AnnotateCard` (new small editor + the `annotation` spec field), `PlotCard` (FigurePane + StylePane), `StatsCard` (StatsPanel result view).
- **Phase 5** — interaction wiring + App.tsx cutover: canvas node/edge click → `openCardAtom`; render `cardsAtom` as `FloatingCard`s over the canvas; node drag → `nodePositionsAtom`; tidy clears nudges; collapse-all button; rename `viewMode` `"analyses"`→`"workbench"`; delete `WorkspaceView.tsx`, `TransformWorkspace`, `workspaceOpenAtom`, the tx-strip; call `clearWorkbenchAtom` on analysis switch.
