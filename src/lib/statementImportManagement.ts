import { formatDateBRFromYMD } from "./format";
import { summarizeMovementTotals } from "./internalTransfers";
import { supabase } from "./supabase";
import type { StatementImport } from "./statementImports";

export type StatementTransactionRef = {
  id: string;
  statement_import_id: string | null;
  transfer_group_id: string | null;
};

export type StatementDeletionPreflight = {
  transactionCount: number;
  commitmentPaymentCount: number;
  blockedByExternalTransfer: boolean;
};

export type StatementDeletionDialog = {
  title: string;
  message: string;
  canDelete: boolean;
};

export const IMPORTED_REMOVAL_CONFIRMATION = {
  title: "Excluir lançamento?",
  message: "Este lançamento veio de um extrato importado. Ele será removido das suas movimentações e dos cálculos do Sonho+, mas o histórico do extrato será preservado.",
  confirm: "Excluir",
  cancel: "Cancelar",
} as const;

export const IMPORTED_COMMITMENT_REMOVAL_NOTE =
  "Este lançamento está vinculado a um pagamento de compromisso. Ao excluí-lo, esse pagamento deixará de contar e o compromisso poderá voltar a aparecer como pendente.";

export function importedRemovalMessage(linkedToCommitment: boolean) {
  if (!linkedToCommitment) return IMPORTED_REMOVAL_CONFIRMATION.message;
  return `${IMPORTED_REMOVAL_CONFIRMATION.message}\n\n${IMPORTED_COMMITMENT_REMOVAL_NOTE}`;
}

export function statementImportedCountLabel(count: number) {
  const total = Math.max(0, Math.trunc(count));
  return total === 1 ? "1 movimentação importada" : `${total} movimentações importadas`;
}

export function statementExcludedCountLabel(count: number) {
  const total = Math.max(0, Math.trunc(count));
  if (total <= 0) return null;
  return total === 1 ? "1 excluída" : `${total} excluídas`;
}

export const STATEMENT_LOOKUP_CHUNK = 80;

export function chunkLookupIds(ids: string[], size = STATEMENT_LOOKUP_CHUNK) {
  const chunkSize = Math.min(STATEMENT_LOOKUP_CHUNK, Math.max(1, Math.trunc(size)));
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
}

export function removalPlan(transaction: { statement_import_id?: string | null }) {
  return transaction.statement_import_id ? "ignore" as const : "delete" as const;
}

export function transactionOriginLabel(input: {
  statementImportId?: string | null;
  accountName?: string | null;
}) {
  if (!input.statementImportId) return "Manual";
  const accountName = input.accountName?.trim() ?? "";
  return accountName ? `${accountName} • Importado` : "Importado via extrato";
}

export function ignoredImportedTransaction<T extends {
  statement_import_id?: string | null;
  source_line?: number | null;
  original_note?: string | null;
  ignored_at?: string | null;
}>(transaction: T, ignoredAt: string): T {
  if (removalPlan(transaction) !== "ignore") {
    throw new Error("Lançamento manual deve ser excluído, não ignorado.");
  }
  return { ...transaction, ignored_at: ignoredAt };
}

export function totalsWithoutIgnored<T extends {
  ignored_at?: string | null;
  type: "income" | "expense";
  amount_cents: number;
  transfer_group_id?: string | null;
  account_id?: string | null;
}>(rows: T[]) {
  return summarizeMovementTotals(rows.filter((row) => !row.ignored_at));
}

export function formatStatementPeriod(periodStart: string, periodEnd: string) {
  const start = formatDateBRFromYMD(periodStart);
  const end = formatDateBRFromYMD(periodEnd);
  return start === end ? start : `${start} a ${end}`;
}

export function statementImportFacts(statement: Pick<
  StatementImport,
  "bank_id" | "file_name" | "period_start" | "period_end" | "created_at" | "transaction_count" | "income_cents" | "expense_cents" | "final_balance_cents" | "skipped_transaction_count" | "rejected_transaction_count"
>) {
  return {
    bankId: statement.bank_id,
    fileName: statement.file_name,
    periodLabel: formatStatementPeriod(statement.period_start, statement.period_end),
    importedAt: statement.created_at,
    transactionCount: statement.transaction_count,
    incomeCents: statement.income_cents,
    expenseCents: statement.expense_cents,
    finalBalanceCents: statement.final_balance_cents,
    showsFinalBalance: statement.final_balance_cents !== null,
    skippedCount: statement.skipped_transaction_count,
    rejectedCount: statement.rejected_transaction_count,
  };
}

export function importsAfterDeletion<T extends { id: string }>(imports: T[], deletedImportId: string) {
  return imports.filter((item) => item.id !== deletedImportId);
}

export function transactionsAfterStatementDeletion<T extends { statement_import_id?: string | null }>(
  transactions: T[],
  deletedImportId: string,
) {
  return transactions.filter((transaction) => transaction.statement_import_id !== deletedImportId);
}

