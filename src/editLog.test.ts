import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  EDIT_LOG_LIMIT, clearEditLogAtom, editLogAtom, formatEditLog, fmtRect, logEditAtom, pointerTag,
} from "./editLog";

describe("edit log", () => {
  it("appends stamped entries and keeps the last EDIT_LOG_LIMIT", () => {
    const store = createStore();
    for (let i = 0; i < EDIT_LOG_LIMIT + 5; i++)
      store.set(logEditAtom, { what: "label", detail: `n=${i}` });
    const log = store.get(editLogAtom);
    expect(log).toHaveLength(EDIT_LOG_LIMIT);
    expect(log[0].detail).toBe("n=5");
    expect(log[log.length - 1].detail).toBe(`n=${EDIT_LOG_LIMIT + 4}`);
    expect(log[0].t).toMatch(/^\d\d:\d\d:\d\d\.\d\d\d$/);
    store.set(clearEditLogAtom);
    expect(store.get(editLogAtom)).toHaveLength(0);
  });

  it("formats one line per entry", () => {
    const text = formatEditLog([
      { t: "10:00:00.000", what: "canvas", detail: "70×50 → 90×50 mm" },
      { t: "10:00:01.000", what: "undo", detail: "canvas" },
    ]);
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("canvas         70×50 → 90×50 mm");
  });

  it("prints rects and pointer endings", () => {
    expect(fmtRect([0.1, 0.2, 0.75, 0.7])).toBe("[0.100, 0.200, 0.750, 0.700]");
    expect(fmtRect(null)).toBe("auto");
    expect(pointerTag({ pointerType: "touch" }, { type: "pointercancel" } as Event)).toBe("touch cancelled");
    expect(pointerTag({ pointerType: "mouse" }, { type: "pointerup" } as Event)).toBe("mouse");
  });
});
