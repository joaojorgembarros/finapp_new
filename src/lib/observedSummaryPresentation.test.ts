import { describe, expect, it } from "vitest";
import type { FinancialObservedSummary } from "./financialObservedSummary";
import {
  OBSERVED_SUMMARY_COPY,
  OBSERVED_UNCATEGORIZED_LABEL,
  OBSERVED_UNRESOLVED_CATEGORY_LABEL,
  buildObservedCategoryRows,
  buildObservedComparison,
  buildObservedMonthHero,
  formatObservedPercent,
  observedAmountDelta,
  observedCategoryLabel,
  observedComparisonCaption,
} from "./observedSummaryPresentation";

function observedSummary(partial?: {
  referenceDate?: string;
  current?: Partial<FinancialObservedSummary["currentPeriod"]>;
  previousComparable?: Partial<FinancialObservedSummary["previousComparablePeriod"]>;
  previousClosed?: Partial<FinancialObservedSummary["previousClosedMonth"]>;
  categories?: FinancialObservedSummary["categories"];
  uncategorized?: Partial<FinancialObservedSummary["uncategorized"]>;
  dataQuality?: Partial<FinancialObservedSummary["dataQuality"]>;
}): FinancialObservedSummary {
  const currentPeriod = {
    start: "2026-10-01",
    end: "2026-10-07",
    inflowCents: 0,
    outflowCents: 0,
    netCents: 0,
    transactionCount: 0,
    ...partial?.current,
  };
  const previousComparablePeriod = {
    start: "2026-09-01",
    end: "2026-09-07",
    inflowCents: 0,
    outflowCents: 0,
    netCents: 0,
    transactionCount: 0,
    ...partial?.previousComparable,
  };
  const previousClosedMonth = {
    start: "2026-09-01",
    end: "2026-10-01",
    inflowCents: 0,
    outflowCents: 0,
    netCents: 0,
    transactionCount: 0,
    ...partial?.previousClosed,
  };
  return {
    referenceDate: partial?.referenceDate ?? "2026-10-06",
    currentPeriod,
    previousComparablePeriod,
    previousClosedMonth,
    categories: partial?.categories ?? [],
    uncategorized: {
      amountCents: 0,
      transactionCount: 0,
      percentageOfOutflows: 0,
      ...partial?.uncategorized,
    },
    dataQuality: {
      isCurrentPeriodEmpty: currentPeriod.transactionCount === 0,
      hasHistoricalData: previousComparablePeriod.transactionCount > 0 || previousClosedMonth.transactionCount > 0,
      isPartialCurrentMonth: true,
      hasPreviousComparableData: previousComparablePeriod.transactionCount > 0,
      hasPreviousClosedMonthData: previousClosedMonth.transactionCount > 0,
      uncategorizedExpenseCents: partial?.uncategorized?.amountCents ?? 0,
      uncategorizedExpenseCount: partial?.uncategorized?.transactionCount ?? 0,
      uncategorizedExpenseRatio: 0,
      transactionsWithoutAccountId: 0,
      excludedMarkedInternalTransferCount: 0,
      invalidTypeCount: 0,
      ...partial?.dataQuality,
    },
  };
}

