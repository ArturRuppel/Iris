import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddStepMenu } from "./AddStepMenu";
import { affordances } from "./authoring";
import type { ExplorerNode } from "../explorer/graph";

const stepNode: ExplorerNode = { id: "step:0", kind: "table", label: "step:0", table: { via: "none" } };

describe("AddStepMenu", () => {
  it("renders one button per option (all seven reduce kinds + terminals for a step node)", () => {
    render(<AddStepMenu options={affordances(stepNode)} onPick={() => {}} />);
    // 7 reduce kinds + 3 terminal options = 10 menu items.
    expect(screen.getAllByRole("menuitem")).toHaveLength(10);
    expect(screen.getByRole("menuitem", { name: "Derive column" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Plot (geom)" })).toBeInTheDocument();
  });

  it("calls onPick with the option's action on click", () => {
    const onPick = vi.fn();
    render(<AddStepMenu options={affordances(stepNode)} onPick={onPick} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Join table" }));
    expect(onPick).toHaveBeenCalledWith({ kind: "reduce", step: "join" });
  });
});
