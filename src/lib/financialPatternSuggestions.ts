import {
  detectFinancialPatterns,
  isActionablePattern,
  PATTERN_DETECTION,
  type DetectedFinancialPattern,
  type PatternBehaviorType,
  type PatternDetectionTransaction,
  type PatternDirection,
} from "./financialPatternDetection";
import { formatBRLFromCents } from "./format";
import { normalizeMerchant } from "./merchantNormalize";
import { supabase } from "./supabase";

const sb: any = supabase;

export const PATTERN_SUGGESTION_BEHAVIORS = [
  "fixed_recurring_expense",
  "variable_recurring_expense",
] as const satisfies readonly PatternBehaviorType[];

const SUGGESTION_BEHAVIORS = new Set<PatternBehaviorType>(PATTERN_SUGGESTION_BEHAVIORS);

export const PATTERN_DECISION_KEY_VERSION = "v1";
export const SIMILAR_COMMITMENT_AMOUNT_TOLERANCE = 0.05;
export const SIMILAR_COMMITMENT_DUE_DAY_TOLERANCE = 3;
export const PATTERN_TRANSACTION_PAGE_SIZE = 500;

export type PatternDecision = "confirmed" | "rejected";

export type FinancialPatternDecisionRow = {
  pattern_key: string;
  decision: PatternDecision;
  linked_commitment_id: string | null;
};

export type PatternCommitmentCandidate = {
  id: string;
  name: string;
  amount_cents: number;
  due_day: number;
  active?: boolean;
};

export type SimilarCommitmentMatch = "none" | "single" | "multiple";

export type FinancialPatternSuggestion = {
  decisionKey: string;
  pattern: DetectedFinancialPattern;
  title: string;
  estimatedAmount: boolean;
  amountLabel: string;
  dayLabel: string;
  historyLabel: string;
  similarCommitments: PatternCommitmentCandidate[];
  similarMatch: SimilarCommitmentMatch;
};

export type BuildFinancialPatternSuggestionsInput = {
  transactions: PatternDetectionTransaction[];
  referenceDate: string;
  decisions?: FinancialPatternDecisionRow[];
  commitments?: PatternCommitmentCandidate[];
};

export function requirePatternReferenceDate(referenceDate?: string | null) {
  const value = (referenceDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("A data de referência do planejamento é obrigatória.");
  }
  return value;
}

export function financialPatternDecisionKey(input: {
  direction: PatternDirection;
  normalizedMerchant?: string | null;
  accountId?: string | null;
}) {
  const merchant = (input.normalizedMerchant || "").trim() || "empty";
  return `merchant:${PATTERN_DECISION_KEY_VERSION}:${input.direction}:${input.accountId ?? "none"}:${merchant}`;
}

