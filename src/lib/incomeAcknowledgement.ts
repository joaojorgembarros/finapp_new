import { supabase } from "./supabase";
import type {
  IncomeAcknowledgement,
  IncomeAcknowledgementBehavior,
  IncomeAcknowledgementDecision,
  IncomeAcknowledgementTargetField,
} from "./incomeAcknowledgementPlan";

export type { IncomeAcknowledgement };

export async function acknowledgeIncomePattern(params: {
  householdId: string;
  patternKey: string;
  targetField: IncomeAcknowledgementTargetField;
  decision: IncomeAcknowledgementDecision;
  suggestedCents: number;
  desiredTotalCents: number;
  expectedCurrentCents: number;
  accountId: string | null;
  normalizedMerchant: string;
  behaviorType: IncomeAcknowledgementBehavior;
}) {
  const { data, error } = await supabase.rpc("acknowledge_income_pattern", {
    p_household_id: params.householdId,
    p_pattern_key: params.patternKey,
    p_target_field: params.targetField,
    p_decision: params.decision,
    p_suggested_cents: params.suggestedCents,
    p_desired_total_cents: params.desiredTotalCents,
    p_expected_current_cents: params.expectedCurrentCents,
    p_account_id: params.accountId,
    p_normalized_merchant: params.normalizedMerchant,
    p_behavior_type: params.behaviorType,
  });
  if (error) throw error;
  return data as IncomeAcknowledgementRow;
}

type IncomeAcknowledgementRow = {
  pattern_key: string;
  target_field: IncomeAcknowledgementTargetField;
  decision: IncomeAcknowledgementDecision;
  suggested_cents: number;
  profile_cents_before: number;
  profile_cents_after: number | null;
  account_id: string | null;
  normalized_merchant: string;
  behavior_type: IncomeAcknowledgementBehavior;
};

export function mapIncomeAcknowledgement(row: IncomeAcknowledgementRow): IncomeAcknowledgement {
  return {
    patternKey: row.pattern_key,
    targetField: row.target_field,
    decision: row.decision,
    suggestedCents: Number(row.suggested_cents) || 0,
    profileCentsBefore: Number(row.profile_cents_before) || 0,
    profileCentsAfter: row.profile_cents_after == null ? null : Number(row.profile_cents_after),
    accountId: row.account_id ?? null,
    normalizedMerchant: row.normalized_merchant,
    behaviorType: row.behavior_type,
  };
}
