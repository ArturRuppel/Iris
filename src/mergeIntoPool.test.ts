import { describe, it, expect } from "vitest";
import { mergeIntoPool, SHARED_SRC } from "./state";
import type { ReduceDag } from "./types";

// two analyses written by a build script, both naming their derive step "s0"
const dagOf = (column: string, expr: string): ReduceDag => ({
  sources: [{ id: "src", tableId: "t" }],
  steps: [{ id: "s0", kind: "derive", column, expr, inputs: ["src"] }],
  output: "s0",
} as unknown as ReduceDag);

describe("mergeIntoPool", () => {
  const empty = { sources: [{ id: SHARED_SRC, tableId: "t" }], steps: [] } as never;

  it("gives a reused id with a different step its own node", () => {
    const a = mergeIntoPool(empty, dagOf("z_um", "z - nucleus_z"));
    const b = mergeIntoPool(a.pool, dagOf("dots", "(z == z) * 1"));
    expect(b.pool.steps).toHaveLength(2);
    expect(b.output).not.toBe("s0");
    const mine = b.pool.steps.find((s) => s.id === b.output) as unknown as { column: string };
    expect(mine.column).toBe("dots");
  });

  it("keeps a genuinely shared step once", () => {
    const a = mergeIntoPool(empty, dagOf("z_um", "z - nucleus_z"));
    const b = mergeIntoPool(a.pool, dagOf("z_um", "z - nucleus_z"));
    expect(b.pool.steps).toHaveLength(1);
    expect(b.output).toBe("s0");
  });
});
