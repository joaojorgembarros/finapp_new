import { addMonths, monthStartYMD, nextMonthStartYMD, ymd } from "./date";
import { isInternalTransferLeg, summarizeMovementTotals } from "./internalTransfers";
import { supabase } from "./supabase";

const sb: any = supabase;

export const OBSERVED_SUMMARY_PAGE_SIZE = 500;
export const OBSERVED_SUMMARY_WINDOW_MONTHS = 6;

export type ObservedSummaryFlow = "income" | "expense";

export type ObservedSummaryTransaction = {
  id: string;
  /** Only `"income"` and `"expense"` enter observed totals. Other values are kept as-is. */
  type: string;
  amountCents: number;
  occurredOn: string;
  categoryId: string | null;
  accountId: string | null;
  ignoredAt: string | null;
  transferGroupId: string | null;
  statementImportId?: string | null;
};

export type ObservedSummaryCategory = {
  id: string;
  name: string;
};

export type ObservedPeriodTotals = {
  /** Inclusive YYYY-MM-DD. */
  start: string;
  /** Exclusive YYYY-MM-DD. */
  end: string;
  inflowCents: number;
  outflowCents: number;
  /** inflowCents - outflowCents. Period cash flow, not a bank balance. */
  netCents: number;
  transactionCount: number;
};

export type ObservedExpenseCategoryTotal = {
  categoryId: string;
  categoryName: string;
  amountCents: number;
  transactionCount: number;
  percentageOfOutflows: number;
};

export type ObservedUncategorizedExpenses = {
  amountCents: number;
  transactionCount: number;
  percentageOfOutflows: number;
};

export type ObservedSummaryDataQuality = {
  /** No counted income/expense in the current civil-month window. */
  isCurrentPeriodEmpty: boolean;
  /** At least one counted income/expense in previousComparable or previousClosedMonth. */
  hasHistoricalData: boolean;
  isPartialCurrentMonth: boolean;
  hasPreviousComparableData: boolean;
  hasPreviousClosedMonthData: boolean;
  uncategorizedExpenseCents: number;
  uncategorizedExpenseCount: number;
  uncategorizedExpenseRatio: number;
  transactionsWithoutAccountId: number;
  excludedMarkedInternalTransferCount: number;
  /** Current-period rows whose type is not explicitly income or expense. */
  invalidTypeCount: number;
};

export type FinancialObservedSummary = {
  referenceDate: string;
  currentPeriod: ObservedPeriodTotals;
  previousComparablePeriod: ObservedPeriodTotals;
  previousClosedMonth: ObservedPeriodTotals;
  categories: ObservedExpenseCategoryTotal[];
  uncategorized: ObservedUncategorizedExpenses;
  dataQuality: ObservedSummaryDataQuality;
};

