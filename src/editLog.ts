/* Edit log: a session ring buffer of the manual figure edits (label drags,
   canvas resizes, plot-area moves and resizes, their undo/redo) and of drags
   that were ignored and why. On the iPad there is no console, so this is how a
   drag that "did nothing" or landed somewhere odd is traced: ⋯ → Show edit
   log, then Copy. Nothing here is saved to the document. */
import { atom } from "jotai";

export interface EditLogEntry { t: string; what: string; detail: string }

export const EDIT_LOG_LIMIT = 300;

export const editLogAtom = atom<EditLogEntry[]>([]);

const stamp = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;

/** append one entry; the oldest fall off past EDIT_LOG_LIMIT */
export const logEditAtom = atom(null, (get, set, e: { what: string; detail: string }) => {
  set(editLogAtom, [...get(editLogAtom).slice(-(EDIT_LOG_LIMIT - 1)), { t: stamp(), ...e }]);
});

export const clearEditLogAtom = atom(null, (_get, set) => set(editLogAtom, []));

/** one line per entry, for the Copy button */
export const formatEditLog = (entries: EditLogEntry[]): string =>
  entries.map((e) => `${e.t}  ${e.what.padEnd(14)} ${e.detail}`).join("\n");

/* helpers for the figure pane's entries */
export const fmtRect = (r: readonly number[] | undefined | null, digits = 3): string =>
  r ? `[${r.map((v) => v.toFixed(digits)).join(", ")}]` : "auto";

/** how a pointer sequence ended: pen/touch/mouse and whether iOS cancelled it */
export const pointerTag = (down: { pointerType?: string }, end: Event | null | undefined): string =>
  `${down.pointerType ?? "?"}${end?.type === "pointercancel" ? " cancelled" : ""}`;
