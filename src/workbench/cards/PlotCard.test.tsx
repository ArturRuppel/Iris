import { describe, it, expect } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { Provider } from "jotai";
import { PlotCard } from "./PlotCard";
import { seedStore } from "./cardTestStore";
import { activePlottableAtom, registryAtom, styleRegistryAtom } from "../../state";
import { displayFocusAtom } from "../state";
import { inspectorTabAtom } from "../../components/inspector/PlotInspector";
import type { Layer, Registry, StyleKnob } from "../../types";

const target = { kind: "node" as const, id: "figure", facet: "plot" as const };

/* a slice of the engine's STYLE_REGISTRY (engine/iris_engine/style.py) */
const KNOBS: StyleKnob[] = [
  { key: "width_mm", label: "Canvas width", group: "figure", widget: { type: "number", min: 40, max: 300, step: 5 }, default: 140, scope: "figure", transferable: true },
  { key: "font_pt", label: "Font size", group: "figure", widget: { type: "number", min: 5, max: 16, step: 0.5 }, default: 9, scope: "figure", transferable: true },
  { key: "frame", label: "Frame", group: "figure", widget: { type: "select", options: ["open", "closed"] }, default: "open", scope: "figure", transferable: true },
  { key: "grid_x", label: "Vertical grid", group: "figure", widget: { type: "bool" }, default: null, scope: "figure", transferable: true },
  { key: "grid_y", label: "Horizontal grid", group: "figure", widget: { type: "bool" }, default: null, scope: "figure", transferable: true },
  { key: "x_scale", label: "X scale", group: "axes", widget: { type: "select", options: ["linear", "log"] }, default: "linear", scope: "figure", transferable: true },
  { key: "y_scale", label: "Y scale", group: "axes", widget: { type: "select", options: ["linear", "log"] }, default: "linear", scope: "figure", transferable: true },
  { key: "x_tick_rotation", label: "X tick rotation", group: "axes", widget: { type: "number", min: 0, max: 90, step: 15 }, default: 0, scope: "figure", transferable: true },
  { key: "title", label: "Title", group: "text", widget: { type: "text" }, default: "", scope: "figure", transferable: false },
  { key: "show_n", label: "n per group", group: "annotations", widget: { type: "bool" }, default: true, scope: "figure", transferable: true },
  { key: "brand_new", label: "Brand new knob", group: "axes", widget: { type: "bool" }, default: false, scope: "figure", transferable: true },
  { key: "mark_width", label: "Width", group: "box", widget: { type: "number", min: 0.1, max: 1, step: 0.05 }, default: 0.42, scope: "geom", applies_to_geoms: ["box"], transferable: true },
  { key: "outlier_marker", label: "Outlier marker", group: "box", widget: { type: "select", options: ["o", "D", "x", "+", "none"] }, default: "o", scope: "geom", applies_to_geoms: ["box"], transferable: true },
  { key: "outlier_size", label: "Outlier size", group: "box", widget: { type: "number", min: 1, max: 8, step: 0.5 }, default: 3, scope: "geom", applies_to_geoms: ["box"], transferable: true,
    visible_when: { key: "outlier_marker", not_equals: "none" } },
];

function mount(opts: { withPlot: boolean; layers?: Layer[]; style?: Record<string, unknown> }) {
  const { store, plottable } = seedStore();
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", aggregates: true, x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  store.set(styleRegistryAtom, KNOBS);
  store.set(activePlottableAtom, opts.withPlot
    ? { ...plottable, mappings: { x: "experiment", y: "val" },
        layers: opts.layers ?? [{ id: "ly1", geom: "box", level: "" }],
        style: opts.style ?? {} }
    : { ...plottable, mappings: { x: "", y: "" }, layers: [] });
  render(<Provider store={store}><PlotCard target={target} /></Provider>);
  return store;
}
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const style = (store: ReturnType<typeof mount>) =>
  store.get(activePlottableAtom)!.style as Record<string, unknown>;

