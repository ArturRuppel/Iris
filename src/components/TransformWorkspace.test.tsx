import { render } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { Provider, createStore } from "jotai";
import { TransformWorkspace } from "./TransformWorkspace";
import { workspaceOpenAtom } from "../state";

/* The container reads explorerGraphAtom (derived from the active plottable). With
   no active plottable the graph is null, so the overlay renders nothing even when
   open — assert the closed/open gating contract that does not need a full store. */
describe("TransformWorkspace", () => {
  it("renders nothing when closed", () => {
    const store = createStore();
    const { container } = render(<Provider store={store}><TransformWorkspace /></Provider>);
    expect(container.querySelector(".txw-overlay")).toBeNull();
  });

  it("renders nothing when open but there is no graph (no active analysis)", () => {
    const store = createStore();
    store.set(workspaceOpenAtom, true);
    const { container } = render(<Provider store={store}><TransformWorkspace /></Provider>);
    expect(container.querySelector(".txw-overlay")).toBeNull();
  });
});
