import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useState, useRef } from "react";
import {
  activePlottableIdAtom, addPlottableAtom, deletePlottableAtom,
  duplicatePlottableAtom, plottablesAtom, renamePlottableAtom,
  selectedPlottableIdsAtom, styleClipboardAtom, styleLibraryAtom,
  styleRegistryAtom, pasteStyleAtom,
} from "../state";
import { captureStyle } from "../style/sheet";
import type { StyleSheet } from "../style/sheet";

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
  const [selectedIds, setSelectedIds] = useAtom(selectedPlottableIdsAtom);
  const [clipboard, setClipboard] = useAtom(styleClipboardAtom);
  const library = useAtomValue(styleLibraryAtom);
  const registry = useAtomValue(styleRegistryAtom);
  const pasteStyle = useSetAtom(pasteStyleAtom);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(initialWidth);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  function showToast(msg: string) {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  /* ---- multi-select logic ---- */

  function handleClick(id: string, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl-click: toggle in selection
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    } else if (e.shiftKey && activeId) {
      // Shift-click: range from active to clicked
      const ids = plottables.map((p) => p.id);
      const a = ids.indexOf(activeId);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds(ids.slice(lo, hi + 1));
      }
    } else {
      // plain click: reset selection to just this one
      setSelectedIds([id]);
    }
    setActiveId(id);
  }

  function handleContextMenu(p: { id: string; name: string }, e: React.MouseEvent) {
    e.preventDefault();
    // if right-clicked row is not in the current selection, reset selection to it
    if (!selectedIds.includes(p.id)) {
      setSelectedIds([p.id]);
    }
    setActiveId(p.id);
    setMenu({ id: p.id, name: p.name, x: e.clientX, y: e.clientY });
  }

  /* ---- style sheet actions ---- */

  function doCopyStyle(id: string) {
    const src = plottables.find((p) => p.id === id);
    if (!src) return;
    const sheet: StyleSheet = {
      iris_style_version: "1.0",
      name: "",
      style: captureStyle(src.style, registry),
    };
    setClipboard(sheet);
    setMenu(null);
    showToast("Style copied");
  }

  function doPasteStyle() {
    if (!clipboard) return;
    const targets = selectedIds.length ? selectedIds : (menu ? [menu.id] : []);
    if (!targets.length) return;
    // ensure selection covers the targets so pasteStyleAtom hits them
    setSelectedIds(targets);
    pasteStyle(clipboard);
    setMenu(null);
    showToast(`Applied style to ${targets.length} ${targets.length === 1 ? "analysis" : "analyses"}`);
  }

  function doApplyLibraryStyle(sheet: StyleSheet) {
    const targets = selectedIds.length ? selectedIds : (menu ? [menu.id] : []);
    if (!targets.length) return;
    setSelectedIds(targets);
    pasteStyle(sheet);
    setMenu(null);
    showToast(`Applied "${sheet.name}" to ${targets.length} ${targets.length === 1 ? "analysis" : "analyses"}`);
  }

  /* ---- resize ---- */

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

  /* ---- rename ---- */

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

  /* ---- render ---- */

  if (collapsed) {
    return (
      <aside className="plottable-sidebar collapsed">
        <button className="rail-expand" title="Show analyses"
          onClick={() => setCollapsed(false)}>⋮ Analyses</button>
      </aside>
    );
  }

  const selSet = new Set(selectedIds);

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
        {plottables.map((p) => {
          const isActive = p.id === activeId;
          const isSelected = selSet.has(p.id);
          const cls = [isActive && "active", isSelected && !isActive && "selected"]
            .filter(Boolean).join(" ");
          return (
            <li key={p.id} className={cls}
                onClick={(e) => handleClick(p.id, e)}
                onDoubleClick={() => startRename(p.id, p.name)}
                onContextMenu={(e) => handleContextMenu(p, e)}>
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
          );
        })}
      </ul>

      {toast && <div className="sidebar-toast">{toast}</div>}

      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => startRename(menu.id, menu.name)}>Rename</button>
            <button onClick={() => { dup(menu.id); setMenu(null); }}>Duplicate</button>
            <button disabled={plottables.length <= 1}
              onClick={() => { del(menu.id); setMenu(null); }}>Delete</button>
            <hr className="context-menu-sep" />
            <button onClick={() => doCopyStyle(menu.id)}>Copy style</button>
            <button disabled={!clipboard} onClick={doPasteStyle}>
              Paste style{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}
            </button>
            {library.length > 0 && (
              <div className="submenu-wrap">
                <button className="submenu-trigger">Apply saved style ▸</button>
                <div className="submenu">
                  {library.map((s, i) => (
                    <button key={i} onClick={() => doApplyLibraryStyle(s)}>
                      {s.name || "(unnamed)"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
