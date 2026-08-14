import { parseBRLToCents } from "./format";
import { supabase } from "./supabase";

const sb: any = supabase;
const signedPhotoUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_PHOTO_CACHE_MS = 50 * 60 * 1000;

export function clearSignedGoalPhotoCacheForUser(userId: string) {
  for (const path of signedPhotoUrlCache.keys()) {
    const segments = path.split("/");
    if (segments[1] === userId) signedPhotoUrlCache.delete(path);
  }
}

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
  completed_on: string | null;
  motivation: string | null;
  cover_photo_path: string | null;
  cover_photo_url: string | null;
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
  let { data: goals, error: goalError } = await sb
    .from("goals")
    .select("id,household_id,title,target_cents,desired_date,priority,motivation,cover_photo_path")
    .eq("household_id", householdId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  // Keep the journey usable while a newly released client reaches a database
  // whose additive goal-details migration has not been applied yet.
  if (goalError?.code === "42703") {
    const fallback = await sb
      .from("goals")
      .select("id,household_id,title,target_cents,desired_date,priority")
      .eq("household_id", householdId)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    goals = fallback.data;
    goalError = fallback.error;
  }
  if (goalError) throw goalError;

  const { data: entries, error: entryError } = await sb
    .from("goal_contribution_entries")
    .select("goal_id,amount_cents,contributed_on")
    .eq("household_id", householdId);
  if (entryError) throw entryError;

  const currentMonth = monthStart();
  const photoUrls = new Map<string, string>();
  await Promise.all((goals ?? []).map(async (goal: any) => {
    if (!goal.cover_photo_path) return;
    const url = await getSignedGoalPhotoUrl(goal.cover_photo_path);
    if (url) photoUrls.set(goal.id, url);
  }));

  return (goals ?? []).map((goal: any) => {
    const goalEntries = (entries ?? []).filter((entry: any) => entry.goal_id === goal.id);
    const targetCents = Number(goal.target_cents || 0);
    let accumulated = 0;
    let completedOn: string | null = null;
    for (const entry of [...goalEntries].sort((a: any, b: any) => a.contributed_on.localeCompare(b.contributed_on))) {
      accumulated += Number(entry.amount_cents || 0);
      if (!completedOn && accumulated >= targetCents) completedOn = entry.contributed_on;
    }
    return {
      ...goal,
      target_cents: targetCents,
      contributed_cents: goalEntries.reduce((sum: number, entry: any) => sum + Number(entry.amount_cents || 0), 0),
      month_contributed_cents: goalEntries
        .filter((entry: any) => entry.contributed_on >= currentMonth)
        .reduce((sum: number, entry: any) => sum + Number(entry.amount_cents || 0), 0),
      contribution_count: goalEntries.length,
      completed_on: completedOn,
      motivation: goal.motivation ?? null,
      cover_photo_path: goal.cover_photo_path ?? null,
      cover_photo_url: photoUrls.get(goal.id) ?? null,
    };
  });
}

export async function getGoalWithProgress(householdId: string, goalId: string) {
  const goals = await listGoalsWithProgress(householdId);
  return goals.find((goal) => goal.id === goalId) ?? null;
}

export async function getSignedGoalPhotoUrl(path: string | null | undefined) {
  if (!path) return null;
  const cached = signedPhotoUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage.from("goal-photos").createSignedUrl(path, 60 * 60);
  if (error) return null;
  signedPhotoUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_PHOTO_CACHE_MS });
  return data.signedUrl;
}

export async function updateGoalDetails(params: {
  householdId: string;
  goalId: string;
  motivation: string | null;
  desiredDate: string | null;
  coverPhotoPath?: string | null;
}) {
  const values: Record<string, string | null> = {
    motivation: params.motivation?.trim() || null,
    desired_date: params.desiredDate,
  };
  if (params.coverPhotoPath !== undefined) values.cover_photo_path = params.coverPhotoPath;

  const { data, error } = await sb
    .from("goals")
    .update(values)
    .eq("id", params.goalId)
    .eq("household_id", params.householdId)
    .select("id")
    .single();

  if (error) throw error;
  return data as { id: string };
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
