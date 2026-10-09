export type InternalTransferType = "income" | "expense";

export type InternalTransferLeg = {
  id: string;
  household_id: string;
  type: InternalTransferType;
  amount_cents: number;
  account_id: string | null;
  note?: string | null;
  occurred_on?: string;
  category?: { name?: string | null } | null;
  ignored_at?: string | null;
  transfer_group_id?: string | null;
  linked_to_commitment?: boolean;
};

export type MovementHistoryFilters = {
  month?: string | "all";
  account?: string | "all";
  statementImportId?: string | null;
  flow?: "all" | InternalTransferType;
  search?: string;
};

export type InternalTransferDraft = {
  type: InternalTransferType;
  amount_cents: number;
  account_id: string;
  note: string | null;
  occurred_on: string;
};

export type MovementTotalsScope = {
  accountId?: string | "all" | null;
};

export const INTERNAL_TRANSFER_ERRORS = {
  sameTransaction: "Selecione duas movimentações diferentes para vincular.",
  household: "As duas pontas da transferência precisam pertencer à mesma casa.",
  ignored: "Não é possível vincular uma movimentação ignorada como transferência interna.",
  alreadyLinked: "Uma das movimentações já está vinculada a outra transferência interna.",
  commitment: "Uma movimentação vinculada a um compromisso não pode ser transferência interna.",
  amount: "As duas pontas da transferência precisam ter o mesmo valor.",
  type: "A transferência interna precisa ter uma entrada e uma saída.",
  accountMissing: "Informe a conta de origem e a conta de destino.",
  sameAccount: "As duas pontas da transferência precisam ser de contas diferentes.",
  originAccount: "Selecione a conta de origem.",
  destinationAccount: "Selecione a conta de destino.",
  amountPositive: "Informe um valor maior que zero.",
  date: "Informe a data da transferência.",
} as const;

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function normalizedAccountId(value: string | null | undefined) {
  const accountId = value?.trim() ?? "";
  return accountId.length ? accountId : null;
}

export function isInternalTransferLeg(transaction: {
  transfer_group_id?: string | null;
}) {
  return Boolean(transaction.transfer_group_id);
}

export function countsInConsolidatedResult(
  transaction: { transfer_group_id?: string | null },
  scope: MovementTotalsScope = {},
) {
  const accountId = scope.accountId ?? "all";
  if (accountId && accountId !== "all") return true;
  return !isInternalTransferLeg(transaction);
}

export function signedAmountCents(transaction: {
  type: InternalTransferType;
  amount_cents: number;
}) {
  const amount = Math.max(0, integerCents(transaction.amount_cents));
  return transaction.type === "income" ? amount : -amount;
}

export function summarizeMovementTotals<T extends {
  type: InternalTransferType;
  amount_cents: number;
  account_id?: string | null;
  transfer_group_id?: string | null;
}>(
  transactions: T[],
  scope: MovementTotalsScope = {},
) {
  const accountId = scope.accountId ?? "all";
  const specificAccount = Boolean(accountId && accountId !== "all");
  let income = 0;
  let expense = 0;

  for (const transaction of transactions) {
    if (specificAccount && (transaction.account_id ?? "not-informed") !== accountId) continue;
    if (!countsInConsolidatedResult(transaction, scope)) continue;
    const amount = Math.max(0, integerCents(transaction.amount_cents));
    if (transaction.type === "income") income += amount;
    else expense += amount;
  }

  return {
    income,
    expense,
    periodBalance: income - expense,
  };
}

export function validateInternalTransferLink(
  left: InternalTransferLeg,
  right: InternalTransferLeg,
): { ok: true } | { ok: false; message: string } {
  if (left.id === right.id) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.sameTransaction };
  }
  if (left.household_id !== right.household_id) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.household };
  }
  if (left.ignored_at || right.ignored_at) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.ignored };
  }
  if (left.transfer_group_id || right.transfer_group_id) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.alreadyLinked };
  }
  if (left.linked_to_commitment || right.linked_to_commitment) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.commitment };
  }
  if (integerCents(left.amount_cents) !== integerCents(right.amount_cents) || integerCents(left.amount_cents) <= 0) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.amount };
  }
  const types = new Set([left.type, right.type]);
  if (!types.has("income") || !types.has("expense")) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.type };
  }
  const leftAccount = normalizedAccountId(left.account_id);
  const rightAccount = normalizedAccountId(right.account_id);
  if (!leftAccount || !rightAccount) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.accountMissing };
  }
  if (leftAccount === rightAccount) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.sameAccount };
  }
  return { ok: true };
}

