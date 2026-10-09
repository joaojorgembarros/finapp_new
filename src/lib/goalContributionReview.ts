import {
  readManualContributionReconciliation,
  readSavedOutsideContribution,
} from "./goalContributionEffect";
import { isPendingManualContribution } from "./goalContributionReviewPresentation";
import { supabase } from "./supabase";

const sb: any = supabase;

export type PendingManualContribution = {
  id: string;
  goalId: string;
  goalTitle: string;
  amountCents: number;
  contributedOn: string;
  note: string | null;
  createdAt: string;
  sourceKind: "manual_unverified";
};

export async function listPendingManualContributions(householdId: string): Promise<PendingManualContribution[]> {
  const { data, error } = await sb
    .from("goal_contribution_entries")
    .select("id,goal_id,amount_cents,source_kind,contributed_on,note,created_at,goal:goals(title)")
    .eq("household_id", householdId)
    .eq("source_kind", "manual_unverified")
    .order("contributed_on", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const pending: PendingManualContribution[] = [];
  for (const row of data ?? []) {
    const sourceKind = typeof row.source_kind === "string" ? row.source_kind : null;
    if (!isPendingManualContribution(sourceKind)) continue;
    const goal = Array.isArray(row.goal) ? row.goal[0] : row.goal;
    pending.push({
      id: String(row.id),
      goalId: String(row.goal_id),
      goalTitle: typeof goal?.title === "string" && goal.title.trim() ? goal.title.trim() : "Sonho",
      amountCents: Math.max(0, Math.trunc(Number(row.amount_cents) || 0)),
      contributedOn: String(row.contributed_on ?? ""),
      note: typeof row.note === "string" && row.note.trim() ? row.note.trim() : null,
      createdAt: String(row.created_at ?? ""),
      sourceKind: "manual_unverified",
    });
  }
  pending.sort((left, right) => (
    left.contributedOn.localeCompare(right.contributedOn)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
  return pending;
}

export async function reconcileManualContribution(params: {
  householdId: string;
  contributionId: string;
  decision: "still_in_accounts" | "saved_outside" | "no_longer_saved";
  effectiveAmountCents: number | null;
  requestId: string;
}) {
  const { data, error } = await sb.rpc("reconcile_manual_contribution", {
    p_household_id: params.householdId,
    p_contribution_id: params.contributionId,
    p_decision: params.decision,
    p_effective_amount_cents: params.effectiveAmountCents,
    p_request_id: params.requestId,
  });
  if (error) throw error;
  return readManualContributionReconciliation(data);
}

export async function addSavedOutsideGoalContribution(params: {
  householdId: string;
  goalId: string;
  amountCents: number;
  contributedOn: string | null;
  note?: string | null;
  requestId: string;
}) {
  const { data, error } = await sb.rpc("add_saved_outside_goal_contribution", {
    p_household_id: params.householdId,
    p_goal_id: params.goalId,
    p_amount_cents: params.amountCents,
    p_contributed_on: params.contributedOn,
    p_note: params.note ?? null,
    p_request_id: params.requestId,
  });
  if (error) throw error;
  return readSavedOutsideContribution(data);
}
