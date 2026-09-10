import { describe, expect, it } from "vitest";
import { hasAllPositiveDreamValues } from "./onboardingDreamValues";

describe("onboarding dream values", () => {
  const dreams = ["Sonho A", "Sonho B", "Sonho C"];

  it("does not continue when no values are filled", () => {
    expect(hasAllPositiveDreamValues(dreams, {})).toBe(false);
    expect(hasAllPositiveDreamValues(dreams, {
      "Sonho A": "",
      "Sonho B": "R$ 0,00",
      "Sonho C": "",
    })).toBe(false);
  });

  it("does not continue when only some dreams have a value", () => {
    expect(hasAllPositiveDreamValues(dreams, {
      "Sonho A": "R$ 5.000,00",
      "Sonho B": "R$ 0,00",
      "Sonho C": "R$ 10.000,00",
    })).toBe(false);
  });

  it("continues only when every selected dream has a value greater than zero", () => {
    expect(hasAllPositiveDreamValues(dreams, {
      "Sonho A": "R$ 5.000,00",
      "Sonho B": "R$ 1,00",
      "Sonho C": "R$ 10.000,00",
    })).toBe(true);
  });
});
