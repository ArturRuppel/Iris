import { useMemo, useState } from "react";
import type { ColumnDef } from "../types";

/* Group columns by their dotted prefix (cell_shape.area -> "cell_shape").
   Columns with no dot fall under "(other)". Order of first appearance is kept
   so the picker mirrors the source-table column order. */
export function groupByPrefix(columns: ColumnDef[]): { prefix: string; cols: ColumnDef[] }[] {
  const order: string[] = [];
  const map = new Map<string, ColumnDef[]>();
  for (const c of columns) {
    const prefix = c.name.includes(".") ? c.name.split(".")[0] : "(other)";
    if (!map.has(prefix)) { map.set(prefix, []); order.push(prefix); }
    map.get(prefix)!.push(c);
  }
  return order.map((prefix) => ({ prefix, cols: map.get(prefix)! }));
}

function leaf(name: string): string {
  return name.includes(".") ? name.slice(name.indexOf(".") + 1) : name;
}

interface Props {
  columns: ColumnDef[];
  selected: string[];
  onToggle: (name: string) => void;
  onToggleGroup: (names: string[], on: boolean) => void;
  /* restrict the pickable set (e.g. numerics only); others are hidden */
  filterType?: (c: ColumnDef) => boolean;
}

/* A searchable, prefix-grouped checkbox list. Tames 50+ column datasets:
   collapse families you don't care about, search to jump, toggle a whole
   family at once. Used by Select (which columns to keep) and Collapse
   (which columns to group by). */
export function ColumnPicker({ columns, selected, onToggle, onToggleGroup, filterType }: Props) {
  const [q, setQ] = useState("");
  const sel = useMemo(() => new Set(selected), [selected]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const pickable = filterType ? columns.filter(filterType) : columns;
  const needle = q.trim().toLowerCase();
  const matched = needle
    ? pickable.filter((c) =>
        c.name.toLowerCase().includes(needle) || c.label.toLowerCase().includes(needle))
    : pickable;
  const groups = groupByPrefix(matched);

  return (
    <div className="column-picker">
      <input
        className="cp-search"
        placeholder={`Search ${pickable.length} columns…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="cp-groups">
        {groups.length === 0 && <div className="cp-empty">no matches</div>}
        {groups.map(({ prefix, cols }) => {
          const names = cols.map((c) => c.name);
          const nSel = names.filter((n) => sel.has(n)).length;
          const allSel = nSel === names.length;
          // a searched view, or a single (other) bucket, defaults to expanded
          const isOpen = open[prefix] ?? (!!needle || prefix === "(other)" || groups.length <= 2);
          return (
            <div key={prefix} className="cp-group">
              <div className="cp-group-head">
                <button
                  className="cp-disclose"
                  onClick={() => setOpen((o) => ({ ...o, [prefix]: !isOpen }))}
                  title={isOpen ? "collapse" : "expand"}
                >{isOpen ? "▾" : "▸"}</button>
                <label className="cp-group-label">
                  <input
                    type="checkbox"
                    checked={allSel}
                    ref={(el) => { if (el) el.indeterminate = nSel > 0 && !allSel; }}
                    onChange={() => onToggleGroup(names, !allSel)}
                  />
                  <span className="cp-prefix">{prefix}</span>
                  <span className="cp-count">{nSel}/{names.length}</span>
                </label>
              </div>
              {isOpen && (
                <ul className="cp-cols">
                  {cols.map((c) => (
                    <li key={c.name}>
                      <label title={c.name}>
                        <input
                          type="checkbox"
                          checked={sel.has(c.name)}
                          onChange={() => onToggle(c.name)}
                        />
                        <span>{leaf(c.name)}</span>
                        {c.unit && <span className="cp-unit">{c.unit}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
