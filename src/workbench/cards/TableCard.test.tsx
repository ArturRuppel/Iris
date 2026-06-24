import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { activePlottableAtom } from "../../state";
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

  it("appends a filter step via the add-step menu", () => {
    const { store } = seedStore(["experiment", "cell"]);
    const before = store.get(activePlottableAtom)!.reduce.steps.length;
    render(
      <Provider store={store}>
        <TableCard target={{ kind: "node", id: "source" }} />
      </Provider>,
    );
    // open the toggle menu, then pick Filter.
    fireEvent.click(screen.getByRole("button", { name: /Filter \/ Drop/i }));
    fireEvent.click(screen.getByRole("button", { name: /Filter rows/i }));

    const steps = store.get(activePlottableAtom)!.reduce.steps;
    expect(steps.length).toBe(before + 1);
    expect(steps[steps.length - 1].kind).toBe("filter");
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
