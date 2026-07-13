import { describe, it, expect, afterEach, vi } from "vitest";
import { createStore } from "jotai";
import { dataFingerprint, snapshotStateKey } from "./autosave";
import {
  autosaveBaselineAtom, autosaveKeyAtom, loadDocumentAtom, makeDefaultPlottable,
  dagFromLinear, plottablesAtom, tablesAtom, activePlottableAtom, type Plottable, type WorkspaceTable,
} from "./state";
import type { Schema } from "./types";

const SCHEMA: Schema = {
  schema_version: "1.0",
  columns: [
    { name: "grp", type: "categorical", label: "Group", levels: ["a", "b"] },
    { name: "val", type: "numeric", label: "Value" },
  ],
};

const table = (id = "t1", version = 0): WorkspaceTable => ({
  id, name: id, schema: SCHEMA, hierarchy: { spine: [], fn: {} },
  handle: { id: `sess_${id}`, n: 6, version, schema: SCHEMA, counts: { total: 6 } },
});

const plottable = (over: Partial<Plottable> = {}): Plottable =>
  ({ ...makeDefaultPlottable("t1"), id: "pt_fixed", ...over });

afterEach(() => vi.restoreAllMocks());

describe("snapshotStateKey — the autosave dirtiness signature", () => {
  // Stage 2: the reduce pipeline is table-scoped, so build a plottable's pin
  // (output) plus its table's shared pool from a linear step list, exactly as a
  // load would land it in reduceStoreAtom.
  const withReduce = (steps: unknown[]) => {
    const dag = dagFromLinear("t1", steps as never);
    return {
      p: plottable({ output: dag.output }),
      store: { t1: { sources: dag.sources, steps: dag.steps } },
    };
  };

  it("ignores session-only state: step _key", () => {
    // an explicit node id (not just _key) so both variants land on the SAME id —
    // a real reload preserves the saved DAG node id and only regenerates _key
    // (see adoptReduceDag), so this isolates the _key-only dimension.
    const step = { _key: "sk_1", kind: "drop" as const, columns: ["val"], id: "n0" };
    const a = withReduce([step]);
    const b = withReduce([{ ...step, _key: "sk_other" }]);    // React list key
    expect(snapshotStateKey([a.p], [table()], a.store))
      .toBe(snapshotStateKey([b.p], [table()], b.store));
  });

  it("moves on a real spec edit (mapping, layer, style)", () => {
    const base = plottable();
    const key = snapshotStateKey([base], [table()], {});
    expect(snapshotStateKey([plottable({ mappings: { x: "grp", y: "val" } })], [table()], {}))
      .not.toBe(key);
    expect(snapshotStateKey(
      [plottable({ layers: [{ id: "ly", geom: "dot", level: "" }] })], [table()], {}))
      .not.toBe(key);
    expect(snapshotStateKey([plottable({ style: { title: "T" } })], [table()], {}))
      .not.toBe(key);
  });

  it("moves when the shared reduce pool changes under a plottable", () => {
    const base = plottable();                                 // pins to source, empty pool
    const key = snapshotStateKey([base], [table()], {});
    const edited = withReduce([{ kind: "drop", columns: ["val"], id: "n0", _key: "k" }]);
    expect(snapshotStateKey([edited.p], [table()], edited.store)).not.toBe(key);
  });

  it("moves on a data edit (session version) and a hierarchy edit", () => {
    const p = [plottable()];
    const key = snapshotStateKey(p, [table()], {});
    expect(snapshotStateKey(p, [table("t1", 1)], {})).not.toBe(key);
    const reordered = { ...table(), hierarchy: { spine: ["grp"], fn: {} } };
    expect(snapshotStateKey(p, [reordered], {})).not.toBe(key);
  });
});

describe("dataFingerprint — when the engine must rewrite the .iris data tier", () => {
  it("is stable across spec and hierarchy edits", () => {
    const fp = dataFingerprint([table()]);
    const reordered = { ...table(), hierarchy: { spine: ["grp"], fn: {} } };
    expect(dataFingerprint([reordered])).toBe(fp);
  });

  it("moves on a version bump and on a pool change", () => {
    const fp = dataFingerprint([table()]);
    expect(dataFingerprint([table("t1", 2)])).not.toBe(fp);
    expect(dataFingerprint([table("t1"), table("t2")])).not.toBe(fp);
  });
});

describe("autosave baseline — what counts as unsaved work", () => {
  const lt = (name: string) => ({
    name, id: `h_${name}`, schema: SCHEMA, hierarchy: { spine: [] as string[], fn: {} },
    n: 1, version: 0, counts: { total: 1 }, rows: [],
  });

  it("starts clean on an empty workspace", () => {
    const store = createStore();
    expect(store.get(autosaveKeyAtom)).toBe(store.get(autosaveBaselineAtom));
  });

  it("a document load rebaselines (load-and-quit leaves nothing to restore)", async () => {
    const store = createStore();
    await store.set(loadDocumentAtom, { analyses: [], tables: [lt("cells")] } as never);
    expect(store.get(tablesAtom)).toHaveLength(1);           // state really moved…
    expect(store.get(autosaveKeyAtom)).toBe(store.get(autosaveBaselineAtom)); // …but clean
  });

  it("a restore-from-snapshot (keepDirty) stays dirty", async () => {
    const store = createStore();
    await store.set(loadDocumentAtom,
      { analyses: [], tables: [lt("cells")], keepDirty: true } as never);
    expect(store.get(autosaveKeyAtom)).not.toBe(store.get(autosaveBaselineAtom));
  });

  it("an edit after a clean load goes dirty", async () => {
    const store = createStore();
    await store.set(loadDocumentAtom, { analyses: [], tables: [lt("cells")] } as never);
    const p = store.get(plottablesAtom)[0];
    store.set(activePlottableAtom, { ...p, mappings: { x: "grp", y: "val" } });
    expect(store.get(autosaveKeyAtom)).not.toBe(store.get(autosaveBaselineAtom));
  });
});
