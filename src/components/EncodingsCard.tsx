import { useAtomValue, useSetAtom } from "jotai";
import { activePlottableAtom, effectiveSchemaAtom } from "../state";
import type { ColumnDef } from "../types";
import { groupByPrefix } from "./ColumnPicker";

/* Dotted column names share a family prefix (cell_shape.area, cell_shape.peri).
   Labels carry only the leaf ("area"), so two families would look identical in
   a flat list — group them under <optgroup> so the prefix gives context.
   Columns with no dot stay at the top level. */
function GroupedOptions({ cols }: { cols: ColumnDef[] }) {
  return (
    <>
      {groupByPrefix(cols).map(({ prefix, cols }) =>
        prefix === "(other)" ? (
          cols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)
        ) : (
          <optgroup key={prefix} label={prefix}>
            {cols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
          </optgroup>
        ),
      )}
    </>
  );
}

/* X/Y mapping, living inside the composable column next to Layers — one place
   for "what does the plot show", instead of a separate header row. The choices
   are drawn from the post-reduction schema so you can never map an axis to a
   column the pipeline drops. */
export function EncodingsCard() {
  const active = useAtomValue(activePlottableAtom);
  const setActive = useSetAtom(activePlottableAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  if (!active) return null;

  const { family } = active;
  const mappings = active.mappings;
  const xKind: "categorical" | "numeric" | "none" =
    family === "group_comparison" ? "categorical"
    : family === "correlation" ? "numeric" : "none";

  const numericCols = schema?.columns.filter((c) => c.type === "numeric") ?? [];
  const catCols = schema?.columns.filter((c) => c.type === "categorical") ?? [];
  const xCols = xKind === "numeric"
    ? numericCols.filter((c) => c.name !== mappings.y) : catCols;

  const setMappings = (m: { x: string; y: string }) =>
    setActive({ ...active, mappings: m });

  return (
    <div className="encodings-card">
      <div className="enc-row">
        <span className="enc-label">{xKind === "none" ? "Variable" : "Y"}</span>
        <select value={mappings.y}
          onChange={(e) => setMappings({ ...mappings, y: e.target.value })}>
          <GroupedOptions cols={numericCols} />
        </select>
      </div>
      {xKind !== "none" && (
        <div className="enc-row">
          <span className="enc-label">X</span>
          <select value={mappings.x}
            onChange={(e) => setMappings({ ...mappings, x: e.target.value })}>
            <GroupedOptions cols={xCols} />
          </select>
        </div>
      )}
    </div>
  );
}
