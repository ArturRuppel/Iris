import type { Hierarchy, Schema } from "./types";
import { RAW_LEVEL } from "./types";

/* The data levels a consumer (the reduced-table preview, a figure layer) can
   draw from: the raw reduced rows plus each spine column's grain, coarsest →
   finest. Labels come from the schema so "position_id" reads as its column
   label. */
export function levelOptions(
  hierarchy: Hierarchy, schema: Schema | null,
): { value: string; label: string }[] {
  const labelFor = (name: string) =>
    schema?.columns.find((c) => c.name === name)?.label ?? name;
  return [
    { value: RAW_LEVEL, label: "Raw (every row)" },
    ...hierarchy.spine.map((s) => ({ value: s, label: `per ${labelFor(s)}` })),
  ];
}
