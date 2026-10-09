import { supabase } from "./supabase";

const sb: any = supabase;

export const ALLOCATABLE_CASH_BLOCK_REASONS = [
  "no_snapshot",
  "stale_snapshot",
  "dates_differ",
  "same_bank_risk",
  "missing_account_snapshot",
  "ambiguous_goal_contributions",
] as const;

export type AllocatableCashBlockReason = (typeof ALLOCATABLE_CASH_BLOCK_REASONS)[number];

export type AllocatableCashAccount = {
  bankId: string;
  importId: string;
  knownCashCents: number;
  asOfDate: string;
  confidence: "confirmed" | "derived";
};

export type AllocatableCashPosition = {
  knownCashCents: number | null;
  earmarkedCents: number;
  pendingDueCents: number;
  reservePolicyCents: number;
  availableToOrganizeCents: number | null;
  cashAsOfDate: string | null;
  referenceDate: string;
  cycleKey: string;
  cycleStart: string;
  cycleEnd: string;
  accounts: AllocatableCashAccount[];
  dataQuality: {
    hasSnapshot: boolean;
    isStale: boolean;
    datesDiffer: boolean;
    sameBankRisk: boolean;
    sameBankIds: string[];
    missingBankIds: string[];
    hasAmbiguousGoalContributions: boolean;
    ambiguousContributionCount: number;
  };
  blockReasons: AllocatableCashBlockReason[];
  canAllocate: boolean;
};

export type KnownCashAllocationResult = {
  contributionId: string;
  requestId: string;
  amountCents: number;
  goalId: string;
  knownCashCents: number | null;
  earmarkedBeforeCents: number;
  pendingDueCents: number;
  reservePolicyCents: number;
  availableBeforeCents: number;
  availableAfterCents: number;
  cashAsOfDate: string | null;
  sourceKind: "known_cash";
  idempotentReplay: boolean;
};

const BLOCK_REASONS = new Set<string>(ALLOCATABLE_CASH_BLOCK_REASONS);

export function knownCashErrorCode(error: { message?: string } | null | undefined) {
  const match = String(error?.message ?? "").match(/known_cash:([a-z0-9_]+)/);
  return match?.[1] ?? null;
}

export function readAllocatableCashPosition(value: unknown): AllocatableCashPosition {
  const row = objectValue(value);
  const dataQuality = objectValue(row.dataQuality);
  const blockReasons = stringArray(row.blockReasons).filter((reason): reason is AllocatableCashBlockReason => (
    BLOCK_REASONS.has(reason)
  ));
  return {
    knownCashCents: nullableCents(row.knownCashCents),
    earmarkedCents: requiredCents(row.earmarkedCents),
    pendingDueCents: requiredCents(row.pendingDueCents),
    reservePolicyCents: requiredCents(row.reservePolicyCents),
    availableToOrganizeCents: nullableCents(row.availableToOrganizeCents),
    cashAsOfDate: nullableText(row.cashAsOfDate),
    referenceDate: requiredText(row.referenceDate),
    cycleKey: requiredText(row.cycleKey),
    cycleStart: requiredText(row.cycleStart),
    cycleEnd: requiredText(row.cycleEnd),
    accounts: readAccounts(row.accounts),
    dataQuality: {
      hasSnapshot: Boolean(dataQuality.hasSnapshot),
      isStale: Boolean(dataQuality.isStale),
      datesDiffer: Boolean(dataQuality.datesDiffer),
      sameBankRisk: Boolean(dataQuality.sameBankRisk),
      sameBankIds: stringArray(dataQuality.sameBankIds),
      missingBankIds: stringArray(dataQuality.missingBankIds),
      hasAmbiguousGoalContributions: Boolean(dataQuality.hasAmbiguousGoalContributions),
      ambiguousContributionCount: requiredCents(dataQuality.ambiguousContributionCount),
    },
    blockReasons,
    canAllocate: Boolean(row.canAllocate),
  };
}

export function readKnownCashAllocationResult(value: unknown): KnownCashAllocationResult {
  const row = objectValue(value);
  if (row.sourceKind !== "known_cash") {
    throw new Error("A distribuição não retornou um aporte de saldo conhecido.");
  }
  return {
    contributionId: requiredText(row.contributionId),
    requestId: requiredText(row.requestId),
    amountCents: requiredCents(row.amountCents),
    goalId: requiredText(row.goalId),
    knownCashCents: nullableCents(row.knownCashCents),
    earmarkedBeforeCents: requiredCents(row.earmarkedBeforeCents),
    pendingDueCents: requiredCents(row.pendingDueCents),
    reservePolicyCents: requiredCents(row.reservePolicyCents),
    availableBeforeCents: requiredCents(row.availableBeforeCents),
    availableAfterCents: requiredCents(row.availableAfterCents),
    cashAsOfDate: nullableText(row.cashAsOfDate),
    sourceKind: "known_cash",
    idempotentReplay: Boolean(row.idempotentReplay),
  };
}

export async function getAllocatableCashPosition(householdId: string) {
  const { data, error } = await sb.rpc("get_allocatable_cash_position", {
    p_household_id: householdId,
  });
  if (error) throw error;
  return readAllocatableCashPosition(data);
}

export async function allocateKnownCashToGoal(params: {
  householdId: string;
  goalId: string;
  amountCents: number;
  requestId: string;
}) {
  const { data, error } = await sb.rpc("allocate_known_cash_to_goal", {
    p_household_id: params.householdId,
    p_goal_id: params.goalId,
    p_amount_cents: params.amountCents,
    p_request_id: params.requestId,
  });
  if (error) throw error;
  return readKnownCashAllocationResult(data);
}

function readAccounts(value: unknown): AllocatableCashAccount[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = objectValue(item);
    const confidence = row.confidence === "derived" ? "derived" : "confirmed";
    return {
      bankId: requiredText(row.bankId),
      importId: requiredText(row.importId),
      knownCashCents: requiredCents(row.knownCashCents),
      asOfDate: requiredText(row.asOfDate),
      confidence,
    };
  });
}

function objectValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A posição de caixa alocável é inválida.");
  }
  return value as Record<string, unknown>;
}

function requiredCents(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("A posição de caixa alocável é inválida.");
  return Math.trunc(number);
}

function nullableCents(value: unknown) {
  if (value == null) return null;
  return requiredCents(value);
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A posição de caixa alocável é inválida.");
  }
  return value;
}

function nullableText(value: unknown) {
  if (value == null) return null;
  return requiredText(value);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
