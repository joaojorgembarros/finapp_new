import { getJourneyBottomContentInset } from "../../ui/journeyChrome";

export type PlanningMode = "embedded" | "standalone";

export function showsPlanningRouteChrome(mode: PlanningMode) {
  return mode === "standalone";
}

export function planningScrollBottomPadding(mode: PlanningMode, safeBottom: number, keyboardInset: number) {
  const base = mode === "embedded" ? getJourneyBottomContentInset(safeBottom) : 32;
  return base + Math.max(0, keyboardInset);
}
