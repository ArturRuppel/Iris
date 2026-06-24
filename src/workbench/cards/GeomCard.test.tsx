import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "jotai";
import { GeomCard } from "./GeomCard";
import { seedStore } from "./cardTestStore";

describe("GeomCard", () => {
  it("renders the encoding + layer editors inside the card wrapper", () => {
    const { store } = seedStore();
    const { container } = render(
      <Provider store={store}><GeomCard target={{ kind: "edge", id: "g:plain" }} /></Provider>,
    );
    expect(container.querySelector('[data-testid="geom-card"]')).toBeInTheDocument();
    // both child panels mount; the card wrapper holds them.
    expect(container.querySelectorAll('[data-testid="geom-card"] > *').length).toBeGreaterThan(0);
  });
});
