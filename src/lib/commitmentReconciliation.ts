import {
  FinancialCycle,
  FinancialOverviewCommitment,
  getCycleForOffset,
  getFinancialOverview,
  getFinancialSettings,
  listCommitmentPayments,
  setCommitmentPaid,
} from "./financialPlanning";
import {
  listStatementImportTransactions,
  StatementImportTransaction,
} from "./statementImports";

export const COMMITMENT_RECONCILIATION_DUE_WINDOW_DAYS = 7;

export type CommitmentReconciliationExpense = Pick<
  StatementImportTransaction,
  "id" | "type" | "amount_cents" | "occurred_on"
>;

export type CommitmentReconciliationCommitment = Pick<
  FinancialOverviewCommitment,
  "id" | "amount_cents" | "due_on" | "paid_cents" | "pending_cents" | "payment_id"
>;

export type CommitmentReconciliationMatch = {
  commitmentId: string;
  transactionId: string;
  amountCents: number;
  paidOn: string;
};

export type CommitmentReconciliationResult = {
  matchedCount: number;
  failedCount: number;
};

type FindCommitmentMatchesParams = {
  expenses: CommitmentReconciliationExpense[];
  commitments: CommitmentReconciliationCommitment[];
  linkedTransactionIds?: Iterable<string>;
  linkedCommitmentIds?: Iterable<string>;
  maxDueDistanceDays?: number;
};

type ReconciliationDependencies = {
  getFinancialSettings: typeof getFinancialSettings;
  getFinancialOverview: typeof getFinancialOverview;
  listCommitmentPayments: typeof listCommitmentPayments;
  listStatementImportTransactions: typeof listStatementImportTransactions;
  setCommitmentPaid: typeof setCommitmentPaid;
};

const defaultDependencies: ReconciliationDependencies = {
  getFinancialSettings,
  getFinancialOverview,
  listCommitmentPayments,
  listStatementImportTransactions,
  setCommitmentPaid,
};

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function ymdDayNumber(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return Math.trunc(date.getTime() / 86_400_000);
}

function localDateFromYmd(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null;
  return date;
}

function groupByAmount<T>(items: T[], amountOf: (item: T) => number) {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const amount = positiveInteger(amountOf(item));
    if (amount <= 0) continue;
    const group = groups.get(amount);
    if (group) group.push(item);
    else groups.set(amount, [item]);
  }
  return groups;
}

/**
 * Selects only one-to-one matches. Proximity never resolves ambiguity: if either
 * side has two rows with the same value in a cycle, that value is left untouched.
 */
export function findUnambiguousCommitmentMatches({
  expenses,
  commitments,
  linkedTransactionIds = [],
  linkedCommitmentIds = [],
  maxDueDistanceDays = COMMITMENT_RECONCILIATION_DUE_WINDOW_DAYS,
}: FindCommitmentMatchesParams): CommitmentReconciliationMatch[] {
  const linkedTransactions = new Set(linkedTransactionIds);
  const linkedCommitments = new Set(linkedCommitmentIds);
  const dueWindowDays = Math.max(0, Math.trunc(maxDueDistanceDays));

  const availableExpenses = expenses.filter((expense) =>
    expense.type === "expense" &&
    !linkedTransactions.has(expense.id) &&
    positiveInteger(expense.amount_cents) > 0
  );
  const pendingCommitments = commitments.filter((commitment) => {
    const amountCents = positiveInteger(commitment.amount_cents);
    return amountCents > 0 &&
      positiveInteger(commitment.pending_cents) === amountCents &&
      positiveInteger(commitment.paid_cents) === 0 &&
      !commitment.payment_id &&
      !linkedCommitments.has(commitment.id);
  });
  const expensesByAmount = groupByAmount(availableExpenses, (expense) => expense.amount_cents);
  const commitmentsByAmount = groupByAmount(pendingCommitments, (commitment) => commitment.amount_cents);
  const matches: CommitmentReconciliationMatch[] = [];

  for (const [amountCents, amountExpenses] of expensesByAmount) {
    const amountCommitments = commitmentsByAmount.get(amountCents) ?? [];
    if (amountExpenses.length !== 1 || amountCommitments.length !== 1) continue;

    const expense = amountExpenses[0];
    const commitment = amountCommitments[0];
    const expenseDay = ymdDayNumber(expense.occurred_on);
    const dueDay = ymdDayNumber(commitment.due_on);
    if (expenseDay === null || dueDay === null || Math.abs(expenseDay - dueDay) > dueWindowDays) continue;

    matches.push({
      commitmentId: commitment.id,
      transactionId: expense.id,
      amountCents,
      paidOn: expense.occurred_on,
    });
  }

  return matches;
}

function cycleForTransactionDate(
  settings: Awaited<ReturnType<typeof getFinancialSettings>>,
  occurredOn: string
) {
  const reference = localDateFromYmd(occurredOn);
  return reference ? getCycleForOffset(settings, 0, reference) : null;
}

/**
 * Best-effort reconciliation for transactions created by one statement import.
 * Database/read failures are deliberately contained so a successful import is
 * never reported as failed just because automatic reconciliation was unavailable.
 */
export async function reconcileImportedCommitments(
  params: { householdId: string; userId: string; importId: string },
  dependencies: ReconciliationDependencies = defaultDependencies
): Promise<CommitmentReconciliationResult> {
  try {
    const [settings, importedTransactions] = await Promise.all([
      dependencies.getFinancialSettings(params.householdId),
      dependencies.listStatementImportTransactions(params.householdId, params.importId),
    ]);
    const expenses = importedTransactions.filter((transaction) => transaction.type === "expense");
    const cycles = new Map<string, FinancialCycle>();

    for (const expense of expenses) {
      const cycle = cycleForTransactionDate(settings, expense.occurred_on);
      if (cycle) cycles.set(cycle.key, cycle);
    }

    const matches = (await Promise.all([...cycles.values()].map(async (cycle) => {
      const [overview, payments] = await Promise.all([
        dependencies.getFinancialOverview({
          householdId: params.householdId,
          userId: params.userId,
          cycle,
        }),
        dependencies.listCommitmentPayments(params.householdId, cycle.key),
      ]);
      const cycleExpenses = expenses.filter((expense) =>
        expense.occurred_on >= cycle.start && expense.occurred_on < cycle.end
      );

      return findUnambiguousCommitmentMatches({
        expenses: cycleExpenses,
        commitments: overview.commitments,
        linkedTransactionIds: payments.flatMap((payment) => payment.transaction_id ? [payment.transaction_id] : []),
        linkedCommitmentIds: payments.map((payment) => payment.commitment_id),
      }).map((match) => ({ ...match, cycleKey: cycle.key }));
    }))).flat();

    const outcomes = await Promise.allSettled(matches.map((match) =>
      dependencies.setCommitmentPaid({
        householdId: params.householdId,
        userId: params.userId,
        commitmentId: match.commitmentId,
        cycleKey: match.cycleKey,
        paid: true,
        paidCents: match.amountCents,
        paidOn: match.paidOn,
        transactionId: match.transactionId,
      })
    ));
    const matchedCount = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
    return { matchedCount, failedCount: outcomes.length - matchedCount };
  } catch {
    return { matchedCount: 0, failedCount: 0 };
  }
}
