import { describe, it, expect } from "vitest";
import type { Schema } from "./types";
import { byId, upsertTable, seedTableName, type WorkspaceTable } from "./tables";

const S: Schema = { schema_version: "1.0", columns: [{ name: "v", type: "numeric", label: "V" }] };
const mk = (id: string): WorkspaceTable =>
  ({ id, name: id, schema: S, hierarchy: { spine: [], fn: {} },
     handle: { id: `h_${id}`, n: 1, version: 0, schema: S, counts: {} as never } });

describe("table pool helpers", () => {
  it("byId finds a table or returns null", () => {
    const pool = [mk("a"), mk("b")];
    expect(byId(pool, "b")?.id).toBe("b");
    expect(byId(pool, "z")).toBeNull();
    expect(byId(pool, null)).toBeNull();
  });
  it("upsertTable appends a new id and replaces an existing one (immutably)", () => {
    const pool = [mk("a")];
    const added = upsertTable(pool, mk("b"));
    expect(added.map((t) => t.id)).toEqual(["a", "b"]);
    expect(added).not.toBe(pool);
    const replaced = upsertTable(added, { ...mk("a"), name: "A2" });
    expect(replaced.find((t) => t.id === "a")!.name).toBe("A2");
    expect(replaced.map((t) => t.id)).toEqual(["a", "b"]);   // order preserved
  });
  it("seedTableName makes a unique, filename-derived name", () => {
    expect(seedTableName([], "cells.csv")).toBe("cells");
    expect(seedTableName([mk("cells")], "cells.csv")).toBe("cells_2");
    expect(seedTableName([], undefined)).toBe("table_1");
  });
});
