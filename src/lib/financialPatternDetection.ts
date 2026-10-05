import { normalizeMerchant, type NormalizedMerchant } from "./merchantNormalize";

export const PATTERN_DETECTION = {
  windowMonths: 6,
  minRecurringOccurrences: 3,
  minWeeklyOccurrences: 4,
  weeklyIntervalMinDays: 6,
  weeklyIntervalMaxDays: 8,
  dayOfMonthTolerance: 4,
  maxChargesPerMonthForRecurring: 2,
  monthlyRecencyMaxDays: 45,
  weeklyRecencyMaxDays: 14,
  fixedRelativeVariance: 0.05,
  fixedAbsoluteCents: 200,
  variableMaxRelativeVariance: 0.35,
  habitMinTransactions: 8,
  habitMinMonths: 2,
  habitMinDistinctMerchants: 3,
  recentOccurrenceLimit: 3,
  minEstimatedDay: 1,
  maxEstimatedDay: 28,
  actionableConfidence: 70,
  score: {
    consistentTiming: 50,
    veryStableAmount: 25,
    strongMerchant: 15,
    fourOrMoreOccurrences: 10,
    exactlyThreeOccurrences: 5,
    weakMerchantPenalty: 20,
    excessiveVariancePenalty: 15,
    habitBase: 10,
    habitVolume: 15,
    habitMonths: 10,
    habitMerchants: 10,
  },
} as const;

export type PatternDirection = "income" | "expense";

export type PatternBehaviorType =
  | "fixed_recurring_expense"
  | "variable_recurring_expense"
  | "fixed_recurring_income"
  | "variable_recurring_income"
  | "habitual_category_spend"
  | "eventual"
  | "unknown";

const ACTIONABLE_BEHAVIOR_TYPES = new Set<PatternBehaviorType>([
  "fixed_recurring_expense",
  "variable_recurring_expense",
  "fixed_recurring_income",
  "variable_recurring_income",
]);

export type PatternCadence = "monthly" | "weekly" | "unknown";

export type PatternDetectionTransaction = {
  id: string;
  type: PatternDirection;
  amountCents: number;
  occurredOn: string;
  note?: string | null;
  originalNote?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  ignoredAt?: string | null;
  transferGroupId?: string | null;
};

export type DetectedFinancialPattern = {
  key: string;
  direction: PatternDirection;
  behaviorType: PatternBehaviorType;
  normalizedMerchant?: string;
  merchantConfidence?: NormalizedMerchant["confidence"];
  accountId?: string | null;
  categoryId?: string | null;
  cadence: PatternCadence;
  estimatedAmountCents: number;
  estimatedDay?: number;
  confidence: number;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  transactionIds: string[];
};

export type DetectFinancialPatternsOptions = {
  referenceDate?: string;
};

export function medianCents(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].map(integerCents).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function clampConfidence(score: number) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function isActionablePattern(
  pattern: Pick<DetectedFinancialPattern, "confidence"> &
    Partial<Pick<DetectedFinancialPattern, "merchantConfidence" | "behaviorType">>,
) {
  if (pattern.merchantConfidence === "weak") return false;
  if (pattern.behaviorType && !ACTIONABLE_BEHAVIOR_TYPES.has(pattern.behaviorType)) return false;
  return pattern.confidence >= PATTERN_DETECTION.actionableConfidence;
}

export function detectFinancialPatterns(
  transactions: PatternDetectionTransaction[],
  options: DetectFinancialPatternsOptions = {},
): DetectedFinancialPattern[] {
  const eligible = eligibleTransactions(transactions, options.referenceDate);
  if (!eligible.length) return [];

  const merchantPatterns = detectMerchantPatterns(eligible, eligible.referenceDate);
  const habitPatterns = detectHabitPatterns(eligible);
  return [...merchantPatterns, ...habitPatterns].sort(comparePatterns);
}

function eligibleTransactions(transactions: PatternDetectionTransaction[], referenceDate?: string): EligibleSet {
  const parsed = transactions
    .filter((transaction) => !transaction.ignoredAt)
    .filter((transaction) => !transaction.transferGroupId)
    .filter((transaction) => integerCents(transaction.amountCents) > 0)
    .map((transaction) => {
      const occurredOn = parseYmd(transaction.occurredOn);
      return occurredOn ? { transaction, occurredOn } : null;
    })
    .filter((row): row is EligibleRow => Boolean(row))
    .sort(compareOccurredThenId);

  if (!parsed.length) {
    return Object.assign([] as EligibleRow[], { referenceDate: { year: 1970, month: 1, day: 1 } });
  }

  const reference = parseYmd(referenceDate) ?? parsed[parsed.length - 1].occurredOn;
  const windowStart = addMonthsYmd(reference, -PATTERN_DETECTION.windowMonths);
  const rows = parsed.filter((row) => compareYmd(row.occurredOn, windowStart) >= 0);
  return Object.assign(rows, { referenceDate: reference });
}

