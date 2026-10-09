import type { JourneyTab } from "./journeyTabs";

export type MainTab = JourneyTab;
export type AndroidBackAction = "close-menu" | "go-home" | "warn-exit" | "confirm-exit";

/** Home tab for Android back and cold start. */
export const HOME_TAB: MainTab = "jornada";

export function getAndroidBackAction(opts: {
  menuOpen: boolean;
  tab: MainTab;
  isSecondPress: boolean;
}): AndroidBackAction {
  if (opts.menuOpen) return "close-menu";
  if (opts.tab !== HOME_TAB) return "go-home";
  return opts.isSecondPress ? "confirm-exit" : "warn-exit";
}
