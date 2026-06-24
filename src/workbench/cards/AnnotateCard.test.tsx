import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { AnnotateCard } from "./AnnotateCard";
import { seedStore } from "./cardTestStore";
import { activePlottableAtom, setAnalysisByIdAtom } from "../../state";
import type { AnalyzeResponse } from "../../types";

const target = { kind: "edge" as const, id: "a:annotate" };

describe("AnnotateCard", () => {
  it("renders an unchecked significance toggle by default", () => {
    const { store } = seedStore();
    render(<Provider store={store}><AnnotateCard target={target} /></Provider>);
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(store.get(activePlottableAtom)?.style.show_significance).toBeFalsy();
  });

  it("checking the toggle writes show_significance into the active plottable", () => {
    const { store } = seedStore();
    render(<Provider store={store}><AnnotateCard target={target} /></Provider>);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(store.get(activePlottableAtom)?.style.show_significance).toBe(true);
  });

  it("names the active test when one has run", () => {
    const { store, plottable } = seedStore();
    // a partial AnalyzeResponse — only the path AnnotateCard reads matters.
    const res = { stats: { result: { test: "welch_t" } } } as unknown as AnalyzeResponse;
    store.set(setAnalysisByIdAtom, { id: plottable.id, res });
    render(<Provider store={store}><AnnotateCard target={target} /></Provider>);
    expect(screen.getByText(/welch_t/i)).toBeInTheDocument();
  });
});
