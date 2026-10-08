import { describe, expect, it, vi } from "vitest";
import { buildFinancialObservedSummary, type ObservedSummaryTransaction } from "./financialObservedSummary";
import {
  buildFinancialObservedHistory,
  coversObservedHistoryRange,
  loadObservedHistoryTransactions,
  observedHistoryFetchStart,
  observedHistoryRangeStart,
} from "./financialObservedHistory";

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

const augustSeptemberOctober = [
  tx({ id: "aug-in", type: "income", occurredOn: "2026-08-05", amountCents: 506284, statementImportId: "csv-aug" }),
  tx({ id: "aug-out", occurredOn: "2026-08-20", amountCents: 127686 }),
  tx({ id: "sep-in", type: "income", occurredOn: "2026-09-05", amountCents: 511420, statementImportId: null }),
  tx({ id: "sep-out", occurredOn: "2026-09-18", amountCents: 131675 }),
  tx({ id: "oct-in", type: "income", occurredOn: "2026-10-02", amountCents: 515000 }),
  tx({ id: "oct-out", occurredOn: "2026-10-08", amountCents: 65350 }),
];

describe("observed history ranges", () => {
  it("keeps an explicit reference date for month, 3 months, 6 months and year", () => {
    expect(observedHistoryRangeStart("2026-10-08", "month")).toBe("2026-10-01");
    expect(observedHistoryRangeStart("2026-10-08", "3months")).toBe("2026-08-01");
    expect(observedHistoryRangeStart("2026-10-08", "6months")).toBe("2026-05-01");
    expect(observedHistoryRangeStart("2026-10-08", "year")).toBe("2026-01-01");
    expect(observedHistoryFetchStart("2026-10-08", "month")).toBe("2026-04-01");
    expect(observedHistoryFetchStart("2026-10-08", "3months")).toBe("2026-04-01");
    expect(observedHistoryFetchStart("2026-10-08", "6months")).toBe("2026-04-01");
    expect(observedHistoryFetchStart("2026-10-08", "year")).toBe("2026-01-01");
  });

  it("crosses the year boundary without using a hidden clock", () => {
    expect(observedHistoryRangeStart("2026-01-10", "3months")).toBe("2025-11-01");
    expect(observedHistoryRangeStart("2026-01-10", "6months")).toBe("2025-08-01");
    expect(observedHistoryRangeStart("2026-01-10", "year")).toBe("2026-01-01");
    expect(observedHistoryFetchStart("2026-03-15", "year")).toBe("2025-09-01");
    expect(coversObservedHistoryRange("2026-04-01", "2026-10-08", "6months")).toBe(true);
    expect(coversObservedHistoryRange("2026-04-01", "2026-10-08", "year")).toBe(false);
    expect(coversObservedHistoryRange("2026-01-01", "2026-10-08", "month")).toBe(true);
  });

  it("rejects an invalid range and a reference date after the requested start", () => {
    expect(() => observedHistoryRangeStart("2026-10-08", "balance" as "month")).toThrow(/inválido/);
    expect(() => observedHistoryRangeStart("2026-02-31", "month")).toThrow(/inválida/);
  });
});

