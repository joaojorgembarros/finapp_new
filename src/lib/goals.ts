// src/lib/goals.ts
import { supabase } from "./supabase";

export type Goal = {
  id: string;
  household_id: string;
  created_by: string;
  title: string;
  target_cents: number;
  desired_date: string;
  created_at?: string;
  current_cents: number; // calculado via contribuições
};

export type CycleClosure = {
  id: string;
  household_id: string;
  cycle_key: string;
  mode: string;
  cycle_start: string;
  cycle_end: string; // exclusive
  net_cents: number;
  allocated_cents: number;
  created_at?: string;
  updated_at?: string;
};

export async function listGoals(householdId: string): Promise<Goal[]> {
  const sb: any = supabase;

  const { data: goals, error: e1 } = await sb
    .from("goals")
    .select("id, household_id, created_by, title, target_cents, desired_date, created_at")
    .eq("household_id", householdId)
    .order("desired_date", { ascending: true })
    .order("created_at", { ascending: false });

  if (e1) throw e1;

  const { data: contribs, error: e2 } = await sb
    .from("goal_contributions")
    .select("goal_id, amount_cents")
    .eq("household_id", householdId);

  if (e2) throw e2;

  const sum: Record<string, number> = {};
  for (const c of contribs ?? []) {
    const gid = String(c.goal_id);
    const amt = Number(c.amount_cents ?? 0) || 0;
    sum[gid] = (sum[gid] ?? 0) + amt;
  }

  return (goals ?? []).map((g: any) => ({
    ...g,
    current_cents: sum[String(g.id)] ?? 0,
  })) as Goal[];
}

export async function addGoal(args: {
  householdId: string;
  userId: string;
  title: string;
  target_cents: number;
  desired_date: string;
}) {
  const sb: any = supabase;

  const payload = {
    household_id: args.householdId,
    created_by: args.userId,
    title: args.title,
    target_cents: args.target_cents,
    desired_date: args.desired_date,
  };

  const { error } = await sb.from("goals").insert(payload);
  if (error) throw error;
}

export async function listCycleClosures(args: { householdId: string; cycleKeys: string[] }) {
  const sb: any = supabase;
  if (!args.cycleKeys?.length) return {} as Record<string, CycleClosure>;

  const { data, error } = await sb
    .from("cycle_closures")
    .select(
      "id, household_id, cycle_key, mode, cycle_start, cycle_end, net_cents, allocated_cents, created_at, updated_at"
    )
    .eq("household_id", args.householdId)
    .in("cycle_key", args.cycleKeys);

  if (error) throw error;

  const map: Record<string, CycleClosure> = {};
  for (const c of data ?? []) map[String(c.cycle_key)] = c as CycleClosure;
  return map;
}

/**
 * ✅ pega as alocações já feitas para um ciclo (pra preencher a tela ao editar)
 * Retorna: { [goalId]: amountCents }
 */
export async function listGoalContributionsForCycle(args: {
  householdId: string;
  cycleKey: string;
}): Promise<Record<string, number>> {
  const sb: any = supabase;

  const { data, error } = await sb
    .from("goal_contributions")
    .select("goal_id, amount_cents")
    .eq("household_id", args.householdId)
    .eq("cycle_key", args.cycleKey);

  if (error) throw error;

  const map: Record<string, number> = {};
  for (const r of data ?? []) {
    const gid = String(r.goal_id);
    map[gid] = Number(r.amount_cents ?? 0) || 0;
  }
  return map;
}

export async function closeCycle(args: {
  householdId: string;
  userId: string;
  mode: string;
  cycleKey: string;
  cycleStart: string;
  cycleEnd: string;
  netCents: number;
  allocations: Array<{ goalId: string; amountCents: number }>; // pode conter 0 para “zerar”
}) {
  const sb: any = supabase;

  // ✅ agora aceitamos amount 0 para sobrescrever valores antigos (edição)
  const rows = args.allocations.map((a) => ({
    household_id: args.householdId,
    goal_id: a.goalId,
    cycle_key: args.cycleKey,
    cycle_start: args.cycleStart,
    cycle_end: args.cycleEnd,
    amount_cents: Math.max(0, Number(a.amountCents) || 0),
    updated_by: args.userId,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length) {
    const { error: e1 } = await sb.from("goal_contributions").upsert(rows, {
      onConflict: "household_id,goal_id,cycle_key",
    });
    if (e1) throw e1;
  }

  // soma só os positivos (0 não conta)
  const allocated = rows.reduce((acc, r) => acc + (Number(r.amount_cents) > 0 ? Number(r.amount_cents) : 0), 0);

  const closurePayload = {
    household_id: args.householdId,
    cycle_key: args.cycleKey,
    mode: args.mode,
    cycle_start: args.cycleStart,
    cycle_end: args.cycleEnd,
    net_cents: Number(args.netCents) || 0,
    allocated_cents: allocated,
    updated_by: args.userId,
    updated_at: new Date().toISOString(),
  };

  const { error: e2 } = await sb.from("cycle_closures").upsert(closurePayload, {
    onConflict: "household_id,cycle_key",
  });
  if (e2) throw e2;
}
