import { describe, expect, it } from "vitest";
import {
  FLOATING_TAB_BAR_CONTENT_GAP,
  FLOATING_TAB_BAR_HEIGHT,
  FLOATING_TAB_BAR_VISUAL_GAP,
  JOURNEY_HEADER_HEIGHT,
  getFloatingTabBarBottomOffset,
  getJourneyBottomContentInset,
  isJourneyAvatarTouchable,
  resolveSafeBottomInset,
  resolveSafeTopInset,
  shouldShowStandaloneScreenHeader,
} from "./journeyChrome";

describe("floating tab bar insets", () => {
  it("places the pill at insets.bottom plus a small visual gap", () => {
    expect(getFloatingTabBarBottomOffset(0)).toBe(FLOATING_TAB_BAR_VISUAL_GAP);
    expect(getFloatingTabBarBottomOffset(8)).toBe(
      8 + FLOATING_TAB_BAR_VISUAL_GAP,
    );
    expect(getFloatingTabBarBottomOffset(48)).toBe(
      48 + FLOATING_TAB_BAR_VISUAL_GAP,
    );
  });

  it("treats invalid inset values as zero", () => {
    expect(getFloatingTabBarBottomOffset(Number.NaN)).toBe(
      FLOATING_TAB_BAR_VISUAL_GAP,
    );
    expect(getFloatingTabBarBottomOffset(-12)).toBe(
      FLOATING_TAB_BAR_VISUAL_GAP,
    );
  });

  it("reserves tab height, content gap, system inset, and visual gap", () => {
    expect(FLOATING_TAB_BAR_HEIGHT).toBe(60);
    expect(getJourneyBottomContentInset(0)).toBe(
      FLOATING_TAB_BAR_HEIGHT +
        FLOATING_TAB_BAR_CONTENT_GAP +
        FLOATING_TAB_BAR_VISUAL_GAP,
    );
    expect(getJourneyBottomContentInset(48)).toBe(
      FLOATING_TAB_BAR_HEIGHT +
        FLOATING_TAB_BAR_CONTENT_GAP +
        48 +
        FLOATING_TAB_BAR_VISUAL_GAP,
    );
  });
});

describe("safe inset resolvers", () => {
  it("uses the live top inset when present", () => {
    expect(resolveSafeTopInset(44, 24)).toBe(44);
  });

  it("falls back to StatusBar height when edge-to-edge reports top 0", () => {
    expect(resolveSafeTopInset(0, 24)).toBe(24);
    expect(resolveSafeTopInset(Number.NaN, 24)).toBe(24);
  });

  it("keeps bottom inset as the real system value", () => {
    expect(resolveSafeBottomInset(48)).toBe(48);
    expect(resolveSafeBottomInset(0)).toBe(0);
    expect(resolveSafeBottomInset(-4)).toBe(0);
  });
});

describe("embedded screen header", () => {
  it("hides the nested ScreenHeaderCard and keeps it on standalone routes", () => {
    expect(shouldShowStandaloneScreenHeader(true)).toBe(false);
    expect(shouldShowStandaloneScreenHeader(false)).toBe(true);
  });
});

describe("journey avatar hitbox", () => {
  it("disables touches only after the avatar has faded out", () => {
    expect(isJourneyAvatarTouchable(0, true)).toBe(true);
    expect(isJourneyAvatarTouchable(JOURNEY_HEADER_HEIGHT * 0.64, true)).toBe(
      true,
    );
    expect(isJourneyAvatarTouchable(JOURNEY_HEADER_HEIGHT * 0.65, true)).toBe(
      false,
    );
  });

  it("uses hysteresis so scroll does not toggle the hitbox every frame", () => {
    expect(isJourneyAvatarTouchable(JOURNEY_HEADER_HEIGHT, false)).toBe(false);
    expect(isJourneyAvatarTouchable(JOURNEY_HEADER_HEIGHT * 0.4, false)).toBe(
      false,
    );
    expect(isJourneyAvatarTouchable(JOURNEY_HEADER_HEIGHT * 0.35, false)).toBe(
      true,
    );
  });
});
