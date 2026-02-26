// src/lib/cards.ts
import { supabase } from "./supabase";
import { addMonths, ymd } from "./date";

export type PaymentMethodType = "cash" | "bank" | "card";
export type LimitBehavior = "full" | "installment";

export type PaymentMethod = {
  id: string;
  household_id: string;
  created_by: string;
  type: PaymentMethodType;
  name: string;
  credit_limit_cents: number | null;
  closing_day: number | null;
  due_day: number | null;
  limit_behavior: LimitBehavior;
  created_at: string;
  updated_at: string;
};

export type CardInstallmentRow = {
  id: string;
  household_id: string;
  created_by: string;
  card_id: string;
  charge_id: string;
  n: number;
  due_on: string; // YYYY-MM-DD
  amount_cents: number;
  paid_at: string | null;
  charge?: { description: string | null; installments_total: number } | null;
};

export function monthKey(ymdStr: string) {
  return String(ymdStr || "").slice(0, 7); // YYYY-MM
}

export async function listPaymentMethods(householdId: string) {
  const sb: any = supabase;

  const { data, error } = await sb
    .from("payment_methods")
    .select("*")
    .eq("household_id", householdId)
    .order("type", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PaymentMethod[];
}

export async function listCards(householdId: string) {
  const all = await listPaymentMethods(householdId);
  return all.filter((m) => m.type === "card");
}

export async function addCard(args: {
  householdId: string;
  userId: string;
  name: string;
  credit_limit_cents: number;
  due_day?: number | null; // 1..28
  closing_day?: number | null; // 1..28
  limit_behavior?: LimitBehavior;
}) {
  const sb: any = supabase;

  const row = {
    household_id: args.householdId,
    created_by: args.userId,
    type: "card",
    name: args.name.trim(),
    credit_limit_cents: Math.max(0, Number(args.credit_limit_cents || 0)),
    due_day: args.due_day ?? null,
    closing_day: args.closing_day ?? null,
    limit_behavior: args.limit_behavior ?? "full",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb.from("payment_methods").insert(row).select("*").single();
  if (error) throw error;
  return data as PaymentMethod;
}

export async function updateCard(args: {
  id: string;
  householdId: string;
  name?: string;
  credit_limit_cents?: number;
  due_day?: number | null;
  closing_day?: number | null;
  limit_behavior?: LimitBehavior;
}) {
  const sb: any = supabase;

  const patch: any = {
    updated_at: new Date().toISOString(),
  };

  if (args.name !== undefined) patch.name = args.name.trim();
  if (args.credit_limit_cents !== undefined) patch.credit_limit_cents = Math.max(0, Number(args.credit_limit_cents || 0));
  if (args.due_day !== undefined) patch.due_day = args.due_day;
  if (args.closing_day !== undefined) patch.closing_day = args.closing_day;
  if (args.limit_behavior !== undefined) patch.limit_behavior = args.limit_behavior;

  const { data, error } = await sb
    .from("payment_methods")
    .update(patch)
    .eq("id", args.id)
    .eq("household_id", args.householdId)
    .select("*")
    .single();

  if (error) throw error;
  return data as PaymentMethod;
}

export async function listInstallments(args: {
  householdId: string;
  cardIds: string[];
  fromYMD?: string; // inclusive
  toYMD?: string; // exclusive
  includePaid?: boolean;
}) {
  const sb: any = supabase;
  if (!args.cardIds.length) return [] as CardInstallmentRow[];

  let q = sb
    .from("card_installments")
    .select(
      `
      id, household_id, created_by, card_id, charge_id, n, due_on, amount_cents, paid_at,
      charge:card_charges(description, installments_total)
    `
    )
    .eq("household_id", args.householdId)
    .in("card_id", args.cardIds)
    .order("due_on", { ascending: true })
    .order("created_at", { ascending: true });

  if (args.fromYMD) q = q.gte("due_on", args.fromYMD);
  if (args.toYMD) q = q.lt("due_on", args.toYMD);
  if (!args.includePaid) q = q.is("paid_at", null);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []) as CardInstallmentRow[];
}

export async function listAllUnpaidInstallments(args: {
  householdId: string;
  cardIds: string[];
}) {
  // usado para calcular "limite usado" (pode incluir atrasadas)
  return listInstallments({
    householdId: args.householdId,
    cardIds: args.cardIds,
    includePaid: false,
  });
}

export function buildForecast(installments: CardInstallmentRow[], monthsAhead = 6) {
  const today = new Date();
  const start = ymd(today);
  const end = ymd(addMonths(today, monthsAhead));

  // só previsões futuras no range
  const inRange = installments.filter((i) => i.due_on >= start && i.due_on < end);

  const byMonth: Record<string, number> = {};
  for (const i of inRange) {
    const mk = monthKey(i.due_on);
    byMonth[mk] = (byMonth[mk] ?? 0) + Number(i.amount_cents || 0);
  }

  // próxima fatura: mês mais próximo com valor
  const months = Object.keys(byMonth).sort();
  const nextMonth = months.length ? months[0] : null;
  const nextTotal = nextMonth ? byMonth[nextMonth] : 0;

  return { byMonth, nextMonth, nextTotal };
}

export async function setInstallmentPaid(args: {
  householdId: string;
  installmentId: string;
  paid: boolean;
}) {
  const sb: any = supabase;

  const patch = args.paid ? { paid_at: new Date().toISOString() } : { paid_at: null };

  const { data, error } = await sb
    .from("card_installments")
    .update(patch)
    .eq("id", args.installmentId)
    .eq("household_id", args.householdId)
    .select("id, paid_at")
    .single();

  if (error) throw error;
  return data as { id: string; paid_at: string | null };
}
