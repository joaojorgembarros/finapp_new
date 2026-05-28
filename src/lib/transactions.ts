// src/lib/transactions.ts
import { supabase } from "./supabase";
import { addMonths, ymd } from "./date";

export type TxType = "income" | "expense";

export type TxRow = {
  id: string;
  household_id: string;
  created_by: string;
  type: TxType;
  amount_cents: number;
  note: string | null;
  category_id: string | null;
  occurred_on: string; // YYYY-MM-DD
  created_at: string;
  category?: { name: string } | null;
};

// ✅ compat com telas antigas que importam Transaction
export type Transaction = TxRow;

const sb: any = supabase;

function monthKeyNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

function toMonthKey(input?: string | Date) {
  if (!input) return monthKeyNow();
  if (input instanceof Date) {
    const y = input.getFullYear();
    const m = String(input.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  return String(input);
}

function monthRange(monthKey?: string | Date) {
  const mk = toMonthKey(monthKey);

  const [yy, mm] = mk.split("-");
  const y = Number(yy);
  const m = Number(mm);

  if (!y || !m) return monthRange(monthKeyNow());

  const startDate = new Date(y, m - 1, 1);
  const endDate = addMonths(startDate, 1);

  return {
    start: ymd(startDate),
    end: ymd(endDate),
  };
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export async function addTransaction(opts: {
  householdId: string;
  userId: string;
  type: TxType;
  amount_cents: number;
  category_id?: string | null;
  note?: string;
  occurred_on?: string; // YYYY-MM-DD
}) {
  const row = {
    household_id: opts.householdId,
    created_by: opts.userId,
    type: opts.type,
    amount_cents: opts.amount_cents,
    category_id: opts.category_id ?? null,
    note: opts.note?.trim() ? opts.note.trim() : null,
    occurred_on: opts.occurred_on ?? ymd(new Date()),
  };

  const { data, error } = await sb
    .from("transactions")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return data as TxRow;
}

export async function listTransactionsByMonth(
  householdId: string,
  monthKey?: string | Date
) {
  const { start, end } = monthRange(monthKey);

  const { data, error } = await sb
    .from("transactions")
    .select(
      `
      id, household_id, created_by, type, amount_cents, note, category_id, occurred_on, created_at,
      category:categories(name)
    `
    )
    .eq("household_id", householdId)
    .gte("occurred_on", start) // ✅ era .get
    .lt("occurred_on", end)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as TxRow[];
}

export async function listTransactionsRecent(householdId: string, days = 90) {
  const end = ymd(addDays(new Date(), 1)); // até amanhã (exclusivo)
  const start = ymd(addDays(new Date(), -Math.max(1, Number(days || 90))));

  const { data, error } = await sb
    .from("transactions")
    .select(
      `
      id, household_id, created_by, type, amount_cents, note, category_id, occurred_on, created_at,
      category:categories(name)
    `
    )
    .eq("household_id", householdId)
    .gte("occurred_on", start) // ✅ era .get
    .lt("occurred_on", end)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as TxRow[];
}

/**
 * ✅ COMPAT (telas antigas):
 * - listTransactions(hh) -> mês atual
 * - listTransactions(hh, "2026-02") -> mês específico
 * - listTransactions(hh, new Date()) -> mês daquela data
 * - listTransactions(hh, 90) -> últimos 90 dias
 */
export const listTransactions = (
  householdId: string,
  arg?: string | Date | number
) => {
  if (typeof arg === "number") return listTransactionsRecent(householdId, arg);
  return listTransactionsByMonth(householdId, arg);
};

export async function getMonthlyNet(
  householdId: string,
  monthKey?: string | Date
) {
  const { start, end } = monthRange(monthKey);

  const { data, error } = await sb
    .from("transactions")
    .select("type,amount_cents,occurred_on")
    .eq("household_id", householdId)
    .gte("occurred_on", start)
    .lt("occurred_on", end);

  if (error) throw error;

  let income = 0;
  let expense = 0;

  for (const t of data ?? []) {
    if (t.type === "income") income += Number(t.amount_cents || 0);
    else expense += Number(t.amount_cents || 0);
  }

  return { income, expense, net: income - expense };
}

export async function getNetBetween(
  householdId: string,
  startYMD: string,
  endYMD: string
) {
  const sb: any = supabase;

  const { data, error } = await sb
    .from("transactions")
    .select("type,amount_cents,occurred_on")
    .eq("household_id", householdId)
    .gte("occurred_on", startYMD)
    .lt("occurred_on", endYMD);

  if (error) throw error;

  let income = 0;
  let expense = 0;

  for (const t of data ?? []) {
    if (t.type === "income") income += Number(t.amount_cents || 0);
    else expense += Number(t.amount_cents || 0);
  }

  return { income, expense, net: income - expense };
}
