export const JOURNEY_HEADER_HEIGHT = 56;

export const FLOATING_TAB_BAR_ITEM_SIZE = 48;
export const FLOATING_TAB_BAR_HIGHLIGHT_SIZE = 44;
export const FLOATING_TAB_BAR_PILL_PADDING_VERTICAL = 6;
export const FLOATING_TAB_BAR_HEIGHT =
  FLOATING_TAB_BAR_ITEM_SIZE + FLOATING_TAB_BAR_PILL_PADDING_VERTICAL * 2;
export const FLOATING_TAB_BAR_CONTENT_GAP = 12;
/** Small breathing gap above the system navigation / home indicator. */
export const FLOATING_TAB_BAR_VISUAL_GAP = 8;

const AVATAR_HIDE_OFFSET = JOURNEY_HEADER_HEIGHT * 0.65;
const AVATAR_SHOW_OFFSET = JOURNEY_HEADER_HEIGHT * 0.35;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Prefer the live safe-area inset. When Android edge-to-edge reports 0 while
 * content still draws under the status bar, fall back to StatusBar.currentHeight.
 */
export function resolveSafeTopInset(
  insetsTop: number,
  statusBarHeight = 0,
) {
  const top = finiteNonNegative(insetsTop);
  if (top > 0) return top;
  return finiteNonNegative(statusBarHeight);
}

export function resolveSafeBottomInset(insetsBottom: number) {
  return finiteNonNegative(insetsBottom);
}

/** Tab bar sits above the system inset with only a small visual gap. */
export function getFloatingTabBarBottomOffset(safeBottom: number) {
  return resolveSafeBottomInset(safeBottom) + FLOATING_TAB_BAR_VISUAL_GAP;
}

export function getJourneyBottomContentInset(safeBottom: number) {
  return (
    FLOATING_TAB_BAR_HEIGHT +
    FLOATING_TAB_BAR_CONTENT_GAP +
    getFloatingTabBarBottomOffset(safeBottom)
  );
}

export function shouldShowStandaloneScreenHeader(embedded: boolean) {
  return !embedded;
}

export function isJourneyAvatarTouchable(
  scrollOffset: number,
  currentlyTouchable: boolean,
) {
  const offset = finiteNonNegative(scrollOffset);
  if (currentlyTouchable) return offset < AVATAR_HIDE_OFFSET;
  return offset <= AVATAR_SHOW_OFFSET;
}
