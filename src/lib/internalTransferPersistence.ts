import type { TransactionAccountId } from "./banks";
import { buildManualInternalTransfer } from "./internalTransfers";
import { supabase } from "./supabase";

const sb: any = supabase;

export type CreatedInternalTransfer = {
  transfer_group_id: string;
  expense_id: string;
  income_id: string;
};

function rpcError(error: { message?: string } | null | undefined, fallback: string) {
  const message = String(error?.message ?? "").trim();
  return new Error(message || fallback);
}

export async function createInternalTransfer(opts: {
  householdId: string;
  fromAccountId: TransactionAccountId | string;
  toAccountId: TransactionAccountId | string;
  amountCents: number;
  occurredOn: string;
  note?: string | null;
}) {
  const validation = buildManualInternalTransfer({
    transferGroupId: "00000000-0000-0000-0000-000000000000",
    fromAccountId: opts.fromAccountId,
    toAccountId: opts.toAccountId,
    amountCents: opts.amountCents,
    occurredOn: opts.occurredOn,
    note: opts.note,
  });
  if (!validation.ok) throw new Error(validation.message);

  const { data, error } = await sb.rpc("create_internal_transfer", {
    p_household_id: opts.householdId,
    p_from_account_id: opts.fromAccountId,
    p_to_account_id: opts.toAccountId,
    p_amount_cents: opts.amountCents,
    p_occurred_on: opts.occurredOn,
    p_note: opts.note?.trim() || null,
  });
  if (error) throw rpcError(error, "Não foi possível registrar a transferência entre as suas contas.");
  return data as CreatedInternalTransfer;
}

export async function linkInternalTransfer(opts: {
  householdId: string;
  transactionId: string;
  counterpartId: string;
}) {
  const { data, error } = await sb.rpc("link_internal_transfer", {
    p_household_id: opts.householdId,
    p_transaction_id: opts.transactionId,
    p_counterpart_id: opts.counterpartId,
  });
  if (error) throw rpcError(error, "Não foi possível vincular essas movimentações como transferência interna.");
  return data as { transfer_group_id: string; transaction_id: string; counterpart_id: string };
}

export async function unlinkInternalTransfer(opts: {
  householdId: string;
  transactionId: string;
}) {
  const { data, error } = await sb.rpc("unlink_internal_transfer", {
    p_household_id: opts.householdId,
    p_transaction_id: opts.transactionId,
  });
  if (error) throw rpcError(error, "Não foi possível desfazer a transferência interna.");
  return data as { transfer_group_id: string; unlinked: boolean };
}

export async function listHouseholdPaymentTransactionIds(householdId: string) {
  const { data, error } = await sb
    .from("financial_commitment_payments")
    .select("transaction_id")
    .eq("household_id", householdId);
  if (error) throw error;
  return [...new Set((data ?? []).map((row: { transaction_id?: string | null }) => row.transaction_id).filter(Boolean))] as string[];
}