function detectMerchantPatterns(rows: EligibleRow[], referenceDate: Ymd): DetectedFinancialPattern[] {
  const groups = new Map<string, EligibleRow[]>();
  for (const row of rows) {
    const merchant = merchantFrom(row.transaction);
    const groupKey = [
      row.transaction.type,
      merchant.key || row.transaction.id,
      row.transaction.accountId ?? "",
    ].join("|");
    const current = groups.get(groupKey) ?? [];
    current.push(row);
    groups.set(groupKey, current);
  }

  const patterns: DetectedFinancialPattern[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(compareOccurredThenId);
    const merchant = merchantFrom(sorted[0].transaction);
    const amounts = sorted.map((row) => integerCents(row.transaction.amountCents));
    const dates = sorted.map((row) => row.occurredOn);
    const recent = recentRows(sorted);
    const estimatedAmountCents = medianCents(recent.map((row) => integerCents(row.transaction.amountCents)));
    const cadence = detectCadence(dates);
    const spread = amountSpread(amounts);
    const occurrenceCount = sorted.length;
    const lastSeen = sorted[sorted.length - 1].occurredOn;
    const recentEnough = isRecentPattern(lastSeen, referenceDate, cadence);
    const behaviorType = classifyMerchantBehavior({
      direction: sorted[0].transaction.type,
      merchant,
      occurrenceCount,
      cadence: recentEnough ? cadence : "unknown",
      spread,
    });
    const confidence = scoreMerchantPattern({
      merchant,
      occurrenceCount,
      cadence: recentEnough ? cadence : "unknown",
      spread,
    });

    patterns.push({
      key: `merchant:${sorted[0].transaction.type}:${merchant.key || "empty"}:${sorted[0].transaction.accountId ?? "none"}`,
      direction: sorted[0].transaction.type,
      behaviorType,
      normalizedMerchant: merchant.key || undefined,
      merchantConfidence: merchant.confidence,
      accountId: sorted[0].transaction.accountId ?? null,
      categoryId: uniqueCategoryId(sorted),
      cadence: recentEnough ? cadence : "unknown",
      estimatedAmountCents,
      estimatedDay: recentEnough && cadence === "monthly" ? medianDayOfMonth(monthAnchors(dates)) : undefined,
      confidence,
      occurrenceCount,
      firstSeen: formatYmd(sorted[0].occurredOn),
      lastSeen: formatYmd(lastSeen),
      transactionIds: sorted.map((row) => row.transaction.id),
    });
  }
  return patterns;
}

function detectHabitPatterns(rows: EligibleRow[]): DetectedFinancialPattern[] {
  const expenses = rows.filter((row) => row.transaction.type === "expense" && row.transaction.categoryId);
  const groups = new Map<string, EligibleRow[]>();
  for (const row of expenses) {
    const categoryId = row.transaction.categoryId as string;
    const current = groups.get(categoryId) ?? [];
    current.push(row);
    groups.set(categoryId, current);
  }

  const patterns: DetectedFinancialPattern[] = [];
  for (const [categoryId, group] of groups) {
    const merchants = new Set(group.map((row) => merchantFrom(row.transaction).key).filter(Boolean));
    const months = new Set(group.map((row) => `${row.occurredOn.year}-${pad2(row.occurredOn.month)}`));
    if (
      group.length < PATTERN_DETECTION.habitMinTransactions ||
      months.size < PATTERN_DETECTION.habitMinMonths ||
      merchants.size < PATTERN_DETECTION.habitMinDistinctMerchants
    ) {
      continue;
    }

    const sorted = [...group].sort(compareOccurredThenId);
    patterns.push({
      key: `habit:expense:${categoryId}`,
      direction: "expense",
      behaviorType: "habitual_category_spend",
      categoryId,
      cadence: "unknown",
      estimatedAmountCents: medianCents(monthlyTotals(sorted)),
      confidence: scoreHabitPattern(sorted.length, months.size, merchants.size),
      occurrenceCount: sorted.length,
      firstSeen: formatYmd(sorted[0].occurredOn),
      lastSeen: formatYmd(sorted[sorted.length - 1].occurredOn),
      transactionIds: sorted.map((row) => row.transaction.id),
    });
  }
  return patterns;
}

