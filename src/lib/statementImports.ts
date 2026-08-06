import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { supabase } from "./supabase";
import type { BankId } from "./banks";
import type { ParsedCsvTx } from "./csvImport";
import type { StatementCategoryRuleInput } from "./statementCategoryRules";

export type StatementBalanceConfidence = "confirmed" | "derived" | "unavailable";

export type StatementImport = {
  id: string;
  file_name: string;
  bank_id: BankId | null;
  transaction_count: number;
  skipped_transaction_count: number;
  rejected_transaction_count: number;
  income_cents: number;
  expense_cents: number;
  initial_balance_cents: number | null;
  final_balance_cents: number | null;
  balance_confidence: StatementBalanceConfidence;
  period_start: string;
  period_end: string;
  created_at: string;
};

const statementImportColumns =
  "id,file_name,bank_id,transaction_count,skipped_transaction_count,rejected_transaction_count,income_cents,expense_cents,initial_balance_cents,final_balance_cents,balance_confidence,period_start,period_end,created_at";
const legacyStatementImportColumns =
  "id,file_name,bank_id,transaction_count,skipped_transaction_count,rejected_transaction_count,income_cents,expense_cents,initial_balance_cents,final_balance_cents,period_start,period_end,created_at";

type StatementImportWithoutConfidence = Omit<StatementImport, "balance_confidence">;

function isBalanceConfidence(value: unknown): value is StatementBalanceConfidence {
  return value === "confirmed" || value === "derived" || value === "unavailable";
}

function normalizeStatementImport(
  row: StatementImportWithoutConfidence & { balance_confidence?: unknown }
): StatementImport {
  const balanceConfidence = isBalanceConfidence(row.balance_confidence)
    ? row.balance_confidence
    : row.initial_balance_cents !== null
      ? "derived"
      : "unavailable";
  const derivedFinalBalance = row.initial_balance_cents === null
    ? null
    : row.initial_balance_cents + row.income_cents - row.expense_cents;

  return {
    ...row,
    final_balance_cents: balanceConfidence === "unavailable"
      ? null
      : row.final_balance_cents ?? derivedFinalBalance,
    balance_confidence: balanceConfidence,
  };
}

function isMissingBalanceConfidenceColumn(error: unknown) {
  const candidate = error as { code?: string; message?: string; details?: string } | null;
  const description = `${candidate?.message ?? ""} ${candidate?.details ?? ""}`;
  return candidate?.code === "42703" || candidate?.code === "PGRST204" || /balance_confidence/i.test(description);
}

function isMissingImportStatementV6(error: unknown) {
  const candidate = error as { code?: string } | null;
  return candidate?.code === "42883" || candidate?.code === "PGRST202";
}

export type CategorizedStatementRow = ParsedCsvTx & {
  categoryId?: string | null;
};

function toStatementRows(rows: CategorizedStatementRow[]) {
  return rows.map((row) => ({
    type: row.type,
    amount_cents: row.amount_cents,
    note: row.note,
    occurred_on: row.occurred_on,
    raw_line: row.rawLine,
    category_id: row.categoryId ?? null,
  }));
}

export async function hashStatementContent(content: string) {
  return bytesToHex(sha256(utf8ToBytes(content)));
}

export async function findStatementImportByHash(householdId: string, fileHash: string) {
  const currentResult = await supabase
    .from("statement_imports")
    .select(statementImportColumns)
    .eq("household_id", householdId)
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (!currentResult.error) {
    return currentResult.data
      ? normalizeStatementImport(currentResult.data as unknown as StatementImport)
      : null;
  }
  if (!isMissingBalanceConfidenceColumn(currentResult.error)) throw currentResult.error;

  const legacyResult = await supabase
    .from("statement_imports")
    .select(legacyStatementImportColumns)
    .eq("household_id", householdId)
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (legacyResult.error) throw legacyResult.error;
  return legacyResult.data
    ? normalizeStatementImport(legacyResult.data as unknown as StatementImportWithoutConfidence)
    : null;
}

