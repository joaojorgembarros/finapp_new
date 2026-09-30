function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function cyclePaymentAlreadyPaidCents(payments: { paid_cents?: number | null }[]) {
  return payments.reduce((sum, payment) => sum + integerCents(payment.paid_cents), 0);
}

export type CyclePaymentAcceptance =
  | { ok: true; remainingCents: number; nextTotalCents: number }
  | { ok: false; code: "invalid" | "exceeds-remaining"; remainingCents: number };

export function getCyclePaymentAcceptance(input: {
  commitmentAmountCents: number;
  alreadyPaidCents: number;
  nextPaidCents: number;
}): CyclePaymentAcceptance {
  const commitmentAmountCents = integerCents(input.commitmentAmountCents);
  const alreadyPaidCents = integerCents(input.alreadyPaidCents);
  const nextPaidCents = integerCents(input.nextPaidCents);
  const remainingCents = Math.max(0, commitmentAmountCents - alreadyPaidCents);

  if (nextPaidCents <= 0) {
    return { ok: false, code: "invalid", remainingCents };
  }
  if (nextPaidCents > remainingCents) {
    return { ok: false, code: "exceeds-remaining", remainingCents };
  }
  return {
    ok: true,
    remainingCents,
    nextTotalCents: alreadyPaidCents + nextPaidCents,
  };
}

export function assertCyclePaymentFits(input: {
  commitmentAmountCents: number;
  alreadyPaidCents: number;
  nextPaidCents: number;
}) {
  const result = getCyclePaymentAcceptance(input);
  if (result.ok) return result;
  if (result.code === "invalid") {
    throw new Error("O valor contabilizado é inválido.");
  }
  throw new Error("Este pagamento ultrapassa o restante do compromisso neste ciclo.");
}
