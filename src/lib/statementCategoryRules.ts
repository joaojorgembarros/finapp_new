import type { Flow } from "./categories";
import { supabase } from "./supabase";

export type StatementCategoryRule = {
  id: string;
  flow: Flow;
  match_key: string;
  category_id: string;
};

export type StatementCategoryRuleInput = {
  flow: Flow;
  match_key: string;
  category_id: string;
};

export async function listStatementCategoryRules(householdId: string) {
  const { data, error } = await supabase
    .from("statement_category_rules")
    .select("id,flow,match_key,category_id")
    .eq("household_id", householdId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as StatementCategoryRule[];
}
