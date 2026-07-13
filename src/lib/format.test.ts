import { describe, expect, it } from "vitest";
import { formatBRLInputFromDigits, parseBRLToCents } from "./format";

describe("money formatting", () => {
  it.each([
    ["2400", 240000],
    ["2.400,50", 240050],
    ["2400.50", 240050],
    ["R$ 12,34", 1234],
    ["", 0],
  ])("parses %s into integer cents", (input, expected) => {
    expect(parseBRLToCents(input)).toBe(expected);
  });

  it("formats digit input without losing cents", () => {
    expect(formatBRLInputFromDigits("1234")).toMatch(/12,34/);
  });
});
