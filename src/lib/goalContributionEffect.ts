export const GOAL_CONTRIBUTION_SOURCE_KINDS = [
  "manual_unverified",
  "known_cash",
  "cycle_surplus",
  "account_reserved",
  "saved_outside",
  "reversed",
] as const;

export type GoalContributionSourceKind = (typeof GOAL_CONTRIBUTION_SOURCE_KINDS)[number];

export type GoalContributionAmounts = {
  sourceKind: string | null | undefined;
  amountCents: number;
  effectiveAmountCents?: number | null;
};

function wholeCents(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.trunc(number);
}

export function getGoalContributionEffectiveCents(entry: GoalContributionAmounts) {
  if (entry.sourceKind == null) return wholeCents(entry.amountCents);
  if (entry.sourceKind === "reversed") return 0;
  if (entry.sourceKind === "account_reserved" || entry.sourceKind === "saved_outside") {
    return Math.max(0, wholeCents(entry.effectiveAmountCents));
  }
  return wholeCents(entry.amountCents);
}

export function isReversedGoalContribution(sourceKind: string | null | undefined) {
  return sourceKind === "reversed";
}

export function getGoalContributionEarmarkCents(entry: GoalContributionAmounts) {
  if (entry.sourceKind === "known_cash" || entry.sourceKind === "cycle_surplus") {
    return wholeCents(entry.amountCents);
  }
  if (entry.sourceKind === "account_reserved") {
    return Math.max(0, wholeCents(entry.effectiveAmountCents));
  }
  return 0;
}

export function goalContributionErrorCode(error: { message?: string } | null | undefined) {
  const match = String(error?.message ?? "").match(/goal_contribution:([a-z0-9_]+)/);
  return match?.[1] ?? null;
}

export function readManualContributionReconciliation(value: unknown) {
  const row = record(value);
  const resultingKind = requiredText(row.resultingKind);
  if (!["account_reserved", "saved_outside", "reversed"].includes(resultingKind)) {
    throw new Error("A revisão do aporte é inválida.");
  }
  return {
    contributionId: requiredText(row.contributionId),
    previousKind: requiredText(row.previousKind),
    resultingKind,
    originalAmountCents: wholeCents(row.originalAmountCents),
    effectiveAmountCents: wholeCents(row.effectiveAmountCents),
    goalProgressCents: wholeCents(row.goalProgressCents),
    goalRemainingCents: wholeCents(row.goalRemainingCents),
    idempotentReplay: Boolean(row.idempotentReplay),
  };
}

export function readSavedOutsideContribution(value: unknown) {
  const row = record(value);
  if (row.sourceKind !== "saved_outside") {
    throw new Error("O aporte fora das contas é inválido.");
  }
  return {
    contributionId: requiredText(row.contributionId),
    goalId: requiredText(row.goalId),
    amountCents: wholeCents(row.amountCents),
    effectiveAmountCents: wholeCents(row.effectiveAmountCents),
    sourceKind: "saved_outside" as const,
    goalProgressCents: wholeCents(row.goalProgressCents),
    goalRemainingCents: wholeCents(row.goalRemainingCents),
    idempotentReplay: Boolean(row.idempotentReplay),
  };
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A resposta do aporte é inválida.");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A resposta do aporte é inválida.");
  }
  return value;
}