export async function listStatementImports(householdId: string) {
  const currentResult = await supabase
    .from("statement_imports")
    .select(statementImportColumns)
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });

  if (!currentResult.error) {
    return (currentResult.data ?? []).map((row) =>
      normalizeStatementImport(row as unknown as StatementImport)
    );
  }
  if (!isMissingBalanceConfidenceColumn(currentResult.error)) throw currentResult.error;

  const legacyResult = await supabase
    .from("statement_imports")
    .select(legacyStatementImportColumns)
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });

  if (legacyResult.error) throw legacyResult.error;
  return (legacyResult.data ?? []).map((row) =>
    normalizeStatementImport(row as unknown as StatementImportWithoutConfidence)
  );
}

export async function deleteStatementImport(householdId: string, importId: string) {
  const { data, error } = await supabase
    .from("statement_imports")
    .delete()
    .eq("household_id", householdId)
    .eq("id", importId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Importação não encontrada ou sem permissão para excluir.");
}

export async function findStatementImportConflicts(
  householdId: string,
  rows: ParsedCsvTx[]
) {
  if (!rows.length) return [];

  const { data, error } = await supabase.rpc("find_statement_import_conflicts", {
    p_household_id: householdId,
    p_rows: toStatementRows(rows),
  });

  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data
    .map(Number)
    .filter((line) => Number.isInteger(line) && line > 0);
}

export type ImportStatementResult = {
  import_id: string;
  source_count: number;
  imported_count: number;
  skipped_count: number;
  rejected_count: number;
  categorized_count: number;
  learned_rules_count: number;
  imported_period_start?: string | null;
  imported_period_end?: string | null;
};

export async function importStatement(params: {
  householdId: string;
  fileHash: string;
  fileName: string;
  bankId: BankId | null;
  initialBalanceCents: number | null;
  finalBalanceCents: number | null;
  balanceConfidence: StatementBalanceConfidence;
  rejectedCount: number;
  rows: CategorizedStatementRow[];
  categoryRules: StatementCategoryRuleInput[];
}) {
  const rpcParams = {
    p_household_id: params.householdId,
    p_file_hash: params.fileHash,
    p_file_name: params.fileName,
    p_bank_id: params.bankId,
    p_initial_balance_cents: params.initialBalanceCents,
    p_final_balance_cents: params.finalBalanceCents,
    p_balance_confidence: params.balanceConfidence,
    p_rejected_count: params.rejectedCount,
    p_rows: toStatementRows(params.rows),
    p_category_rules: params.categoryRules,
  };
  const currentResult = await supabase.rpc("import_statement_v6", rpcParams);

  if (!currentResult.error) return currentResult.data as ImportStatementResult;
  if (!isMissingImportStatementV6(currentResult.error)) throw currentResult.error;

  const { p_balance_confidence: _balanceConfidence, ...legacyRpcParams } = rpcParams;
  const legacyResult = await supabase.rpc("import_statement_v5", legacyRpcParams);

  if (legacyResult.error) throw legacyResult.error;
  return legacyResult.data as ImportStatementResult;
}

export type StatementImportTransaction = {
  id: string;
  type: ParsedCsvTx["type"];
  amount_cents: number;
  note: string | null;
  occurred_on: string;
  source_line: number | null;
  category_id: string | null;
};

export async function listStatementImportTransactions(
  householdId: string,
  importId: string
) {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,type,amount_cents,note,occurred_on,source_line,category_id")
    .eq("household_id", householdId)
    .eq("statement_import_id", importId)
    .order("occurred_on", { ascending: false })
    .order("source_line", { ascending: true });

  if (error) throw error;
  return (data ?? []) as StatementImportTransaction[];
}

export async function categorizeStatementImport(params: {
  householdId: string;
  importId: string;
  assignments: { transaction_id: string; category_id: string | null }[];
  categoryRules: StatementCategoryRuleInput[];
}) {
  const { data, error } = await supabase.rpc("categorize_statement_import", {
    p_household_id: params.householdId,
    p_import_id: params.importId,
    p_assignments: params.assignments,
    p_category_rules: params.categoryRules,
  });

  if (error) throw error;
  return data as { updated_count: number; learned_rules_count: number };
}

export function isDuplicateStatementError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === "23505" || /já (?:foi|foram) importad[oa]s?/i.test(candidate?.message ?? "");
}
