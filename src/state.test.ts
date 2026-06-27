import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import type { AnalysisSpec, AnalyzeResponse, Schema } from "./types";
import {
  activePlottableIdAtom, analysisByIdAtom, analysisKeyByIdAtom,
  analysisRecencyAtom, buildSpec, cacheBudgetAtom, cacheKey, estimateBytes,
  isSpecRenderable, makeDefaultPlottable, pickStaleSpec, plottableFromSpec,
  selectedNodeIdAtom, setAnalysisResultAtom,
  schemaAtom, hierarchyAtom, plottablesAtom, activePlottableAtom,
  effectivePlanAtom, effectiveTestGrainAtom,
  setCollapsePlanAtom, setTestGrainAtom, resetCollapseAtom,
  makeStep, addStepAtom, insertStepAtom, updateStepAtom,
  removeStepAtom, moveStepAtom, runnableSteps, EMPTY_RIGHT,
  tablesAtom, activeTableIdAtom, activeTableAtom, analysisTableAtom,
} from "./state";
import type { ReduceStep, Table } from "./types";
import { EMPTY_HIERARCHY } from "./types";

/* a minimal renderable spec: a Y encoding and one layer. Toggle `y`/`layers`/`x`
   to exercise the renderable gate; `tag` lets a test mutate the spec so its key
   changes (simulating a config edit). */
function makeSpec(id: string, opts: {
  y?: boolean; layers?: number; xCol?: string | null; tag?: string;
} = {}): AnalysisSpec {
  return {
    spec_version: "2.1", id, title: opts.tag ?? id,
    data: { filter: [] },
    reduce: { steps: [] },
    encodings: {
      x: opts.xCol ? { column: opts.xCol } : null,
      y: opts.y === false ? null : { column: "val" },
      color: null, size: null, shape: null,
    },
    facet: { row: null, col: null, share_x: true, share_y: true },
    hierarchy: { spine: [], fn: {} },
    layers: opts.layers === 0 ? [] : [{ geom: "dot", params: {}, level: "" }],
    stats: {
      family: "group_comparison", test: "welch_t", override: null, alpha: 0.05,
    },
    annotations: { significance_brackets: "auto", show_n: true },
    style: { overrides: {} },
    engine_snapshot: {},
  };
}

/* an AnalyzeResponse sized to `bytes` via SVG length (estimateBytes adds a flat
   overhead, so the request is a lower bound the tests account for). */
function makeRes(bytes = 0): AnalyzeResponse {
  return {
    figure: { svg: "x".repeat(bytes) },
    stats: {} as AnalyzeResponse["stats"],
    stat_model: {} as AnalyzeResponse["stat_model"],
    issues: [], engine_snapshot: {},
  };
}

const SCHEMA: Schema = { schema_version: "1.0", columns: [
  { name: "grp", type: "categorical", label: "Group" },
  { name: "val", type: "numeric", label: "Value" },
] };

describe("location (vs-reference) family round-trips through save/load", () => {
  // a saved location doc, like reports' contact_clustering.iris: categorical x,
  // numeric y, stats.family = location, the tested constant in stats.reference.
  const locationSpec = (): AnalysisSpec => ({
    ...makeSpec("loc", { xCol: "grp" }),
    stats: {
      family: "location", test: "one_sample_t",
      override: "one_sample_t", reference: 0, alpha: 0.05,
    },
  });

  it("plottableFromSpec restores the reference opt-in (not a group comparison)", () => {
    const p = plottableFromSpec(locationSpec());
    expect(p.reference).toBe(0);
    // an ordinary group comparison must NOT acquire a reference
    expect(plottableFromSpec(makeSpec("g", { xCol: "grp" })).reference).toBeNull();
  });

  it("plottableFromSpec falls back to the reference line when stats.reference is absent", () => {
    const legacy = locationSpec();
    delete (legacy.stats as { reference?: number | null }).reference;
    legacy.style = { overrides: { reference_value: 0.5 } };
    expect(plottableFromSpec(legacy).reference).toBe(0.5);
  });

  it("buildSpec re-emits family=location with the reference (no silent group_comparison)", () => {
    const p = { ...makeDefaultPlottable(SCHEMA), mappings: { x: "grp", y: "val" }, reference: 0 };
    const spec = buildSpec(p, "location", undefined, {}, EMPTY_HIERARCHY);
    expect(spec.stats.family).toBe("location");
    expect(spec.stats.reference).toBe(0);
    expect(spec.stats.test).toBe("one_sample_t");
    // the chance line is defaulted so the figure draws the reference it tests against
    expect(spec.style.overrides.reference_value).toBe(0);
  });

  it("a full save→load→save cycle preserves the location family", () => {
    const loaded = plottableFromSpec(locationSpec());
    const resaved = buildSpec(loaded, "location", undefined, {}, EMPTY_HIERARCHY);
    expect(resaved.stats.family).toBe("location");
    expect(resaved.stats.reference).toBe(0);
  });
});