describe("buildFinancialObservedHistory", () => {
  it("matches the monthly observed summary for the current civil month", () => {
    const history = buildFinancialObservedHistory({
      referenceDate: "2026-10-08",
      range: "month",
      transactions: [
        ...augustSeptemberOctober,
        tx({ id: "after", occurredOn: "2026-10-09", amountCents: 99999 }),
      ],
    });
    const summary = buildFinancialObservedSummary({
      referenceDate: "2026-10-08",
      transactions: augustSeptemberOctober,
    });

    expect(history.months).toHaveLength(1);
    expect(history.months[0]).toMatchObject({
      monthKey: "2026-10",
      isPartial: true,
      hasData: true,
      inflowCents: 515000,
      outflowCents: 65350,
      netCents: 449650,
    });
    expect(history.inflowCents).toBe(summary.currentPeriod.inflowCents);
    expect(history.outflowCents).toBe(summary.currentPeriod.outflowCents);
    expect(history.netCents).toBe(summary.currentPeriod.netCents);
    expect(history.netCents).toBe(history.inflowCents - history.outflowCents);
  });

  it("totals August, September and October without treating the result as a balance", () => {
    const history = buildFinancialObservedHistory({
      referenceDate: "2026-10-08",
      range: "3months",
      transactions: [
        tx({ id: "april", type: "income", occurredOn: "2026-04-02", amountCents: 100000 }),
        ...augustSeptemberOctober,
      ],
    });

    expect(history).toMatchObject({
      start: "2026-08-01",
      end: "2026-10-09",
      inflowCents: 1532704,
      outflowCents: 324711,
      netCents: 1207993,
      transactionCount: 6,
    });
    expect(history.months.map((month) => [month.monthKey, month.netCents, month.isPartial, month.hasData])).toEqual([
      ["2026-08", 378598, false, true],
      ["2026-09", 379745, false, true],
      ["2026-10", 449650, true, true],
    ]);
    expect(history.inflowCents).toBe(history.months.reduce((total, month) => total + month.inflowCents, 0));
    expect(history.outflowCents).toBe(history.months.reduce((total, month) => total + month.outflowCents, 0));
    expect(history.netCents).toBe(history.months.reduce((total, month) => total + month.netCents, 0));
    expect(history.dataQuality).toMatchObject({
      hasAnyData: true,
      monthsWithData: 3,
      monthsRequested: 3,
      currentMonthPartial: true,
      hasGaps: false,
    });
  });

  it("asks for six civil months and keeps them chronological", () => {
    const history = buildFinancialObservedHistory({
      referenceDate: "2026-10-08",
      range: "6months",
      transactions: [
        tx({ id: "april", type: "income", occurredOn: "2026-04-30", amountCents: 100 }),
        tx({ id: "may", type: "income", occurredOn: "2026-05-02", amountCents: 200 }),
        tx({ id: "oct", occurredOn: "2026-10-01", amountCents: 50 }),
      ],
    });

    expect(history.months.map((month) => month.monthKey)).toEqual([
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(history.inflowCents).toBe(200);
    expect(history.outflowCents).toBe(50);
    expect(history.netCents).toBe(150);
    expect(history.dataQuality.hasGaps).toBe(true);
    expect(history.months.filter((month) => !month.hasData).map((month) => month.monthKey)).toEqual([
      "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
  });

  it("builds a partial year and a year that crosses from the previous calendar", () => {
    const year = buildFinancialObservedHistory({
      referenceDate: "2026-10-08",
      range: "year",
      transactions: augustSeptemberOctober,
    });
    expect(year.months).toHaveLength(10);
    expect(year.months[0]).toMatchObject({ monthKey: "2026-01", hasData: false, isPartial: false, netCents: 0 });
    expect(year.months[9]).toMatchObject({ monthKey: "2026-10", hasData: true, isPartial: true });
    expect(year.dataQuality).toMatchObject({
      monthsRequested: 10,
      monthsWithData: 3,
      hasGaps: true,
      currentMonthPartial: true,
    });
    expect(year.netCents).toBe(1207993);

    const turn = buildFinancialObservedHistory({
      referenceDate: "2026-01-10",
      range: "6months",
      transactions: [
        tx({ id: "dec", type: "income", occurredOn: "2025-12-31", amountCents: 80 }),
        tx({ id: "jan", occurredOn: "2026-01-10", amountCents: 30 }),
      ],
    });
    expect(turn.months.map((month) => month.monthKey)).toEqual([
      "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
    ]);
    expect(turn.months[4]).toMatchObject({ hasData: true, netCents: 80, isPartial: false });
    expect(turn.months[5]).toMatchObject({ hasData: true, netCents: -30, isPartial: true });
  });

  it("keeps a January year partial when the month is not closed", () => {
    const history = buildFinancialObservedHistory({
      referenceDate: "2026-01-15",
      range: "year",
      transactions: [
        tx({ id: "jan", type: "income", occurredOn: "2026-01-15", amountCents: 400 }),
        tx({ id: "late", type: "income", occurredOn: "2026-01-16", amountCents: 900 }),
      ],
    });

    expect(history.months).toEqual([
      expect.objectContaining({
        monthKey: "2026-01",
        hasData: true,
        isPartial: true,
        inflowCents: 400,
        netCents: 400,
        transactionCount: 1,
      }),
    ]);
    expect(history.dataQuality).toMatchObject({
      monthsRequested: 1,
      monthsWithData: 1,
      hasGaps: false,
      currentMonthPartial: true,
    });
  });

  it("closes the reference month on its last civil day", () => {
    const history = buildFinancialObservedHistory({
      referenceDate: "2026-10-31",
      range: "month",
      transactions: [tx({ id: "last", occurredOn: "2026-10-31", amountCents: 10 })],
    });

    expect(history.months[0]).toMatchObject({
      end: "2026-11-01",
      isPartial: false,
      hasData: true,
    });
    expect(history.dataQuality.currentMonthPartial).toBe(false);
  });

  it("marks a month without counted rows as having no data", () => {
    const history = buildFinancialObservedHistory({
      referenceDate: "2026-10-08",
      range: "3months",
      transactions: [
        tx({ id: "oct", type: "income", occurredOn: "2026-10-03", amountCents: 515000 }),
        tx({ id: "oct-out", occurredOn: "2026-10-04", amountCents: 65350 }),
        tx({ id: "aug-ignored", type: "income", occurredOn: "2026-08-01", amountCents: 999, ignoredAt: "2026-08-02" }),
        tx({
          id: "sep-transfer",
          type: "income",
          occurredOn: "2026-09-02",
          amountCents: 999,
          transferGroupId: "group-1",
        }),
        tx({ id: "sep-invalid", type: "refund", occurredOn: "2026-09-03", amountCents: 999 }),
      ],
    });

    expect(history.months.map((month) => month.hasData)).toEqual([false, false, true]);
    expect(history.inflowCents).toBe(515000);
    expect(history.outflowCents).toBe(65350);
    expect(history.netCents).toBe(449650);
    expect(history.dataQuality).toMatchObject({
      hasAnyData: true,
      monthsWithData: 1,
      hasGaps: true,
    });
  });

  it("returns finite zeros when the period has no counted activity", () => {
    const history = buildFinancialObservedHistory({
      referenceDate: "2026-10-08",
      range: "3months",
      transactions: [
        tx({ id: "nan", type: "income", occurredOn: "2026-10-01", amountCents: Number.NaN }),
      ],
    });
    const empty = buildFinancialObservedHistory({
      referenceDate: "2026-10-08",
      range: "year",
      transactions: [],
    });

    expect(history.netCents).toBe(0);
    expect(Number.isNaN(history.netCents)).toBe(false);
    expect(history.months[2]).toMatchObject({ hasData: true, netCents: 0, inflowCents: 0 });
    expect(empty.dataQuality).toMatchObject({
      hasAnyData: false,
      monthsWithData: 0,
      monthsRequested: 10,
      hasGaps: false,
    });
    expect(empty.months.every((month) => month.netCents === 0 && month.hasData === false)).toBe(true);
    expect(empty.months.some((month) => Number.isNaN(month.netCents))).toBe(false);
  });
});

describe("loadObservedHistoryTransactions", () => {
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

  it("pages a year from 1 January and keeps the 6-month window for shorter ranges", async () => {
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
    const yearCaptured = { gte: [] as [string, string][], lte: [] as [string, string][], ranges: [] as [number, number][] };
    mockQuery(rows, yearCaptured);

    const year = await loadObservedHistoryTransactions({
      householdId: "house-1",
      referenceDate: "2026-10-08",
      range: "year",
    });

    expect(yearCaptured.gte).toContainEqual(["occurred_on", "2026-01-01"]);
    expect(yearCaptured.lte).toContainEqual(["occurred_on", "2026-10-08"]);
    expect(yearCaptured.ranges).toEqual([[0, 499], [500, 999]]);
    expect(year).toHaveLength(501);

    const shortCaptured = { gte: [] as [string, string][], lte: [] as [string, string][], ranges: [] as [number, number][] };
    mockQuery([], shortCaptured);
    await loadObservedHistoryTransactions({
      householdId: "house-1",
      referenceDate: "2026-10-08",
      range: "3months",
    });
    expect(shortCaptured.gte).toContainEqual(["occurred_on", "2026-04-01"]);

    const earlyYear = { gte: [] as [string, string][], lte: [] as [string, string][], ranges: [] as [number, number][] };
    mockQuery([], earlyYear);
    await loadObservedHistoryTransactions({
      householdId: "house-1",
      referenceDate: "2026-03-15",
      range: "year",
    });
    expect(earlyYear.gte).toContainEqual(["occurred_on", "2025-09-01"]);
  });
});
