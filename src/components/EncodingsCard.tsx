import { useAtomValue, useSetAtom } from "jotai";
import { activePlottableAtom, effectiveSchemaAtom } from "../state";

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
          {numericCols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
        </select>
      </div>
      {xKind !== "none" && (
        <div className="enc-row">
          <span className="enc-label">X</span>
          <select value={mappings.x}
            onChange={(e) => setMappings({ ...mappings, x: e.target.value })}>
            {xCols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
