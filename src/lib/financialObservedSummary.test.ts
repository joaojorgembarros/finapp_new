import { describe, expect, it, vi } from "vitest";
import {
  buildFinancialObservedSummary,
  loadObservedSummaryTransactions,
  OBSERVED_SUMMARY_PAGE_SIZE,
  OBSERVED_SUMMARY_WINDOW_MONTHS,
  observedSummaryPeriods,
  observedSummaryWindowStart,
  paginateObservedSummaryTransactions,
  type ObservedSummaryTransaction,
} from "./financialObservedSummary";

const from = vi.fn();

vi.mock("./supabase", () => ({
  supabase: { from: (...args: unknown[]) => from(...args) },
}));

function tx(
  partial: Partial<ObservedSummaryTransaction> & Pick<ObservedSummaryTransaction, "id" | "occurredOn" | "amountCents">,
): ObservedSummaryTransaction {
  return {
    type: "expense",
    categoryId: null,
    accountId: "nubank",
    ignoredAt: null,
    transferGroupId: null,
    statementImportId: null,
    ...partial,
  };
}

describe("observed summary calendar", () => {
  it("uses the civil month through the reference date, not a payday cycle", () => {
    const periods = observedSummaryPeriods("2026-10-06");

    expect(periods.currentPeriod).toEqual({ start: "2026-10-01", end: "2026-10-07" });
    expect(periods.previousComparablePeriod).toEqual({ start: "2026-09-01", end: "2026-09-07" });
    expect(periods.previousClosedMonth).toEqual({ start: "2026-09-01", end: "2026-10-01" });
    expect(observedSummaryWindowStart("2026-10-06")).toBe("2026-04-01");
    expect(OBSERVED_SUMMARY_WINDOW_MONTHS).toBe(6);
  });

  it("clamps the comparable previous month when the previous month is shorter", () => {
    const periods = observedSummaryPeriods("2026-03-31");

    expect(periods.currentPeriod).toEqual({ start: "2026-03-01", end: "2026-04-01" });
    expect(periods.previousComparablePeriod).toEqual({ start: "2026-02-01", end: "2026-03-01" });
    expect(periods.previousClosedMonth).toEqual({ start: "2026-02-01", end: "2026-03-01" });
  });

  it("clamps 31 March against a leap February", () => {
    const periods = observedSummaryPeriods("2024-03-31");

    expect(periods.previousComparablePeriod).toEqual({ start: "2024-02-01", end: "2024-03-01" });
  });
});

