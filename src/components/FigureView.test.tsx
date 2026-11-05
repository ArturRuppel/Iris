import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import {
  activePlottableIdAtom, figureAtom, figureRequestAtom, loadDocumentAtom,
  plottablesAtom, viewModeAtom,
} from "../state";
import { engine } from "../types";
import { FigureView } from "./FigureView";

const SCHEMA = { schema_version: "1.0", columns: [
  { name: "grp", type: "categorical", label: "Group", levels: ["a", "b"] },
  { name: "val", type: "numeric", label: "Value" }] } as const;
const spec = (id: string, tag?: string) => ({
  spec_version: "2.2", id, title: id, table_id: "t",
  reduce: { nodes: [{ id: "src", kind: "source", table_id: "t" }], output: "src" },
  encodings: { x: { column: "grp" }, y: { column: "val" }, color: null, size: null, shape: null },
  facet: { row: null, col: null, share_x: true, share_y: true },
  hierarchy: { spine: [], fn: {} }, layers: [{ geom: "box", level: "" }],
  stats: { family: "group_comparison", test: "welch_t", alpha: 0.05 },
  style: { overrides: {} }, engine_snapshot: {}, ...(tag ? { tag } : {}),
});

async function seed() {
  const store = createStore();
  await store.set(loadDocumentAtom, {
    analyses: [spec("one", "A"), spec("two", "B"), spec("three")],
    tables: [{ name: "t", id: "h_t", schema: SCHEMA, hierarchy: { spine: [], fn: {} },
      n: 2, version: 0, counts: { total: 2 }, rows: [] }],
    figure: { panels: ["two", "one"] },
  } as never);
  return store;
}

afterEach(() => vi.restoreAllMocks());

describe("FigureView", () => {
  it("previews the assembly, lists the panels in order, and opens a tapped panel", async () => {
    const store = await seed();
    const renderFig = vi.spyOn(engine, "figureRender").mockResolvedValue({
      svg: "<svg xmlns='http://www.w3.org/2000/svg'/>", width_mm: 100, height_mm: 120,
      panels: [{ id: "two", tag: "B", box: [0, 0, 1, 0.5], error: null },
               { id: "one", tag: "A", box: [0, 0.5, 1, 1], error: null }],
    });
    globalThis.URL.createObjectURL ??= () => "blob:x";
    globalThis.URL.revokeObjectURL ??= () => {};
    render(<Provider store={store}><FigureView /></Provider>);
    // the request carries the tagged analyses in figure order, with their sessions
    const req = store.get(figureRequestAtom);
    expect(req.map((p) => [p.spec.id, p.tag, p.table_token])).toEqual([["two", "B", "h_t"], ["one", "A", "h_t"]]);
    expect(screen.getByLabelText("Tag of two")).toHaveValue("B");
    await waitFor(() => expect(renderFig).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Open panel A" }));
    expect(store.get(activePlottableIdAtom)).toBe("one");
    expect(store.get(viewModeAtom)).toBe("workbench");
  });

  it("adds an untagged analysis with the next letter and edits the layout", async () => {
    const store = await seed();
    vi.spyOn(engine, "figureRender").mockResolvedValue({ svg: "<svg/>", panels: [], width_mm: 1, height_mm: 1 });
    render(<Provider store={store}><FigureView /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Add three to the figure" }));
    expect(store.get(plottablesAtom).find((p) => p.id === "three")?.tag).toBe("C");
    fireEvent.click(screen.getByLabelText("Shared x axis"));
    expect(store.get(figureAtom)?.share_x).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(store.get(figureAtom)).toMatchObject({ direction: "columns", share_x: false });
  });
});
