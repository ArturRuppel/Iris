import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Provider } from "jotai";
import { LayerStrip } from "./LayerStrip";
import { ruleColumns } from "./LayerCards";
import { seedStore } from "../workbench/cards/cardTestStore";
import {
  activePlottableAtom, addLayerAtom, buildSpec, emptyPipeline, plottableFromSpec,
  registryAtom, makeDefaultPlottable,
} from "../state";
import { geomAddable, geomAxisColTypes, geomGateReason, geomSatisfiableByColumns } from "../channels";
import type { AnalysisSpec, ColumnDef, GeomMeta, Layer, Registry } from "../types";
import { EMPTY_HIERARCHY, RULE_DEFAULTS } from "../types";

/* the registry entry the engine serves for `rule` (geoms.py) */
const RULE: GeomMeta = {
  label: "Rule (per-row line)", family: "annotation", aggregates: true,
  needs: [], x_type: "any", y_type: "any", h_orient: false, point_cap: null,
  aes: ["color"],
};
const DIST: GeomMeta = {
  label: "Distribution", family: "descriptive", aggregates: true, needs: ["y"],
  x_type: "none", y_type: "numeric", h_orient: false, point_cap: null, aes: [],
};
const REGISTRY: Registry = {
  point_cap: 5000, facet_cell_cap: 200, geoms: { distribution: DIST, rule: RULE },
};

const EXTRA: ColumnDef[] = [
  { name: "z", type: "numeric", label: "Z" },
  { name: "top", type: "numeric", label: "Top membrane" },
  { name: "dot", type: "numeric", label: "Dot id", identifier: true },
  { name: "condition", type: "categorical", label: "Condition", levels: ["a", "b"] },
];

function mount(layers: Layer[]) {
  const { store, plottable } = seedStore(["field"], EXTRA);
  store.set(registryAtom, REGISTRY);
  store.set(activePlottableAtom, {
    ...plottable, mappings: { x: "", y: "z" }, layers,
  });
  render(
    <Provider store={store}>
      <LayerStrip />
    </Provider>,
  );
  return store;
}

const ruleLayer = (params: Layer["params"] = {}): Layer =>
  ({ id: "r1", geom: "rule", level: "", params });

describe("rule geom: registry gating", () => {
  it("places no demand on either axis", () => {
    for (const [x, y] of [[null, "numeric"], ["categorical", "numeric"],
      ["numeric", "numeric"], [null, null]] as const) {
      expect(geomGateReason(RULE, x, y)).toBeNull();
      expect(geomAddable(RULE, x, y)).toBe(true);
    }
    expect(geomSatisfiableByColumns(RULE, [], REGISTRY)).toBe(true);
  });
  it("never narrows what the encoding offers", () => {
    expect(geomAxisColTypes([RULE], "x").size).toBe(0);
    expect(geomAxisColTypes([RULE], "y").size).toBe(0);
    // alongside a distribution the narrowing is the distribution's alone
    expect([...geomAxisColTypes([DIST, RULE], "y")]).toEqual(["numeric"]);
  });
  it("offers numeric measures only as rule columns", () => {
    const cols = ruleColumns(EXTRA).map((c) => c.name);
    expect(cols).toEqual(["z", "top"]);
  });
});

