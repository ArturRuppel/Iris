import { atom } from "jotai";

/* the lanes experiment's on/off switch (see lanes.ts): localStorage, or
   ?lanes=1 / ?lanes=0 for one visit. */
const KEY = "iris:lanes";
const initial = (): boolean => {
  try {
    const q = new URLSearchParams(window.location.search).get("lanes");
    if (q != null) return q !== "0";
    return localStorage.getItem(KEY) === "1";
  } catch { return false; }
};
const lanesFlag = atom(initial());
export const lanesEnabledAtom = atom(
  (get) => get(lanesFlag),
  (_get, set, on: boolean) => {
    set(lanesFlag, on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
  },
);

