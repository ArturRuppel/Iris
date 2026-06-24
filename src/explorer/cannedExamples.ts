import type { EdgeKind } from "./graph";

export interface MiniTable { cols: string[]; rows: (string | number)[][] }
export interface CannedExample { before: MiniTable; after: MiniTable; caption: string }

/* Fixed, authored before/after schematics — identical every render, no curation
   logic. One pair per op kind; doubles as documentation. Mirrors the 02/05/06
   mockup tables. */
export const CANNED: Partial<Record<EdgeKind, CannedExample>> = {
  filter: {
    before: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c2", 98.0], ["c3", 1.7]] },
    after: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c3", 1.7]] },
    caption: "Keep only rows passing the predicate (here a p99 cap drops c2).",
  },
  drop: {
    before: { cols: ["cell", "area", "speed"], rows: [["c1", 540, 2.1], ["c2", 610, 1.8]] },
    after: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c2", 1.8]] },
    caption: "Remove a column; rows are untouched.",
  },
  derive: {
    before: { cols: ["cell", "perimeter", "area"], rows: [["c1", 88, 540], ["c2", 102, 610]] },
    after: { cols: ["cell", "perimeter", "area", "q"], rows: [["c1", 88, 540, 3.8], ["c2", 102, 610, 4.1]] },
    caption: "Add a column computed elementwise from existing ones (q = perimeter/√area).",
  },
  recode: {
    before: { cols: ["cell", "class"], rows: [["c1", 0], ["c2", 1], ["c3", 0]] },
    after: { cols: ["cell", "class"], rows: [["c1", "non-div"], ["c2", "dividing"], ["c3", "non-div"]] },
    caption: "Relabel a categorical's levels (0→non-div, 1→dividing); unmapped pass through.",
  },
  join: {
    before: { cols: ["experiment", "cell", "speed"], rows: [["E1", "c1", 2.1], ["E1", "c2", 1.8]] },
    after: { cols: ["experiment", "cell", "speed", "class"], rows: [["E1", "c1", 2.1, "non-div"], ["E1", "c2", 1.8, "dividing"]] },
    caption: "Align a second table on the shared axis path and add its columns.",
  },
  pivot: {
    before: { cols: ["cell", "feature", "measure"], rows: [["c1", "perimeter", 88], ["c1", "area", 540], ["c1", "speed", 2.1], ["c2", "perimeter", 102], ["c2", "area", 610], ["c2", "speed", 1.8]] },
    after: { cols: ["cell", "perimeter", "area", "speed"], rows: [["c1", 88, 540, 2.1], ["c2", 102, 610, 1.8]] },
    caption: "Unstack a categorical axis: each level becomes a named column (long→wide).",
  },
  grid_complete: {
    before: { cols: ["position", "transition"], rows: [["p1", "A→B"], ["p1", "A→B"], ["p1", "B→C"], ["p2", "A→B"]] },
    after: { cols: ["position", "transition", "count"], rows: [["p1", "A→B", 2], ["p1", "B→C", 1], ["p1", "C→A", 0], ["p2", "A→B", 1], ["p2", "B→C", 0], ["p2", "C→A", 0]] },
    caption: "Densify a ragged axis to the full declared grid; absent combos become honest 0s.",
  },
  collapse: {
    before: { cols: ["cell", "frame", "speed"], rows: [["c1", 1, 2.0], ["c1", 2, 2.2], ["c2", 1, 1.7]] },
    after: { cols: ["cell", "speed"], rows: [["c1", 2.1], ["c2", 1.7]] },
    caption: "Aggregate over the innermost axis (median over frame), one value per group.",
  },
};

export function cannedExample(kind: EdgeKind): CannedExample | null {
  return CANNED[kind] ?? null;
}