describe("rule geom: state", () => {
  it("a new rule layer is seeded with the default params", () => {
    const { store } = seedStore(["field"], EXTRA);
    store.set(addLayerAtom, "rule");
    const last = () => { const ls = store.get(activePlottableAtom)!.layers; return ls[ls.length - 1]; };
    const l = last();
    expect(l.geom).toBe("rule");
    expect(l.params).toEqual({ label: "", label_where: "first",
      linestyle: "dashed", linewidth: 0.8 });
    // other geoms carry no params
    store.set(addLayerAtom, "distribution");
    expect(last().params).toBeUndefined();
  });
  it("rule params survive a spec round-trip; other geoms' params are dropped", () => {
    const spec = {
      spec_version: "2.2", id: "z", title: "z",
      reduce: { nodes: [{ id: "src", kind: "source" }], output: "src" },
      encodings: { x: null, y: { column: "z" }, color: null, size: null, shape: null },
      facet: { row: null, col: null, share_x: true, share_y: true },
      hierarchy: { spine: [], fn: {} },
      layers: [
        { geom: "distribution", level: "", params: { dist_render: "bars" } },
        { geom: "rule", level: "field", params: { column: "top", label: "top",
          label_where: "all", linestyle: "dotted", linewidth: 1.2 } },
      ],
      stats: { family: "descriptive", test: "descriptive", override: null, alpha: 0.05 },
      style: { overrides: {} }, engine_snapshot: {},
    } as unknown as AnalysisSpec;
    const { p, dag } = plottableFromSpec(spec);
    expect(p.layers[0].params).toBeUndefined();
    expect(p.layers[1].params).toEqual({ column: "top", label: "top",
      label_where: "all", linestyle: "dotted", linewidth: 1.2 });
    const out = buildSpec(p, "descriptive", undefined, {}, EMPTY_HIERARCHY, {},
      { sources: dag.sources, steps: dag.steps });
    expect(out.layers[1]).toMatchObject({ geom: "rule", level: "field",
      params: { column: "top", label_where: "all" } });
  });
  it("buildSpec emits a fresh plottable's rule params", () => {
    const p = { ...makeDefaultPlottable(), mappings: { x: "", y: "z" },
      layers: [ruleLayer({ column: "top" })] };
    const spec = buildSpec(p, "descriptive", undefined, {}, EMPTY_HIERARCHY, {}, emptyPipeline(""));
    expect(spec.layers[0].params).toEqual({ column: "top" });
  });
});

describe("rule geom: Layers card", () => {
  it("shows the rule editors with the defaults", () => {
    mount([{ id: "d1", geom: "distribution", level: "" }, ruleLayer()]);
    const col = screen.getByLabelText("Column") as HTMLSelectElement;
    const opts = within(col).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(["", "z", "top", "val"]);       // numeric measures only
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Line width") as HTMLInputElement).value)
      .toBe(String(RULE_DEFAULTS.linewidth));
    expect(screen.getByRole("button", { name: "first" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "dashed" })).toHaveAttribute("aria-pressed", "true");
  });
  it("a distribution layer has no rule editors", () => {
    mount([{ id: "d1", geom: "distribution", level: "" }]);
    expect(screen.queryByLabelText("Column")).toBeNull();
  });
  it("edits write the layer's params", () => {
    const store = mount([ruleLayer({ ...RULE_DEFAULTS, column: null })]);
    const params = () => store.get(activePlottableAtom)!.layers[0].params!;
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "top" } });
    expect(params().column).toBe("top");
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "apical" } });
    expect(params().label).toBe("apical");
    fireEvent.click(screen.getByRole("button", { name: "all" }));
    expect(params().label_where).toBe("all");
    fireEvent.click(screen.getByRole("button", { name: "dotted" }));
    expect(params().linestyle).toBe("dotted");
    fireEvent.change(screen.getByLabelText("Line width"), { target: { value: "1.5" } });
    expect(params().linewidth).toBe(1.5);
    // nothing else on the layer moved
    expect(params().column).toBe("top");
  });
  it("retyping out of a rule drops its params; into a rule seeds them", () => {
    const store = mount([ruleLayer({ column: "top" })]);
    fireEvent.change(screen.getByTitle(/change plot type/i), { target: { value: "distribution" } });
    expect(store.get(activePlottableAtom)!.layers[0].params).toBeUndefined();
    fireEvent.change(screen.getByTitle(/change plot type/i), { target: { value: "rule" } });
    expect(store.get(activePlottableAtom)!.layers[0].params?.linestyle).toBe("dashed");
  });
});
