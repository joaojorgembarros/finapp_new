// src/lib/profile.ts
import { supabase } from "./supabase";

export type EmploymentType = "CLT" | "PJ" | "Autônomo" | "Estudante" | "Outro";

export type Profile = {
  user_id: string;

  // novo
  income_fixed_cents: number;
  income_variable_avg_cents: number;

  // legado (pode existir)
  income_cents?: number | null;

  employment_type: EmploymentType;
  onboarding_done: boolean;
  updated_at?: string;
};

export function expectedMonthlyIncomeCents(p: Pick<Profile, "income_fixed_cents" | "income_variable_avg_cents">) {
  return (Number(p.income_fixed_cents || 0) + Number(p.income_variable_avg_cents || 0)) | 0;
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "user_id,income_fixed_cents,income_variable_avg_cents,income_cents,employment_type,onboarding_done,updated_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) return null;

  // fallback caso o user já existia e ainda não tem as novas colunas preenchidas
  const fixed = Number((data as any).income_fixed_cents ?? 0);
  const legacy = Number((data as any).income_cents ?? 0);

  const normalized: Profile = {
    ...(data as any),
    income_fixed_cents: fixed || legacy || 0,
    income_variable_avg_cents: Number((data as any).income_variable_avg_cents ?? 0),
  };

  return normalized;
}

export async function upsertProfile(
  userId: string,
  patch: Partial<Profile> & {
    income_fixed_cents?: number;
    income_variable_avg_cents?: number;
  }
) {
  const fixed = Number(patch.income_fixed_cents ?? 0);
  const variableAvg = Number(patch.income_variable_avg_cents ?? 0);

  const payload: any = {
    user_id: userId,
    updated_at: new Date().toISOString(),
    ...patch,
  };

  // mantém o campo legado coerente (opcional, mas ajuda)
  if ("income_fixed_cents" in patch || "income_variable_avg_cents" in patch) {
    payload.income_cents = fixed + variableAvg;
  }

  const { data, error } = await supabase.from("profiles").upsert(payload).select("*").single();
  if (error) throw error;
  return data as Profile;
}
