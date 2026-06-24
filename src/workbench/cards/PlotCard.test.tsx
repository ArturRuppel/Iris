import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "jotai";
import { PlotCard } from "./PlotCard";
import { seedStore } from "./cardTestStore";

describe("PlotCard", () => {
  it("renders the FigurePane inside the card wrapper", () => {
    const { store } = seedStore();
    const { container } = render(
      <Provider store={store}><PlotCard target={{ kind: "node", id: "plot" }} /></Provider>,
    );
    expect(container.querySelector('[data-testid="plot-card"]')).toBeInTheDocument();
    // FigurePane always renders its <section className="pane figure-pane">.
    expect(container.querySelector(".figure-pane")).toBeInTheDocument();
  });
});