describe("observed month hero", () => {
  it("shows a positive net as period result, not as available cash", () => {
    const hero = buildObservedMonthHero(observedSummary({
      current: {
        inflowCents: 480000,
        outflowCents: 120000,
        netCents: 360000,
        transactionCount: 4,
      },
    }));

    expect(hero).toMatchObject({
      kind: "ready",
      title: OBSERVED_SUMMARY_COPY.heroTitle,
      inflowCents: 480000,
      outflowCents: 120000,
      netCents: 360000,
      resultLabel: "Resultado do mês",
    });
    expect(JSON.stringify(hero)).not.toMatch(/saldo|disponível|livre|sobra|pode gastar/i);
  });

  it("keeps a negative net visible", () => {
    const hero = buildObservedMonthHero(observedSummary({
      current: {
        inflowCents: 100000,
        outflowCents: 250000,
        netCents: -150000,
        transactionCount: 3,
      },
    }));

    expect(hero.kind).toBe("ready");
    if (hero.kind !== "ready") return;
    expect(hero.netCents).toBe(-150000);
  });

  it("uses the empty copy when the current period has no counted movements", () => {
    const hero = buildObservedMonthHero(observedSummary({
      dataQuality: { isCurrentPeriodEmpty: true, hasHistoricalData: false },
    }));

    expect(hero).toMatchObject({
      kind: "empty",
      message: OBSERVED_SUMMARY_COPY.heroEmpty,
      historyNote: null,
    });
  });

  it("mentions previous history without inventing an insight", () => {
    const hero = buildObservedMonthHero(observedSummary({
      previousClosed: { outflowCents: 80000, transactionCount: 2 },
      dataQuality: { isCurrentPeriodEmpty: true, hasHistoricalData: true },
    }));

    expect(hero.kind).toBe("empty");
    if (hero.kind !== "empty") return;
    expect(hero.historyNote).toBe(OBSERVED_SUMMARY_COPY.heroHistoryNote);
  });
});

