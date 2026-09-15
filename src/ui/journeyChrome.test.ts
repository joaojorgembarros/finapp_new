import { describe, expect, it } from "vitest";
import {
  FLOATING_TAB_BAR_CONTENT_GAP,
  FLOATING_TAB_BAR_HEIGHT,
  FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET,
  JOURNEY_HEADER_HEIGHT,
  getFloatingTabBarBottomOffset,
  getJourneyBottomContentInset,
  isJourneyAvatarTouchable,
  shouldShowStandaloneScreenHeader,
} from "./journeyChrome";

describe("floating tab bar insets", () => {
  it("keeps the pill above the home indicator with a minimum offset", () => {
    expect(getFloatingTabBarBottomOffset(0)).toBe(
      FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET,
    );
    expect(getFloatingTabBarBottomOffset(8)).toBe(
      FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET,
    );
    expect(getFloatingTabBarBottomOffset(34)).toBe(34);
  });

  it("treats invalid inset values as zero", () => {
    expect(getFloatingTabBarBottomOffset(Number.NaN)).toBe(
      FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET,
    );
    expect(getFloatingTabBarBottomOffset(-12)).toBe(
      FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET,
    );
  });

  it("clears the pill height, gap, and safe bottom without stacking extra padding", () => {
    expect(FLOATING_TAB_BAR_HEIGHT).toBe(60);
    expect(getJourneyBottomContentInset(0)).toBe(
      FLOATING_TAB_BAR_HEIGHT +
        FLOATING_TAB_BAR_CONTENT_GAP +
        FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET,
    );
    expect(getJourneyBottomContentInset(34)).toBe(
      FLOATING_TAB_BAR_HEIGHT + FLOATING_TAB_BAR_CONTENT_GAP + 34,
    );
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