describe("stats block stores decisions only (format redesign)", () => {
  const base = () => ({ ...makeDefaultPlottable(SCHEMA),
                        mappings: { x: "grp", y: "val" } });

  it("buildSpec emits no derived/process fields", () => {
    const spec = buildSpec(base(), "group_comparison", "welch_t", {}, EMPTY_HIERARCHY);
    const keys = Object.keys(spec.stats);
    for (const dead of ["chosen_by", "alternatives_offered", "assumption_checks", "report"]) {
      expect(keys).not.toContain(dead);
    }
    expect(spec.spec_version).toBe("2.1");
  });

  it("describe_only is a stored decision and round-trips", () => {
    const p = { ...base(), describeOnly: true };
    const spec = buildSpec(p, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY);
    expect(spec.stats.describe_only).toBe(true);
    expect(plottableFromSpec(spec).describeOnly).toBe(true);
  });

  it("describe_only is omitted (not false) when the user did not choose it", () => {
    const spec = buildSpec(base(), "group_comparison", "welch_t", {}, EMPTY_HIERARCHY);
    expect("describe_only" in spec.stats).toBe(false);
    expect(plottableFromSpec(spec).describeOnly).toBe(false);
  });

  it("override round-trips independently of the recommendation", () => {
    const p = { ...base(), override: "mann_whitney" as const };
    const spec = buildSpec(p, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY);
    expect(spec.stats.override).toBe("mann_whitney");
    expect(plottableFromSpec(spec).override).toBe("mann_whitney");
  });
});

describe("isSpecRenderable — the active loop's gate, applied to any spec", () => {
  it("requires a Y encoding and ≥1 layer", () => {
    expect(isSpecRenderable(makeSpec("a"), SCHEMA)).toBe(true);
    expect(isSpecRenderable(makeSpec("a", { y: false }), SCHEMA)).toBe(false);
    expect(isSpecRenderable(makeSpec("a", { layers: 0 }), SCHEMA)).toBe(false);
  });
  it("rejects a mapped axis the post-reduction schema drops", () => {
    expect(isSpecRenderable(makeSpec("a", { xCol: "grp" }), SCHEMA)).toBe(true);
    expect(isSpecRenderable(makeSpec("a", { xCol: "gone" }), SCHEMA)).toBe(false);
  });
  it("allows survival-unknown specs through when no schema is available", () => {
    // the engine will 422 and the background loop records the failed key
    expect(isSpecRenderable(makeSpec("a", { xCol: "gone" }), null)).toBe(true);
  });
});

