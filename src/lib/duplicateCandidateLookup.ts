import { supabase } from "./supabase";
import type { StoredTransactionIdentity } from "./statementConflictReview";

const PAGE_SIZE = 500;
const DATE_CHUNK = 40;

/**
 * Loads rows that might be duplicate candidates. Matching stays in the pure helper.
 * This does not write, merge, or ignore anything.
 */
export async function loadTransactionsForDuplicateCheck(
  householdId: string,
  dates: string[],
): Promise<StoredTransactionIdentity[]> {
  const unique = [...new Set(dates.map((date) => date.trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))];
  if (!unique.length) return [];

  const rows: StoredTransactionIdentity[] = [];
  for (let index = 0; index < unique.length; index += DATE_CHUNK) {
    const slice = unique.slice(index, index + DATE_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,type,amount_cents,occurred_on,note,original_note,category_id,account_id,statement_import_id,ignored_at,transfer_group_id")
        .eq("household_id", householdId)
        .in("occurred_on", slice)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const page = data ?? [];
      for (const row of page) {
        if (row.type !== "income" && row.type !== "expense") continue;
        rows.push({
          id: String(row.id),
          type: row.type,
          amountCents: Number(row.amount_cents) || 0,
          occurredOn: String(row.occurred_on).slice(0, 10),
          note: row.note == null ? null : String(row.note),
          originalNote: row.original_note == null ? null : String(row.original_note),
          categoryId: row.category_id == null ? null : String(row.category_id),
          accountId: row.account_id == null ? null : String(row.account_id),
          statementImportId: row.statement_import_id == null ? null : String(row.statement_import_id),
          ignoredAt: row.ignored_at == null ? null : String(row.ignored_at),
          transferGroupId: row.transfer_group_id == null ? null : String(row.transfer_group_id),
        });
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}
