const DEFAULT_SCROLL_RUNWAY = 96;
const MAX_SCROLL_RUNWAY = 320;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Returns the bottom space a scroll view needs while the keyboard is open.
 *
 * `keyboardOverlap` alone is not enough on Android with adjustResize: after the
 * window is resized the measured overlap becomes zero, but the last field still
 * needs some scrollable content after it so it can move above the keyboard.
 */
export function getKeyboardBottomSpace(
  keyboardOverlap: number,
  focusedFieldHeight: number | undefined,
  topOffset = 16
) {
  const overlap = finiteNonNegative(keyboardOverlap);
  const fieldHeight = finiteNonNegative(focusedFieldHeight ?? 0);
  const offset = finiteNonNegative(topOffset);
  const runway = Math.min(
    MAX_SCROLL_RUNWAY,
    Math.max(DEFAULT_SCROLL_RUNWAY, fieldHeight + offset)
  );

  return Math.max(overlap, runway);
}

type KeyboardScrollGeometry = {
  scrollWindowY: number;
  scrollWindowHeight: number;
  keyboardTop: number;
  fieldWindowY: number;
  fieldHeight: number;
  currentScrollY: number;
  contentHeight: number;
  topOffset?: number;
  bottomOffset?: number;
};

export function getKeyboardScrollAdjustment({
  scrollWindowY,
  scrollWindowHeight,
  keyboardTop,
  fieldWindowY,
  fieldHeight,
  currentScrollY,
  contentHeight,
  topOffset = 16,
  bottomOffset = 18,
}: KeyboardScrollGeometry) {
  const visibleTop = scrollWindowY + topOffset;
  const visibleBottom = Math.min(
    scrollWindowY + scrollWindowHeight,
    keyboardTop
  ) - bottomOffset;

  if (!Number.isFinite(visibleBottom) || visibleBottom <= visibleTop) return null;

  const fieldBottom = fieldWindowY + fieldHeight;
  let delta = 0;
  if (fieldBottom > visibleBottom) delta = fieldBottom - visibleBottom;
  else if (fieldWindowY < visibleTop) delta = fieldWindowY - visibleTop;
  else return null;

  const targetY = Math.max(currentScrollY + delta, 0);
  const maximumScrollY = Math.max(contentHeight - scrollWindowHeight, 0);

  return {
    targetY,
    missingRunway: delta > 0
      ? Math.max(0, Math.ceil(targetY - maximumScrollY + bottomOffset))
      : 0,
  };
}