describe("pickStaleSpec — what the background loop renders next", () => {
  const base = {
    activeId: "a", handleId: "t1", version: 0,
    keyById: {} as Record<string, string>,
    failedKeys: new Set<string>(),
    schemaFor: () => SCHEMA,
  };

  it("picks the first stale, renderable, non-active plottable", () => {
    const specs = [makeSpec("a"), makeSpec("b"), makeSpec("c")];
    const got = pickStaleSpec(specs, base);
    expect(got?.spec.id).toBe("b");
    expect(got?.key).toBe(cacheKey("t1", 0, specs[1]));
  });

  it("never picks the active plottable, even when stale", () => {
    const specs = [makeSpec("a")];
    expect(pickStaleSpec(specs, base)).toBeNull();
  });

  it("skips fresh plottables (key already matches)", () => {
    const specs = [makeSpec("a"), makeSpec("b"), makeSpec("c")];
    const keyById = { b: cacheKey("t1", 0, specs[1]) };
    expect(pickStaleSpec(specs, { ...base, keyById })?.spec.id).toBe("c");
  });

  it("skips non-renderable plottables", () => {
    const specs = [makeSpec("a"), makeSpec("b", { y: false }), makeSpec("c")];
    expect(pickStaleSpec(specs, base)?.spec.id).toBe("c");
  });

  it("skips a config already failed at this exact key", () => {
    const specs = [makeSpec("a"), makeSpec("b"), makeSpec("c")];
    const failedKeys = new Set([`b:${cacheKey("t1", 0, specs[1])}`]);
    expect(pickStaleSpec(specs, { ...base, failedKeys })?.spec.id).toBe("c");
  });

  it("returns null once every plottable is fresh", () => {
    const specs = [makeSpec("a"), makeSpec("b"), makeSpec("c")];
    const keyById = {
      b: cacheKey("t1", 0, specs[1]), c: cacheKey("t1", 0, specs[2]),
    };
    expect(pickStaleSpec(specs, { ...base, keyById })).toBeNull();
  });
});

describe("background drain — sequential warm of every stale plottable", () => {
  it("renders each stale plottable exactly until fresh, one at a time, never the active one, then stops", async () => {
    const specs = [makeSpec("a"), makeSpec("b"), makeSpec("c"), makeSpec("d")];
    const keyById: Record<string, string> = {};
    const failedKeys = new Set<string>();
    const rendered: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    // a stubbed engine.analyze: records the call and resolves
    const analyze = async (id: string) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      rendered.push(id);
    };

    // drive the loop the way the effect does: pick → render → store key → repeat
    for (;;) {
      const target = pickStaleSpec(specs, {
        activeId: "a", handleId: "t1", version: 0, keyById, failedKeys,
        schemaFor: () => SCHEMA,
      });
      if (!target) break;
      await analyze(target.spec.id);
      keyById[target.spec.id] = target.key;
    }

    expect(rendered).toEqual(["b", "c", "d"]);  // every non-active, in order
    expect(rendered).not.toContain("a");        // never the active one
    expect(maxInFlight).toBe(1);                 // one /analyze at a time
    // a second pass finds nothing stale
    expect(pickStaleSpec(specs, {
      activeId: "a", handleId: "t1", version: 0, keyById, failedKeys,
      schemaFor: () => SCHEMA,
    })).toBeNull();
  });

  it("attempts a failing plottable once per key, then skips it", async () => {
    const specs = [makeSpec("a"), makeSpec("b")];
    const keyById: Record<string, string> = {};
    const failedKeys = new Set<string>();
    let attempts = 0;

    for (let guard = 0; guard < 10; guard++) {
      const target = pickStaleSpec(specs, {
        activeId: "a", handleId: "t1", version: 0, keyById, failedKeys,
        schemaFor: () => SCHEMA,
      });
      if (!target) break;
      attempts++;
      // render rejects: record the failed key, never store a result/key
      failedKeys.add(`${target.spec.id}:${target.key}`);
    }

    expect(attempts).toBe(1);  // b was tried once, then permanently skipped
  });
});