describe("buildFinancialObservedSummary", () => {
  const categories = [
    { id: "food", name: "Alimentação" },
    { id: "transport", name: "Transporte" },
    { id: "salary", name: "Salário" },
  ];

  it("totals a civil month through the reference date", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      categories,
      transactions: [
        tx({ id: "in-1", type: "income", occurredOn: "2026-10-01", amountCents: 480000 }),
        tx({ id: "out-1", occurredOn: "2026-10-03", amountCents: 50000, categoryId: "food" }),
        tx({ id: "out-later", occurredOn: "2026-10-07", amountCents: 90000, categoryId: "food" }),
        tx({ id: "sep", occurredOn: "2026-09-10", amountCents: 10000, categoryId: "food" }),
      ],
    });

    expect(summary.currentPeriod).toMatchObject({
      start: "2026-10-01",
      end: "2026-10-07",
      inflowCents: 480000,
      outflowCents: 50000,
      netCents: 430000,
      transactionCount: 2,
    });
    expect(summary.currentPeriod.netCents).toBe(
      summary.currentPeriod.inflowCents - summary.currentPeriod.outflowCents,
    );
  });

  it("compares the previous month through the same civil day", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [
        tx({ id: "now", occurredOn: "2026-10-05", amountCents: 20000 }),
        tx({ id: "same-day", occurredOn: "2026-09-06", amountCents: 15000 }),
        tx({ id: "after-day", occurredOn: "2026-09-07", amountCents: 80000 }),
        tx({ id: "closed", occurredOn: "2026-09-20", amountCents: 30000 }),
      ],
    });

    expect(summary.previousComparablePeriod).toMatchObject({
      outflowCents: 15000,
      transactionCount: 1,
    });
    expect(summary.previousClosedMonth).toMatchObject({
      outflowCents: 125000,
      transactionCount: 3,
    });
    expect(summary.dataQuality.isCurrentPeriodEmpty).toBe(false);
    expect(summary.dataQuality.hasHistoricalData).toBe(true);
    expect(summary.dataQuality.hasPreviousComparableData).toBe(true);
    expect(summary.dataQuality.hasPreviousClosedMonthData).toBe(true);
    expect(summary.dataQuality.isPartialCurrentMonth).toBe(true);
  });

  it("keeps net as income minus expense with integer cents", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [
        tx({ id: "in", type: "income", occurredOn: "2026-10-01", amountCents: 10_000_000_000 }),
        tx({ id: "out", occurredOn: "2026-10-02", amountCents: 20_000_000_001 }),
      ],
    });

    expect(summary.currentPeriod.inflowCents).toBe(10_000_000_000);
    expect(summary.currentPeriod.outflowCents).toBe(20_000_000_001);
    expect(summary.currentPeriod.netCents).toBe(-10_000_000_001);
  });

  it("excludes ignored_at from observed totals", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [
        tx({ id: "kept", occurredOn: "2026-10-02", amountCents: 4000 }),
        tx({ id: "ignored", occurredOn: "2026-10-02", amountCents: 90000, ignoredAt: "2026-10-02T12:00:00Z" }),
      ],
    });

    expect(summary.currentPeriod.outflowCents).toBe(4000);
    expect(summary.currentPeriod.transactionCount).toBe(1);
  });

  it("excludes both internal-transfer legs from the household total", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [
        tx({ id: "salary", type: "income", occurredOn: "2026-10-01", amountCents: 300000 }),
        tx({ id: "grocery", occurredOn: "2026-10-03", amountCents: 50000 }),
        tx({
          id: "out-leg",
          occurredOn: "2026-10-04",
          amountCents: 100000,
          transferGroupId: "group-1",
        }),
        tx({
          id: "in-leg",
          type: "income",
          occurredOn: "2026-10-04",
          amountCents: 100000,
          accountId: "inter",
          transferGroupId: "group-1",
        }),
      ],
    });

    expect(summary.currentPeriod).toMatchObject({
      inflowCents: 300000,
      outflowCents: 50000,
      netCents: 250000,
      transactionCount: 2,
    });
    expect(summary.dataQuality.excludedMarkedInternalTransferCount).toBe(2);
  });

  it("counts manual and CSV rows the same way", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [
        tx({ id: "csv", occurredOn: "2026-10-02", amountCents: 12000, statementImportId: "import-1" }),
        tx({ id: "manual", occurredOn: "2026-10-03", amountCents: 8000, statementImportId: null }),
      ],
    });

    expect(summary.currentPeriod.outflowCents).toBe(20000);
    expect(summary.currentPeriod.transactionCount).toBe(2);
  });

  it("sends uncategorized expenses to the uncategorized bucket", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      categories,
      transactions: [
        tx({ id: "named", occurredOn: "2026-10-02", amountCents: 30000, categoryId: "food" }),
        tx({ id: "blank", occurredOn: "2026-10-03", amountCents: 10000, categoryId: null }),
      ],
    });

    expect(summary.categories).toEqual([
      expect.objectContaining({ categoryId: "food", amountCents: 30000, percentageOfOutflows: 75 }),
    ]);
    expect(summary.uncategorized).toEqual({
      amountCents: 10000,
      transactionCount: 1,
      percentageOfOutflows: 25,
    });
    expect(summary.dataQuality.uncategorizedExpenseCents).toBe(10000);
  });

  it("does not rank income categories as spending", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      categories,
      transactions: [
        tx({
          id: "salary",
          type: "income",
          occurredOn: "2026-10-01",
          amountCents: 480000,
          categoryId: "salary",
        }),
        tx({ id: "food", occurredOn: "2026-10-02", amountCents: 20000, categoryId: "food" }),
      ],
    });

    expect(summary.currentPeriod.inflowCents).toBe(480000);
    expect(summary.categories.map((item) => item.categoryId)).toEqual(["food"]);
    expect(summary.categories[0]?.amountCents).toBe(20000);
    expect(summary.categories[0]?.percentageOfOutflows).toBe(100);
  });

  it("sorts categories by amount then by stable id", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      categories,
      transactions: [
        tx({ id: "t1", occurredOn: "2026-10-01", amountCents: 20000, categoryId: "transport" }),
        tx({ id: "f1", occurredOn: "2026-10-02", amountCents: 20000, categoryId: "food" }),
        tx({ id: "f2", occurredOn: "2026-10-03", amountCents: 10000, categoryId: "food" }),
      ],
    });

    expect(summary.categories.map((item) => item.categoryId)).toEqual(["food", "transport"]);
    expect(summary.categories[0]).toMatchObject({
      amountCents: 30000,
      transactionCount: 2,
      percentageOfOutflows: 60,
    });
    expect(summary.categories[1]?.percentageOfOutflows).toBe(40);
  });

  it("returns 0% when there are no expenses", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      categories,
      transactions: [
        tx({ id: "in", type: "income", occurredOn: "2026-10-01", amountCents: 1000 }),
      ],
    });

    expect(summary.currentPeriod.outflowCents).toBe(0);
    expect(summary.uncategorized.percentageOfOutflows).toBe(0);
    expect(summary.dataQuality.uncategorizedExpenseRatio).toBe(0);
    expect(Number.isFinite(summary.uncategorized.percentageOfOutflows)).toBe(true);
  });

  it("stays stable when there are no transactions", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [],
    });

    expect(summary.currentPeriod).toMatchObject({
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
      transactionCount: 0,
    });
    expect(summary.categories).toEqual([]);
    expect(summary.dataQuality.isCurrentPeriodEmpty).toBe(true);
    expect(summary.dataQuality.hasHistoricalData).toBe(false);
    expect(summary.dataQuality.hasPreviousComparableData).toBe(false);
    expect(summary.dataQuality.hasPreviousClosedMonthData).toBe(false);
    expect(summary.dataQuality.invalidTypeCount).toBe(0);
  });

  it("treats a current month with only historical data as empty now, not empty forever", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [tx({ id: "sep", occurredOn: "2026-09-10", amountCents: 18000 })],
    });

    expect(summary.currentPeriod.transactionCount).toBe(0);
    expect(summary.dataQuality.isCurrentPeriodEmpty).toBe(true);
    expect(summary.dataQuality.hasHistoricalData).toBe(true);
    expect(summary.dataQuality.hasPreviousClosedMonthData).toBe(true);
  });

  it("marks missing previous comparison when only the current month exists", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [tx({ id: "only", occurredOn: "2026-10-02", amountCents: 7000 })],
    });

    expect(summary.dataQuality.isCurrentPeriodEmpty).toBe(false);
    expect(summary.dataQuality.hasHistoricalData).toBe(false);
    expect(summary.dataQuality.hasPreviousComparableData).toBe(false);
    expect(summary.dataQuality.hasPreviousClosedMonthData).toBe(false);
    expect(summary.previousComparablePeriod.transactionCount).toBe(0);
  });

  it("does not treat an unknown type as expense", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [
        tx({ id: "food", occurredOn: "2026-10-02", amountCents: 4000, categoryId: "food" }),
        tx({ id: "weird", type: "refund", occurredOn: "2026-10-03", amountCents: 99000, categoryId: "food" }),
      ],
    });

    expect(summary.currentPeriod).toMatchObject({
      outflowCents: 4000,
      transactionCount: 1,
    });
    expect(summary.categories).toEqual([
      expect.objectContaining({ categoryId: "food", amountCents: 4000 }),
    ]);
    expect(summary.dataQuality.invalidTypeCount).toBe(1);
  });

  it("keeps a transaction without account_id in the totals", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [tx({ id: "cash", occurredOn: "2026-10-02", amountCents: 3500, accountId: null })],
    });

    expect(summary.currentPeriod.outflowCents).toBe(3500);
    expect(summary.dataQuality.transactionsWithoutAccountId).toBe(1);
  });

  it("includes the start date and excludes the exclusive end", () => {
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: [
        tx({ id: "start", occurredOn: "2026-10-01", amountCents: 1000 }),
        tx({ id: "on-ref", occurredOn: "2026-10-06", amountCents: 2000 }),
        tx({ id: "end", occurredOn: "2026-10-07", amountCents: 4000 }),
      ],
    });

    expect(summary.currentPeriod.outflowCents).toBe(3000);
    expect(summary.currentPeriod.transactionCount).toBe(2);
  });

  it("ignores payday cycle, profile, commitments and acknowledgements if they are passed along", () => {
    const transactions = [tx({ id: "food", occurredOn: "2026-10-02", amountCents: 9000 })];
    const expected = buildFinancialObservedSummary({ referenceDate: "2026-10-06", transactions });
    const noisy = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions,
      ...{
        cycleMode: "payday",
        paydayDay: 10,
        profile: { income_fixed_cents: 480000 },
        commitments: [{ amount_cents: 200000 }],
        acknowledgements: [{ decision: "incorporated" }],
        reserveCents: 50000,
        final_balance_cents: 999999,
      } as object,
    });

    expect(noisy).toEqual(expected);
    expect(JSON.stringify(noisy)).not.toMatch(/income_fixed_cents|acknowledgement|projected|reserve|final_balance/);
  });
});

