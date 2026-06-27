import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { TableCard } from "./TableCard";
import { seedStore } from "./cardTestStore";

describe("TableCard", () => {
  it("renders the NodeTable body for the source node", () => {
    const { store } = seedStore(["experiment", "cell"]);
    const { container } = render(
      <Provider store={store}>
        <TableCard target={{ kind: "node", id: "source" }} />
      </Provider>,
    );
    expect(container.querySelector('[data-testid="table-card"]')).toBeInTheDocument();
  });

  it("is table-only — no in-card add-step menu (the on-canvas + handle owns add)", () => {
    const { store } = seedStore(["experiment", "cell"]);
    render(
      <Provider store={store}>
        <TableCard target={{ kind: "node", id: "source" }} />
      </Provider>,
    );
    expect(screen.queryByRole("button", { name: /Filter \/ Drop/i })).toBeNull();
  });

  it("shows a notice for a target id not in the graph", () => {
    const { store } = seedStore(["experiment", "cell"]);
    render(
      <Provider store={store}>
        <TableCard target={{ kind: "node", id: "ghost" }} />
      </Provider>,
    );
    expect(screen.getByText(/no longer in the graph/i)).toBeInTheDocument();
  });
});
