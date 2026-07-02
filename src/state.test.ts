import { describe, it, expect, vi, afterEach } from "vitest";
import { createStore } from "jotai";
import type { AnalysisSpec, AnalyzeResponse, Schema } from "./types";
import {
  activePlottableIdAtom, analysisByIdAtom, analysisKeyByIdAtom,
  analysisRecencyAtom, buildSpec, cacheBudgetAtom, cacheKey, estimateBytes,
  isSpecRenderable, makeDefaultPlottable, pickStaleSpec, plottableFromSpec,
  selectedNodeIdAtom, setAnalysisResultAtom,
  schemaAtom, hierarchyAtom, tableHandleAtom, plottablesAtom, activePlottableAtom,
  effectivePlanAtom, effectiveTestGrainAtom,
  setCollapsePlanAtom, setTestGrainAtom, resetCollapseAtom,
  loadTableAtom, setColumnRoleAtom,
  makeStep, addStepAtom, insertStepAtom, updateStepAtom,
  removeStepAtom, moveStepAtom, runnableSteps, resolveEngineSteps, specForSave, resolveSaveSteps, saveTablesFor, materializedTablesAtom,
  tablesNeedingMaterialize,
  tablesAtom, activeTableIdAtom, activeTableAtom, analysisTableAtom,
  activeSchemaAtom,
  addPlottableAtom, loadDocumentAtom,
  undoSpecAtom, redoSpecAtom, specHistoryAtom, specRedoAtom, clearSpecHistoryAtom,
} from "./state";
import type { ReduceStep, Table } from "./types";
import { EMPTY_HIERARCHY, engine } from "./types";

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
    layers: opts.layers === 0 ? [] : [{ geom: "dot", level: "" }],
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
    const spec = buildSpec(p, "location", undefined, {}, EMPTY_HIERARCHY, {});
    expect(spec.stats.family).toBe("location");
    expect(spec.stats.reference).toBe(0);
    expect(spec.stats.test).toBe("one_sample_t");
    // the chance line is defaulted so the figure draws the reference it tests against
    expect(spec.style.overrides.reference_value).toBe(0);
  });

  it("a full save→load→save cycle preserves the location family", () => {
    const loaded = plottableFromSpec(locationSpec());
    const resaved = buildSpec(loaded, "location", undefined, {}, EMPTY_HIERARCHY, {});
    expect(resaved.stats.family).toBe("location");
    expect(resaved.stats.reference).toBe(0);
  });
});

describe("stats block stores decisions only (format redesign)", () => {
  const base = () => ({ ...makeDefaultPlottable(SCHEMA),
                        mappings: { x: "grp", y: "val" } });

  it("buildSpec emits no derived/process fields", () => {
    const spec = buildSpec(base(), "group_comparison", "welch_t", {}, EMPTY_HIERARCHY, {});
    const keys = Object.keys(spec.stats);
    for (const dead of ["chosen_by", "alternatives_offered", "assumption_checks", "report"]) {
      expect(keys).not.toContain(dead);
    }
    expect(spec.spec_version).toBe("2.1");
  });

  it("describe_only is a stored decision and round-trips", () => {
    const p = { ...base(), describeOnly: true };
    const spec = buildSpec(p, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY, {});
    expect(spec.stats.describe_only).toBe(true);
    expect(plottableFromSpec(spec).describeOnly).toBe(true);
  });

  it("describe_only is omitted (not false) when the user did not choose it", () => {
    const spec = buildSpec(base(), "group_comparison", "welch_t", {}, EMPTY_HIERARCHY, {});
    expect("describe_only" in spec.stats).toBe(false);
    expect(plottableFromSpec(spec).describeOnly).toBe(false);
  });

  it("override round-trips independently of the recommendation", () => {
    const p = { ...base(), override: "mann_whitney" as const };
    const spec = buildSpec(p, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY, {});
    expect(spec.stats.override).toBe("mann_whitney");
    expect(plottableFromSpec(spec).override).toBe("mann_whitney");
  });
});

