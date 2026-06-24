import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { FloatingCard } from "./FloatingCard";
import { cardsAtom, type Card } from "./state";

// the shell tests use a STILL-STUBBED kind (`table`) so they exercise FloatingCard
// in isolation, decoupled from whichever kinds have real, atom-bound bodies wired.
const makeCard = (over: Partial<Card> = {}): Card => ({
  id: "node:source", target: { kind: "node", id: "source" }, cardKind: "table",
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
    // title is scoped to the bar so it does not collide with the stub body
    // (`table — node:source`), which also matches /table/i for this card.
    expect(within(screen.getByTestId("card-bar")).getByText(/table/i)).toBeInTheDocument();
    expect(screen.getByTestId("card-stub").dataset.cardKind).toBe("table");
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

  it("accumulates across successive drags (no stale base)", () => {
    const { store, rerender } = mount(makeCard({ x: 40, y: 50 }));
    const drag = (fromX: number, fromY: number, toX: number, toY: number) => {
      const bar = screen.getByTestId("card-bar");
      fireEvent.pointerDown(bar, { clientX: fromX, clientY: fromY });
      fireEvent.pointerMove(window, { clientX: toX, clientY: toY });
      fireEvent.pointerUp(window, { clientX: toX, clientY: toY });
    };
    drag(100, 100, 130, 120);            // +30,+20 → 70,70
    // The card prop is fixed, so re-render with the updated geometry from the
    // store before the second drag — otherwise a stale-closure impl would be
    // indistinguishable from a correct one.
    rerender(<Provider store={store}><FloatingCard card={store.get(cardsAtom)[0]} /></Provider>);
    drag(200, 200, 210, 215);            // +10,+15 from the NEW base 70,70 → 80,85
    expect(store.get(cardsAtom)[0]).toMatchObject({ x: 80, y: 85 });
  });
});
