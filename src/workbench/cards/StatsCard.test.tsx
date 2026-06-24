import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { StatsCard } from "./StatsCard";
import { seedStore } from "./cardTestStore";

describe("StatsCard", () => {
  it("renders the StatsPanel inside the card wrapper", () => {
    const { store } = seedStore();
    const { container } = render(
      <Provider store={store}><StatsCard target={{ kind: "node", id: "stats" }} /></Provider>,
    );
    expect(container.querySelector('[data-testid="stats-card"]')).toBeInTheDocument();
    // with no analysis yet, StatsPanel shows its waiting placeholder.
    expect(screen.getByText(/waiting for first analysis/i)).toBeInTheDocument();
  });
});
