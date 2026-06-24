import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { CollapseCard } from "./CollapseCard";
import { seedStore } from "./cardTestStore";

describe("CollapseCard", () => {
  it("renders the CollapseRoutingPanel inside the card wrapper", () => {
    const { store } = seedStore(["experiment", "cell"]);
    const { container } = render(
      <Provider store={store}>
        <CollapseCard target={{ kind: "edge", id: "e:source->grain:experiment" }} />
      </Provider>,
    );
    expect(container.querySelector('[data-testid="collapse-card"]')).toBeInTheDocument();
    expect(screen.getByLabelText(/test reads at/i)).toBeInTheDocument();
  });
});
