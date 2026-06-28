import { useEffect } from "react";

export interface NodeMenu { x: number; y: number; stepIndex: number; label: string }

/* the right-click menu on a deletable pipeline node. A node is a pure projection
   of one reduce step, so "Delete" removes that step (removeStepAtom) and the
   linear steps array auto-heals — no edge rewiring. Distinct from a card's `×`,
   which only closes an editor. Closes on outside-click or Escape. */
export function NodeContextMenu(
  { menu, onDelete, onClose }: { menu: NodeMenu; onDelete: () => void; onClose: () => void },
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
        <button role="menuitem" className="danger" onClick={onDelete}>
          Delete {menu.label.toLowerCase()}
        </button>
      </div>
    </>
  );
}
