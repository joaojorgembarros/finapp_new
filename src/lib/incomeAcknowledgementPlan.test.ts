import { describe, expect, it } from "vitest";
import { formatBRLFromCents } from "./format";
import {
  INCOME_ACKNOWLEDGEMENT_KEY_PATTERN,
  INCOME_ACKNOWLEDGEMENT_MAX_CENTS,
  incomeAcknowledgementKey,
  incomeAmountsAreSimilar,
  incomeCardAction,
  incomeEstimateChanged,
  incomePlanDraft,
  incomeTargetField,
  isStaleIncomeAcknowledgementError,
  similarIncomeAccountWarning,
} from "./incomeAcknowledgementPlan";

const alpha = {
  normalizedMerchant: "salario:empresa alpha",
  accountId: "nubank",
  estimatedMonthlyCents: 480000,
  behaviorType: "fixed_recurring_income" as const,
};

describe("income acknowledgement identity", () => {
  it("keeps the same key when the observed amount changes", () => {
    const original = incomeAcknowledgementKey(alpha);
    const raised = incomeAcknowledgementKey({
      normalizedMerchant: alpha.normalizedMerchant,
      accountId: alpha.accountId,
    });

    expect(original).toBe("merchant:v1:income:nubank:salario:empresa alpha");
    expect(raised).toBe(original);
    expect(original).toMatch(INCOME_ACKNOWLEDGEMENT_KEY_PATTERN);
    expect(original).not.toContain("480000");
    expect(original).not.toContain("520000");
  });

  it("keeps another account as a different key", () => {
    expect(incomeAcknowledgementKey({ ...alpha, accountId: "inter" })).toBe(
      "merchant:v1:income:inter:salario:empresa alpha",
    );
  });

  it("maps fixed and variable income onto the profile fields", () => {
    expect(incomeTargetField("fixed_recurring_income")).toBe("income_fixed_cents");
    expect(incomeTargetField("variable_recurring_income")).toBe("income_variable_avg_cents");
  });
});

describe("income plan draft", () => {
  it("prefills an empty fixed income with the detected amount", () => {
    const draft = incomePlanDraft({ currentCents: 0, detectedCents: 480000, behaviorType: "fixed_recurring_income" });

    expect(draft.mode).toBe("zero");
    expect(draft.prefillCents).toBe(480000);
    expect(draft.explanation).toBe(`Usar ${formatBRLFromCents(480000)} como minha renda fixa`);
    expect(draft.addToCurrentCents).toBeNull();
  });

  it("prefills an empty variable income without offering a sum", () => {
    const draft = incomePlanDraft({
      currentCents: 0,
      detectedCents: 460000,
      behaviorType: "variable_recurring_income",
    });

    expect(draft.mode).toBe("zero");
    expect(draft.prefillCents).toBe(460000);
    expect(draft.explanation).toContain("média de renda extra");
  });

  it("keeps a similar fixed total and does not suggest adding it again", () => {
    expect(incomeAmountsAreSimilar(480000, 490000, "fixed_recurring_income")).toBe(true);
    const draft = incomePlanDraft({ currentCents: 480000, detectedCents: 490000, behaviorType: "fixed_recurring_income" });

    expect(draft.mode).toBe("similar");
    expect(draft.prefillCents).toBe(480000);
    expect(draft.explanation).toBe("Já está incluída no meu total");
    expect(draft.keepCurrentCents).toBe(480000);
    expect(draft.updateToDetectedCents).toBe(490000);
    expect(draft.addToCurrentCents).toBeNull();
  });

  it("treats a distant fixed total as unknown and offers absolute helpers", () => {
    const draft = incomePlanDraft({ currentCents: 800000, detectedCents: 480000, behaviorType: "fixed_recurring_income" });

    expect(draft.mode).toBe("different");
    expect(draft.prefillCents).toBe(800000);
    expect(draft.explanation).toBe("O Sonho+ não sabe se esta fonte já está incluída na sua renda atual.");
    expect(draft.keepCurrentCents).toBe(800000);
    expect(draft.useOnlyDetectedCents).toBe(480000);
    expect(draft.addToCurrentCents).toBe(1280000);
  });

  it("uses the motor variance for variable income and still refuses an automatic sum", () => {
    expect(incomeAmountsAreSimilar(200000, 460000, "variable_recurring_income")).toBe(false);
    const draft = incomePlanDraft({
      currentCents: 200000,
      detectedCents: 460000,
      behaviorType: "variable_recurring_income",
    });

    expect(draft.mode).toBe("different");
    expect(draft.prefillCents).toBe(200000);
    expect(draft.addToCurrentCents).toBe(660000);
  });

  it("does not offer a sum that would pass the ceiling", () => {
    const draft = incomePlanDraft({
      currentCents: INCOME_ACKNOWLEDGEMENT_MAX_CENTS - 100,
      detectedCents: 200,
      behaviorType: "fixed_recurring_income",
    });

    expect(draft.addToCurrentCents).toBeNull();
  });
});

describe("income card actions", () => {
  it("hides the action when the acknowledgement state is unknown", () => {
    expect(incomeCardAction(null, true)).toBe("hidden");
  });

  it("offers planning only before a decision", () => {
    expect(incomeCardAction(null, false)).toBe("use");
  });

  it("turns a decline into review and keeps an incorporated source quiet", () => {
    expect(incomeCardAction({ decision: "declined" }, false)).toBe("review");
    expect(incomeCardAction({ decision: "incorporated" }, false)).toBe("hidden");
  });

  it("does not let another person's acknowledgement hide the action", () => {
    const own = new Map<string, { decision: "incorporated" | "declined" }>([
      [incomeAcknowledgementKey({ normalizedMerchant: "empresa gama", accountId: "nubank" }), { decision: "incorporated" }],
    ]);

    expect(incomeCardAction(own.get(incomeAcknowledgementKey(alpha)) ?? null, false)).toBe("use");
  });

  it("signals an observed change without treating it as a new total", () => {
    expect(incomeEstimateChanged({
      acknowledgement: { decision: "incorporated", suggestedCents: 480000 },
      estimatedMonthlyCents: 520000,
      behaviorType: "fixed_recurring_income",
    })).toBe(true);
    expect(incomeEstimateChanged({
      acknowledgement: { decision: "declined", suggestedCents: 480000 },
      estimatedMonthlyCents: 520000,
      behaviorType: "fixed_recurring_income",
    })).toBe(false);
  });

  it("warns about the same payer on another account without merging them", () => {
    const warning = similarIncomeAccountWarning(alpha, [{
      normalizedMerchant: alpha.normalizedMerchant,
      accountId: "inter",
      estimatedMonthlyCents: 480000,
    }]);

    expect(warning).toContain("Inter");
    expect(incomeAcknowledgementKey(alpha)).not.toBe(
      incomeAcknowledgementKey({ ...alpha, accountId: "inter" }),
    );
  });
});

describe("stale income acknowledgement", () => {
  it("recognizes the controlled conflict and leaves a local total untouched", () => {
    let plannedCents = 800000;
    const error = { message: "Renda alterada em outro lugar. Atualize os valores e tente novamente." };

    if (!isStaleIncomeAcknowledgementError(error)) plannedCents = 1280000;

    expect(isStaleIncomeAcknowledgementError(error)).toBe(true);
    expect(plannedCents).toBe(800000);
    expect(isStaleIncomeAcknowledgementError({ message: "falha de rede" })).toBe(false);
  });
});