describe("observed comparison", () => {
  it("compares inflow, outflow and net against the comparable previous window", () => {
    const comparison = buildObservedComparison(observedSummary({
      current: {
        inflowCents: 400000,
        outflowCents: 180000,
        netCents: 220000,
        transactionCount: 4,
      },
      previousComparable: {
        inflowCents: 350000,
        outflowCents: 240000,
        netCents: 110000,
        transactionCount: 3,
      },
    }));

    expect(comparison.kind).toBe("ready");
    if (comparison.kind !== "ready") return;
    expect(comparison.caption).toBe("Até o dia 6");
    expect(comparison.inflow).toEqual({
      currentCents: 400000,
      previousCents: 350000,
      deltaCents: 50000,
      percent: expect.closeTo(14.2857, 3),
    });
    expect(comparison.outflow).toEqual({
      currentCents: 180000,
      previousCents: 240000,
      deltaCents: -60000,
      percent: -25,
    });
    expect(comparison.net.deltaCents).toBe(110000);
  });

  it("does not use the closed previous month as the highlighted comparison", () => {
    const comparison = buildObservedComparison(observedSummary({
      current: { outflowCents: 10000, transactionCount: 1 },
      previousComparable: { outflowCents: 20000, transactionCount: 1 },
      previousClosed: { outflowCents: 90000, transactionCount: 8 },
    }));

    expect(comparison.kind).toBe("ready");
    if (comparison.kind !== "ready") return;
    expect(comparison.outflow.previousCents).toBe(20000);
    expect(comparison.outflow.previousCents).not.toBe(90000);
  });

  it("shows a neutral state when there is no previous comparable history", () => {
    const comparison = buildObservedComparison(observedSummary({
      current: { outflowCents: 7000, transactionCount: 1 },
      dataQuality: { hasPreviousComparableData: false, isCurrentPeriodEmpty: false },
    }));

    expect(comparison).toMatchObject({
      kind: "insufficient",
      message: OBSERVED_SUMMARY_COPY.comparisonEmpty,
    });
    expect(observedComparisonCaption("2026-10-06")).toBe("Até o dia 6");
  });

  it("omits percent when previous is zero instead of inventing 100% or Infinity", () => {
    const delta = observedAmountDelta(24000, 0);
    expect(delta).toEqual({
      currentCents: 24000,
      previousCents: 0,
      deltaCents: 24000,
      percent: null,
    });
    expect(formatObservedPercent(delta.percent)).toBeNull();
    expect(formatObservedPercent(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatObservedPercent(Number.NaN)).toBeNull();
  });
});

describe("observed category rows", () => {
  it("keeps the top spending categories by amount", () => {
    const rows = buildObservedCategoryRows(observedSummary({
      current: { outflowCents: 100000, transactionCount: 4 },
      categories: [
        { categoryId: "food", categoryName: "Alimentação", amountCents: 50000, transactionCount: 2, percentageOfOutflows: 50 },
        { categoryId: "transport", categoryName: "Transporte", amountCents: 30000, transactionCount: 1, percentageOfOutflows: 30 },
        { categoryId: "health", categoryName: "Saúde", amountCents: 20000, transactionCount: 1, percentageOfOutflows: 20 },
      ],
    }));

    expect(rows.map((row) => row.name)).toEqual(["Alimentação", "Transporte", "Saúde"]);
    expect(rows[0]).toMatchObject({ amountCents: 50000, percentageOfOutflows: 50, uncategorized: false });
  });

  it("includes uncategorized spending instead of hiding it", () => {
    const rows = buildObservedCategoryRows(observedSummary({
      current: { outflowCents: 40000, transactionCount: 2 },
      categories: [
        { categoryId: "food", categoryName: "Alimentação", amountCents: 25000, transactionCount: 1, percentageOfOutflows: 62.5 },
      ],
      uncategorized: { amountCents: 15000, transactionCount: 1, percentageOfOutflows: 37.5 },
    }));

    expect(rows).toEqual([
      expect.objectContaining({ name: "Alimentação", amountCents: 25000, uncategorized: false }),
      expect.objectContaining({ name: OBSERVED_UNCATEGORIZED_LABEL, amountCents: 15000, uncategorized: true }),
    ]);
  });

  it("shows only Sem categoria when every expense is uncategorized", () => {
    const rows = buildObservedCategoryRows(observedSummary({
      current: { outflowCents: 18000, transactionCount: 2 },
      uncategorized: { amountCents: 18000, transactionCount: 2, percentageOfOutflows: 100 },
    }));

    expect(rows).toEqual([
      expect.objectContaining({
        name: OBSERVED_UNCATEGORIZED_LABEL,
        amountCents: 18000,
        percentageOfOutflows: 100,
        uncategorized: true,
      }),
    ]);
  });

  it("keeps Sem categoria visible even when it would fall outside the top categories", () => {
    const rows = buildObservedCategoryRows(observedSummary({
      current: { outflowCents: 150000, transactionCount: 6 },
      categories: [
        { categoryId: "a", categoryName: "A", amountCents: 50000, transactionCount: 1, percentageOfOutflows: 33 },
        { categoryId: "b", categoryName: "B", amountCents: 40000, transactionCount: 1, percentageOfOutflows: 27 },
        { categoryId: "c", categoryName: "C", amountCents: 30000, transactionCount: 1, percentageOfOutflows: 20 },
        { categoryId: "d", categoryName: "D", amountCents: 20000, transactionCount: 1, percentageOfOutflows: 13 },
      ],
      uncategorized: { amountCents: 1000, transactionCount: 1, percentageOfOutflows: 1 },
    }), { limit: 4 });

    expect(rows).toHaveLength(4);
    expect(rows.slice(0, 3).map((row) => row.name)).toEqual(["A", "B", "C"]);
    expect(rows[3]).toMatchObject({ name: OBSERVED_UNCATEGORIZED_LABEL, amountCents: 1000 });
  });

  it("uses a conservative label when the category name cannot be resolved", () => {
    expect(observedCategoryLabel({ categoryId: "gone", categoryName: "gone" })).toBe(
      OBSERVED_UNRESOLVED_CATEGORY_LABEL,
    );
    expect(observedCategoryLabel(
      { categoryId: "gone", categoryName: "Alimentação" },
      new Set(["food"]),
    )).toBe(OBSERVED_UNRESOLVED_CATEGORY_LABEL);

    const rows = buildObservedCategoryRows(observedSummary({
      current: { outflowCents: 9000, transactionCount: 1 },
      categories: [
        { categoryId: "gone", categoryName: "gone", amountCents: 9000, transactionCount: 1, percentageOfOutflows: 100 },
      ],
    }));

    expect(rows[0]).toMatchObject({
      name: OBSERVED_UNRESOLVED_CATEGORY_LABEL,
      amountCents: 9000,
      unresolved: true,
    });
  });
});
