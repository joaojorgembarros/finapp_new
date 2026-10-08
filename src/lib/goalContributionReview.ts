import {
  readManualContributionReconciliation,
  readSavedOutsideContribution,
} from "./goalContributionEffect";
import { supabase } from "./supabase";

const sb: any = supabase;

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