export function patternDetectionWindowStart(referenceDate: string) {
  const date = requirePatternReferenceDate(referenceDate);
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1 - PATTERN_DETECTION.windowMonths, 1));
  const lastDay = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(clampedDay)}`;
}

export function similarAmountToleranceFor(behaviorType?: PatternBehaviorType) {
  if (behaviorType === "variable_recurring_expense" || behaviorType === "variable_recurring_income") {
    return PATTERN_DETECTION.variableMaxRelativeVariance;
  }
  return SIMILAR_COMMITMENT_AMOUNT_TOLERANCE;
}

export function findSimilarCommitments(
  pattern: Pick<DetectedFinancialPattern, "normalizedMerchant" | "estimatedAmountCents" | "estimatedDay" | "behaviorType">,
  commitments: PatternCommitmentCandidate[],
): PatternCommitmentCandidate[] {
  if (!pattern.estimatedDay || pattern.estimatedAmountCents <= 0) return [];
  const merchantKey = (pattern.normalizedMerchant || "").trim();
  if (!merchantKey) return [];
  const amountTolerance = similarAmountToleranceFor(pattern.behaviorType);

  return commitments.filter((commitment) => {
    if (commitment.active === false) return false;
    if (!namesMatch(commitment.name, merchantKey)) return false;
    if (!amountWithinTolerance(commitment.amount_cents, pattern.estimatedAmountCents, amountTolerance)) return false;
    return Math.abs(commitment.due_day - pattern.estimatedDay!) <= SIMILAR_COMMITMENT_DUE_DAY_TOLERANCE;
  });
}

export function similarMatchFor(candidates: PatternCommitmentCandidate[]): SimilarCommitmentMatch {
  if (candidates.length > 1) return "multiple";
  if (candidates.length === 1) return "single";
  return "none";
}

export function buildFinancialPatternSuggestions(
  input: BuildFinancialPatternSuggestionsInput,
): FinancialPatternSuggestion[] {
  const referenceDate = requirePatternReferenceDate(input.referenceDate);
  const commitments = input.commitments ?? [];
  const activeCommitmentIds = new Set(
    commitments.filter((row) => row.active !== false).map((row) => row.id),
  );
  const decided = new Set(
    (input.decisions ?? [])
      .filter((row) => isBlockingDecision(row, activeCommitmentIds))
      .map((row) => row.pattern_key),
  );

  return detectFinancialPatterns(input.transactions, { referenceDate })
    .filter((pattern) => SUGGESTION_BEHAVIORS.has(pattern.behaviorType))
    .filter((pattern) => isActionablePattern(pattern))
    .map((pattern) => {
      const decisionKey = financialPatternDecisionKey(pattern);
      const similarCommitments = findSimilarCommitments(pattern, commitments);
      const estimatedAmount = pattern.behaviorType === "variable_recurring_expense";
      return {
        decisionKey,
        pattern,
        title: suggestionTitle(pattern),
        estimatedAmount,
        amountLabel: estimatedAmount
          ? `aprox. ${formatBRLFromCents(pattern.estimatedAmountCents)} / mês`
          : `${formatBRLFromCents(pattern.estimatedAmountCents)} / mês`,
        dayLabel: pattern.estimatedDay ? `Por volta do dia ${pattern.estimatedDay}` : "Dia ainda sem estimativa",
        historyLabel: estimatedAmount
          ? "Valor estimado pelo seu histórico"
          : `Detectado em ${pattern.occurrenceCount} ${pattern.occurrenceCount === 1 ? "mês" : "meses"}`,
        similarCommitments,
        similarMatch: similarMatchFor(similarCommitments),
      } satisfies FinancialPatternSuggestion;
    })
    .filter((suggestion) => !decided.has(suggestion.decisionKey));
}

export async function loadFinancialPatternSuggestions(params: {
  householdId: string;
  referenceDate: string;
}): Promise<FinancialPatternSuggestion[]> {
  const referenceDate = requirePatternReferenceDate(params.referenceDate);
  const windowStart = patternDetectionWindowStart(referenceDate);
  try {
    const [transactions, decisions, commitments] = await Promise.all([
      loadPatternTransactions(params.householdId, windowStart, referenceDate),
      loadPatternDecisions(params.householdId),
      loadCommitmentsForSuggestions(params.householdId),
    ]);
    return buildFinancialPatternSuggestions({
      transactions,
      referenceDate,
      decisions,
      commitments,
    });
  } catch (error: any) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

export async function confirmFinancialPattern(params: {
  householdId: string;
  suggestion: FinancialPatternSuggestion;
  name: string;
  amountCents: number;
  dueDay: number;
  existingCommitmentId?: string | null;
}) {
  const { data, error } = await sb.rpc("confirm_financial_pattern", {
    p_household_id: params.householdId,
    p_pattern_key: params.suggestion.decisionKey,
    p_name: params.name,
    p_amount_cents: params.amountCents,
    p_due_day: params.dueDay,
    p_existing_commitment_id: params.existingCommitmentId ?? null,
    p_normalized_merchant: params.suggestion.pattern.normalizedMerchant ?? null,
    p_direction: params.suggestion.pattern.direction,
    p_behavior_type: params.suggestion.pattern.behaviorType,
    p_cadence: params.suggestion.pattern.cadence,
    p_estimated_amount_cents: params.suggestion.pattern.estimatedAmountCents,
    p_estimated_day: params.suggestion.pattern.estimatedDay ?? null,
    p_confidence: params.suggestion.pattern.confidence,
    p_first_seen: params.suggestion.pattern.firstSeen,
    p_last_seen: params.suggestion.pattern.lastSeen,
    p_occurrence_count: params.suggestion.pattern.occurrenceCount,
  });
  if (error) {
    if (isMissingSchema(error)) throw missingSchemaError();
    throw error;
  }
  return data;
}

export async function rejectFinancialPattern(params: {
  householdId: string;
  suggestion: FinancialPatternSuggestion;
}) {
  const { data, error } = await sb.rpc("reject_financial_pattern", {
    p_household_id: params.householdId,
    p_pattern_key: params.suggestion.decisionKey,
    p_normalized_merchant: params.suggestion.pattern.normalizedMerchant ?? null,
    p_direction: params.suggestion.pattern.direction,
    p_behavior_type: params.suggestion.pattern.behaviorType,
    p_cadence: params.suggestion.pattern.cadence,
    p_estimated_amount_cents: params.suggestion.pattern.estimatedAmountCents,
    p_estimated_day: params.suggestion.pattern.estimatedDay ?? null,
    p_confidence: params.suggestion.pattern.confidence,
    p_first_seen: params.suggestion.pattern.firstSeen,
    p_last_seen: params.suggestion.pattern.lastSeen,
    p_occurrence_count: params.suggestion.pattern.occurrenceCount,
  });
  if (error) {
    if (isMissingSchema(error)) throw missingSchemaError();
    throw error;
  }
  return data;
}

async function loadPatternTransactions(
  householdId: string,
  windowStart: string,
  referenceDate: string,
): Promise<PatternDetectionTransaction[]> {
  const transactions: PatternDetectionTransaction[] = [];
  for (let from = 0; ; from += PATTERN_TRANSACTION_PAGE_SIZE) {
    const { data, error } = await sb
      .from("transactions")
      .select("id,type,amount_cents,occurred_on,note,original_note,category_id,account_id,ignored_at,transfer_group_id")
      .eq("household_id", householdId)
      .gte("occurred_on", windowStart)
      .lte("occurred_on", referenceDate)
      .order("occurred_on", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PATTERN_TRANSACTION_PAGE_SIZE - 1);
    if (error) throw error;
    const page: PatternDetectionTransaction[] = ((data ?? []) as any[]).map((row) => ({
      id: String(row.id),
      type: row.type === "income" ? "income" : "expense",
      amountCents: Number(row.amount_cents) || 0,
      occurredOn: String(row.occurred_on),
      note: row.note ?? null,
      originalNote: row.original_note ?? null,
      categoryId: row.category_id ?? null,
      accountId: row.account_id ?? null,
      ignoredAt: row.ignored_at ?? null,
      transferGroupId: row.transfer_group_id ?? null,
    }));
    transactions.push(...page);
    if (page.length < PATTERN_TRANSACTION_PAGE_SIZE) break;
  }
  return transactions;
}

async function loadPatternDecisions(householdId: string): Promise<FinancialPatternDecisionRow[]> {
  const { data, error } = await sb
    .from("financial_pattern_decisions")
    .select("pattern_key,decision,linked_commitment_id")
    .eq("household_id", householdId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    pattern_key: String(row.pattern_key),
    decision: row.decision === "confirmed" ? "confirmed" : "rejected",
    linked_commitment_id: row.linked_commitment_id ?? null,
  }));
}

async function loadCommitmentsForSuggestions(householdId: string): Promise<PatternCommitmentCandidate[]> {
  const { data, error } = await sb
    .from("financial_commitments")
    .select("id,name,amount_cents,due_day,active")
    .eq("household_id", householdId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    amount_cents: Number(row.amount_cents) || 0,
    due_day: Number(row.due_day) || 0,
    active: row.active !== false,
  }));
}

function isBlockingDecision(row: FinancialPatternDecisionRow, activeCommitmentIds: Set<string>) {
  if (row.decision === "rejected") return true;
  if (row.decision !== "confirmed" || !row.linked_commitment_id) return false;
  return activeCommitmentIds.has(row.linked_commitment_id);
}

function suggestionTitle(pattern: DetectedFinancialPattern) {
  const merchant = (pattern.normalizedMerchant || "").trim();
  if (!merchant) return "Gasto recorrente";
  const named = normalizeMerchant(merchant);
  return named.displayName || merchant;
}

function namesMatch(commitmentName: string, merchantKey: string) {
  const fromName = normalizeMerchant(commitmentName);
  if (fromName.key && fromName.key === merchantKey) return true;
  return compactName(commitmentName) === merchantKey;
}

function compactName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function amountWithinTolerance(amountCents: number, estimatedAmountCents: number, ratio: number) {
  const allowed = Math.max(1, Math.round(estimatedAmountCents * ratio));
  return Math.abs(amountCents - estimatedAmountCents) <= allowed;
}

function isMissingSchema(error: any) {
  return ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code);
}

function missingSchemaError() {
  return new Error("A atualização do planejamento financeiro ainda não foi aplicada no banco de dados.");
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
