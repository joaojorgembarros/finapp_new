import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { journeyContentScrollProps, planningScrollBottomPadding, showsPlanningRouteChrome } from "./planningChrome";
import { getJourneyBottomContentInset } from "../../ui/journeyChrome";

const root = dirname(fileURLToPath(import.meta.url));

describe("planning chrome", () => {
  it("keeps the back button on the stacked route and off the tab", () => {
    expect(showsPlanningRouteChrome("standalone")).toBe(true);
    expect(showsPlanningRouteChrome("embedded")).toBe(false);
  });

  it("forwards the journey scroll handler only when a tab provides one", () => {
    const handler = () => undefined;
    expect(journeyContentScrollProps(undefined)).toBeNull();
    expect(journeyContentScrollProps(handler)).toEqual({ onScroll: handler, scrollEventThrottle: 16 });
  });

  it("reserves the floating tab bar only for the embedded screen", () => {
    expect(planningScrollBottomPadding("embedded", 48, 0)).toBe(getJourneyBottomContentInset(48));
    expect(planningScrollBottomPadding("standalone", 48, 12)).toBe(44);
    expect(planningScrollBottomPadding("embedded", 0, 20)).toBe(getJourneyBottomContentInset(0) + 20);
  });

  it("uses one planning screen for the tab and the stacked route", () => {
    const screen = readFileSync(join(root, "FinancialPlanScreen.tsx"), "utf8");
    const route = readFileSync(join(root, "../../../app/(app)/financial-plan.tsx"), "utf8");
    const journey = readFileSync(join(root, "../../../app/(app)/journey.tsx"), "utf8");
    expect(route).toContain('mode="standalone"');
    expect(journey).toContain('mode="embedded" onScroll={onContentScroll}');
    expect(route).not.toContain("onScroll");
    expect(screen).toContain("journeyContentScrollProps(onScroll)");
    expect(journey).toContain('label: "Planejamento"');
    expect(journey).toContain('icon: "calendar-outline"');
    expect(journey).not.toContain("Desafios");
    expect(screen).toContain('const guided = routeChrome && requestedGuided === "1"');
    expect(screen).toContain("Organize o seu ciclo");
    expect(screen).toContain("AllocatableCashSection");
    expect(screen).toContain("Como é o seu ciclo?");
    expect(screen).toContain("O que ainda falta pagar?");
    expect(screen).toContain('reviewReturn={mode === "embedded" ? "planejamento" : "financial-plan"}');
  });
});
