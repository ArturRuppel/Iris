import { describe, expect, it } from "vitest";
import { parseExampleToken, parseOpenToken } from "./tokens";

describe("parseExampleToken", () => {
  it("parses a plot token into case + analysis ids", () => {
    expect(parseExampleToken("example:iris-species-comparison/iris-species-comparison-02"))
      .toEqual({ caseId: "iris-species-comparison", analysisId: "iris-species-comparison-02" });
  });
  it("returns null for a non-example src", () => {
    expect(parseExampleToken("https://example.com/x.png")).toBeNull();
  });
  it("returns null when the analysis id is missing", () => {
    expect(parseExampleToken("example:iris-species-comparison")).toBeNull();
  });
});

describe("parseOpenToken", () => {
  it("parses an open token into a case id", () => {
    expect(parseOpenToken("iris-open:timeseries-growth")).toEqual({ caseId: "timeseries-growth" });
  });
  it("returns null for an ordinary link", () => {
    expect(parseOpenToken("https://docs.example.com")).toBeNull();
  });
});
