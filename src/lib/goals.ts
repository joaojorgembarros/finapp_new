import { parseBRLToCents } from "./format";
import { supabase } from "./supabase";

const sb: any = supabase;

export type GoalProgress = {
  id: string;
  household_id: string;
  title: string;
  target_cents: number;
  desired_date: string | null;
  priority: number;
  contributed_cents: number;
  month_contributed_cents: number;
  contribution_count: number;
};

export type GoalContribution = {
  id: string;
  goal_id: string;
  amount_cents: number;
  contributed_on: string;
  note: string | null;
  created_at: string;
};

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function normalizeTitle(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

export async function syncGoalsFromDreams(opts: {
  householdId: string;
  userId: string;
  dreams: string[];
  values: Record<string, string>;
}) {
  const { data: existing, error: listError } = await sb
    .from("goals")
    .select("id,title,target_cents,priority")
    .eq("household_id", opts.householdId);
  if (listError) throw listError;

  const byTitle = new Map((existing ?? []).map((goal: any) => [normalizeTitle(goal.title), goal]));
  for (const [index, rawTitle] of opts.dreams.entries()) {
    const title = rawTitle.trim();
    const target = parseBRLToCents(opts.values[rawTitle] ?? "");
    if (!title || target <= 0) continue;

    const current: any = byTitle.get(normalizeTitle(title));
    if (current) {
      const { error } = await sb
        .from("goals")
        .update({ title, target_cents: target, priority: index + 1 })
        .eq("id", current.id)
        .eq("household_id", opts.householdId);
      if (error) throw error;
    } else {
      const { error } = await sb.from("goals").insert({
        household_id: opts.householdId,
        title,
        target_cents: target,
        desired_date: null,
        priority: index + 1,
        created_by: opts.userId,
      });
      if (error) throw error;
    }
  }
}

export async function listGoalsWithProgress(householdId: string): Promise<GoalProgress[]> {
  const { data: goals, error: goalError } = await sb
    .from("goals")
    .select("id,household_id,title,target_cents,desired_date,priority")
    .eq("household_id", householdId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (goalError) throw goalError;

  const { data: entries, error: entryError } = await sb
    .from("goal_contribution_entries")
    .select("goal_id,amount_cents,contributed_on")
    .eq("household_id", householdId);
  if (entryError) throw entryError;

  const currentMonth = monthStart();
  return (goals ?? []).map((goal: any) => {
    const goalEntries = (entries ?? []).filter((entry: any) => entry.goal_id === goal.id);
    return {
      ...goal,
      target_cents: Number(goal.target_cents || 0),
      contributed_cents: goalEntries.reduce((sum: number, entry: any) => sum + Number(entry.amount_cents || 0), 0),
      month_contributed_cents: goalEntries
        .filter((entry: any) => entry.contributed_on >= currentMonth)
        .reduce((sum: number, entry: any) => sum + Number(entry.amount_cents || 0), 0),
      contribution_count: goalEntries.length,
    };
  });
}

export async function addGoalContribution(opts: {
  householdId: string;
  goalId: string;
  userId: string;
  amount_cents: number;
  note?: string;
}) {
  const { error } = await sb.from("goal_contribution_entries").insert({
    household_id: opts.householdId,
    goal_id: opts.goalId,
    amount_cents: opts.amount_cents,
    note: opts.note?.trim() || null,
    created_by: opts.userId,
  });
  if (error) throw error;
}

export async function listGoalContributions(goalId: string): Promise<GoalContribution[]> {
  const { data, error } = await sb
    .from("goal_contribution_entries")
    .select("id,goal_id,amount_cents,contributed_on,note,created_at")
    .eq("goal_id", goalId)
    .order("contributed_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, amount_cents: Number(row.amount_cents || 0) }));
}
