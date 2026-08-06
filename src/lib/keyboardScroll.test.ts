import { describe, expect, it } from "vitest";
import {
  getKeyboardBottomSpace,
  getKeyboardScrollAdjustment,
} from "./keyboardScroll";

describe("getKeyboardBottomSpace", () => {
  it("keeps scroll runway when adjustResize reports no overlap", () => {
    expect(getKeyboardBottomSpace(0, 210, 16)).toBe(226);
  });

  it("uses the real overlap when the keyboard covers the scroll view", () => {
    expect(getKeyboardBottomSpace(430, 210, 16)).toBe(430);
  });

  it("provides a safe fallback before the field has been measured", () => {
    expect(getKeyboardBottomSpace(0, undefined)).toBe(96);
  });

  it("caps unusually large fields to avoid excessive empty space", () => {
    expect(getKeyboardBottomSpace(0, 900, 16)).toBe(320);
  });
});

describe("getKeyboardScrollAdjustment", () => {
  it("calculates extra runway for a third field below the keyboard", () => {
    expect(getKeyboardScrollAdjustment({
      scrollWindowY: 580,
      scrollWindowHeight: 330,
      keyboardTop: 910,
      fieldWindowY: 960,
      fieldHeight: 48,
      currentScrollY: 350,
      contentHeight: 720,
    })).toEqual({ targetY: 466, missingRunway: 94 });
  });

  it("returns the exact scroll after the required runway exists", () => {
    expect(getKeyboardScrollAdjustment({
      scrollWindowY: 580,
      scrollWindowHeight: 330,
      keyboardTop: 910,
      fieldWindowY: 960,
      fieldHeight: 48,
      currentScrollY: 350,
      contentHeight: 820,
    })).toEqual({ targetY: 466, missingRunway: 0 });
  });

  it("does nothing when the focused field is already visible", () => {
    expect(getKeyboardScrollAdjustment({
      scrollWindowY: 580,
      scrollWindowHeight: 330,
      keyboardTop: 910,
      fieldWindowY: 700,
      fieldHeight: 48,
      currentScrollY: 120,
      contentHeight: 800,
    })).toBeNull();
  });

  it("moves the field higher when the screen requests more keyboard clearance", () => {
    expect(getKeyboardScrollAdjustment({
      scrollWindowY: 580,
      scrollWindowHeight: 330,
      keyboardTop: 910,
      fieldWindowY: 820,
      fieldHeight: 48,
      currentScrollY: 300,
      contentHeight: 900,
      bottomOffset: 64,
    })).toEqual({ targetY: 322, missingRunway: 0 });
  });
});
