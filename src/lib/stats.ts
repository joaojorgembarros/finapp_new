// src/lib/stats.ts
import { listCategories, Category } from "./categories";
import { listTransactionsByMonth } from "./transactions";

export type MonthBreakdown = {
  fixed_expense: number;
  variable_expense: number;
  income: number;
};

export async function getMonthBreakdown(householdId: string, ref = new Date()) {
  const [cats, tx] = await Promise.all([listCategories(householdId), listTransactionsByMonth(householdId, ref)]);

  const byId = new Map<string, Category>();
  for (const c of cats) byId.set(c.id, c);

  let fixed_expense = 0;
  let variable_expense = 0;
  let income = 0;

  for (const t of tx) {
    if (t.type === "income") {
      income += t.amount_cents || 0;
      continue;
    }
    const cat = t.category_id ? byId.get(t.category_id) : undefined;
    if (cat?.kind === "fixed") fixed_expense += t.amount_cents || 0;
    else variable_expense += t.amount_cents || 0;
  }

  return { fixed_expense, variable_expense, income } as MonthBreakdown;
}