describe("specForSave — save joins by reference (Plan B 2.1)", () => {
  it("serializes a filled join as a right_table_id reference and sets table_id", () => {
    const p = { ...makeDefaultPlottable(SCHEMA, "cells"),
      reduce: { steps: [{ ...makeStep("join"), rightTableId: "annot", on: ["k"] }] } } as never;
    const spec = specForSave(p, "group_comparison", "welch_t", {}, { spine: [], fn: {} }, {});
    // the analysis records which pool table it roots in
    expect(spec.table_id).toBe("cells");
    // the join references its right by pool id — NO inline rows
    expect(spec.reduce.steps[0]).toMatchObject({ kind: "join", on: ["k"], right_table_id: "annot" });
    expect("right" in spec.reduce.steps[0]).toBe(false);
  });

  it("resolveSaveSteps drops UNSET joins and keeps filled ones as references", () => {
    const unset: ReduceStep[] = [{ ...makeStep("join"), rightTableId: "", on: ["k"] } as ReduceStep];
    expect(resolveSaveSteps(unset)).toEqual([]);
    const filled: ReduceStep[] = [{ ...makeStep("join"), rightTableId: "annot", on: ["k"] } as ReduceStep];
    expect(resolveSaveSteps(filled))
      .toEqual([{ kind: "join", on: ["k"], how: "inner", right_table_id: "annot" }]);
  });
});

describe("saveTablesFor — the save table pool (Plan B 2.1)", () => {
  it("collects each rooted/joined pool table once, as {name, table_id, hierarchy}", () => {
    const wt = (id: string) => ({ id, name: id, schema: SCHEMA,
      hierarchy: { spine: [id], fn: {} },
      handle: { id: `h_${id}`, n: 1, version: 0, schema: SCHEMA, counts: {} as never } });
    const pool = [wt("cells"), wt("annot")];
    // two analyses both rooted in cells; the first also joins annot
    const p1 = { ...makeDefaultPlottable(SCHEMA, "cells"),
      reduce: { steps: [{ ...makeStep("join"), rightTableId: "annot", on: ["k"] }] } } as never;
    const p2 = { ...makeDefaultPlottable(SCHEMA, "cells") } as never;
    expect(saveTablesFor([p1, p2], pool)).toEqual([
      { name: "cells", table_id: "h_cells", hierarchy: { spine: ["cells"], fn: {} } },
      { name: "annot", table_id: "h_annot", hierarchy: { spine: ["annot"], fn: {} } },
    ]);
  });

  it("saves a table referenced ONLY as a join right (no analysis roots in it)", () => {
    const wt = (id: string) => ({ id, name: id, schema: SCHEMA,
      hierarchy: { spine: [id], fn: {} },
      handle: { id: `h_${id}`, n: 1, version: 0, schema: SCHEMA, counts: {} as never } });
    const pool = [wt("main"), wt("lookup")];
    // the only analysis roots in main and joins lookup; nothing ever roots in lookup.
    const p = { ...makeDefaultPlottable(SCHEMA, "main"),
      reduce: { steps: [{ ...makeStep("join"), rightTableId: "lookup", on: ["k"] }] } } as never;
    const tables = saveTablesFor([p], pool);
    // lookup must still be saved, else its join reference dangles on reload.
    expect(tables.map((t) => t.name)).toEqual(["main", "lookup"]);
    expect(tables.find((t) => t.name === "lookup")?.table_id).toBe("h_lookup");
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
    const p = { ...makeDefaultPlottable(SCHEMA), tableId: "cells" };
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, p.id);
    expect(store.get(activeTableAtom)?.id).toBe("annot");
    expect(store.get(analysisTableAtom)?.id).toBe("cells");
  });

  it("makeDefaultPlottable seeds tableId from the most-recently-imported pool table", () => {
    const store = createStore();
    const wt = (id: string) => ({ id, name: id, schema: SCHEMA,
      hierarchy: { spine: [], fn: {} },
      handle: { id: `h_${id}`, n: 1, version: 0, schema: SCHEMA, counts: {} as never } });
    store.set(tablesAtom, [wt("cells"), wt("annot")]);
    // makeDefaultPlottable takes the seed id explicitly (pure); the writer passes the last pool id.
    expect(makeDefaultPlottable(SCHEMA, "annot").tableId).toBe("annot");
    expect(makeDefaultPlottable(SCHEMA).tableId).toBe("");   // no pool → empty, resolved later
  });
});

