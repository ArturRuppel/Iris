import { useEffect } from "react";

export interface MenuItem { label: string; danger?: boolean; onClick: () => void; }
export interface NodeMenu { x: number; y: number; items: MenuItem[]; }

/* The right-click menu on a graph node. Items are caller-supplied: a reduce step
   offers Delete (removes that step; the linear steps array auto-heals); the
   figure terminal offers Edit plot…/Edit test…. Closes on outside-click/Escape. */
export function NodeContextMenu(
  { menu, onClose }: { menu: NodeMenu; onClose: () => void },
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="txw-ctxmenu-scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="txw-ctxmenu" role="menu" style={{ left: menu.x, top: menu.y }}>
        {menu.items.map((it, i) => (
          <button key={i} role="menuitem" className={it.danger ? "danger" : undefined}
            onClick={() => { it.onClick(); onClose(); }}>
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
