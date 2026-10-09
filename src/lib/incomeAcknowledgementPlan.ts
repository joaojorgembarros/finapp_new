import { findTransactionAccountById } from "./banks";
import { PATTERN_DETECTION } from "./financialPatternDetection";
import { formatBRLFromCents } from "./format";

export const INCOME_ACKNOWLEDGEMENT_MAX_CENTS = 1_000_000_000;
export const INCOME_ACKNOWLEDGEMENT_KEY_PATTERN = /^merchant:v1:income:[^:]+:.+$/;

export type IncomeAcknowledgementDecision = "incorporated" | "declined";
export type IncomeAcknowledgementTargetField = "income_fixed_cents" | "income_variable_avg_cents";
export type IncomeAcknowledgementBehavior = "fixed_recurring_income" | "variable_recurring_income";

export type IncomeAcknowledgement = {
  patternKey: string;
  targetField: IncomeAcknowledgementTargetField;
  decision: IncomeAcknowledgementDecision;
  suggestedCents: number;
  profileCentsBefore: number;
  profileCentsAfter: number | null;
  accountId: string | null;
  normalizedMerchant: string;
  behaviorType: IncomeAcknowledgementBehavior;
};

/**
 * Stable decision identity. Amount, confidence, occurrences and dates are absent.
 * Example: merchant:v1:income:nubank:salario:empresa alpha
 */
export function incomeAcknowledgementKey(input: {
  normalizedMerchant: string;
  accountId?: string | null;
}) {
  const merchant = (input.normalizedMerchant || "").trim() || "empty";
  const accountId = input.accountId ?? "none";
  return `merchant:v1:income:${accountId}:${merchant}`;
}

export function incomeTargetField(behaviorType: IncomeAcknowledgementBehavior): IncomeAcknowledgementTargetField {
  return behaviorType === "fixed_recurring_income" ? "income_fixed_cents" : "income_variable_avg_cents";
}

export function incomeFieldLabel(behaviorType: IncomeAcknowledgementBehavior) {
  return behaviorType === "fixed_recurring_income" ? "Renda fixa" : "Média de renda extra";
}

export function incomeAccountLabel(accountId: string | null | undefined) {
  const named = findTransactionAccountById(accountId);
  if (named) return named.name;
  if (accountId) return accountId;
  return "Conta não identificada";
}

export function incomeAmountsAreSimilar(
  currentCents: number,
  detectedCents: number,
  behaviorType: IncomeAcknowledgementBehavior,
) {
  const ratio = behaviorType === "variable_recurring_income"
    ? PATTERN_DETECTION.variableMaxRelativeVariance
    : PATTERN_DETECTION.fixedRelativeVariance;
  const allowed = Math.max(1, Math.round(detectedCents * ratio));
  return Math.abs(currentCents - detectedCents) <= allowed;
}

export type IncomePlanMode = "zero" | "similar" | "different";

export type IncomePlanDraft = {
  mode: IncomePlanMode;
  prefillCents: number;
  explanation: string;
  keepCurrentCents: number;
  updateToDetectedCents: number | null;
  useOnlyDetectedCents: number | null;
  addToCurrentCents: number | null;
};

export function incomePlanDraft(input: {
  currentCents: number;
  detectedCents: number;
  behaviorType: IncomeAcknowledgementBehavior;
}): IncomePlanDraft {
  const currentCents = Math.max(0, Math.trunc(input.currentCents));
  const detectedCents = Math.max(0, Math.trunc(input.detectedCents));
  const detectedLabel = formatBRLFromCents(detectedCents);
  const fieldLabel = input.behaviorType === "fixed_recurring_income" ? "renda fixa" : "média de renda extra";

  if (currentCents === 0) {
    return {
      mode: "zero",
      prefillCents: detectedCents,
      explanation: `Usar ${detectedLabel} como minha ${fieldLabel}`,
      keepCurrentCents: currentCents,
      updateToDetectedCents: null,
      useOnlyDetectedCents: null,
      addToCurrentCents: null,
    };
  }

  if (incomeAmountsAreSimilar(currentCents, detectedCents, input.behaviorType)) {
    return {
      mode: "similar",
      prefillCents: currentCents,
      explanation: "Já está incluída no meu total",
      keepCurrentCents: currentCents,
      updateToDetectedCents: detectedCents,
      useOnlyDetectedCents: null,
      addToCurrentCents: null,
    };
  }

  const sum = currentCents + detectedCents;
  return {
    mode: "different",
    prefillCents: currentCents,
    explanation: "O Sonho+ não sabe se esta fonte já está incluída na sua renda atual.",
    keepCurrentCents: currentCents,
    updateToDetectedCents: null,
    useOnlyDetectedCents: detectedCents,
    addToCurrentCents: sum <= INCOME_ACKNOWLEDGEMENT_MAX_CENTS ? sum : null,
  };
}

export type IncomeCardAction = "hidden" | "use" | "review";

export function incomeCardAction(
  acknowledgement: Pick<IncomeAcknowledgement, "decision"> | null,
  unavailable: boolean,
): IncomeCardAction {
  if (unavailable) return "hidden";
  if (!acknowledgement) return "use";
  if (acknowledgement.decision === "declined") return "review";
  return "hidden";
}

export function incomeEstimateChanged(input: {
  acknowledgement: Pick<IncomeAcknowledgement, "decision" | "suggestedCents"> | null;
  estimatedMonthlyCents: number;
  behaviorType: IncomeAcknowledgementBehavior;
}) {
  if (!input.acknowledgement || input.acknowledgement.decision !== "incorporated") return false;
  return !incomeAmountsAreSimilar(
    input.acknowledgement.suggestedCents,
    input.estimatedMonthlyCents,
    input.behaviorType,
  );
}

export function similarIncomeAccountWarning(
  current: { normalizedMerchant: string; accountId: string | null; estimatedMonthlyCents: number; behaviorType: IncomeAcknowledgementBehavior },
  others: { normalizedMerchant: string; accountId: string | null; estimatedMonthlyCents: number }[],
) {
  const match = others.find((other) => (
    other.normalizedMerchant === current.normalizedMerchant
    && other.accountId !== current.accountId
    && incomeAmountsAreSimilar(other.estimatedMonthlyCents, current.estimatedMonthlyCents, current.behaviorType)
  ));
  if (!match) return null;
  return `Há uma fonte parecida na conta ${incomeAccountLabel(match.accountId)}. Confirme só se for outra renda.`;
}

export function isStaleIncomeAcknowledgementError(error: { message?: string | null } | null | undefined) {
  return (error?.message ?? "").includes("Renda alterada em outro lugar");
}
