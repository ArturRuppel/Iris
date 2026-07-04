import type { Hierarchy, Schema } from "./types";
import { RAW_LEVEL } from "./types";

/* A column's display label, falling back to its name when the schema is absent
   or the column is unknown. The single definition every "name → label" lookup
   in the app shares (the reduced-table preview, the hierarchy panel, the
   collapse-routing panel, the explorer graph). */
export function labelForCol(schema: Schema | null, name: string): string {
  return schema?.columns.find((c) => c.name === name)?.label ?? name;
}

/* The data levels a consumer (the reduced-table preview, a figure layer) can
   draw from: the raw reduced rows plus each spine column's grain, coarsest →
   finest. Labels come from the schema so "position_id" reads as its column
   label. */
export function levelOptions(
  hierarchy: Hierarchy, schema: Schema | null,
): { value: string; label: string }[] {
  return [
    { value: RAW_LEVEL, label: "Raw (every row)" },
    ...hierarchy.spine.map((s) => ({ value: s, label: `per ${labelForCol(schema, s)}` })),
  ];
}
