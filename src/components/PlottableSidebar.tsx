import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableIdAtom, addPlottableAtom, deletePlottableAtom,
  duplicatePlottableAtom, plottablesAtom, renamePlottableAtom,
} from "../state";

export function PlottableSidebar() {
  const plottables = useAtomValue(plottablesAtom);
  const [activeId, setActiveId] = useAtom(activePlottableIdAtom);
  const add = useSetAtom(addPlottableAtom);
  const dup = useSetAtom(duplicatePlottableAtom);
  const del = useSetAtom(deletePlottableAtom);
  const rename = useSetAtom(renamePlottableAtom);
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="plottable-sidebar collapsed">
        <button className="rail-expand" title="Show analyses"
          onClick={() => setCollapsed(false)}>⋮ Analyses</button>
      </aside>
    );
  }

  return (
    <aside className="plottable-sidebar">
      <div className="rail-head">
        <strong>Analyses</strong>
        <button className="icon" title="Hide analyses"
          onClick={() => setCollapsed(true)}>⟨</button>
      </div>
      <button className="add-plottable" onClick={() => add()}>+ Analysis</button>
      <ul>
        {plottables.map((p) => (
          <li key={p.id} className={p.id === activeId ? "active" : ""}
              onClick={() => setActiveId(p.id)}>
            <input value={p.name} onClick={(e) => e.stopPropagation()}
              onChange={(e) => rename({ id: p.id, name: e.target.value })} />
            <button title="Duplicate" onClick={(e) => { e.stopPropagation(); dup(p.id); }}>⧉</button>
            <button title="Delete" disabled={plottables.length <= 1}
              onClick={(e) => { e.stopPropagation(); del(p.id); }}>✕</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
