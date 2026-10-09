import { addMonths, monthStartYMD, nextMonthStartYMD, ymd } from "./date";
import {
  loadObservedSummaryTransactions,
  observedSummaryWindowStart,
  requireObservedSummaryReferenceDate,
  type ObservedSummaryTransaction,
} from "./financialObservedSummary";
import { isInternalTransferLeg, summarizeMovementTotals } from "./internalTransfers";

/**
 * Observed cash flow over a civil range.
 * Net is inflow minus outflow. It is a period result, not a bank balance.
 *
 * Month, 3 months and 6 months reuse the 6-month fetch already required by
 * the monthly comparison. Year starts on 1 January only when that day is
 * earlier than the 6-month window (August–December). Callers should keep
 * an in-memory window and skip a new request when it already covers the range.
 */
export const OBSERVED_HISTORY_RANGES = ["month", "3months", "6months", "year"] as const;

export type ObservedHistoryRange = (typeof OBSERVED_HISTORY_RANGES)[number];

export type ObservedHistoryMonth = {
  monthKey: string;
  start: string;
  /** Exclusive YYYY-MM-DD. */
  end: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  transactionCount: number;
  /** True only for the reference month before its last civil day. */
  isPartial: boolean;
  /** False when no counted income/expense exists. Absence is not a real zero. */
  hasData: boolean;
};

export type ObservedHistoryDataQuality = {
  hasAnyData: boolean;
  monthsWithData: number;
  monthsRequested: number;
  currentMonthPartial: boolean;
  /** Some requested months have counted rows and others do not. */
  hasGaps: boolean;
};

export type FinancialObservedHistory = {
  referenceDate: string;
  range: ObservedHistoryRange;
  start: string;
  /** Exclusive YYYY-MM-DD. */
  end: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  transactionCount: number;
  months: ObservedHistoryMonth[];
  dataQuality: ObservedHistoryDataQuality;
};

export function requireObservedHistoryRange(range: string): ObservedHistoryRange {
  if ((OBSERVED_HISTORY_RANGES as readonly string[]).includes(range)) {
    return range as ObservedHistoryRange;
  }
  throw new Error("O período do histórico observado é inválido.");
}

export function observedHistoryRangeStart(referenceDate: string, range: ObservedHistoryRange) {
  const reference = requireObservedSummaryReferenceDate(referenceDate);
  const currentMonthStart = monthStartYMD(parseLocalYmd(reference));
  const selected = requireObservedHistoryRange(range);
  if (selected === "month") return currentMonthStart;
  if (selected === "3months") return shiftMonthStart(currentMonthStart, -2);
  if (selected === "6months") return shiftMonthStart(currentMonthStart, -5);
  return `${reference.slice(0, 4)}-01-01`;
}

export function observedHistoryFetchStart(referenceDate: string, range: ObservedHistoryRange) {
  const reference = requireObservedSummaryReferenceDate(referenceDate);
  const sixMonthStart = observedSummaryWindowStart(reference);
  if (requireObservedHistoryRange(range) !== "year") return sixMonthStart;
  const yearStart = observedHistoryRangeStart(reference, "year");
  return yearStart < sixMonthStart ? yearStart : sixMonthStart;
}

export function coversObservedHistoryRange(
  coverageStart: string,
  referenceDate: string,
  range: ObservedHistoryRange,
) {
  const coveredFrom = requireObservedSummaryReferenceDate(coverageStart);
  return coveredFrom <= observedHistoryFetchStart(referenceDate, range);
}

