// src/lib/budgets.ts
import { supabase } from "./supabase";

export type BudgetRow = {
  id: string;
  household_id: string;
  category_id: string;
  month_key: string;
  planned_cents: number;
  created_at: string;
  updated_at: string;
};

const sb: any = supabase;

export async function listBudgetsByMonth(householdId: string, monthKey: string) {
  const { data, error } = await sb
    .from("budgets")
    .select("id,household_id,category_id,month_key,planned_cents,created_at,updated_at")
    .eq("household_id", householdId)
    .eq("month_key", monthKey);

  if (error) {
    const msg = String(error?.message ?? "").toLowerCase();
    if (error?.code === "42P01" || msg.includes("could not find the table") || msg.includes("does not exist")) {
      return [];
    }
    throw error;
  }
  return (data ?? []) as BudgetRow[];
}

export async function upsertBudget(params: {
  householdId: string;
  categoryId: string;
  monthKey: string;
  plannedCents: number;
}) {
  const { data, error } = await sb
    .from("budgets")
    .upsert(
      {
        household_id: params.householdId,
        category_id: params.categoryId,
        month_key: params.monthKey,
        planned_cents: Math.max(0, Math.round(params.plannedCents || 0)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,category_id,month_key" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as BudgetRow;
}
