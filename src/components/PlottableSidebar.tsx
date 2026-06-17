import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableIdAtom, addPlottableAtom, deletePlottableAtom,
  duplicatePlottableAtom, plottablesAtom, renamePlottableAtom,
} from "../state";

type Menu = { id: string; name: string; x: number; y: number };

const WIDTH_KEY = "plottable-sidebar-width";
const MIN_WIDTH = 140;
const MAX_WIDTH = 480;

function clampWidth(w: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
}

function initialWidth() {
  const stored = Number(localStorage.getItem(WIDTH_KEY));
  return stored ? clampWidth(stored) : 200;
}

export function PlottableSidebar() {
  const plottables = useAtomValue(plottablesAtom);
  const [activeId, setActiveId] = useAtom(activePlottableIdAtom);
  const add = useSetAtom(addPlottableAtom);
  const dup = useSetAtom(duplicatePlottableAtom);
  const del = useSetAtom(deletePlottableAtom);
  const rename = useSetAtom(renamePlottableAtom);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(initialWidth);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    function onMove(ev: MouseEvent) {
      setWidth(clampWidth(startWidth + (ev.clientX - startX)));
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      localStorage.setItem(WIDTH_KEY, String(clampWidth(startWidth + (ev.clientX - startX))));
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startRename(id: string, name: string) {
    setMenu(null);
    setDraft(name);
    setEditingId(id);
  }

  function commitRename(id: string) {
    const name = draft.trim();
    if (name) rename({ id, name });
    setEditingId(null);
  }

  if (collapsed) {
    return (
      <aside className="plottable-sidebar collapsed">
        <button className="rail-expand" title="Show analyses"
          onClick={() => setCollapsed(false)}>⋮ Analyses</button>
      </aside>
    );
  }

  return (
    <aside className="plottable-sidebar" style={{ width }}>
      <div className="sidebar-resize" onMouseDown={startResize}
        title="Drag to resize" />
      <div className="rail-head">
        <strong>Analyses</strong>
        <button className="icon" title="Hide analyses"
          onClick={() => setCollapsed(true)}>⟨</button>
      </div>
      <button className="add-plottable" onClick={() => add()}>+ Analysis</button>
      <ul>
        {plottables.map((p) => (
          <li key={p.id} className={p.id === activeId ? "active" : ""}
              onClick={() => setActiveId(p.id)}
              onDoubleClick={() => startRename(p.id, p.name)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: p.id, name: p.name, x: e.clientX, y: e.clientY });
              }}>
            {editingId === p.id ? (
              <input autoFocus value={draft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => commitRename(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(p.id);
                  else if (e.key === "Escape") setEditingId(null);
                }} />
            ) : (
              <span className="plottable-name" title={p.name}>{p.name}</span>
            )}
          </li>
        ))}
      </ul>
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => startRename(menu.id, menu.name)}>Rename</button>
            <button onClick={() => { dup(menu.id); setMenu(null); }}>Duplicate</button>
            <button disabled={plottables.length <= 1}
              onClick={() => { del(menu.id); setMenu(null); }}>Delete</button>
          </div>
        </>
      )}
    </aside>
  );
}