export function requireObservedSummaryReferenceDate(referenceDate?: string | null) {
  const value = (referenceDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("A data de referência do resumo é obrigatória.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
    throw new Error("A data de referência do resumo é inválida.");
  }
  return value;
}

export function observedSummaryWindowStart(referenceDate: string) {
  const date = parseLocalYmd(requireObservedSummaryReferenceDate(referenceDate));
  return ymd(new Date(date.getFullYear(), date.getMonth() - OBSERVED_SUMMARY_WINDOW_MONTHS, 1));
}

export function observedSummaryPeriods(referenceDate: string) {
  const reference = requireObservedSummaryReferenceDate(referenceDate);
  const currentStart = monthStartYMD(parseLocalYmd(reference));
  const currentEnd = addDaysYmd(reference, 1);
  const previousStart = ymd(addMonths(parseLocalYmd(currentStart), -1));
  const comparableDay = clampDayOfMonth(previousStart, dayOfYmd(reference));
  const previousComparableEnd = addDaysYmd(comparableDay, 1);
  const previousClosedEnd = nextMonthStartYMD(parseLocalYmd(previousStart));

  return {
    currentPeriod: { start: currentStart, end: currentEnd },
    previousComparablePeriod: { start: previousStart, end: previousComparableEnd },
    previousClosedMonth: { start: previousStart, end: previousClosedEnd },
  };
}

export function buildFinancialObservedSummary(input: {
  transactions: ObservedSummaryTransaction[];
  categories?: ObservedSummaryCategory[];
  referenceDate: string;
}): FinancialObservedSummary {
  const referenceDate = requireObservedSummaryReferenceDate(input.referenceDate);
  const periods = observedSummaryPeriods(referenceDate);
  const names = new Map((input.categories ?? []).map((category) => [category.id, category.name]));
  const currentPeriod = totalsForPeriod(input.transactions, periods.currentPeriod);
  const previousComparablePeriod = totalsForPeriod(input.transactions, periods.previousComparablePeriod);
  const previousClosedMonth = totalsForPeriod(input.transactions, periods.previousClosedMonth);
  const { categories, uncategorized } = expenseCategoriesForPeriod(
    input.transactions,
    periods.currentPeriod,
    names,
    currentPeriod.outflowCents,
  );
  const countedCurrent = countedInPeriod(input.transactions, periods.currentPeriod);
  const lastDayOfCurrentMonth = addDaysYmd(nextMonthStartYMD(parseLocalYmd(periods.currentPeriod.start)), -1);

  return {
    referenceDate,
    currentPeriod,
    previousComparablePeriod,
    previousClosedMonth,
    categories,
    uncategorized,
    dataQuality: {
      isCurrentPeriodEmpty: currentPeriod.transactionCount === 0,
      hasHistoricalData: previousComparablePeriod.transactionCount > 0
        || previousClosedMonth.transactionCount > 0,
      isPartialCurrentMonth: referenceDate < lastDayOfCurrentMonth,
      hasPreviousComparableData: previousComparablePeriod.transactionCount > 0,
      hasPreviousClosedMonthData: previousClosedMonth.transactionCount > 0,
      uncategorizedExpenseCents: uncategorized.amountCents,
      uncategorizedExpenseCount: uncategorized.transactionCount,
      uncategorizedExpenseRatio: ratio(uncategorized.amountCents, currentPeriod.outflowCents),
      transactionsWithoutAccountId: countedCurrent.filter((transaction) => !transaction.accountId).length,
      excludedMarkedInternalTransferCount: markedInternalTransfersInPeriod(input.transactions, periods.currentPeriod),
      invalidTypeCount: invalidTypeCountInPeriod(input.transactions, periods.currentPeriod),
    },
  };
}

export async function paginateObservedSummaryTransactions(
  fetchPage: (from: number, to: number) => Promise<ObservedSummaryTransaction[]>,
  pageSize = OBSERVED_SUMMARY_PAGE_SIZE,
) {
  if (pageSize < 1) throw new Error("O tamanho da página do resumo é inválido.");
  const transactions: ObservedSummaryTransaction[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    transactions.push(...page);
    if (page.length < pageSize) break;
  }
  return transactions;
}

export async function loadObservedSummaryTransactions(params: {
  householdId: string;
  referenceDate: string;
}) {
  const referenceDate = requireObservedSummaryReferenceDate(params.referenceDate);
  const windowStart = observedSummaryWindowStart(referenceDate);
  return paginateObservedSummaryTransactions(async (from, to) => {
    const { data, error } = await sb
      .from("transactions")
      .select("id,type,amount_cents,occurred_on,category_id,account_id,ignored_at,transfer_group_id,statement_import_id")
      .eq("household_id", params.householdId)
      .gte("occurred_on", windowStart)
      .lte("occurred_on", referenceDate)
      .order("occurred_on", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return ((data ?? []) as any[]).map(mapObservedSummaryTransaction);
  });
}

function mapObservedSummaryTransaction(row: any): ObservedSummaryTransaction {
  return {
    id: String(row.id),
    type: observedSummaryType(row.type),
    amountCents: integerCents(row.amount_cents),
    occurredOn: String(row.occurred_on),
    categoryId: row.category_id ?? null,
    accountId: row.account_id ?? null,
    ignoredAt: row.ignored_at ?? null,
    transferGroupId: row.transfer_group_id ?? null,
    statementImportId: row.statement_import_id ?? null,
  };
}

function observedSummaryType(value: unknown) {
  if (value === "income" || value === "expense") return value;
  return typeof value === "string" ? value : String(value ?? "");
}

function isObservedSummaryFlow(type: string): type is ObservedSummaryFlow {
  return type === "income" || type === "expense";
}

function totalsForPeriod(
  transactions: ObservedSummaryTransaction[],
  period: { start: string; end: string },
): ObservedPeriodTotals {
  const counted = countedInPeriod(transactions, period);
  const totals = summarizeMovementTotals(counted.map((transaction) => ({
    type: transaction.type,
    amount_cents: transaction.amountCents,
    account_id: transaction.accountId,
    transfer_group_id: transaction.transferGroupId,
  })));
  return {
    start: period.start,
    end: period.end,
    inflowCents: totals.income,
    outflowCents: totals.expense,
    netCents: totals.periodBalance,
    transactionCount: counted.length,
  };
}

function expenseCategoriesForPeriod(
  transactions: ObservedSummaryTransaction[],
  period: { start: string; end: string },
  names: Map<string, string>,
  outflowCents: number,
) {
  const grouped = new Map<string, { amountCents: number; transactionCount: number }>();
  let uncategorizedCents = 0;
  let uncategorizedCount = 0;

  for (const transaction of countedInPeriod(transactions, period)) {
    if (transaction.type !== "expense") continue;
    const amount = integerCents(transaction.amountCents);
    if (!transaction.categoryId) {
      uncategorizedCents += amount;
      uncategorizedCount += 1;
      continue;
    }
    const current = grouped.get(transaction.categoryId) ?? { amountCents: 0, transactionCount: 0 };
    current.amountCents += amount;
    current.transactionCount += 1;
    grouped.set(transaction.categoryId, current);
  }

  const categories = [...grouped.entries()]
    .map(([categoryId, totals]) => ({
      categoryId,
      categoryName: names.get(categoryId) || categoryId,
      amountCents: totals.amountCents,
      transactionCount: totals.transactionCount,
      percentageOfOutflows: percentOf(totals.amountCents, outflowCents),
    }))
    .sort((left, right) => (
      right.amountCents - left.amountCents
      || left.categoryId.localeCompare(right.categoryId)
      || left.categoryName.localeCompare(right.categoryName)
    ));

  return {
    categories,
    uncategorized: {
      amountCents: uncategorizedCents,
      transactionCount: uncategorizedCount,
      percentageOfOutflows: percentOf(uncategorizedCents, outflowCents),
    },
  };
}

function countedInPeriod(
  transactions: ObservedSummaryTransaction[],
  period: { start: string; end: string },
) {
  return transactions
    .filter(isCountedObservedTransaction)
    .filter((transaction) => inPeriod(transaction.occurredOn, period));
}

function isCountedObservedTransaction(
  transaction: ObservedSummaryTransaction,
): transaction is ObservedSummaryTransaction & { type: ObservedSummaryFlow } {
  if (transaction.ignoredAt) return false;
  if (isInternalTransferLeg({ transfer_group_id: transaction.transferGroupId })) return false;
  return isObservedSummaryFlow(transaction.type);
}

function invalidTypeCountInPeriod(
  transactions: ObservedSummaryTransaction[],
  period: { start: string; end: string },
) {
  return transactions.filter((transaction) => (
    !isObservedSummaryFlow(transaction.type)
    && inPeriod(transaction.occurredOn, period)
  )).length;
}

function markedInternalTransfersInPeriod(
  transactions: ObservedSummaryTransaction[],
  period: { start: string; end: string },
) {
  return transactions.filter((transaction) => (
    !transaction.ignoredAt
    && isInternalTransferLeg({ transfer_group_id: transaction.transferGroupId })
    && inPeriod(transaction.occurredOn, period)
  )).length;
}

function inPeriod(occurredOn: string, period: { start: string; end: string }) {
  return occurredOn >= period.start && occurredOn < period.end;
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

function dayOfYmd(value: string) {
  return Number(value.slice(8, 10));
}

function clampDayOfMonth(monthStart: string, day: number) {
  const date = parseLocalYmd(monthStart);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(Math.max(1, day), lastDay));
  return ymd(date);
}

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function ratio(part: number, whole: number) {
  if (whole <= 0) return 0;
  return part / whole;
}

function percentOf(part: number, whole: number) {
  if (whole <= 0) return 0;
  return (part * 100) / whole;
}
