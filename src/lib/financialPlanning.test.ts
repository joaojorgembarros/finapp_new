import { describe, expect, it, vi } from "vitest";
import {
  calculateFinancialSummary,
  getCycleForOffset,
} from "./financialPlanning";

vi.mock("./supabase", () => ({
  supabase: {},
}));

describe("financial cycles", () => {
  it("uses calendar months with an exclusive end", () => {
    const cycle = getCycleForOffset(
      { cycle_mode: "calendar", payday_day: 5 },
      0,
      new Date(2026, 7, 20, 12)
    );

    expect(cycle).toMatchObject({
      key: "calendar:2026-08",
      start: "2026-08-01",
      end: "2026-09-01",
    });
  });

  it("finds the payday cycle containing the reference date", () => {
    const beforePayday = getCycleForOffset(
      { cycle_mode: "payday", payday_day: 10 },
      0,
      new Date(2026, 7, 6, 12)
    );
    const afterPayday = getCycleForOffset(
      { cycle_mode: "payday", payday_day: 10 },
      0,
      new Date(2026, 7, 20, 12)
    );

    expect(beforePayday).toMatchObject({
      key: "payday:2026-07-10",
      start: "2026-07-10",
      end: "2026-08-10",
    });
    expect(afterPayday).toMatchObject({
      key: "payday:2026-08-10",
      start: "2026-08-10",
      end: "2026-09-10",
    });
  });

  it("moves either cycle by whole months", () => {
    const cycle = getCycleForOffset(
      { cycle_mode: "payday", payday_day: 28 },
      -1,
      new Date(2026, 2, 10, 12)
    );

    expect(cycle).toMatchObject({
      start: "2026-01-28",
      end: "2026-02-28",
    });
  });
});

describe("conservative financial calculation", () => {
  it("subtracts pending commitments, reserve and prior allocations from positive realized net", () => {
    expect(calculateFinancialSummary({
      expectedIncomeCents: 380_000,
      realizedIncomeCents: 380_000,
      realizedExpenseCents: 210_000,
      totalCommitmentsCents: 50_000,
      pendingCommitmentsCents: 50_000,
      reserveCents: 30_000,
      allocatedCents: 0,
    })).toMatchObject({
      resultCents: 170_000,
      availableCents: 90_000,
    });
  });

  it("does not treat projected income as available cash", () => {
    expect(calculateFinancialSummary({
      expectedIncomeCents: 500_000,
      realizedIncomeCents: 0,
      realizedExpenseCents: 0,
      totalCommitmentsCents: 0,
      pendingCommitmentsCents: 0,
      reserveCents: 0,
      allocatedCents: 0,
    }).availableCents).toBe(0);
  });

  it("caps availability at trustworthy bank balance and never returns a negative value", () => {
    expect(calculateFinancialSummary({
      expectedIncomeCents: 400_000,
      realizedIncomeCents: 400_000,
      realizedExpenseCents: 100_000,
      totalCommitmentsCents: 20_000,
      pendingCommitmentsCents: 20_000,
      reserveCents: 10_000,
      allocatedCents: 5_000,
      trustedBalanceCents: 60_000,
    })).toMatchObject({
      resultCents: 300_000,
      balanceCapApplied: true,
      availableCents: 25_000,
    });

    expect(calculateFinancialSummary({
      expectedIncomeCents: 0,
      realizedIncomeCents: 10_000,
      realizedExpenseCents: 30_000,
      totalCommitmentsCents: 0,
      pendingCommitmentsCents: 0,
      reserveCents: 0,
      allocatedCents: 0,
    }).availableCents).toBe(0);
  });

  it("calculates a separate monthly projection from expected income and all commitments", () => {
    expect(calculateFinancialSummary({
      expectedIncomeCents: 500_000,
      realizedIncomeCents: 300_000,
      realizedExpenseCents: 140_000,
      totalCommitmentsCents: 120_000,
      pendingCommitmentsCents: 40_000,
      reserveCents: 50_000,
      allocatedCents: 30_000,
    })).toMatchObject({
      availableCents: 40_000,
      totalCommitmentsCents: 120_000,
      projectedAvailableCents: 300_000,
    });
  });

  it("subtracts each monthly installment once from the monthly income projection", () => {
    const summary = calculateFinancialSummary({
      expectedIncomeCents: 500_000,
      realizedIncomeCents: 0,
      realizedExpenseCents: 0,
      totalCommitmentsCents: 50_000 + 20_000,
      pendingCommitmentsCents: 50_000 + 20_000,
      reserveCents: 0,
      allocatedCents: 0,
    });

    expect(summary.projectedAvailableCents).toBe(430_000);
  });

  it("does not double-count realized expenses in the monthly projection and floors it at zero", () => {
    const summary = calculateFinancialSummary({
      expectedIncomeCents: 200_000,
      realizedIncomeCents: 200_000,
      realizedExpenseCents: 180_000,
      totalCommitmentsCents: 170_000,
      pendingCommitmentsCents: 0,
      reserveCents: 40_000,
      allocatedCents: 10_000,
    });

    expect(summary.resultCents).toBe(20_000);
    expect(summary.projectedAvailableCents).toBe(0);
  });
});
