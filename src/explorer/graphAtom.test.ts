import { describe, it, expect } from "vitest";
import { mergeGuards } from "./graphAtom";
import type { Edge } from "./graph";
import type { ShapeCountsGuards } from "../types";

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
        dim: "cell", on: ["cell"], suggested: ["experiment", "position", "cell"],
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

  it("no join_leaf_key entries -> no badge added", () => {
    const out = mergeGuards(joinEdges(), NO_GUARDS);
    expect(out.some((e) => e.guards?.some((g) => g.id === "join_leaf_key"))).toBe(false);
  });
});
