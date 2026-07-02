import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { ImportWizard } from "./ImportWizard";
import { engine } from "../types";

afterEach(() => vi.restoreAllMocks());

// §2: a first-ever pick that fails BEFORE `file` is set (the upload itself throws)
// left the modal — gated on `file && (preview || error)` — never opening, so
// "Import data…" looked inert. The dialog must now open and show the error.
it("surfaces a first-pick upload failure in the dialog", async () => {
  vi.spyOn(engine, "importUpload").mockRejectedValue(new Error("upload exploded"));
  const { container } = render(<ImportWizard />);

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["a,b\n1,2\n"], "data.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });

  expect(await screen.findByText("upload exploded")).toBeTruthy();  // was invisible
  // the dialog opened even though `file` was never set (generic title, no crash)
  expect(screen.getByRole("heading", { name: /Import data/ })).toBeTruthy();
});
