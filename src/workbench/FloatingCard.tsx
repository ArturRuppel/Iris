import { useSetAtom } from "jotai";
import {
  closeCardAtom, moveCardAtom, resizeCardAtom, toggleCardCollapsedAtom,
  type Card,
} from "./state";
import { CARD_BODIES, CARD_TITLE } from "./cardRegistry";

// Minimum card dimensions enforced by the resize clamp (mirrors index.css min-width).
const MIN_W = 220;
const MIN_H = 120;

/* A pointer drag. At pointer-down it captures the pointer origin AND a base
   value (read fresh from the closure, i.e. the latest render's card geometry),
   then reports base+delta on every move. Capturing in the handler — not React
   state — avoids the stale-closure trap where a same-event bubble handler would
   read pre-update state, which would make the *second* drag start from a stale
   origin. */
function startDrag(
  e: React.PointerEvent,
  base: { x: number; y: number },
  onMove: (x: number, y: number) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const ox = e.clientX;
  const oy = e.clientY;
  const move = (ev: PointerEvent) => onMove(base.x + (ev.clientX - ox), base.y + (ev.clientY - oy));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* Generic ephemeral card: title bar (drag to move), registry-chosen body,
   corner resize, collapse + close. All mutations route through the session-only
   card atoms — nothing here is serialized. */
export function FloatingCard({ card }: { card: Card }) {
  const move = useSetAtom(moveCardAtom);
  const resize = useSetAtom(resizeCardAtom);
  const close = useSetAtom(closeCardAtom);
  const toggle = useSetAtom(toggleCardCollapsedAtom);

  // each handler reads card.* fresh from this render's closure at pointer-down,
  // so repeated drags always start from the current geometry.
  const onBarDown = (e: React.PointerEvent) =>
    startDrag(e, { x: card.x, y: card.y },
      (x, y) => move({ id: card.id, x, y }));
  // startDrag's position-named base {x,y} / onMove(x,y) carry width/height here.
  const onResizeDown = (e: React.PointerEvent) =>
    startDrag(e, { x: card.w, y: card.h },
      (w, h) => resize({ id: card.id, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) }));

  const Body = CARD_BODIES[card.cardKind];
  const title = CARD_TITLE[card.cardKind];

  return (
    <div
      className={`txw-card${card.collapsed ? " collapsed" : ""}`}
      role="dialog" aria-label={`${title} card`}
      style={{ left: card.x, top: card.y, width: card.w,
               height: card.collapsed ? undefined : card.h }}
    >
      <div className="txw-card-bar" data-testid="card-bar" onPointerDown={onBarDown}>
        <span className="txw-card-title">{title}</span>
        <button className="txw-card-btn" aria-label="Collapse card"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggle(card.id)}>
          {card.collapsed ? "▢" : "—"}
        </button>
        <button className="txw-card-btn" aria-label="Close card"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => close(card.id)}>
          ✕
        </button>
      </div>
      {!card.collapsed && (
        <>
          <div className="txw-card-body">
            <Body target={card.target} />
          </div>
          <div className="txw-card-resize" data-testid="card-resize"
               onPointerDown={onResizeDown} aria-hidden />
        </>
      )}
    </div>
  );
}
