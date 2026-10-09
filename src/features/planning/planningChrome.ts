import { getJourneyBottomContentInset } from "../../ui/journeyChrome";

export type PlanningMode = "embedded" | "standalone";

export function showsPlanningRouteChrome(mode: PlanningMode) {
  return mode === "standalone";
}

export function planningScrollBottomPadding(mode: PlanningMode, safeBottom: number, keyboardInset: number) {
  const base = mode === "embedded" ? getJourneyBottomContentInset(safeBottom) : 32;
  return base + Math.max(0, keyboardInset);
}

/** Same scroll contract Sonhos, Movimentações and Resumo pass to the journey header. */
export function journeyContentScrollProps<T>(onScroll?: T) {
  if (!onScroll) return null;
  return { onScroll, scrollEventThrottle: 16 as const };
}
