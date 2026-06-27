import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { tablesAtom, activeTableIdAtom } from "../state";
import type { WorkspaceTable } from "../state";
import { TableList } from "./TableList";

const wt = (id: string): WorkspaceTable => ({
  id, name: id,
  schema: { schema_version: "1.0", columns: [{ name: "v", type: "numeric", label: "V" }] },
  hierarchy: { spine: [], fn: {} },
  handle: { id: `h_${id}`, n: 1, version: 0,
    schema: { schema_version: "1.0", columns: [{ name: "v", type: "numeric", label: "V" }] },
    counts: { total: 1 } as never },
});

function seed() {
  const store = createStore();
  store.set(tablesAtom, [wt("alpha"), wt("beta")]);
  store.set(activeTableIdAtom, "alpha");
  return store;
}

describe("TableList", () => {
  it("renders both table names and marks the active one", () => {
    const store = seed();
    render(<Provider store={store}><TableList /></Provider>);
    const alpha = screen.getByRole("button", { name: "alpha" });
    const beta = screen.getByRole("button", { name: "beta" });
    expect(alpha).toBeInTheDocument();
    expect(beta).toBeInTheDocument();
    expect(alpha).toHaveAttribute("aria-current", "true");
    expect(beta).toHaveAttribute("aria-current", "false");
    expect(alpha.className).toContain("is-active");
    expect(beta.className).not.toContain("is-active");
  });

  it("switches the active table when another row is clicked", () => {
    const store = seed();
    render(<Provider store={store}><TableList /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: "beta" }));
    expect(store.get(activeTableIdAtom)).toBe("beta");
    expect(screen.getByRole("button", { name: "beta" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "alpha" })).toHaveAttribute("aria-current", "false");
  });

  it("renders nothing when the pool is empty", () => {
    const store = createStore();
    store.set(tablesAtom, []);
    const { container } = render(<Provider store={store}><TableList /></Provider>);
    expect(container.firstChild).toBeNull();
  });
});
