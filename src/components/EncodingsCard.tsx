import { useAtomValue, useSetAtom } from "jotai";
import { activePlottableAtom, effectiveSchemaAtom, registryAtom } from "../state";
import type { Channel } from "../channels";
import { colType, offeredColumns, renderStatus } from "../channels";
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

/* Phase 3 — five uniform channel rows (X, Y, Color, Size, Shape). The user maps
   columns first and the column *types* drive everything: which columns each row
   offers (the §4 offer rule), the derived stats family, and which mappings the
   engine can render today. A column whose type is offerable but not renderable
   yet (e.g. a numeric color) appears disabled-with-reason instead of silently
   misrendering — the picker teaches the rule rather than hiding the option. */
const ROWS: { key: Channel; label: string }[] = [
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "color", label: "Color" },
  { key: "size", label: "Size" },
  { key: "shape", label: "Shape" },
];

export function EncodingsCard() {
  const active = useAtomValue(activePlottableAtom);
  const setActive = useSetAtom(activePlottableAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const registry = useAtomValue(registryAtom);
  if (!active) return null;

  const mappings = active.mappings;
  const columns = schema?.columns ?? [];

  const valueOf = (ch: Channel): string =>
    ch === "x" || ch === "y" ? mappings[ch] : active[ch];

  /* color follows x while it tracks x (the default), so changing the group
     column doesn't strand color on the old one; an explicit color is left be. */
  const setValue = (ch: Channel, col: string) => {
    if (ch === "x") {
      const colorTracksX = active.color === mappings.x;
      setActive({ ...active, mappings: { ...mappings, x: col },
                  color: colorTracksX ? col : active.color });
    } else if (ch === "y") {
      setActive({ ...active, mappings: { ...mappings, y: col } });
    } else {
      setActive({ ...active, [ch]: col });
    }
  };

  return (
    <div className="encodings-card">
      {ROWS.map(({ key, label }) => {
        /* the column the *other* axis holds is excluded so X and Y can't collide */
        const otherAxis = key === "x" ? mappings.y : key === "y" ? mappings.x : "";
        const offered = offeredColumns(
          registry, key, columns.filter((c) => c.name !== otherAxis));
        /* nothing this channel can carry (and nothing stale mapped) → hide row */
        if (offered.selectable.length === 0 && offered.disabled.length === 0
            && !valueOf(key)) return null;
        const value = valueOf(key);
        /* a still-mapped column whose type the engine can't render yet: surface
           the reason inline (it also rides the amber warn-bar after render). */
        const t = colType(schema, value);
        const status = t ? renderStatus(registry, key, t) : null;
        const reason = status && status !== "ok" ? status.reason : null;
        return (
          <div className="enc-row" key={key}>
            <span className="enc-label">{label}</span>
            <select value={value} onChange={(e) => setValue(key, e.target.value)}>
              <option value="">— none —</option>
              <GroupedOptions cols={offered.selectable} />
              {offered.disabled.map(({ col, reason }) => (
                <option key={col.name} value={col.name} disabled>
                  {col.label} — {reason}
                </option>
              ))}
            </select>
            {reason && <span className="enc-warn" title={reason}>⚠ {reason}</span>}
          </div>
        );
      })}
    </div>
  );
}