describe("paginateObservedSummaryTransactions", () => {
  function pagesFrom(rows: ObservedSummaryTransaction[], pageSize = OBSERVED_SUMMARY_PAGE_SIZE) {
    return async (fromIndex: number, to: number) => rows.slice(fromIndex, to + 1).slice(0, pageSize);
  }

  it("returns a short page unchanged", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => (
      tx({ id: `r${index}`, occurredOn: "2026-10-01", amountCents: 1 })
    ));
    await expect(paginateObservedSummaryTransactions(pagesFrom(rows), 500)).resolves.toHaveLength(3);
  });

  it("loads exactly one full page", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => (
      tx({ id: `p${index}`, occurredOn: "2026-10-01", amountCents: 1 })
    ));
    const loaded = await paginateObservedSummaryTransactions(pagesFrom(rows), 500);
    expect(loaded).toHaveLength(500);
    expect(new Set(loaded.map((item) => item.id)).size).toBe(500);
  });

  it("keeps every row across multiple pages, including more than 1000", async () => {
    const rows = Array.from({ length: 1200 }, (_, index) => (
      tx({ id: `n${index}`, occurredOn: "2026-09-01", amountCents: index + 1 })
    ));
    const loaded = await paginateObservedSummaryTransactions(pagesFrom(rows), 500);
    expect(loaded).toHaveLength(1200);
    expect(loaded.map((item) => item.id)).toEqual(rows.map((item) => item.id));
  });
});