export function buildManualInternalTransfer(input: {
  transferGroupId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  occurredOn: string;
  note?: string | null;
}): { ok: true; transferGroupId: string; legs: InternalTransferDraft[] } | { ok: false; message: string } {
  const fromAccountId = normalizedAccountId(input.fromAccountId);
  const toAccountId = normalizedAccountId(input.toAccountId);
  const amountCents = integerCents(input.amountCents);
  const occurredOn = input.occurredOn?.trim() ?? "";
  const note = input.note?.trim() ? input.note.trim() : null;

  if (!fromAccountId) return { ok: false, message: INTERNAL_TRANSFER_ERRORS.originAccount };
  if (!toAccountId) return { ok: false, message: INTERNAL_TRANSFER_ERRORS.destinationAccount };
  if (fromAccountId === toAccountId) return { ok: false, message: INTERNAL_TRANSFER_ERRORS.sameAccount };
  if (amountCents <= 0) return { ok: false, message: INTERNAL_TRANSFER_ERRORS.amountPositive };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    return { ok: false, message: INTERNAL_TRANSFER_ERRORS.date };
  }

  return {
    ok: true,
    transferGroupId: input.transferGroupId,
    legs: [
      {
        type: "expense",
        amount_cents: amountCents,
        account_id: fromAccountId,
        note,
        occurred_on: occurredOn,
      },
      {
        type: "income",
        amount_cents: amountCents,
        account_id: toAccountId,
        note,
        occurred_on: occurredOn,
      },
    ],
  };
}

export function unlinkInternalTransferLegs<T extends { transfer_group_id?: string | null }>(
  transactions: T[],
  transferGroupId: string,
) {
  return transactions.map((transaction) => (
    transaction.transfer_group_id === transferGroupId
      ? { ...transaction, transfer_group_id: null }
      : transaction
  ));
}

export async function withSaveGate<T>(
  gate: { current: boolean },
  action: () => Promise<T>,
): Promise<T | "blocked"> {
  if (gate.current) return "blocked";
  gate.current = true;
  try {
    return await action();
  } finally {
    gate.current = false;
  }
}

export function periodBalanceCaption(accountId?: string | "all" | null) {
  if (accountId && accountId !== "all") {
    return "Movimentações desta conta no período. Não representa o saldo atual dos seus bancos.";
  }
  return "Entradas menos saídas das contas exibidas no período. Não representa o saldo atual dos seus bancos.";
}

export const PERIOD_BALANCE_FLOW_LABEL = "Entradas − saídas";

export const PERIOD_BALANCE_EXPLANATION =
  "Este valor mostra o que entrou menos o que saiu no período. Não é o saldo atual das suas contas.";

export function periodMovementWindowLabel(month?: string | null) {
  if (!month || month === "all") return "Todas as datas";
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return month;
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const endDay = String(lastDay).padStart(2, "0");
  return `01/${match[2]}/${match[1]} a ${endDay}/${match[2]}/${match[1]}`;
}

export function periodBalanceDetail(month?: string | null) {
  return `${PERIOD_BALANCE_FLOW_LABEL} • ${periodMovementWindowLabel(month)}`;
}

export function toInternalTransferLeg(
  transaction: InternalTransferLeg,
  paymentTransactionIds: Iterable<string> = [],
): InternalTransferLeg {
  const linkedIds = paymentTransactionIds instanceof Set
    ? paymentTransactionIds
    : new Set(paymentTransactionIds);
  return {
    ...transaction,
    linked_to_commitment: Boolean(transaction.linked_to_commitment || linkedIds.has(transaction.id)),
  };
}

export function findInternalTransferCounterparts(
  source: InternalTransferLeg,
  candidates: InternalTransferLeg[],
  paymentTransactionIds: Iterable<string> = [],
) {
  const left = toInternalTransferLeg(source, paymentTransactionIds);
  return candidates.filter((candidate) => (
    validateInternalTransferLink(left, toInternalTransferLeg(candidate, paymentTransactionIds)).ok
  ));
}

function matchesMonthAndAccount<T extends {
  occurred_on: string;
  account_id?: string | null;
  statement_import_id?: string | null;
}>(transaction: T, filters: MovementHistoryFilters = {}) {
  const month = filters.month ?? "all";
  const account = filters.account ?? "all";
  if (filters.statementImportId && transaction.statement_import_id !== filters.statementImportId) return false;
  if (month !== "all" && !transaction.occurred_on.startsWith(month)) return false;
  const accountKey = transaction.account_id ?? "not-informed";
  if (account !== "all" && accountKey !== account) return false;
  return true;
}

export function filterMovementsForTotals<T extends {
  occurred_on: string;
  account_id?: string | null;
  statement_import_id?: string | null;
}>(
  transactions: T[],
  filters: MovementHistoryFilters = {},
) {
  return transactions.filter((transaction) => matchesMonthAndAccount(transaction, filters));
}

export function filterMovementsForList<T extends {
  type: InternalTransferType;
  occurred_on: string;
  account_id?: string | null;
  statement_import_id?: string | null;
  note?: string | null;
  category?: { name?: string | null } | null;
}>(
  transactions: T[],
  filters: MovementHistoryFilters = {},
  searchHaystack: (transaction: T) => (string | null | undefined)[] = (transaction) => [
    transaction.note,
    transaction.category?.name,
  ],
) {
  const flow = filters.flow ?? "all";
  const query = filters.search?.trim().toLocaleLowerCase("pt-BR") ?? "";
  return filterMovementsForTotals(transactions, filters).filter((transaction) => {
    if (flow !== "all" && transaction.type !== flow) return false;
    if (!query) return true;
    return searchHaystack(transaction).some((value) => (
      String(value ?? "").toLocaleLowerCase("pt-BR").includes(query)
    ));
  });
}
