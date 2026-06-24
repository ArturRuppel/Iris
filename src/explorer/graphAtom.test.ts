import { describe, it, expect } from "vitest";
import { mergeGuards, annotateEnabled } from "./graphAtom";
import type { Edge } from "./graph";
import type { ShapeCountsGuards, StyleOverrides } from "../types";

const NO_GUARDS: ShapeCountsGuards = {
  pseudoreplication: null, pairing_flip: null,
  identity_merge: [], post_aggregate_derive: [], join_leaf_key: [],
};

const joinEdges = (): Edge[] => [
  { id: "e:source->step:0", kind: "join", label: "join on Cell", fromId: "source", toId: "step:0" },
  { id: "e:source:0->step:0", kind: "join", label: "join on Cell", fromId: "source:0", toId: "step:0" },
];

describe("mergeGuards: join_leaf_key", () => {
  it("lands one caution on the join, derived from the guard text", () => {
    const guards: ShapeCountsGuards = {
      ...NO_GUARDS,
      join_leaf_key: [{
        step: 0, dim: "cell", on: ["cell"], suggested: ["experiment", "position", "cell"],
        before: "cell", after: "experiment, position, cell", severity: "caution",
        text: "Joining on cell alone, but cell isn't unique without experiment, position …",
      }],
    };
    const out = mergeGuards(joinEdges(), guards);
    const flagged = out.filter((e) => e.guards?.some((g) => g.id === "join_leaf_key"));
    expect(flagged).toHaveLength(1);
    expect(flagged[0].guards?.find((g) => g.id === "join_leaf_key"))
      .toMatchObject({ severity: "caution", text: guards.join_leaf_key[0].text });
  });

  it("lands the caution on the offending join (by step index), not by position", () => {
    // two joins; edges for join 0 (safe) and join 1 (offends). The single verdict
    // carries step:1 and must land on the step:1 join, not step:0.
    const edges: Edge[] = [
      { id: "e:a->step:0", kind: "join", label: "join on X", fromId: "source", toId: "step:0" },
      { id: "e:b->step:0", kind: "join", label: "join on X", fromId: "source:0", toId: "step:0" },
      { id: "e:c->step:1", kind: "join", label: "join on Cell", fromId: "step:0", toId: "step:1" },
      { id: "e:d->step:1", kind: "join", label: "join on Cell", fromId: "source:1", toId: "step:1" },
    ];
    const guards: ShapeCountsGuards = {
      ...NO_GUARDS,
      join_leaf_key: [{
        step: 1, dim: "cell", on: ["cell"], suggested: ["experiment", "position", "cell"],
        before: "cell", after: "experiment, position, cell", severity: "caution",
        text: "Joining on cell alone …",
      }],
    };
    const out = mergeGuards(edges, guards);
    const flagged = out.filter((e) => e.guards?.some((g) => g.id === "join_leaf_key"));
    expect(flagged.every((e) => e.toId === "step:1")).toBe(true);
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(out.filter((e) => e.toId === "step:0")
      .every((e) => !e.guards?.some((g) => g.id === "join_leaf_key"))).toBe(true);
  });

  it("no join_leaf_key entries -> no badge added", () => {
    const out = mergeGuards(joinEdges(), NO_GUARDS);
    expect(out.some((e) => e.guards?.some((g) => g.id === "join_leaf_key"))).toBe(false);
  });
});

describe("annotateEnabled", () => {
  it("is true when show_significance is set", () => {
    expect(annotateEnabled({ show_significance: true } as StyleOverrides)).toBe(true);
  });
  it("is false when show_significance is unset or false", () => {
    expect(annotateEnabled({} as StyleOverrides)).toBe(false);
    expect(annotateEnabled({ show_significance: false } as StyleOverrides)).toBe(false);
  });
});
