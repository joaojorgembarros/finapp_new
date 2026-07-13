// src/lib/household.ts
import { supabase } from "./supabase";

export type PlanType = "individual" | "couple";

export async function createHousehold(opts: {
  name: string;
  type: PlanType;
}) {
  const { data, error } = await supabase.rpc("create_household", {
    household_name: opts.name.trim(),
    household_type: opts.type,
  });
  if (error) throw error;
  if (!data) throw new Error("Não foi possível criar a casa.");
  return data as string;
}

export async function getMyHouseholdId(userId: string) {
  const { data, error } = await supabase
    .from("memberships")
    .select("household_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0]?.household_id ?? null;
}