function classifyMerchantBehavior(params: {
  direction: PatternDirection;
  merchant: NormalizedMerchant;
  occurrenceCount: number;
  cadence: PatternCadence;
  spread: AmountSpread;
}): PatternBehaviorType {
  if (params.occurrenceCount === 1) return "eventual";
  if (params.occurrenceCount < PATTERN_DETECTION.minRecurringOccurrences) return "unknown";
  if (params.merchant.confidence !== "strong") return "unknown";
  if (params.cadence === "unknown") return "unknown";
  if (params.spread.relative > PATTERN_DETECTION.variableMaxRelativeVariance) return "unknown";

  const stable = isFixedAmount(params.spread);
  if (params.direction === "income") {
    return stable ? "fixed_recurring_income" : "variable_recurring_income";
  }
  return stable ? "fixed_recurring_expense" : "variable_recurring_expense";
}

function scoreMerchantPattern(params: {
  merchant: NormalizedMerchant;
  occurrenceCount: number;
  cadence: PatternCadence;
  spread: AmountSpread;
}) {
  const { score } = PATTERN_DETECTION;
  let total = 0;
  if (params.cadence !== "unknown") total += score.consistentTiming;
  if (isFixedAmount(params.spread)) total += score.veryStableAmount;
  if (params.merchant.confidence === "strong" && params.merchant.key) total += score.strongMerchant;
  if (params.occurrenceCount >= 4) total += score.fourOrMoreOccurrences;
  else if (params.occurrenceCount === 3) total += score.exactlyThreeOccurrences;
  if (params.merchant.confidence === "weak") total -= score.weakMerchantPenalty;
  if (params.spread.relative > PATTERN_DETECTION.variableMaxRelativeVariance) {
    total -= score.excessiveVariancePenalty;
  }
  return clampConfidence(total);
}

function scoreHabitPattern(occurrenceCount: number, monthCount: number, merchantCount: number) {
  const { score } = PATTERN_DETECTION;
  let total = score.habitBase;
  if (occurrenceCount >= PATTERN_DETECTION.habitMinTransactions) total += score.habitVolume;
  if (monthCount >= PATTERN_DETECTION.habitMinMonths) total += score.habitMonths;
  if (merchantCount >= PATTERN_DETECTION.habitMinDistinctMerchants) total += score.habitMerchants;
  return clampConfidence(total);
}

function detectCadence(dates: Ymd[]): PatternCadence {
  if (dates.length >= PATTERN_DETECTION.minWeeklyOccurrences && intervalsMatch(dates, PATTERN_DETECTION.weeklyIntervalMinDays, PATTERN_DETECTION.weeklyIntervalMaxDays)) {
    return "weekly";
  }
  if (isMonthlyCadence(dates)) {
    return "monthly";
  }
  return "unknown";
}

function isMonthlyCadence(dates: Ymd[]) {
  if (dates.length < PATTERN_DETECTION.minRecurringOccurrences) return false;
  if (![...chargesPerMonth(dates).values()].every((count) => count <= PATTERN_DETECTION.maxChargesPerMonthForRecurring)) {
    return false;
  }
  const anchors = monthAnchors(dates);
  if (anchors.length < PATTERN_DETECTION.minRecurringOccurrences) return false;
  if (!areConsecutiveMonths(anchors)) return false;
  const estimatedDay = medianDayOfMonth(anchors);
  return anchors.every((date) => dayOfMonthDistance(date.day, estimatedDay) <= PATTERN_DETECTION.dayOfMonthTolerance);
}