describe("setAnalysisResultAtom — byte-budget LRU eviction", () => {
  it("stores result + key and marks the entry most-recently-used", () => {
    const store = createStore();
    store.set(activePlottableIdAtom, "a");
    store.set(setAnalysisResultAtom, { id: "b", key: "kb", res: makeRes() });
    expect(store.get(analysisByIdAtom).b).toBeDefined();
    expect(store.get(analysisKeyByIdAtom).b).toBe("kb");
    expect(store.get(analysisRecencyAtom)).toEqual(["b"]);
  });

  it("evicts least-recently-used entries past the budget, never the active one, and stays under budget", () => {
    const store = createStore();
    store.set(activePlottableIdAtom, "a");
    // a tiny budget where each entry's overhead alone (~4KB) leaves room for ~2
    const budget = estimateBytes(makeRes()) * 2 + 10;
    store.set(cacheBudgetAtom, budget);
    store.set(setAnalysisResultAtom, { id: "a", key: "ka", res: makeRes() });
    store.set(setAnalysisResultAtom, { id: "b", key: "kb", res: makeRes() });
    store.set(setAnalysisResultAtom, { id: "c", key: "kc", res: makeRes() });

    const byId = store.get(analysisByIdAtom);
    // a (active) is pinned; b was LRU and evicted to fit c
    expect(byId.a).toBeDefined();
    expect(byId.c).toBeDefined();
    expect(byId.b).toBeUndefined();
    expect(store.get(analysisKeyByIdAtom).b).toBeUndefined();
    expect(store.get(analysisRecencyAtom)).not.toContain("b");

    const total = Object.values(byId).reduce((s, r) => s + estimateBytes(r), 0);
    expect(total).toBeLessThanOrEqual(budget);
  });

  it("never evicts the active plottable even when the budget is already blown", () => {
    const store = createStore();
    store.set(activePlottableIdAtom, "a");
    store.set(cacheBudgetAtom, 1);  // budget below even a single entry's overhead
    store.set(setAnalysisResultAtom, { id: "a", key: "ka", res: makeRes() });
    store.set(setAnalysisResultAtom, { id: "b", key: "kb", res: makeRes() });
    // a third insert trims older non-active entries; the active one is pinned
    store.set(setAnalysisResultAtom, { id: "c", key: "kc", res: makeRes() });
    expect(store.get(analysisByIdAtom).a).toBeDefined();  // active never evicted
    expect(store.get(analysisByIdAtom).b).toBeUndefined(); // LRU non-active dropped
  });

  it("re-accessing an entry rescues it from being the next evicted", () => {
    const store = createStore();
    store.set(activePlottableIdAtom, "z");  // active not among the cached entries
    store.set(cacheBudgetAtom, estimateBytes(makeRes()) * 2 + 10);
    store.set(setAnalysisResultAtom, { id: "a", key: "ka", res: makeRes() });
    store.set(setAnalysisResultAtom, { id: "b", key: "kb", res: makeRes() });
    // touch a so b is now the LRU, then insert c → b is evicted, a survives
    store.set(setAnalysisResultAtom, { id: "a", key: "ka2", res: makeRes() });
    store.set(setAnalysisResultAtom, { id: "c", key: "kc", res: makeRes() });
    expect(store.get(analysisByIdAtom).a).toBeDefined();
    expect(store.get(analysisByIdAtom).b).toBeUndefined();
    expect(store.get(analysisByIdAtom).c).toBeDefined();
  });
});

describe("selectedNodeIdAtom", () => {
  it("defaults to null and round-trips a set", () => {
    const store = createStore();
    expect(store.get(selectedNodeIdAtom)).toBeNull();
    store.set(selectedNodeIdAtom, "flatten:experiment");
    expect(store.get(selectedNodeIdAtom)).toBe("flatten:experiment");
  });
});

describe("table pool atoms", () => {
  it("activeTableAtom follows the Data-tab selection; analysisTableAtom follows the active plottable's tableId", () => {
    const store = createStore();
    const wt = (id: string) => ({ id, name: id, schema: SCHEMA,
      hierarchy: { spine: [], fn: {} },
      handle: { id: `h_${id}`, n: 1, version: 0, schema: SCHEMA, counts: {} as never } });
    store.set(tablesAtom, [wt("cells"), wt("annot")]);
    store.set(activeTableIdAtom, "annot");
    const p = { ...makeDefaultPlottable(SCHEMA), tableId: "cells" } as never;
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, (p as { id: string }).id);
    expect(store.get(activeTableAtom)?.id).toBe("annot");
    expect(store.get(analysisTableAtom)?.id).toBe("cells");
  });
});

