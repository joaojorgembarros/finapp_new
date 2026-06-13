// src/lib/household.ts
import { supabase } from "./supabase";

export type PlanType = "individual" | "couple";

export async function createHousehold(opts: {
  name: string;
  type: PlanType;
  userId?: string;
}) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;

  const uid = userData.user?.id ?? opts.userId;
  if (!uid) throw new Error("Usuário não autenticado.");

  // 1) cria household (precisa bater created_by = auth.uid())
  const { data: hh, error: hhErr } = await supabase
    .from("households")
    .insert({
      name: opts.name,
      type: opts.type,
      created_by: uid,
    })
    .select("id")
    .single();

  if (hhErr) throw hhErr;
  const householdId = hh.id as string;

  // 2) cria membership (ANTES do seed)
  const { error: memErr } = await supabase.from("memberships").insert({
    household_id: householdId,
    user_id: uid,
    role: "owner",
  });

  if (memErr) throw memErr;

  return householdId;
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