describe("loadObservedSummaryTransactions", () => {
  function mockQuery(rows: Record<string, unknown>[], captured: {
    gte: [string, string][];
    lte: [string, string][];
    ranges: [number, number][];
  }) {
    from.mockImplementation(() => {
      const query = {
        select: () => query,
        eq: () => query,
        gte: (column: string, value: string) => {
          captured.gte.push([column, value]);
          return query;
        },
        lte: (column: string, value: string) => {
          captured.lte.push([column, value]);
          return query;
        },
        order: () => query,
        range: async (start: number, end: number) => {
          captured.ranges.push([start, end]);
          return { data: rows.slice(start, end + 1), error: null };
        },
      };
      return query;
    });
  }

  it("pages the civil window through the reference date", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: `db-${index}`,
      type: "expense",
      amount_cents: 10,
      occurred_on: "2026-10-01",
      category_id: null,
      account_id: "nubank",
      ignored_at: null,
      transfer_group_id: null,
      statement_import_id: null,
    }));
    const captured = { gte: [] as [string, string][], lte: [] as [string, string][], ranges: [] as [number, number][] };
    mockQuery(rows, captured);

    const loaded = await loadObservedSummaryTransactions({
      householdId: "house-1",
      referenceDate: "2026-10-06",
    });

    expect(from).toHaveBeenCalledWith("transactions");
    expect(captured.ranges).toEqual([[0, 499], [500, 999]]);
    expect(loaded).toHaveLength(501);
    expect(loaded[0]).toMatchObject({ id: "db-0", amountCents: 10, occurredOn: "2026-10-01" });
  });

  it("includes occurred_on on the reference date and does not coerce unknown types", async () => {
    const captured = { gte: [] as [string, string][], lte: [] as [string, string][], ranges: [] as [number, number][] };
    mockQuery([
      {
        id: "on-ref",
        type: "expense",
        amount_cents: 2500,
        occurred_on: "2026-10-06",
        category_id: null,
        account_id: "nubank",
        ignored_at: null,
        transfer_group_id: null,
        statement_import_id: null,
      },
      {
        id: "weird",
        type: "refund",
        amount_cents: 99000,
        occurred_on: "2026-10-06",
        category_id: "food",
        account_id: "nubank",
        ignored_at: null,
        transfer_group_id: null,
        statement_import_id: null,
      },
    ], captured);

    const loaded = await loadObservedSummaryTransactions({
      householdId: "house-1",
      referenceDate: "2026-10-06",
    });

    expect(captured.gte).toContainEqual(["occurred_on", "2026-04-01"]);
    expect(captured.lte).toContainEqual(["occurred_on", "2026-10-06"]);
    expect(captured.lte.some(([, value]) => value === "2026-10-05")).toBe(false);
    expect(loaded).toEqual([
      expect.objectContaining({ id: "on-ref", type: "expense", occurredOn: "2026-10-06", amountCents: 2500 }),
      expect.objectContaining({ id: "weird", type: "refund", occurredOn: "2026-10-06", amountCents: 99000 }),
    ]);

    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-06",
      transactions: loaded,
    });
    expect(summary.currentPeriod.outflowCents).toBe(2500);
    expect(summary.currentPeriod.transactionCount).toBe(1);
    expect(summary.dataQuality.invalidTypeCount).toBe(1);
  });
});
