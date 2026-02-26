// src/lib/cardCharges.ts
import { supabase } from "./supabase";
import { addMonths, ymd } from "./date";

function parseYMD(s: string) {
  const [yy, mm, dd] = String(s || "").split("-").map((n) => Number(n));
  return new Date(yy, (mm || 1) - 1, dd || 1);
}

function setDaySafe(d: Date, day: number) {
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth()); // normalize
  // como usamos day 1..28 (recomendado), não estoura
  x.setDate(Math.max(1, Math.min(28, day)));
  return x;
}

function splitInstallments(total: number, n: number) {
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const arr = Array(n).fill(base);
  for (let i = 0; i < rem; i++) arr[i] += 1;
  return arr;
}

// regra V1: primeira parcela vence no "due_day" do mês seguinte.
// se não tiver due_day, usa o dia da compra (clamp 1..28) no mês seguinte.
function firstDueDate(purchasedOn: string, dueDay?: number | null) {
  const p = parseYMD(purchasedOn);
  const nextMonth = addMonths(p, 1);
  const day = dueDay ?? Math.min(28, p.getDate());
  return setDaySafe(nextMonth, day);
}

export async function addCardChargeAndInstallments(args: {
  householdId: string;
  userId: string;
  cardId: string;
  purchased_on: string; // YYYY-MM-DD
  description?: string | null;
  total_cents: number;
  installments_total: number;
  due_day?: number | null; // do cartão (opcional)
}) {
  const sb: any = supabase;

  const total = Math.max(1, Number(args.total_cents || 0));
  const n = Math.max(1, Math.min(60, Number(args.installments_total || 1)));

  // 1) cria charge
  const chargeRow = {
    household_id: args.householdId,
    created_by: args.userId,
    card_id: args.cardId,
    purchased_on: args.purchased_on,
    description: args.description?.trim() ? args.description.trim() : null,
    total_cents: total,
    installments_total: n,
    updated_at: new Date().toISOString(),
  };

  const { data: charge, error: e1 } = await sb.from("card_charges").insert(chargeRow).select("*").single();
  if (e1) throw e1;

  // 2) gera parcelas
  const firstDue = firstDueDate(args.purchased_on, args.due_day);
  const amounts = splitInstallments(total, n);

  const rows = amounts.map((amt: number, idx: number) => {
    const due = addMonths(firstDue, idx);
    return {
      household_id: args.householdId,
      created_by: args.userId,
      card_id: args.cardId,
      charge_id: charge.id,
      n: idx + 1,
      due_on: ymd(due),
      amount_cents: amt,
      paid_at: null,
    };
  });

  const { error: e2 } = await sb.from("card_installments").insert(rows);
  if (e2) {
    // rollback simples
    try {
      await sb.from("card_charges").delete().eq("id", charge.id).eq("household_id", args.householdId);
    } catch {}
    throw e2;
  }

  return charge as any;
}
