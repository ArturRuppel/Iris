import { Fragment, useCallback, useRef, type RefObject, type PointerEvent as RPE } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { workbenchLayoutAtom, STASH_SLOTS } from "./state";
import { clampStashH, resizeColumns, slotSplit, trackWidth, TOPBAR } from "./layoutResize";

/* the grid-template-columns string the stash and its handle layer share, so the
   sliders always sit exactly on the slot boundaries. */
export function gridCols(cols: number[]): string {
  return cols.map((c) => `${c}fr`).join(" ");
}

/* The tiling-resize controller. Wires two input paths to the one layout atom:
   - Alt + left-drag anywhere (captured on the overlay so React Flow never pans);
   - the visible divider/corner sliders.
   A slot drag moves the stash height AND its nearest column split together — two
   axes at once, the Hyprland corner feel; the canvas (or an edge slider) moves a
   single axis. */
export function useWorkbenchResize(
  overlayRef: RefObject<HTMLDivElement>,
  stashRef: RefObject<HTMLDivElement>,
) {
  const layout = useAtomValue(workbenchLayoutAtom);
  const setLayout = useSetAtom(workbenchLayoutAtom);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;            // always read the freshest at drag start

  const beginDrag = useCallback(
    (e: RPE, axisH: boolean, splitIndex: number | null) => {
      const stash = stashRef.current, overlay = overlayRef.current;
      if (!stash || !overlay) return;
      const startX = e.clientX, startY = e.clientY;
      const { stashH: startStashH, cols: startCols } = layoutRef.current;
      const contentH = overlay.clientHeight - TOPBAR;
      const innerW = trackWidth(stash.clientWidth, startCols.length);
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor =
        axisH && splitIndex != null ? "nwse-resize" : axisH ? "ns-resize" : "ew-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const stashH = axisH
          ? clampStashH(startStashH - (ev.clientY - startY), contentH)
          : startStashH;
        const cols = splitIndex != null
          ? resizeColumns(startCols, splitIndex, ev.clientX - startX, innerW)
          : startCols;
        setLayout({ stashH, cols });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = "";
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [overlayRef, stashRef, setLayout],
  );

  const onOverlayPointerDownCapture = useCallback(
    (e: RPE) => {
      if (!e.altKey || e.button !== 0) return;
      const stash = stashRef.current;
      if (!stash) return;                // stash closed → nothing to resize
      const sr = stash.getBoundingClientRect();
      let splitIndex: number | null = null;
      if (e.clientY >= sr.top) {         // inside the stash → also resize a split
        const slots = Array.from(stash.querySelectorAll(".txw-slot"));
        let i = slots.findIndex((s) => {
          const r = s.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right;
        });
        if (i < 0) i = 0;
        const r = slots[i].getBoundingClientRect();
        splitIndex = slotSplit(i, (e.clientX - r.left) / r.width, STASH_SLOTS);
      }
      // stop React Flow (and its native listeners) from also handling this drag.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      beginDrag(e, true, splitIndex);
    },
    [stashRef, beginDrag],
  );

  const startH = useCallback((e: RPE) => {
    e.preventDefault(); e.stopPropagation(); beginDrag(e, true, null);
  }, [beginDrag]);
  const startV = useCallback((e: RPE, i: number) => {
    e.preventDefault(); e.stopPropagation(); beginDrag(e, false, i);
  }, [beginDrag]);
  const startCorner = useCallback((e: RPE, i: number) => {
    e.preventDefault(); e.stopPropagation(); beginDrag(e, true, i);
  }, [beginDrag]);

  return { onOverlayPointerDownCapture, startH, startV, startCorner };
}

/* The visible slider layer: a transparent grid mirroring the stash columns, with
   a full-width height handle along the top boundary, an ew handle on each column
   gap, and a two-axis corner grip where they cross. */
export function ResizeHandles({
  cols, startH, startV, startCorner,
}: {
  cols: number[];
  startH: (e: RPE) => void;
  startV: (e: RPE, i: number) => void;
  startCorner: (e: RPE, i: number) => void;
}) {
  return (
    <div className="txw-stash-handles" style={{ gridTemplateColumns: gridCols(cols) }}>
      <div className="txw-rs-h" title="Drag to resize height (or Alt-drag a pane)"
           onPointerDown={startH} />
      {cols.slice(0, -1).map((_, i) => (
        <Fragment key={i}>
          <div className="txw-rs-v" style={{ gridColumn: i + 1 }}
               title="Drag to resize width" onPointerDown={(e) => startV(e, i)} />
          <div className="txw-rs-corner" style={{ gridColumn: i + 1 }}
               title="Drag to resize both axes" onPointerDown={(e) => startCorner(e, i)} />
        </Fragment>
      ))}
    </div>
  );
}
