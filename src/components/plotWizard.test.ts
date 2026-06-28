import { describe, it, expect } from "vitest";
import { firstStep, nextStep, type WizardMode } from "./plotWizard";

describe("plotWizard step machine", () => {
  it("first mode goes type → map → done", () => {
    const m: WizardMode = "first";
    expect(firstStep(m)).toBe("type");
    expect(nextStep(m, "type")).toBe("map");
    expect(nextStep(m, "map")).toBe("done");
  });
  it("addLayer mode goes type → grain → done", () => {
    const m: WizardMode = "addLayer";
    expect(firstStep(m)).toBe("type");
    expect(nextStep(m, "type")).toBe("grain");
    expect(nextStep(m, "grain")).toBe("done");
  });
});
