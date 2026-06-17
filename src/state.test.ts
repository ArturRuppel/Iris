import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import type { AnalysisSpec, AnalyzeResponse, Schema } from "./types";
import {
  activePlottableIdAtom, analysisByIdAtom, analysisKeyByIdAtom,
  analysisRecencyAtom, cacheBudgetAtom, cacheKey, estimateBytes,
  isSpecRenderable, pickStaleSpec, setAnalysisResultAtom,
} from "./state";

/* a minimal renderable spec: a Y encoding and one layer. Toggle `y`/`layers`/`x`
   to exercise the renderable gate; `tag` lets a test mutate the spec so its key
   changes (simulating a config edit). */
function makeSpec(id: string, opts: {
  y?: boolean; layers?: number; xCol?: string | null; tag?: string;
} = {}): AnalysisSpec {
  return {
    spec_version: "2.0", id, title: opts.tag ?? id,
    data: { filter: [], respect_exclusions: true },
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
      family: "group_comparison", test: "welch_t", chosen_by: "default",
      override: null, alternatives_offered: [], assumption_checks: [],
      alpha: 0.05, report: [],
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
