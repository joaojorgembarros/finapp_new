import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";
import type { BankId } from "./banks";
import type { ParsedCsvTx } from "./csvImport";

export type StatementImport = {
  id: string;
  file_name: string;
  bank_id: BankId | null;
  transaction_count: number;
  period_start: string;
  period_end: string;
  created_at: string;
};

export async function hashStatementContent(content: string) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    content,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
}

export async function findStatementImportByHash(householdId: string, fileHash: string) {
  const { data, error } = await supabase
    .from("statement_imports")
    .select("id,file_name,bank_id,transaction_count,period_start,period_end,created_at")
    .eq("household_id", householdId)
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as StatementImport | null;
}

export async function importStatement(params: {
  householdId: string;
  fileHash: string;
  fileName: string;
  bankId: BankId | null;
  initialBalanceCents: number | null;
  finalBalanceCents: number | null;
  rows: ParsedCsvTx[];
}) {
  const { data, error } = await supabase.rpc("import_statement", {
    p_household_id: params.householdId,
    p_file_hash: params.fileHash,
    p_file_name: params.fileName,
    p_bank_id: params.bankId,
    p_initial_balance_cents: params.initialBalanceCents,
    p_final_balance_cents: params.finalBalanceCents,
    p_rows: params.rows.map((row) => ({
      type: row.type,
      amount_cents: row.amount_cents,
      note: row.note,
      occurred_on: row.occurred_on,
      raw_line: row.rawLine,
    })),
  });

  if (error) throw error;
  return data as string;
}

export function isDuplicateStatementError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === "23505" || /já (?:foi|foram) importad[oa]s?/i.test(candidate?.message ?? "");
}