describe("per-analysis collapse plan + test grain", () => {
  /* a store with the given spine: a schema whose columns include the spine dims
     as identifiers + a numeric measure, a hierarchy of that spine, and one active
     plottable. Mirrors makeDefaultPlottable for the plottable defaults. */
  function makeStoreWithSpine(spine: string[]) {
    const store = createStore();
    const schema: Schema = { schema_version: "1.0", columns: [
      ...spine.map((d) => ({ name: d, type: "identifier" as const, label: d })),
      { name: "val", type: "numeric" as const, label: "Value" },
    ] };
    store.set(schemaAtom, schema);
    store.set(hierarchyAtom, { spine, fn: {} });
    const p = makeDefaultPlottable(schema);
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, p.id);
    return store;
  }

  it("effectivePlanAtom defaults to the full-spine prefix chain", () => {
    const store = makeStoreWithSpine(["experiment", "cell"]);
    expect(store.get(effectivePlanAtom)).toEqual([
      { keep: ["experiment", "cell"], fn: "mean" },
      { keep: ["experiment"], fn: "mean" },
    ]);
  });

  it("effectiveTestGrainAtom defaults to the coarsest (last) node", () => {
    const store = makeStoreWithSpine(["experiment", "cell"]);
    expect(store.get(effectiveTestGrainAtom)).toBe("experiment");
  });

  it("effectiveTestGrainAtom clamps a stale grain dropped by a plan edit", () => {
    const store = makeStoreWithSpine(["experiment", "cell"]);
    store.set(setTestGrainAtom, "experiment/cell");
    expect(store.get(effectiveTestGrainAtom)).toBe("experiment/cell");
    // shrink the plan so "experiment/cell" is no longer a node
    store.set(setCollapsePlanAtom, [{ keep: ["experiment"], fn: "mean" }]);
    expect(store.get(effectiveTestGrainAtom)).toBe("experiment");
  });

  it("setTestGrain/setCollapsePlan write the active plottable; reset clears them", () => {
    const store = makeStoreWithSpine(["experiment", "cell"]);
    store.set(setTestGrainAtom, "experiment/cell");
    expect(store.get(activePlottableAtom)?.testGrain).toBe("experiment/cell");
    store.set(resetCollapseAtom);
    expect(store.get(activePlottableAtom)?.collapse).toBeUndefined();
    expect(store.get(activePlottableAtom)?.testGrain).toBeUndefined();
  });

  it("buildSpec records the collapse plan + test grain as-is; plottableFromSpec reads them back", () => {
    const store = makeStoreWithSpine(["experiment", "cell"]);
    const plan = [{ keep: ["experiment", "cell"], fn: "median" as const }];
    store.set(setCollapsePlanAtom, plan);
    store.set(setTestGrainAtom, "experiment/cell");
    const p = store.get(activePlottableAtom)!;
    const spec = buildSpec(p, "group_comparison", undefined, {}, store.get(hierarchyAtom));
    expect(spec.collapse).toEqual(plan);
    expect(spec.test_grain).toBe("experiment/cell");
    const back = plottableFromSpec(spec);
    expect(back.collapse).toEqual(plan);
    expect(back.testGrain).toBe("experiment/cell");
  });

  it("plottableFromSpec leaves collapse/testGrain undefined when the spec omits them", () => {
    const back = plottableFromSpec(makeSpec("plain"));
    expect(back.collapse).toBeUndefined();
    expect(back.testGrain).toBeUndefined();
  });
});

describe("makeStep — valid blanks for every reduce kind", () => {
  it("builds the right blank for each kind, each with a _key", () => {
    expect(makeStep("drop")).toMatchObject({ kind: "drop", columns: [] });
    expect(makeStep("filter")).toMatchObject({ kind: "filter", conditions: [] });
    expect(makeStep("derive")).toMatchObject({ kind: "derive", column: "", expr: "" });
    expect(makeStep("recode")).toMatchObject({ kind: "recode", column: "", map: {} });
    expect(makeStep("pivot")).toMatchObject({
      kind: "pivot", index: [], column: "", values: "", agg: "sum", fill: 0, names: {},
    });
    expect(makeStep("grid_complete")).toMatchObject({
      kind: "grid_complete", by: [], column: "", levels: [], count: true,
      count_unique: null, fill: 0, count_name: "n",
    });
    // join starts with an EMPTY right (the unfilled "missing input" sentinel)
    const j = makeStep("join");
    expect(j).toMatchObject({ kind: "join", on: [], how: "inner" });
    expect(j.kind === "join" && j.right.schema.columns).toEqual([]);

    for (const k of ["drop", "filter", "derive", "recode", "pivot", "grid_complete", "join"] as const) {
      expect(makeStep(k)._key).toBeTruthy();
    }
  });
});