export function buildFinancialObservedHistory(input: {
  transactions: ObservedSummaryTransaction[];
  referenceDate: string;
  range: ObservedHistoryRange;
}): FinancialObservedHistory {
  const referenceDate = requireObservedSummaryReferenceDate(input.referenceDate);
  const range = requireObservedHistoryRange(input.range);
  const start = observedHistoryRangeStart(referenceDate, range);
  const end = addDaysYmd(referenceDate, 1);
  const months = monthKeysFrom(start, referenceDate).map((monthKey) => (
    monthPoint(input.transactions, monthKey, referenceDate)
  ));
  const inflowCents = sumBy(months, "inflowCents");
  const outflowCents = sumBy(months, "outflowCents");
  const transactionCount = sumBy(months, "transactionCount");
  const monthsWithData = months.filter((month) => month.hasData).length;
  const currentMonthPartial = months.some((month) => month.isPartial);

  return {
    referenceDate,
    range,
    start,
    end,
    inflowCents,
    outflowCents,
    netCents: inflowCents - outflowCents,
    transactionCount,
    months,
    dataQuality: {
      hasAnyData: monthsWithData > 0,
      monthsWithData,
      monthsRequested: months.length,
      currentMonthPartial,
      hasGaps: monthsWithData > 0 && monthsWithData < months.length,
    },
  };
}

export async function loadObservedHistoryTransactions(params: {
  householdId: string;
  referenceDate: string;
  range: ObservedHistoryRange;
}) {
  const referenceDate = requireObservedSummaryReferenceDate(params.referenceDate);
  const range = requireObservedHistoryRange(params.range);
  return loadObservedSummaryTransactions({
    householdId: params.householdId,
    referenceDate,
    occurredFrom: observedHistoryFetchStart(referenceDate, range),
  });
}

function monthPoint(
  transactions: ObservedSummaryTransaction[],
  monthKey: string,
  referenceDate: string,
): ObservedHistoryMonth {
  const start = `${monthKey}-01`;
  const nextStart = nextMonthStartYMD(parseLocalYmd(start));
  const isCurrent = monthKey === referenceDate.slice(0, 7);
  const end = isCurrent ? addDaysYmd(referenceDate, 1) : nextStart;
  const totals = totalsForPeriod(transactions, { start, end });
  const lastDay = addDaysYmd(nextStart, -1);
  return {
    monthKey,
    start,
    end,
    ...totals,
    isPartial: isCurrent && referenceDate < lastDay,
    hasData: totals.transactionCount > 0,
  };
}

function totalsForPeriod(
  transactions: ObservedSummaryTransaction[],
  period: { start: string; end: string },
) {
  const counted = transactions.filter((transaction) => (
    isCountedObservedTransaction(transaction)
    && transaction.occurredOn >= period.start
    && transaction.occurredOn < period.end
  ));
  const totals = summarizeMovementTotals(counted.map((transaction) => ({
    type: transaction.type as "income" | "expense",
    amount_cents: integerCents(transaction.amountCents),
    account_id: transaction.accountId,
    transfer_group_id: transaction.transferGroupId,
  })));
  return {
    inflowCents: totals.income,
    outflowCents: totals.expense,
    netCents: totals.periodBalance,
    transactionCount: counted.length,
  };
}

function isCountedObservedTransaction(transaction: ObservedSummaryTransaction) {
  if (transaction.ignoredAt) return false;
  if (isInternalTransferLeg({ transfer_group_id: transaction.transferGroupId })) return false;
  return transaction.type === "income" || transaction.type === "expense";
}

function monthKeysFrom(start: string, referenceDate: string) {
  const lastKey = referenceDate.slice(0, 7);
  const keys: string[] = [];
  let cursor = start;
  while (cursor.slice(0, 7) <= lastKey) {
    keys.push(cursor.slice(0, 7));
    cursor = nextMonthStartYMD(parseLocalYmd(cursor));
  }
  return keys;
}

function shiftMonthStart(monthStart: string, delta: number) {
  return monthStartYMD(addMonths(parseLocalYmd(monthStart), delta));
}

function sumBy(months: ObservedHistoryMonth[], field: "inflowCents" | "outflowCents" | "netCents" | "transactionCount") {
  return months.reduce((total, month) => total + month[field], 0);
}

function parseLocalYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDaysYmd(value: string, days: number) {
  const date = parseLocalYmd(value);
  date.setDate(date.getDate() + days);
  return ymd(date);
}

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}
