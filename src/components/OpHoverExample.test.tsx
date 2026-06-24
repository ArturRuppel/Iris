import { render, screen } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { OpHoverExample } from "./OpHoverExample";
import { cannedExample } from "../explorer/cannedExamples";

describe("OpHoverExample", () => {
  it("renders the before/after columns, rows, and caption for an op", () => {
    render(<OpHoverExample example={cannedExample("pivot")!} />);
    expect(screen.getByText(/long→wide|named column/i)).toBeInTheDocument();   // caption
    // assert on before-only column headers (after-column headers also appear as
    // before-row values, so they aren't unique text)
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.getByText("measure")).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(2);      // before + after
  });
});