describe("single-table globals derive off the active analysis's pool table", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("schemaAtom/hierarchyAtom/tableHandleAtom reflect the active analysis's pool table", () => {
    const store = createStore();
    const S2: Schema = { schema_version: "1.0", columns: [{ name: "x", type: "numeric", label: "X" }] };
    const wt = (id: string, s: Schema) => ({ id, name: id, schema: s,
      hierarchy: { spine: [id], fn: {} },
      handle: { id: `h_${id}`, n: 5, version: 1, schema: s, counts: {} as never } });
    store.set(tablesAtom, [wt("cells", SCHEMA), wt("annot", S2)]);
    const p = { ...makeDefaultPlottable(SCHEMA, "annot"), tableId: "annot" };
    store.set(plottablesAtom, [p]); store.set(activePlottableIdAtom, p.id);
    expect(store.get(schemaAtom)).toBe(S2);
    expect(store.get(tableHandleAtom)?.id).toBe("h_annot");
    expect(store.get(hierarchyAtom).spine).toEqual(["annot"]);
  });

  it("active* atoms follow the Data-tab selection, independent of the active analysis's table", () => {
    const store = createStore();
    const S2: Schema = { schema_version: "1.0", columns: [{ name: "x", type: "numeric", label: "X" }] };
    const wt = (id: string, s: Schema) => ({ id, name: id, schema: s, hierarchy: { spine: [id], fn: {} },
      handle: { id: `h_${id}`, n: 1, version: 0, schema: s, counts: {} as never } });
    store.set(tablesAtom, [wt("cells", SCHEMA), wt("annot", S2)]);
    store.set(activeTableIdAtom, "annot");                 // Data tab on annot
    const p = { ...makeDefaultPlottable(SCHEMA, "cells") };  // active analysis on cells
    store.set(plottablesAtom, [p]); store.set(activePlottableIdAtom, p.id);
    expect(store.get(activeSchemaAtom)).toBe(S2);          // Data-tab table
    expect(store.get(schemaAtom)).toBe(SCHEMA);            // analysis table — different
  });

  it("loadTableAtom appends to the pool, selects it, and seeds an analysis bound to it", async () => {
    const store = createStore();
    vi.spyOn(engine, "createSession").mockResolvedValue(
      { id: "h1", n: 2, version: 0, schema: SCHEMA, counts: { total: 2 } as never });
    await store.set(loadTableAtom, { schema: SCHEMA, rows: [], token: undefined } as never);
    const pool = store.get(tablesAtom);
    expect(pool).toHaveLength(1);
    expect(store.get(activeTableIdAtom)).toBe(pool[0].id);
    expect(store.get(activePlottableAtom)?.tableId).toBe(pool[0].id);
  });

  it("setColumnRoleAtom edits the ACTIVE pool table's schema and leaves other tables untouched", async () => {
    const store = createStore();
    const S2: Schema = { schema_version: "1.0", columns: [{ name: "x", type: "numeric", label: "X" }] };
    const wt = (id: string, s: Schema) => ({ id, name: id, schema: s,
      hierarchy: { spine: [], fn: {} },
      handle: { id: `h_${id}`, n: 1, version: 0, schema: s, counts: {} as never } });
    store.set(tablesAtom, [wt("cells", SCHEMA), wt("annot", S2)]);
    store.set(activeTableIdAtom, "cells");
    const annot0 = store.get(tablesAtom).find((t) => t.id === "annot")!;
    // the retyped schema is pushed to the engine session; the bumped version
    // flows onto the handle so the analyze cache invalidates and re-infers.
    const setSchema = vi.spyOn(engine, "setSchema").mockImplementation(
      async (_id, schema) => ({ version: 1, schema, counts: {} as never }));
    // grp -> identifier: not categorical, so no engine.distinct re-fetch.
    await store.set(setColumnRoleAtom, { name: "grp", role: "identifier" });
    const pool = store.get(tablesAtom);
    const cells = pool.find((t) => t.id === "cells")!;
    expect(cells.schema.columns.find((c) => c.name === "grp")?.type).toBe("identifier");
    expect(cells.hierarchy.spine).toEqual(["grp"]);
    // the engine session got the retyped schema and the handle took its new version
    expect(setSchema).toHaveBeenCalledWith("h_cells",
      expect.objectContaining({ columns: expect.arrayContaining([
        expect.objectContaining({ name: "grp", type: "identifier" })]) }));
    expect(cells.handle.version).toBe(1);
    // the non-active table is referentially unchanged
    expect(pool.find((t) => t.id === "annot")).toBe(annot0);
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
    store.set(tablesAtom, [{ id: "main", name: "main", schema,
      hierarchy: { spine, fn: {} },
      handle: { id: "h_main", n: 0, version: 0, schema, counts: {} as never } }]);
    store.set(activeTableIdAtom, "main");
    const p = makeDefaultPlottable(schema, "main");
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

  it("addPlottable binds the new analysis to the active analysis's table (not unbound)", () => {
    const store = makeStoreWithSpine(["experiment", "cell"]);
    store.set(addPlottableAtom);
    const added = store.get(activePlottableAtom)!;
    expect(added.tableId).toBe("main");
    // the new analysis resolves to a real table, not a blank schema
    expect(store.get(analysisTableAtom)?.id).toBe("main");
    expect(store.get(schemaAtom)).not.toBeNull();
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
    const spec = buildSpec(p, "group_comparison", undefined, {}, store.get(hierarchyAtom), {});
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
    expect(makeStep("recode")).toMatchObject({ kind: "recode", column: "", map: [] });
    expect(makeStep("pivot")).toMatchObject({
      kind: "pivot", index: [], column: "", values: "", agg: "sum", fill: 0, names: [],
    });
    expect(makeStep("grid_complete")).toMatchObject({
      kind: "grid_complete", by: [], column: "", levels: [],
      count_unique: null, fill: 0, count_name: "n",
    });
    // join starts with an empty rightTableId (the unfilled "missing input" reference)
    const j = makeStep("join");
    expect(j).toMatchObject({ kind: "join", on: [], how: "inner", rightTableId: "" });

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

describe("runnableSteps / resolveEngineSteps — joins resolve at the engine boundary", () => {
  const right: Table = { schema: { schema_version: "1.0", columns: [
    { name: "k", type: "identifier", label: "K" },
  ] }, rows: [{ id: "1", k: "a" }] };
  const cache = { annot: { version: 0, table: right } };

  it("runnableSteps drops a join whose rightTableId is unset or not materialized", () => {
    expect(runnableSteps([makeStep("filter"), makeStep("join")], {}).map((s) => s.kind))
      .toEqual(["filter"]);
    // set id but not materialized -> still dropped
    const dangling: ReduceStep[] = [{ ...makeStep("join"), rightTableId: "missing" } as ReduceStep];
    expect(runnableSteps(dangling, cache).map((s) => s.kind)).toEqual([]);
  });

  it("runnableSteps keeps a join once its right is materialized", () => {
    const steps: ReduceStep[] = [makeStep("filter"),
      { ...makeStep("join"), rightTableId: "annot" } as ReduceStep];
    expect(runnableSteps(steps, cache).map((s) => s.kind)).toEqual(["filter", "join"]);
  });

  it("resolveEngineSteps inlines a materialized right table", () => {
    const steps: ReduceStep[] = [{ ...makeStep("join"), rightTableId: "annot", on: ["k"] } as ReduceStep];
    const out = resolveEngineSteps(steps, cache);
    expect(out[0]).toMatchObject({ kind: "join", on: ["k"], right });
  });

  it("buildSpec excludes an unset join and inlines a materialized one", () => {
    const p = {
      ...makeDefaultPlottable(SCHEMA), mappings: { x: "grp", y: "val" },
      reduce: { steps: [makeStep("filter"), makeStep("join")] },
    };
    const spec = buildSpec(p, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY, {});
    expect(spec.reduce.steps.map((s) => s.kind)).toEqual(["filter"]);

    const pFilled = {
      ...makeDefaultPlottable(SCHEMA), mappings: { x: "grp", y: "val" },
      reduce: { steps: [makeStep("filter"),
        { ...makeStep("join"), rightTableId: "annot", on: ["k"] } as ReduceStep] },
    };
    const specFilled = buildSpec(pFilled, "group_comparison", "welch_t", {}, EMPTY_HIERARCHY, cache);
    expect(specFilled.reduce.steps.map((s) => s.kind)).toEqual(["filter", "join"]);
    const joinStep = specFilled.reduce.steps[1];
    expect(joinStep).toMatchObject({ kind: "join", right });
  });

  it("materializedTablesAtom feeds specAtom-style resolution through buildSpec", () => {
    const store = createStore();
    store.set(materializedTablesAtom, cache);
    expect(store.get(materializedTablesAtom).annot.table).toBe(right);
  });

  it("tablesNeedingMaterialize lists referenced tables missing or stale in the cache", () => {
    const wt = (id: string, version: number) => ({ id, name: id, schema: SCHEMA,
      hierarchy: { spine: [], fn: {} },
      handle: { id: `h_${id}`, n: 3, version, schema: SCHEMA, counts: {} as never } });
    const pool = [wt("cells", 1), wt("annot", 2)];
    const join = { ...makeStep("join"), rightTableId: "annot" };
    const p = { ...makeDefaultPlottable(SCHEMA, "cells"),
      reduce: { steps: [join] } } as never;
    // cache empty → annot needs fetch (cells is not referenced by a join)
    expect(tablesNeedingMaterialize(pool, [p], {}).map((t) => t.id)).toEqual(["annot"]);
    // cache has annot at the WRONG version → still stale
    expect(tablesNeedingMaterialize(pool, [p],
      { annot: { version: 1, table: { schema: SCHEMA, rows: [] } } }).map((t) => t.id)).toEqual(["annot"]);
    // cache has annot at the CURRENT version (2) → nothing needed
    expect(tablesNeedingMaterialize(pool, [p],
      { annot: { version: 2, table: { schema: SCHEMA, rows: [] } } })).toEqual([]);
  });
});

describe("loadDocumentAtom — full-pool rebuild, joins bound by reference", () => {
  // one entry of the load response's tables[]; the session (id) holds every row.
  const lt = (name: string, hierarchy = { spine: [] as string[], fn: {} }) => ({
    name, id: `h_${name}`, schema: SCHEMA, hierarchy,
    n: 1, version: 0, counts: { total: 1 }, rows: [],
  });

  it("(2.1) rebuilds the full pool and binds joins by reference — no migration", async () => {
    const store = createStore();
    const createSession = vi.spyOn(engine, "createSession").mockResolvedValue(
      { id: "x", n: 0, version: 0, schema: SCHEMA, counts: { total: 0 } } as never);
    // analysis 1 roots in cells and joins annot by reference; analysis 2 roots in annot.
    const a1 = { ...makeSpec("a1", { xCol: "grp" }), table_id: "cells",
      reduce: { steps: [{ kind: "join", on: ["k"], how: "inner", right_table_id: "annot" }] } } as never;
    const a2 = { ...makeSpec("a2", { xCol: "grp" }), table_id: "annot" } as never;
    await store.set(loadDocumentAtom,
      { analyses: [a1, a2], tables: [lt("cells"), lt("annot")] } as never);
    const pool = store.get(tablesAtom);
    expect(pool.map((t) => t.id)).toEqual(["cells", "annot"]);     // the whole pool, rebuilt
    const ps = store.get(plottablesAtom);
    expect(ps[0].tableId).toBe("cells");
    const join = ps[0].reduce.steps[0];
    expect(join.kind === "join" && join.rightTableId).toBe("annot");
    expect(ps[1].tableId).toBe("annot");
    expect(createSession).not.toHaveBeenCalled();                  // references need no migration
  });

  it("(2.1) warns and falls back to pool[0] when an analysis's table_id is not in tables[]", async () => {
    const store = createStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(engine, "createSession").mockResolvedValue(
      { id: "x", n: 0, version: 0, schema: SCHEMA, counts: { total: 0 } } as never);
    // the analysis references "ghost", which the doc never ships.
    const a = { ...makeSpec("a", { xCol: "grp" }), table_id: "ghost" } as never;
    await store.set(loadDocumentAtom, { analyses: [a], tables: [lt("cells")] } as never);
    const pool = store.get(tablesAtom);
    expect(pool.map((t) => t.id)).toEqual(["cells"]);        // does not throw; pool intact
    expect(store.get(plottablesAtom)[0].tableId).toBe("cells");   // bound to pool[0]
    expect(warn).toHaveBeenCalled();                         // the dangling ref is surfaced
    warn.mockRestore();
  });

  it("REPLACES the workspace (no orphan tables / stale cache from a prior load)", async () => {
    const store = createStore();
    // a prior import left a table + a stale materialized entry in the pool
    store.set(tablesAtom, [{ id: "old", name: "old", schema: SCHEMA,
      hierarchy: { spine: [], fn: {} },
      handle: { id: "h_old", n: 1, version: 0, schema: SCHEMA, counts: {} as never } }]);
    store.set(materializedTablesAtom, { old: { version: 0, table: { schema: SCHEMA, rows: [] } } });
    await store.set(loadDocumentAtom,
      { analyses: [makeSpec("a", { xCol: "grp" })], tables: [lt("table_1")] } as never);
    const pool = store.get(tablesAtom);
    expect(pool.map((t) => t.id)).not.toContain("old");            // the orphan is gone
    expect(pool.length).toBe(1);                                   // just the loaded doc's table
    expect(store.get(materializedTablesAtom)).toEqual({});         // stale cache cleared
  });
});

describe("undo history — spec mutations only", () => {
  const seedActive = () => {
    const store = createStore();
    const p = makeDefaultPlottable(SCHEMA);
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, p.id);
    return { store, p };
  };

  it("records a spec edit and undo restores it; redo reapplies", () => {
    const { store, p } = seedActive();
    store.set(addStepAtom, "filter");                       // a spec mutation
    expect(store.get(activePlottableAtom)?.reduce.steps).toHaveLength(1);
    expect(store.get(specHistoryAtom)).toHaveLength(1);

    store.set(undoSpecAtom);
    expect(store.get(activePlottableAtom)?.reduce.steps).toHaveLength(0);
    expect(store.get(activePlottableAtom)?.id).toBe(p.id);
    expect(store.get(specHistoryAtom)).toHaveLength(0);
    expect(store.get(specRedoAtom)).toHaveLength(1);

    store.set(redoSpecAtom);
    expect(store.get(activePlottableAtom)?.reduce.steps).toHaveLength(1);
    expect(store.get(specRedoAtom)).toHaveLength(0);
  });

  it("does NOT record a style-only edit", () => {
    const { store } = seedActive();
    const cur = store.get(activePlottableAtom)!;
    store.set(activePlottableAtom, { ...cur, style: { overrides: { foo: 1 } } } as never);
    expect(store.get(specHistoryAtom)).toHaveLength(0);   // style is excluded
    // canUndo (the read half) is false
    expect(store.get(undoSpecAtom)).toBe(false);
  });

  it("undo reverts the spec but KEEPS a style edit made afterwards", () => {
    const { store } = seedActive();
    store.set(addStepAtom, "filter");                       // spec edit (captured)
    const afterStep = store.get(activePlottableAtom)!;
    store.set(activePlottableAtom,                          // style edit (not captured)
      { ...afterStep, style: { overrides: { color: "red" } } } as never);
    store.set(undoSpecAtom);                                // undo the step
    const now = store.get(activePlottableAtom)!;
    expect(now.reduce.steps).toHaveLength(0);               // structure reverted
    expect(now.style).toEqual({ overrides: { color: "red" } });  // styling preserved
  });

  it("a fresh spec edit prunes the redo branch", () => {
    const { store } = seedActive();
    store.set(addStepAtom, "filter");
    store.set(undoSpecAtom);
    expect(store.get(specRedoAtom)).toHaveLength(1);
    store.set(addStepAtom, "drop");                        // new edit after undo
    expect(store.get(specRedoAtom)).toHaveLength(0);       // redo branch dropped
  });

  it("clearSpecHistoryAtom empties both stacks (analysis switch)", () => {
    const { store } = seedActive();
    store.set(addStepAtom, "filter");
    store.set(undoSpecAtom);
    store.set(clearSpecHistoryAtom);
    expect(store.get(specHistoryAtom)).toHaveLength(0);
    expect(store.get(specRedoAtom)).toHaveLength(0);
  });
});
