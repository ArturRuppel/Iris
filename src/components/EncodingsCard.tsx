import { useAtomValue, useSetAtom } from "jotai";
import { activePlottableAtom, effectiveSchemaAtom, registryAtom } from "../state";
import type { Channel } from "../state";
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
/* the aesthetic channels, with the column type each accepts */
const CHANNELS: { key: Channel; label: string; kind: "categorical" | "numeric" }[] = [
  { key: "color", label: "Color", kind: "categorical" },
  { key: "size", label: "Size", kind: "numeric" },
  { key: "shape", label: "Shape", kind: "categorical" },
];

export function EncodingsCard() {
  const active = useAtomValue(activePlottableAtom);
  const setActive = useSetAtom(activePlottableAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const registry = useAtomValue(registryAtom);
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

  /* color follows x while it tracks x (the default), so changing the group
     column doesn't strand color on the old one; an explicit color is left be. */
  const setMappings = (m: { x: string; y: string }) => {
    const colorTracksX = active.color === mappings.x;
    setActive({ ...active, mappings: m,
                color: colorTracksX ? m.x : active.color });
  };
  const setChannel = (ch: Channel, col: string) =>
    setActive({ ...active, [ch]: col });

  /* a channel is offered if ANY layer's geom draws it (union); the guard warns
     only when none do. A still-set-but-unsupported channel stays visible so it
     can be cleared. */
  const accepted = new Set(
    active.layers.flatMap((l) => registry?.geoms[l.geom]?.aes ?? []));

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
      {CHANNELS.map(({ key, label, kind }) => {
        const value = active[key];
        if (!accepted.has(key) && !value) return null;
        const cols = kind === "numeric" ? numericCols : catCols;
        return (
          <div className="enc-row" key={key}>
            <span className="enc-label">{label}</span>
            <select value={value}
              onChange={(e) => setChannel(key, e.target.value)}>
              <option value="">— none —</option>
              <GroupedOptions cols={cols} />
            </select>
          </div>
        );
      })}
    </div>
  );
}