function chargesPerMonth(dates: Ymd[]) {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = monthKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function monthAnchors(dates: Ymd[]) {
  const grouped = new Map<string, Ymd[]>();
  for (const date of dates) {
    const key = monthKey(date);
    const current = grouped.get(key) ?? [];
    current.push(date);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((monthDates) => [...monthDates].sort(compareYmd)[monthDates.length - 1])
    .sort(compareYmd);
}

function areConsecutiveMonths(dates: Ymd[]) {
  for (let index = 1; index < dates.length; index += 1) {
    const previous = dates[index - 1].year * 12 + dates[index - 1].month;
    const next = dates[index].year * 12 + dates[index].month;
    if (next - previous !== 1) return false;
  }
  return true;
}

function monthKey(date: Ymd) {
  return `${date.year}-${pad2(date.month)}`;
}

function isRecentPattern(lastSeen: Ymd, referenceDate: Ymd, cadence: PatternCadence) {
  if (compareYmd(lastSeen, referenceDate) >= 0) return true;
  const gap = daysBetween(lastSeen, referenceDate);
  if (cadence === "weekly") return gap <= PATTERN_DETECTION.weeklyRecencyMaxDays;
  if (cadence === "monthly") return gap <= PATTERN_DETECTION.monthlyRecencyMaxDays;
  return true;
}

function intervalsMatch(dates: Ymd[], minDays: number, maxDays: number) {
  if (dates.length < 2) return false;
  for (let index = 1; index < dates.length; index += 1) {
    const gap = daysBetween(dates[index - 1], dates[index]);
    if (gap < minDays || gap > maxDays) return false;
  }
  return true;
}

function isFixedAmount(spread: AmountSpread) {
  return spread.relative <= PATTERN_DETECTION.fixedRelativeVariance
    || spread.absolute <= PATTERN_DETECTION.fixedAbsoluteCents;
}

function amountSpread(amounts: number[]): AmountSpread {
  const values = amounts.map(integerCents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const median = medianCents(values) || 1;
  return {
    absolute: max - min,
    relative: (max - min) / median,
  };
}

function recentRows(rows: EligibleRow[]) {
  if (rows.length <= PATTERN_DETECTION.recentOccurrenceLimit) return rows;
  const last = rows[rows.length - 1].occurredOn;
  const cutoff = addMonthsYmd(last, -PATTERN_DETECTION.recentOccurrenceLimit);
  const inWindow = rows.filter((row) => compareYmd(row.occurredOn, cutoff) >= 0);
  if (inWindow.length >= PATTERN_DETECTION.minRecurringOccurrences) return inWindow;
  return rows.slice(-PATTERN_DETECTION.recentOccurrenceLimit);
}

function monthlyTotals(rows: EligibleRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const month = `${row.occurredOn.year}-${pad2(row.occurredOn.month)}`;
    totals.set(month, (totals.get(month) ?? 0) + integerCents(row.transaction.amountCents));
  }
  return [...totals.values()];
}

function uniqueCategoryId(rows: EligibleRow[]) {
  const ids = new Set(rows.map((row) => row.transaction.categoryId).filter((id): id is string => Boolean(id)));
  return ids.size === 1 ? [...ids][0] : null;
}

function merchantFrom(transaction: PatternDetectionTransaction) {
  return normalizeMerchant(transaction.originalNote || transaction.note || "");
}

function medianDayOfMonth(dates: Ymd[]) {
  const day = medianCents(dates.map((date) => date.day));
  return Math.max(
    PATTERN_DETECTION.minEstimatedDay,
    Math.min(PATTERN_DETECTION.maxEstimatedDay, day),
  );
}

function dayOfMonthDistance(left: number, right: number) {
  if (left >= 28 && right >= 28) return 0;
  return Math.abs(left - right);
}

function comparePatterns(left: DetectedFinancialPattern, right: DetectedFinancialPattern) {
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  return left.key.localeCompare(right.key);
}

function compareOccurredThenId(left: EligibleRow, right: EligibleRow) {
  const byDate = compareYmd(left.occurredOn, right.occurredOn);
  if (byDate !== 0) return byDate;
  return left.transaction.id.localeCompare(right.transaction.id);
}

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

type Ymd = { year: number; month: number; day: number };
type EligibleRow = { transaction: PatternDetectionTransaction; occurredOn: Ymd };
type EligibleSet = EligibleRow[] & { referenceDate: Ymd };
type AmountSpread = { absolute: number; relative: number };

function parseYmd(value?: string | null): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatYmd(value: Ymd) {
  return `${value.year}-${pad2(value.month)}-${pad2(value.day)}`;
}

function addMonthsYmd(value: Ymd, months: number): Ymd {
  const utc = new Date(Date.UTC(value.year, value.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(value.day, lastDay);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day };
}

function daysBetween(start: Ymd, end: Ymd) {
  const from = Date.UTC(start.year, start.month - 1, start.day);
  const to = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((to - from) / 86_400_000);
}

function compareYmd(left: Ymd, right: Ymd) {
  return formatYmd(left).localeCompare(formatYmd(right));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