describe("step writers — insert, and reduce.post preservation", () => {
  /* an active plottable carrying both a steps chain and a post phase. */
  function makeStoreWithPost() {
    const store = createStore();
    const schema: Schema = { schema_version: "1.0", columns: [
      { name: "val", type: "numeric", label: "Value" },
    ] };
    store.set(schemaAtom, schema);
    const p = {
      ...makeDefaultPlottable(schema),
      reduce: {
        steps: [makeStep("filter"), makeStep("drop")],
        post: [makeStep("derive")],
      },
    };
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, p.id);
    return store;
  }

  it("insertStepAtom splices after the given index", () => {
    const store = makeStoreWithPost();
    store.set(insertStepAtom, { afterIndex: 0, kind: "filter" });
    const steps = store.get(activePlottableAtom)!.reduce.steps;
    expect(steps.map((s) => s.kind)).toEqual(["filter", "filter", "drop"]);
  });

  it("insertStepAtom after the last index appends", () => {
    const store = makeStoreWithPost();
    store.set(insertStepAtom, { afterIndex: 1, kind: "derive" });
    const steps = store.get(activePlottableAtom)!.reduce.steps;
    expect(steps.map((s) => s.kind)).toEqual(["filter", "drop", "derive"]);
  });

  it("every step writer preserves reduce.post", () => {
    const post = (s: ReturnType<typeof createStore>) =>
      s.get(activePlottableAtom)!.reduce.post?.map((x) => x.kind);

    let store = makeStoreWithPost();
    store.set(addStepAtom, "drop");
    expect(post(store)).toEqual(["derive"]);

    store = makeStoreWithPost();
    store.set(insertStepAtom, { afterIndex: 0, kind: "filter" });
    expect(post(store)).toEqual(["derive"]);

    store = makeStoreWithPost();
    store.set(updateStepAtom, { index: 0, step: makeStep("drop") });
    expect(post(store)).toEqual(["derive"]);

    store = makeStoreWithPost();
    store.set(removeStepAtom, 1);
    expect(post(store)).toEqual(["derive"]);

    store = makeStoreWithPost();
    store.set(moveStepAtom, { index: 0, dir: 1 });
    expect(post(store)).toEqual(["derive"]);
  });
});

describe("runnableSteps — unfilled joins are skipped on the run path", () => {
  const filledRight: Table = { schema: { schema_version: "1.0", columns: [
    { name: "cell_id", type: "identifier", label: "Cell" },
  ] }, rows: [] };

  it("drops a join whose right is the empty sentinel, keeps everything else", () => {
    const steps: ReduceStep[] = [makeStep("filter"), makeStep("join")];
    expect(steps[1].kind === "join" && steps[1].right).toBe(EMPTY_RIGHT);
    const out = runnableSteps(steps);
    expect(out.map((s) => s.kind)).toEqual(["filter"]);
  });

  it("keeps a join once its right has columns", () => {
    const join: ReduceStep = { ...makeStep("join"), right: filledRight } as ReduceStep;
    const out = runnableSteps([makeStep("filter"), join]);
    expect(out.map((s) => s.kind)).toEqual(["filter", "join"]);
  });

  it("buildSpec excludes an unfilled join from the engine request", () => {
    const p = {
      ...makeDefaultPlottable(SCHEMA), mappings: { x: "grp", y: "val" },
      reduce: { steps: [makeStep("filter"), makeStep("join")] },
    };
    const spec = buildSpec(p, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY);
    expect(spec.reduce.steps.map((s) => s.kind)).toEqual(["filter"]);

    const pFilled = {
      ...makeDefaultPlottable(SCHEMA), mappings: { x: "grp", y: "val" },
      reduce: { steps: [makeStep("filter"), { ...makeStep("join"), right: filledRight } as ReduceStep] },
    };
    const specFilled = buildSpec(pFilled, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY);
    expect(specFilled.reduce.steps.map((s) => s.kind)).toEqual(["filter", "join"]);
  });
});
