const SHORT_MONTHS_PT_BR = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

type PendingCommitmentLike = {
  pending_cents: number;
  due_on: string;
  created_at: string;
};

export type CommitmentPaymentStatus = "Não pago" | "Pago parcialmente" | "Pago";

function normalizeCents(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function getCommitmentPaymentProgress(totalCents: number, paidCents: number) {
  const total = normalizeCents(totalCents);
  const paid = Math.min(total, normalizeCents(paidCents));
  const remaining = Math.max(0, total - paid);
  const status: CommitmentPaymentStatus = paid <= 0
    ? "Não pago"
    : remaining <= 0
      ? "Pago"
      : "Pago parcialmente";

  return {
    totalCents: total,
    paidCents: paid,
    remainingCents: remaining,
    status,
  };
}

export function getPaymentAmountIssue(remainingCents: number, paymentCents: number) {
  const remaining = normalizeCents(remainingCents);
  const payment = normalizeCents(paymentCents);
  if (payment <= 0) return "invalid" as const;
  if (payment > remaining) return "exceeds-remaining" as const;
  return null;
}

export function formatShortDateFromYmd(ymd: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;

  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = SHORT_MONTHS_PT_BR[month - 1];
  if (!monthLabel || day < 1 || day > 31) return ymd;

  return `${day} ${monthLabel}`;
}

export function sortPendingCommitments<T extends PendingCommitmentLike>(commitments: readonly T[]) {
  return commitments
    .filter((item) => Number.isFinite(item.pending_cents) && item.pending_cents > 0)
    .slice()
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.created_at.localeCompare(b.created_at));
}
