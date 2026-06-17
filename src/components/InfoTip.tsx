import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATS_GLOSSARY, type GlossaryEntry, type GlossaryKey } from "./statsGlossary";

const POP_W = 300; // keep in sync with .infotip-pop width
const GAP = 6;
const MARGIN = 8; // min gap from the viewport edge

/* Inline `?` affordance that reveals a glossary popover on hover/focus.
   Content, not decoration — keyboard-focusable and read by screen readers.
   The popover renders in a portal with fixed positioning so it is never
   clipped by the (overflow-hidden, scrolling) stats pane; it flips above the
   trigger near the bottom of the viewport and is clamped to the edges. See
   docs/superpowers/specs/2026-06-17-stats-info-boxes-design.md */
export function InfoTip({ k }: { k: GlossaryKey }) {
  const e: GlossaryEntry = STATS_GLOSSARY[k];
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - POP_W - MARGIN));
    // Flip above when the trigger sits in the lower half of the viewport.
    const above = r.top > window.innerHeight / 2;
    setPos(above
      ? { left, bottom: window.innerHeight - r.top + GAP }
      : { left, top: r.bottom + GAP });
  };
  const hide = () => setPos(null);

  return (
    <span
      className="infotip"
      onMouseEnter={show}
      onMouseLeave={hide}
      onKeyDown={(ev) => ev.key === "Escape" && hide()}
    >
      <button
        ref={ref}
        type="button"
        className="infotip-trigger"
        aria-label={`About ${e.term}`}
        aria-describedby={pos ? id : undefined}
        onFocus={show}
        onBlur={hide}
      >
        ⓘ
      </button>
      {pos && createPortal(
        <span
          id={id}
          role="tooltip"
          className="infotip-pop"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
        >
          <strong className="infotip-term">{e.term}</strong>
          <span className="infotip-what">{e.what}</span>
          {e.assumes && (
            <span className="infotip-line">
              <em>Assumes</em> · {e.assumes}
            </span>
          )}
          {e.read && (
            <span className="infotip-line">
              <em>Read</em> · {e.read}
            </span>
          )}
        </span>,
        document.body,
      )}
    </span>
  );
}
