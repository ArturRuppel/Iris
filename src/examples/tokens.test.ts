import { describe, expect, it } from "vitest";
import { parseExampleToken, parseOpenToken, parseTutorialToken } from "./tokens";

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
  it("does not mistake an iris-tutorial link for an open token", () => {
    expect(parseOpenToken("iris-tutorial:quickstart")).toBeNull();
  });
});

describe("parseTutorialToken", () => {
  it("parses a tutorial token into an id", () => {
    expect(parseTutorialToken("iris-tutorial:quickstart")).toEqual({ tutorialId: "quickstart" });
  });
  it("returns null for an open token or an ordinary link", () => {
    expect(parseTutorialToken("iris-open:mann-whitney")).toBeNull();
    expect(parseTutorialToken("https://docs.example.com")).toBeNull();
  });
  it("returns null when the id is missing", () => {
    expect(parseTutorialToken("iris-tutorial:")).toBeNull();
  });
});
