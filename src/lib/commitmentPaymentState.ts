export type CommitmentPaymentRecord = {
  id: string;
  paid_cents: number;
  paid_on: string | null;
  transaction_id: string | null;
};

export type CommitmentPaymentTransaction = {
  type?: string | null;
  amount_cents: number;
};

export type ResolvedCommitmentPayment = {
  paidCents: number;
  pendingCents: number;
  paymentId: string | null;
  paidOn: string | null;
  invalidUncounted: number;
};

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function groupPaymentsByCommitment<T extends { commitment_id: string }>(payments: T[]) {
  const grouped = new Map<string, T[]>();
  for (const payment of payments) {
    const current = grouped.get(payment.commitment_id);
    if (current) current.push(payment);
    else grouped.set(payment.commitment_id, [payment]);
  }
  return grouped;
}

/**
 * One cycle may have several payment events. The motor sums them and never
 * lets paid cents exceed the commitment. A payment only reduces the pending
 * balance when the linked expense still exists, so an orphan expense cannot
 * keep the bill fully pending at the same time.
 */
export function resolveCommitmentCyclePayment(input: {
  commitmentAmountCents: number;
  payments: CommitmentPaymentRecord[];
  transactionsById: Map<string, CommitmentPaymentTransaction | undefined>;
}): ResolvedCommitmentPayment {
  const amount = integerCents(input.commitmentAmountCents);
  let paidCents = 0;
  let paymentId: string | null = null;
  let paidOn: string | null = null;
  let invalidUncounted = 0;

  for (const payment of input.payments) {
    const recorded = integerCents(payment.paid_cents);
    if (recorded <= 0 || !payment.transaction_id) {
      invalidUncounted += 1;
      continue;
    }

    const transaction = input.transactionsById.get(payment.transaction_id);
    if (!transaction || transaction.type !== "expense") {
      invalidUncounted += 1;
      continue;
    }

    const transactionAmount = integerCents(transaction.amount_cents);
    if (transactionAmount <= 0) {
      invalidUncounted += 1;
      continue;
    }

    const remaining = Math.max(0, amount - paidCents);
    const counted = Math.min(recorded, transactionAmount, remaining);
    if (counted <= 0) continue;

    paidCents += counted;
    paymentId = payment.id;
    paidOn = payment.paid_on;
  }

  return {
    paidCents,
    pendingCents: Math.max(0, amount - paidCents),
    paymentId,
    paidOn,
    invalidUncounted,
  };
}
