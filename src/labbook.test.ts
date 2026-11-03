import { afterEach, describe, expect, it, vi } from "vitest";
import { figureApiUrl, fileName, labbookTarget, putFigure } from "./labbook";

const FILE = "https://book.example:5001/documents/note/a%20b.iris";
const SAVE = { iris_base64: "eA==", svg: "<svg/>", base_sha256: "old", session: "s" };

afterEach(() => vi.unstubAllGlobals());

describe("labbook", () => {
  it("reads the bound file from the query", () => {
    expect(labbookTarget(`?labbook=${encodeURIComponent(FILE)}`)).toBe(FILE);
    expect(labbookTarget("?open=x")).toBeNull();
  });
  it("derives the save address and the name", () => {
    expect(figureApiUrl(FILE)).toBe("https://book.example:5001/api/figures/documents/note/a%20b.iris");
    expect(fileName(FILE)).toBe("a b.iris");
  });
  it("returns the new hash", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sha256: "new" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(putFigure(FILE, SAVE)).resolves.toBe("new");
    expect(fetchMock.mock.calls[0]).toMatchObject([expect.any(String), { method: "PUT" }]);
  });
  it("surfaces the lab book's reason", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "changed" }), { status: 409 }));
    await expect(putFigure(FILE, SAVE)).rejects.toThrow("changed");
  });
});