export function auditStatementDeletion(input: {
  importId: string;
  importTransactions: StatementTransactionRef[];
  relatedTransferLegs: StatementTransactionRef[];
  commitmentPaymentCount: number;
  transactionCount?: number;
}): StatementDeletionPreflight {
  const legsByGroup = new Map<string, StatementTransactionRef[]>();
  for (const leg of [...input.importTransactions, ...input.relatedTransferLegs]) {
    if (!leg.transfer_group_id) continue;
    const legs = legsByGroup.get(leg.transfer_group_id) ?? [];
    if (!legs.some((item) => item.id === leg.id)) legs.push(leg);
    legsByGroup.set(leg.transfer_group_id, legs);
  }

  const externalGroups = new Set<string>();
  for (const transaction of input.importTransactions) {
    if (!transaction.transfer_group_id) continue;
    const legs = legsByGroup.get(transaction.transfer_group_id) ?? [];
    if (legs.some((leg) => leg.statement_import_id !== input.importId)) {
      externalGroups.add(transaction.transfer_group_id);
    }
  }

  return {
    transactionCount: input.transactionCount ?? input.importTransactions.length,
    commitmentPaymentCount: Math.max(0, input.commitmentPaymentCount),
    blockedByExternalTransfer: externalGroups.size > 0,
  };
}

export function buildStatementDeletionDialog(input: {
  bankName: string;
  periodLabel: string;
  preflight: StatementDeletionPreflight;
}): StatementDeletionDialog {
  if (input.preflight.blockedByExternalTransfer) {
    return {
      canDelete: false,
      title: "Não é possível excluir este extrato",
      message: "Este extrato possui uma movimentação vinculada a uma transferência entre contas. Desfaça esse vínculo antes de excluir o extrato.",
    };
  }

  const countLabel = input.preflight.transactionCount === 1
    ? "1 movimentação"
    : `${input.preflight.transactionCount} movimentações`;
  const lines = [
    `Período: ${input.periodLabel}`,
    countLabel,
    "Todas as movimentações deste extrato serão removidas do Sonho+.",
    "Isso não afeta sua conta bancária.",
  ];
  if (input.preflight.commitmentPaymentCount > 0) {
    lines.push(
      "",
      `Este extrato possui ${input.preflight.commitmentPaymentCount} pagamento(s) vinculado(s) a compromissos. Esses pagamentos também serão removidos e os compromissos poderão voltar a aparecer como pendentes.`,
    );
  }

  const bankName = input.bankName.trim();
  return {
    canDelete: true,
    title: bankName ? `Excluir extrato do ${bankName}?` : "Excluir extrato?",
    message: lines.join("\n"),
  };
}

export function sameFileReimportStatus(existingStatementId?: string | null) {
  return existingStatementId ? "blocked" as const : "allowed" as const;
}

export function onlyImportAfterStatementDeletion(onlyImport: string | null | undefined, deletedImportId: string) {
  return onlyImport === deletedImportId ? null : onlyImport ?? null;
}

export function movementsRouteForStatement(importId: string) {
  return {
    tab: "movimentacoes" as const,
    onlyImport: importId,
    postImport: "0",
    importId: "",
  };
}

const TRANSFER_PAGE_SIZE = 1000;

async function listStatementTransferLegs(householdId: string, importId: string) {
  const rows: StatementTransactionRef[] = [];
  let from = 0;
  let page: StatementTransactionRef[] = [];
  do {
    const result = await supabase
      .from("transactions")
      .select("id, statement_import_id, transfer_group_id")
      .eq("household_id", householdId)
      .eq("statement_import_id", importId)
      .not("transfer_group_id", "is", null)
      .range(from, from + TRANSFER_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    page = (result.data ?? []) as StatementTransactionRef[];
    rows.push(...page);
    from += TRANSFER_PAGE_SIZE;
  } while (page.length === TRANSFER_PAGE_SIZE);
  return rows;
}

export async function countIgnoredImportedTransactions(householdId: string, importIds: string[]) {
  const counts: Record<string, number> = {};
  await Promise.all(importIds.map(async (importId) => {
    const result = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("statement_import_id", importId)
      .not("ignored_at", "is", null);
    if (result.error) throw result.error;
    counts[importId] = result.count ?? 0;
  }));
  return counts;
}

export async function loadStatementDeletionPreflight(householdId: string, importId: string) {
  const [countResult, paymentResult, importTransactions] = await Promise.all([
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("statement_import_id", importId),
    supabase
      .from("financial_commitment_payments")
      .select("id, transactions!inner(statement_import_id)", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("transactions.statement_import_id", importId),
    listStatementTransferLegs(householdId, importId),
  ]);
  if (countResult.error) throw countResult.error;
  if (paymentResult.error) throw paymentResult.error;

  const groupIds = [...new Set(
    importTransactions
      .map((transaction) => transaction.transfer_group_id)
      .filter((groupId): groupId is string => Boolean(groupId)),
  )];
  const relatedTransferLegs: StatementTransactionRef[] = [];
  for (const slice of chunkLookupIds(groupIds)) {
    const legsResult = await supabase
      .from("transactions")
      .select("id, statement_import_id, transfer_group_id")
      .eq("household_id", householdId)
      .in("transfer_group_id", slice);
    if (legsResult.error) throw legsResult.error;
    relatedTransferLegs.push(...(legsResult.data ?? []) as StatementTransactionRef[]);
  }

  return auditStatementDeletion({
    importId,
    transactionCount: countResult.count ?? 0,
    importTransactions,
    relatedTransferLegs,
    commitmentPaymentCount: paymentResult.count ?? 0,
  });
}
