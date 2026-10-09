import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canAllocateCycleSurplus,
  commitmentPaymentParams,
  journeyTabAfterPlanningAction,
  planningExitLabel,
  surplusAllocationParams,
} from "./planningCycleActions";

const root = dirname(fileURLToPath(import.meta.url));
const cycle = { key: "calendar:2026-10", start: "2026-10-01", end: "2026-11-01", label: "Outubro" };

describe("planning cycle actions", () => {
  it("shows the surplus action only when the existing planned free amount is positive", () => {
    expect(canAllocateCycleSurplus(null)).toBe(false);
    expect(canAllocateCycleSurplus({
      expectedIncomeCents: 100_000,
      reserveCents: 20_000,
      allocatedCents: 0,
      commitments: [{ kind: "fixed_bill", amount_cents: 80_000, paid_cents: 0, pending_cents: 80_000 }],
    })).toBe(false);
    expect(canAllocateCycleSurplus({
      expectedIncomeCents: 100_000,
      reserveCents: 20_000,
      allocatedCents: 0,
      commitments: [{ kind: "fixed_bill", amount_cents: 30_000, paid_cents: 0, pending_cents: 30_000 }],
    })).toBe(true);
  });

  it("keeps the payment and surplus routes and returns planning only when asked", () => {
    expect(commitmentPaymentParams({ cycle }, { id: "bill-1" }, "planejamento")).toMatchObject({
      commitmentId: "bill-1",
      cycleKey: cycle.key,
      returnTo: "planejamento",
    });
    expect(surplusAllocationParams({ cycle, availableCents: 45_000 }, "planejamento")).toMatchObject({
      availableCents: "45000",
      returnTo: "planejamento",
    });
    expect(commitmentPaymentParams({ cycle }, { id: "bill-1" })).not.toHaveProperty("returnTo");
    expect(journeyTabAfterPlanningAction("planejamento")).toEqual({
      pathname: "/(app)/journey",
      params: { tab: "planejamento" },
    });
    expect(journeyTabAfterPlanningAction(undefined, "2026-10-01").params).toEqual({
      tab: "controle",
      cycleDate: "2026-10-01",
    });
    expect(planningExitLabel("planejamento")).toBe("Voltar ao planejamento");
    expect(planningExitLabel(undefined)).toBe("Voltar ao Resumo");
  });

  it("moves the old summary actions into planning and keeps guided focused", () => {
    const screen = readFileSync(join(root, "FinancialPlanScreen.tsx"), "utf8");
    const actions = readFileSync(join(root, "PlanningActionsSection.tsx"), "utf8");
    const copy = readFileSync(join(root, "planningCycleActions.ts"), "utf8");
    const summary = readFileSync(join(root, "../summary/SummaryTab.tsx"), "utf8");
    const journey = readFileSync(join(root, "../../../app/(app)/journey.tsx"), "utf8");
    expect(screen).toContain("{!guided ? <PlanningActionsSection overview={cycleOverview} /> : null}");
    expect(copy).toContain("Revisar pagamentos");
    expect(copy).toContain("Guardar para um sonho");
    expect(actions).toContain("PLANNING_CYCLE_ACTION_COPY.reviewPayments");
    expect(actions).toContain("PLANNING_CYCLE_ACTION_COPY.allocateDream");
    expect(actions).toContain('"/(app)/link-commitment"');
    expect(actions).toContain('"/(app)/allocate-surplus"');
    expect(actions).toContain("canAllocateCycleSurplus");
    expect(actions).not.toContain("Seu planejamento");
    expect(summary).not.toContain("Seu planejamento");
    expect(summary).not.toContain("ObservedPlanningAccess");
    expect(summary).toContain("Extrato importado");
    expect(journey).not.toContain("Desafio de hoje");
    expect(journey).toContain('label: "Planejamento"');
  });
});
