import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ALLOCATABLE_CASH_COPY,
  allocationAmountIssue,
  allocationConfirmCopy,
  allocationSuccessCopy,
  buildAllocatableBreakdown,
  buildAllocatableCashView,
  canSubmitAllocation,
  classifyAllocationError,
  createAllocationRequestId,
  isAllocatableGoal,
  resolveAllocationRequestId,
} from "./allocatableCashPresentation";
import type { AllocatableCashPosition } from "./financialAllocatableCash";

vi.mock("./supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

const root = dirname(fileURLToPath(import.meta.url));

function position(partial: Partial<AllocatableCashPosition> = {}): AllocatableCashPosition {
  return {
    knownCashCents: 1_327_993,
    earmarkedCents: 200_000,
    pendingDueCents: 200_000,
    reservePolicyCents: 100_000,
    availableToOrganizeCents: 827_993,
    cashAsOfDate: "2026-10-08",
    referenceDate: "2026-10-08",
    cycleKey: "calendar:2026-10",
    cycleStart: "2026-10-01",
    cycleEnd: "2026-11-01",
    accounts: [],
    dataQuality: {
      hasSnapshot: true,
      isStale: false,
      datesDiffer: false,
      sameBankRisk: false,
      sameBankIds: [],
      missingBankIds: [],
      hasAmbiguousGoalContributions: false,
      ambiguousContributionCount: 0,
    },
    blockReasons: [],
    canAllocate: true,
    ...partial,
  };
}

describe("allocatable cash presentation", () => {
  it("shows the server amount for a distributable position", () => {
    const view = buildAllocatableCashView({ status: "ready", position: position() });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.amountCents).toBe(827_993);
    expect(view.title).toBe("Dinheiro para organizar");
    expect(view.ctaLabel).toBe(ALLOCATABLE_CASH_COPY.distribute);
    expect(view.asOf).toBe("Com base nos extratos até 08/10");
    expect(view.message).not.toMatch(/saldo livre|pode gastar|sobrando/i);
  });

  it("lists the server breakdown without recomputing the total", () => {
    const decoy = position({
      knownCashCents: 1_000,
      earmarkedCents: 0,
      pendingDueCents: 0,
      reservePolicyCents: 0,
      availableToOrganizeCents: 400,
    });
    const lines = buildAllocatableBreakdown(decoy);
    expect(lines.map((line) => [line.label, line.cents])).toEqual([
      ["Saldo conhecido", 1_000],
      ["Já destinado", 0],
      ["Contas a vencer", 0],
      ["Reserva protegida", 0],
      ["Para organizar", 400],
    ]);
    expect(lines.find((line) => line.key === "available")?.cents).toBe(400);
  });

  it("explains a valid position with nothing left to organize", () => {
    const view = buildAllocatableCashView({
      status: "ready",
      position: position({ availableToOrganizeCents: 0 }),
    });
    expect(view.kind).toBe("none");
    if (view.kind !== "none") return;
    expect(view.message).toBe(ALLOCATABLE_CASH_COPY.empty);
    expect(view.breakdown.find((line) => line.key === "available")?.cents).toBe(0);
    expect("ctaLabel" in view).toBe(false);
  });

  it.each([
    ["no_snapshot", "Precisamos de um extrato com saldo para calcular quanto você pode organizar.", "Importar extrato"],
    ["stale_snapshot", "Seu saldo conhecido está desatualizado.", "Atualizar extrato"],
    ["same_bank_risk", "Não conseguimos confirmar todas as contas deste banco.", null],
    ["missing_account_snapshot", "Há uma conta no histórico sem saldo conhecido.", null],
    ["dates_differ", "Seus saldos estão em datas diferentes.", "Atualizar extrato"],
    ["ambiguous_goal_contributions", "Existem valores antigos guardados em sonhos que precisam ser revisados.", "Revisar valores guardados"],
  ] as const)("explains %s without enabling distribution", (reason, message, ctaLabel) => {
    const view = buildAllocatableCashView({
      status: "ready",
      position: position({
        canAllocate: false,
        availableToOrganizeCents: null,
        blockReasons: [reason],
      }),
    });
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toBe(message);
    expect(view.ctaLabel).toBe(ctaLabel);
    expect(view.ctaAction).toBe(reason === "ambiguous_goal_contributions" ? "review" : ctaLabel ? "import" : null);
    expect(view).not.toHaveProperty("amountCents");
  });

  it("offers review when old savings are an extra blocker", () => {
    const view = buildAllocatableCashView({
      status: "ready",
      position: position({
        canAllocate: false,
        availableToOrganizeCents: null,
        blockReasons: ["stale_snapshot", "ambiguous_goal_contributions"],
      }),
    });
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.ctaAction).toBe("import");
    expect(view.reviewCtaLabel).toBe("Revisar valores guardados");
  });

  it("rejects zero, amounts above the available cash, and amounts above the goal", () => {
    expect(allocationAmountIssue({
      amountCents: 0,
      typed: true,
      availableCents: 500,
      goalRemainingCents: 800,
    })).toBe("zero");
    expect(allocationAmountIssue({
      amountCents: 600,
      typed: true,
      availableCents: 500,
      goalRemainingCents: 800,
    })).toBe("over_available");
    expect(allocationAmountIssue({
      amountCents: 700,
      typed: true,
      availableCents: 900,
      goalRemainingCents: 600,
    })).toBe("over_goal");
    expect(canSubmitAllocation({
      saving: false,
      goalSelected: true,
      issue: null,
      amountCents: 100,
    })).toBe(true);
    expect(canSubmitAllocation({
      saving: true,
      goalSelected: true,
      issue: null,
      amountCents: 100,
    })).toBe(false);
  });

  it("hides a completed goal and confirms an earmark instead of a transfer", () => {
    expect(isAllocatableGoal({ target_cents: 100, contributed_cents: 100 })).toBe(false);
    expect(isAllocatableGoal({ target_cents: 100, contributed_cents: 40 })).toBe(true);
    expect(allocationConfirmCopy(200_000, "Viagem").detail).toMatch(/não movimenta dinheiro entre contas/);
  });

  it("uses one success sentence for a new allocation and a replay", () => {
    const copy = allocationSuccessCopy(200_000, "Viagem");
    expect(copy).toBe("R$\u00a02.000,00 destinados para Viagem.");
    expect(copy).not.toMatch(/duplic|replay|novamente/i);
  });

  it("reuses the request id only for the same goal and amount", () => {
    const first = resolveAllocationRequestId(null, "goal-1", 200_000, () => "request-1");
    const retry = resolveAllocationRequestId(first, "goal-1", 200_000, () => "request-2");
    const changed = resolveAllocationRequestId(first, "goal-1", 100_000, () => "request-3");
    expect(retry.id).toBe("request-1");
    expect(changed.id).toBe("request-3");
    expect(createAllocationRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("maps concurrency, data-quality, and goal-limit failures", () => {
    expect(classifyAllocationError({ message: "known_cash:insufficient_available_cash" })).toMatchObject({
      kind: "insufficient",
      message: ALLOCATABLE_CASH_COPY.insufficient,
    });
    expect(classifyAllocationError({ message: "known_cash:stale_snapshot" })).toMatchObject({
      kind: "blocked",
      reason: "stale_snapshot",
    });
    expect(classifyAllocationError({ message: "known_cash:goal_completed" }).message).toBe(
      ALLOCATABLE_CASH_COPY.goalChanged,
    );
    expect(classifyAllocationError({ message: "known_cash:amount_exceeds_goal_remaining" }).kind).toBe(
      "goal_changed",
    );
  });

  it("keeps a read failure inside the cash card", () => {
    const view = buildAllocatableCashView({ status: "error", position: null });
    expect(view).toMatchObject({
      kind: "error",
      message: ALLOCATABLE_CASH_COPY.error,
      retryLabel: ALLOCATABLE_CASH_COPY.retry,
    });
  });

  it("does not calculate cash from history, income, or a local transaction", () => {
    const presentation = readFileSync(join(root, "allocatableCashPresentation.ts"), "utf8");
    const sheet = readFileSync(join(root, "../features/planning/GoalAllocationSheet.tsx"), "utf8");
    const section = readFileSync(join(root, "../features/planning/AllocatableCashSection.tsx"), "utf8");
    expect(presentation).not.toMatch(/income_fixed_cents|income_variable_avg_cents|createTransaction/);
    expect(sheet).not.toMatch(/createTransaction|from\("transactions"\)/);
    expect(section).toMatch(/getAllocatableCashPosition/);
    expect(sheet).toMatch(/allocateKnownCashToGoal/);
    const view = buildAllocatableCashView({
      status: "ready",
      position: position({ knownCashCents: 50_000, availableToOrganizeCents: 12_000 }),
    });
    expect(view.kind).toBe("ready");
    if (view.kind === "ready") expect(view.amountCents).toBe(12_000);
  });
});