describe("PlotCard", () => {
  it("with no renderable plot, shows the add-plot CTA", () => {
    mount({ withPlot: false });
    expect(screen.getByRole("button", { name: /add plot/i })).toBeInTheDocument();
  });

  it("with a plot, renders the figure body and the layer strip under Layers", () => {
    mount({ withPlot: true });
    expect(screen.queryByRole("button", { name: /add plot/i })).not.toBeInTheDocument();
    tab("Layers");
    expect(screen.getByTestId("layer-strip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
  });

  it("a request to focus the encoding switches back to the Encoding tab", () => {
    const store = mount({ withPlot: true });
    tab("Axes");
    expect(store.get(inspectorTabAtom)).toBe("axes");
    act(() => store.set(displayFocusAtom, { section: "encoding", n: 1 }));
    expect(screen.getByRole("tab", { name: "Encoding" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".encodings-card")).toBeInTheDocument();
  });
});

describe("plot inspector", () => {
  it("a 2-option select is a segmented control that writes the value", () => {
    const store = mount({ withPlot: true });
    tab("Axes");
    const frameRow = screen.getByText("Frame").closest(".insp-row") as HTMLElement;
    const closed = within(frameRow).getByRole("button", { name: "closed" });
    expect(within(frameRow).getByRole("button", { name: "open" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(closed);
    expect(style(store).frame).toBe("closed");
    expect(within(frameRow).getByRole("button", { name: "closed" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the Axes grid pairs X and Y, with — where Y has no knob", () => {
    const store = mount({ withPlot: true });
    tab("Axes");
    const scale = screen.getByText("Scale").closest(".insp-grid-row") as HTMLElement;
    const logs = within(scale).getAllByRole("button", { name: "log" });
    expect(logs).toHaveLength(2);
    fireEvent.click(logs[1]);
    expect(style(store).y_scale).toBe("log");
    expect(style(store).x_scale).toBeUndefined();
    const rot = screen.getByText("Rotation").closest(".insp-grid-row") as HTMLElement;
    expect(within(rot).getByText("—")).toBeInTheDocument();
    // a registry knob no tab places by hand still renders in its tab
    expect(screen.getByText("Brand new knob")).toBeInTheDocument();
  });

  it("a customised knob shows a reset dot that deletes the override", () => {
    const store = mount({ withPlot: true, style: { font_pt: 12 } });
    tab("Text");
    expect(screen.getAllByTitle("Reset to default")).toHaveLength(1);
    expect(screen.queryByText(/customized/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /reset font size to default/i }));
    expect(style(store).font_pt).toBeUndefined();
    expect(screen.queryByTitle("Reset to default")).toBeNull();
    expect(screen.getByText("Annotations")).toBeInTheDocument();
  });

  it("a unit number field shows its unit and writes a number", () => {
    const store = mount({ withPlot: true });
    tab("Layout");
    const row = screen.getByText("Canvas width").closest(".insp-row") as HTMLElement;
    expect(within(row).getByText("mm")).toBeInTheDocument();
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "90" } });
    expect(style(store).width_mm).toBe(90);
  });

  it("each layer card carries its geom's knobs, on the shared tier for a single geom", () => {
    const store = mount({ withPlot: true });
    tab("Layers");
    const strip = screen.getByTestId("layer-strip");
    // a fraction is a slider with its value as text, no number field
    const widthRow = within(strip).getByText("Width").closest(".insp-row") as HTMLElement;
    expect(within(widthRow).getByText("0.42")).toBeInTheDocument();
    expect(within(widthRow).queryByRole("spinbutton")).toBeNull();
    fireEvent.change(within(widthRow).getByRole("slider"), { target: { value: "0.6" } });
    expect(style(store).geoms).toEqual({ box: { mark_width: 0.6 } });
    // a 5-option select stays a dropdown; visible_when hides the size at "none"
    const marker = within(strip).getByLabelText("Outlier marker");
    expect(marker.tagName).toBe("SELECT");
    expect(within(strip).getByText("Outlier size")).toBeInTheDocument();
    fireEvent.change(marker, { target: { value: "none" } });
    expect(within(strip).queryByText("Outlier size")).toBeNull();
  });

  it("a repeated geom edits each layer's own tier (item K)", () => {
    const store = mount({ withPlot: true, layers: [
      { id: "a", geom: "box", level: "" }, { id: "b", geom: "box", level: "" }] });
    tab("Layers");
    const cards = screen.getByTestId("layer-strip").querySelectorAll(".layer-card");
    expect(cards).toHaveLength(2);
    const second = within(cards[1] as HTMLElement);
    fireEvent.change(second.getByLabelText("Outlier marker"), { target: { value: "x" } });
    expect(style(store).layers).toEqual({ b: { outlier_marker: "x" } });
    expect(style(store).geoms).toBeUndefined();
    expect(second.getAllByTitle("Reset to default")).toHaveLength(1);
    expect(within(cards[0] as HTMLElement).queryByTitle("Reset to default")).toBeNull();
  });

  it("the ⋯ menu holds the style-sheet actions and Reset all", () => {
    const store = mount({ withPlot: true, style: { font_pt: 12 } });
    fireEvent.click(screen.getByRole("button", { name: /style sheet actions/i }));
    for (const n of ["Save as style…", "Export…", "Import…"])
      expect(screen.getByRole("menuitem", { name: n })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset all" }));
    expect(style(store)).toEqual({});
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
