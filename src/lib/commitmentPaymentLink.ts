export function getUnlinkedPaymentMessage() {
  return "O gasto foi salvo, mas o pagamento do compromisso não foi registrado. Tente de novo ou desfaça este gasto para o compromisso não continuar pendente.";
}

export async function linkExpenseToCommitmentWithRetry(
  link: () => Promise<unknown>,
): Promise<{ kind: "linked" } | { kind: "unlinked"; message: string }> {
  try {
    await link();
    return { kind: "linked" };
  } catch {
    try {
      await link();
      return { kind: "linked" };
    } catch {
      return { kind: "unlinked", message: getUnlinkedPaymentMessage() };
    }
  }
}

export async function rollbackUnlinkedManualPayment(input: {
  householdId: string;
  transactionId: string;
  deleteManualTransaction: (householdId: string, transactionId: string) => Promise<unknown>;
}) {
  await input.deleteManualTransaction(input.householdId, input.transactionId);
}
