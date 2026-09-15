import { describe, expect, it } from "vitest";
import {
  buildFutureMonthCards,
  buildIncomeBreakdown,
  buildObligationSurplus,
  commitmentAppliesToCycle,
  detectSummarySetupGaps,
  groupCommittedMoney,
  shortCycleMonthLabel,
  type SummaryCommitment,
} from "./summaryPresentation";

function commitment(
  partial: Partial<SummaryCommitment> & Pick<SummaryCommitment, "kind" | "amount_cents">
): SummaryCommitment {
  return {
    kind: partial.kind,
    amount_cents: partial.amount_cents,
    due_day: partial.due_day ?? 10,
    starts_on: partial.starts_on ?? "2026-01-01",
    ends_on: partial.ends_on ?? null,
    installments_total: partial.installments_total ?? (partial.kind === "installment" ? 3 : null),
    active: partial.active ?? true,
    archived_at: partial.archived_at ?? null,
  };
}

describe("summaryPresentation", () => {
  it("builds income with fixed only", () => {
    expect(buildIncomeBreakdown({ incomeFixedCents: 350_000, incomeVariableAvgCents: 0 })).toEqual({
      fixedCents: 350_000,
      variableCents: 0,
      totalCents: 350_000,
    });
  });

  it("builds income with fixed + variable estimate", () => {
    expect(buildIncomeBreakdown({ incomeFixedCents: 350_000, incomeVariableAvgCents: 100_000 })).toEqual({
      fixedCents: 350_000,
      variableCents: 100_000,
      totalCents: 450_000,
    });
  });

  it("falls back to legacy income_cents", () => {
    expect(buildIncomeBreakdown({ incomeFixedCents: 0, incomeVariableAvgCents: 0, incomeCents: 200_000 })).toEqual({
      fixedCents: 200_000,
      variableCents: 0,
      totalCents: 200_000,
    });
  });

  it("groups fixed bills, debts and reserve", () => {
    const grouped = groupCommittedMoney({
      reserveCents: 40_000,
      commitments: [
        { kind: "fixed_bill", amount_cents: 130_000, paid_cents: 130_000, pending_cents: 0 },
        { kind: "debt", amount_cents: 50_000, paid_cents: 0, pending_cents: 50_000 },
        { kind: "installment", amount_cents: 45_000, paid_cents: 20_000, pending_cents: 25_000 },
      ],
    });

    expect(grouped.fixedBillsCents).toBe(130_000);
    expect(grouped.debtsAndInstallmentsCents).toBe(95_000);
    expect(grouped.destinedTotalCents).toBe(265_000);
    expect(grouped.paidCommitmentsCents).toBe(150_000);
    expect(grouped.pendingCommitmentsCents).toBe(75_000);
  });

  it("splits surplus into dreams and day-to-day using projectedAvailableCents semantics", () => {
    const surplus = buildObligationSurplus({
      expectedIncomeCents: 450_000,
      commitmentsTotalCents: 225_000,
      reserveCents: 40_000,
      dreamsAllocatedCents: 60_000,
    });

    expect(surplus.plannedFreeCents).toBe(185_000);
    expect(surplus.dreamsAllocatedCents).toBe(60_000);
    expect(surplus.dayToDayCents).toBe(125_000);
  });

  it("keeps planned free at zero when obligations exceed income", () => {
    const surplus = buildObligationSurplus({
      expectedIncomeCents: 100_000,
      commitmentsTotalCents: 120_000,
      reserveCents: 10_000,
      dreamsAllocatedCents: 0,
    });
    expect(surplus.plannedFreeCents).toBe(0);
    expect(surplus.dayToDayCents).toBe(0);
  });

  it("stops installments after installments_total", () => {
    const installment = commitment({
      kind: "installment",
      amount_cents: 50_000,
      starts_on: "2026-09-01",
      installments_total: 2,
      due_day: 5,
    });

    expect(commitmentAppliesToCycle(installment, {
      start: "2026-09-01",
      end: "2026-10-01",
    })?.installment_number).toBe(1);

    expect(commitmentAppliesToCycle(installment, {
      start: "2026-10-01",
      end: "2026-11-01",
    })?.installment_number).toBe(2);

    expect(commitmentAppliesToCycle(installment, {
      start: "2026-11-01",
      end: "2026-12-01",
    })).toBeNull();
  });

  it("honors ends_on for open debts", () => {
    const debt = commitment({
      kind: "debt",
      amount_cents: 80_000,
      starts_on: "2026-01-01",
      ends_on: "2026-10-15",
      due_day: 10,
      installments_total: null,
    });

    expect(commitmentAppliesToCycle(debt, {
      start: "2026-10-01",
      end: "2026-11-01",
    })).not.toBeNull();

    expect(commitmentAppliesToCycle(debt, {
      start: "2026-11-01",
      end: "2026-12-01",
    })).toBeNull();
  });

  it("projects future months with recurring fixed bills", () => {
    const cards = buildFutureMonthCards({
      expectedIncomeCents: 450_000,
      reserveCents: 40_000,
      cycles: [
        { key: "calendar:2026-09", start: "2026-09-01", end: "2026-10-01", label: "Setembro", offset: 0 },
        { key: "calendar:2026-10", start: "2026-10-01", end: "2026-11-01", label: "Outubro", offset: 1 },
        { key: "calendar:2026-11", start: "2026-11-01", end: "2026-12-01", label: "Novembro", offset: 2 },
      ],
      commitments: [
        commitment({
          kind: "fixed_bill",
          amount_cents: 130_000,
          starts_on: "2026-01-01",
          due_day: 5,
          installments_total: null,
        }),
        commitment({
          kind: "installment",
          amount_cents: 50_000,
          starts_on: "2026-09-01",
          installments_total: 2,
          due_day: 5,
        }),
      ],
    });

    expect(cards).toHaveLength(3);
    expect(cards[0].destinedTotalCents).toBe(220_000);
    expect(cards[0].plannedFreeCents).toBe(230_000);
    expect(cards[1].destinedTotalCents).toBe(220_000);
    expect(cards[2].destinedTotalCents).toBe(170_000);
    expect(cards[2].plannedFreeCents).toBe(280_000);
  });

  it("detects setup gaps without inventing data", () => {
    expect(detectSummarySetupGaps({
      income: { fixedCents: 0, variableCents: 0, totalCents: 0 },
      committed: {
        fixedBillsCents: 0,
        debtsAndInstallmentsCents: 0,
        reserveCents: 0,
        commitmentsTotalCents: 0,
        destinedTotalCents: 0,
        paidCommitmentsCents: 0,
        pendingCommitmentsCents: 0,
      },
      settingsUpdatedBy: null,
      cycleMode: "calendar",
      hasGoals: false,
    })).toEqual({
      missingIncome: true,
      missingFixedBills: true,
      missingReserve: true,
      missingPaydayConfig: true,
      missingDreams: true,
    });
  });

  it("formats compact month labels", () => {
    expect(shortCycleMonthLabel("2026-09-01")).toBe("SET");
    expect(shortCycleMonthLabel("2026-11-05")).toBe("NOV");
  });
});
