export const JOURNEY_HEADER_HEIGHT = 56;

export const FLOATING_TAB_BAR_ITEM_SIZE = 48;
export const FLOATING_TAB_BAR_HIGHLIGHT_SIZE = 44;
export const FLOATING_TAB_BAR_PILL_PADDING_VERTICAL = 6;
export const FLOATING_TAB_BAR_HEIGHT =
  FLOATING_TAB_BAR_ITEM_SIZE + FLOATING_TAB_BAR_PILL_PADDING_VERTICAL * 2;
export const FLOATING_TAB_BAR_CONTENT_GAP = 12;
export const FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET = 10;

const AVATAR_HIDE_OFFSET = JOURNEY_HEADER_HEIGHT * 0.65;
const AVATAR_SHOW_OFFSET = JOURNEY_HEADER_HEIGHT * 0.35;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getFloatingTabBarBottomOffset(safeBottom: number) {
  return Math.max(
    finiteNonNegative(safeBottom),
    FLOATING_TAB_BAR_MIN_BOTTOM_OFFSET,
  );
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
