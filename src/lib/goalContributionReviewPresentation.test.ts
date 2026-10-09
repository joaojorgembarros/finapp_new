import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { formatBRLFromCents } from "./format";
import { reconcileManualContribution } from "./goalContributionReview";
import { supabase } from "./supabase";
import {
  buildReconciliationSubmission,
  classifyReviewError,
  classifySavedOutsideError,
  contributionHistoryPresentation,
  isPendingManualContribution,
  nextPendingAfterResolve,
  pendingManualContributions,
  reviewAmountIssue,
  reviewChoices,
  reviewConfirmation,
  reviewFailureKeepsRequest,
  reviewProgressLabel,
  resolveReviewRequestId,
  resolveSavedOutsideRequestId,
  saveMoneyChoices,
  savedOutsideAmountIssue,
  trackedAccountSaveState,
} from "./goalContributionReviewPresentation";
import type { AllocatableCashPosition } from "./financialAllocatableCash";

vi.mock("./supabase", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

const root = dirname(fileURLToPath(import.meta.url));

function position(partial: Partial<AllocatableCashPosition> = {}): AllocatableCashPosition {
  return {
    knownCashCents: 200_000,
    earmarkedCents: 0,
    pendingDueCents: 0,
    reservePolicyCents: 0,
    availableToOrganizeCents: 200_000,
    cashAsOfDate: "2026-10-08",
    referenceDate: "2026-10-08",
    cycleKey: "calendar:2026-10",
    cycleStart: "2026-10-01",
    cycleEnd: "2026-11-01",
    accounts: [],
    dataQuality: {
      hasSnapshot: true,
      isStale: false,
      datesDiffer: false,
      sameBankRisk: false,
      sameBankIds: [],
      missingBankIds: [],
      hasAmbiguousGoalContributions: false,
      ambiguousContributionCount: 0,
    },
    blockReasons: [],
    canAllocate: true,
    ...partial,
  };
}

describe("goal contribution review presentation", () => {
  it("lists only unresolved manual contributions", () => {
    const pending = pendingManualContributions([
      { id: "manual", sourceKind: "manual_unverified" },
      { id: "cash", sourceKind: "known_cash" },
      { id: "cycle", sourceKind: "cycle_surplus" },
      { id: "reserved", sourceKind: "account_reserved" },
      { id: "outside", sourceKind: "saved_outside" },
      { id: "reversed", sourceKind: "reversed" },
    ]);
    expect(pending.map((row) => row.id)).toEqual(["manual"]);
    expect(isPendingManualContribution("known_cash")).toBe(false);
  });

  it("confirms a full amount still in the tracked accounts", () => {
    const copy = reviewConfirmation({
      decision: "still_in_accounts",
      amountCents: 200_000,
      originalCents: 200_000,
      goalTitle: "Viagem",
    });
    expect(copy.title).toBe(`Confirmar ${formatBRLFromCents(200_000)} ainda guardados para Viagem?`);
    expect(copy.detail).toMatch(/dinheiro disponível para organizar/);
    expect(reviewAmountIssue({
      decision: "still_in_accounts",
      amountCents: 200_000,
      originalCents: 200_000,
      reducing: false,
    })).toBeNull();
  });

  it("accepts a smaller amount still in the tracked accounts", () => {
    expect(reviewAmountIssue({
      decision: "still_in_accounts",
      amountCents: 150_000,
      originalCents: 200_000,
      reducing: true,
    })).toBeNull();
    expect(reviewConfirmation({
      decision: "still_in_accounts",
      amountCents: 150_000,
      originalCents: 200_000,
      goalTitle: "Viagem",
    }).title).toContain(formatBRLFromCents(150_000));
  });

  it("confirms money saved outside the tracked accounts", () => {
    const full = reviewConfirmation({
      decision: "saved_outside",
      amountCents: 200_000,
      originalCents: 200_000,
      goalTitle: "Viagem",
    });
    const partial = reviewConfirmation({
      decision: "saved_outside",
      amountCents: 150_000,
      originalCents: 200_000,
      goalTitle: "Viagem",
    });
    expect(full.detail).toMatch(/não será descontado do saldo conhecido/);
    expect(partial.title).toContain(formatBRLFromCents(150_000));
    expect(reviewAmountIssue({
      decision: "saved_outside",
      amountCents: 150_000,
      originalCents: 200_000,
      reducing: true,
    })).toBeNull();
  });

  it("removes a value that is no longer saved", () => {
    const copy = reviewConfirmation({
      decision: "no_longer_saved",
      amountCents: 0,
      originalCents: 200_000,
      goalTitle: "Viagem",
    });
    expect(copy.title).toBe(`Remover ${formatBRLFromCents(200_000)} do progresso de Viagem?`);
    expect(copy.detail).toMatch(/histórico/);
  });

  it("rejects zero and an amount above the original for the first two choices", () => {
    expect(reviewAmountIssue({
      decision: "still_in_accounts",
      amountCents: 0,
      originalCents: 200_000,
      reducing: true,
    })).toBe("zero");
    expect(reviewAmountIssue({
      decision: "saved_outside",
      amountCents: 0,
      originalCents: 200_000,
      reducing: true,
    })).toBe("zero");
    expect(reviewAmountIssue({
      decision: "still_in_accounts",
      amountCents: 250_000,
      originalCents: 200_000,
      reducing: true,
    })).toBe("over_original");
  });

  it("advances to the next pending value and finishes the last one", () => {
    const first = nextPendingAfterResolve([{ id: "a" }, { id: "b" }, { id: "c" }], "a");
    expect(first.map((item) => item.id)).toEqual(["b", "c"]);
    expect(reviewProgressLabel(2, 3)).toBe("2 de 3");
    expect(nextPendingAfterResolve(first, "b")).toHaveLength(1);
    expect(nextPendingAfterResolve([{ id: "c" }], "c")).toEqual([]);
  });

  it("reloads after another device reviews the value and keeps the request on a network retry", () => {
    expect(classifyReviewError({ message: "goal_contribution:already_reconciled" })).toBe("already_reviewed");
    expect(classifyReviewError({ message: "goal_contribution:request_conflict" })).toBe("conflict");
    expect(reviewFailureKeepsRequest("unknown")).toBe(true);
    expect(reviewFailureKeepsRequest("conflict")).toBe(false);
    const created = resolveReviewRequestId(null, "contribution-1", "saved_outside", 150_000, () => "first");
    const retried = resolveReviewRequestId(created, "contribution-1", "saved_outside", 150_000, () => "second");
    expect(retried.id).toBe("first");
    expect(resolveReviewRequestId(created, "contribution-1", "still_in_accounts", 150_000, () => "third").id).toBe("third");
  });

  it("has an empty state and three explicit review choices", () => {
    expect(reviewChoices().map((choice) => choice.decision)).toEqual([
      "still_in_accounts",
      "saved_outside",
      "no_longer_saved",
    ]);
    expect(reviewChoices().some((choice) => /não sei/i.test(choice.title))).toBe(false);
  });

  it("labels each history kind and keeps the original amount visible", () => {
    expect(contributionHistoryPresentation({ amountCents: 80_000, effectiveCents: 80_000, sourceKind: "known_cash" }).status)
      .toBe("Destinado pelo planejamento");
    expect(contributionHistoryPresentation({ amountCents: 40_000, effectiveCents: 40_000, sourceKind: "cycle_surplus" }).status)
      .toBe("Guardado da sobra do ciclo");
    expect(contributionHistoryPresentation({ amountCents: 200_000, effectiveCents: 150_000, sourceKind: "account_reserved" })).toMatchObject({
      status: "Guardado nas contas acompanhadas",
      headline: `${formatBRLFromCents(150_000)} guardados`,
      originalCaption: `Registro original: ${formatBRLFromCents(200_000)}`,
    });
    expect(contributionHistoryPresentation({ amountCents: 90_000, effectiveCents: 90_000, sourceKind: "saved_outside" }).status)
      .toBe("Guardado fora das contas acompanhadas");
    expect(contributionHistoryPresentation({ amountCents: 10_000, effectiveCents: 10_000, sourceKind: "manual_unverified" }).status)
      .toBe("Precisa de revisão");
    expect(contributionHistoryPresentation({ amountCents: 200_000, effectiveCents: 0, sourceKind: "reversed" })).toMatchObject({
      status: "Não está mais guardado",
      headline: `${formatBRLFromCents(200_000)} registrados anteriormente`,
      originalCaption: null,
    });
  });

  it("sends tracked savings through known cash and refuses a blocked position", () => {
    const ready = trackedAccountSaveState(position());
    expect(ready.kind).toBe("ready");
    expect(ready.allowsManual).toBe(false);
    const blocked = trackedAccountSaveState(position({
      canAllocate: false,
      availableToOrganizeCents: null,
      blockReasons: ["ambiguous_goal_contributions"],
    }));
    expect(blocked.kind).toBe("blocked");
    if (blocked.kind !== "blocked") return;
    expect(blocked.allowsManual).toBe(false);
    expect(blocked.review).toBe(true);
  });

  it("keeps one request id for the same outside-savings intention", () => {
    const created = resolveSavedOutsideRequestId(null, "goal-1", 40_000, "2026-10-08", "", () => "first");
    const retried = resolveSavedOutsideRequestId(created, "goal-1", 40_000, "2026-10-08", "", () => "second");
    expect(retried.id).toBe("first");
    expect(saveMoneyChoices()).toHaveLength(2);
    expect(saveMoneyChoices().some((choice) => /não sei/i.test(choice.title))).toBe(false);
  });

  it("respects the apparent goal remaining and a completed goal", () => {
    expect(savedOutsideAmountIssue({ amountCents: 50_000, typed: true, remainingCents: 40_000 })).toBe("over_goal");
    expect(savedOutsideAmountIssue({ amountCents: 10_000, typed: true, remainingCents: 0 })).toBe("completed");
    expect(classifySavedOutsideError({ message: "goal_contribution:goal_completed" })).toBe("invalid");
  });

  it("sends the amount shown in the confirmation", async () => {
    const unchanged = buildReconciliationSubmission({
      decision: "saved_outside",
      originalCents: 20_000,
      correcting: false,
      editedCents: 15_000,
    });
    expect(unchanged).toMatchObject({
      decision: "saved_outside",
      effectiveAmountCents: 20_000,
      issue: null,
    });

    const outside = buildReconciliationSubmission({
      decision: "saved_outside",
      originalCents: 20_000,
      correcting: true,
      editedCents: 15_000,
    });
    expect(outside).toMatchObject({
      decision: "saved_outside",
      effectiveAmountCents: 15_000,
      issue: null,
    });
    expect(reviewConfirmation({
      decision: outside.decision,
      amountCents: outside.effectiveAmountCents ?? 0,
      originalCents: 20_000,
      goalTitle: "Viagem",
    }).title).toBe(`Confirmar ${formatBRLFromCents(15_000)} guardados fora das contas acompanhadas?`);

    const reserved = buildReconciliationSubmission({
      decision: "still_in_accounts",
      originalCents: 20_000,
      correcting: true,
      editedCents: 15_000,
    });
    expect(reserved).toMatchObject({
      decision: "still_in_accounts",
      effectiveAmountCents: 15_000,
      issue: null,
    });
    expect(buildReconciliationSubmission({
      decision: "saved_outside",
      originalCents: 20_000,
      correcting: true,
      editedCents: 20_000,
    })).toMatchObject({ effectiveAmountCents: 20_000, issue: null });
    expect(buildReconciliationSubmission({
      decision: "saved_outside",
      originalCents: 20_000,
      correcting: true,
      editedCents: 0,
    }).issue).toBe("zero");
    expect(buildReconciliationSubmission({
      decision: "still_in_accounts",
      originalCents: 20_000,
      correcting: true,
      editedCents: 20_001,
    }).issue).toBe("over_original");
    expect(buildReconciliationSubmission({
      decision: "no_longer_saved",
      originalCents: 30_000,
      correcting: true,
      editedCents: 15_000,
    })).toMatchObject({ decision: "no_longer_saved", effectiveAmountCents: null, issue: null });

    const rpc = supabase.rpc as ReturnType<typeof vi.fn>;
    rpc.mockResolvedValueOnce({
      data: {
        contributionId: "contribution-b",
        previousKind: "manual_unverified",
        resultingKind: "saved_outside",
        originalAmountCents: 20_000,
        effectiveAmountCents: outside.effectiveAmountCents,
        goalProgressCents: 27_000,
        goalRemainingCents: 973_000,
        idempotentReplay: false,
      },
      error: null,
    });
    await reconcileManualContribution({
      householdId: "household-1",
      contributionId: "contribution-b",
      decision: outside.decision,
      effectiveAmountCents: outside.effectiveAmountCents,
      requestId: "request-1",
    });
    expect(rpc).toHaveBeenCalledWith("reconcile_manual_contribution", {
      p_household_id: "household-1",
      p_contribution_id: "contribution-b",
      p_decision: "saved_outside",
      p_effective_amount_cents: 15_000,
      p_request_id: "request-1",
    });
  });

  it("does not create a manual contribution from the new screens", () => {
    const dream = readFileSync(join(root, "../../app/(app)/dream/[goalId].tsx"), "utf8");
    const review = readFileSync(join(root, "../../app/(app)/review-goal-contributions.tsx"), "utf8");
    const save = readFileSync(join(root, "../features/journey/SaveGoalMoneyCard.tsx"), "utf8");
    const plan = readFileSync(join(root, "../features/planning/AllocatableCashSection.tsx"), "utf8");
    expect(dream).not.toContain("addGoalContribution");
    expect(review).not.toContain("addGoalContribution");
    expect(save).not.toContain("addGoalContribution");
    expect(save).toContain("allocateKnownCashToGoal");
    expect(save).toContain("addSavedOutsideGoalContribution");
    expect(review).toContain("reconcileManualContribution");
    expect(review).toContain("buildReconciliationSubmission");
    expect(review).toContain("effectiveAmountToSubmitCents");
    expect(review).toContain("amountCents: effectiveAmountToSubmitCents ?? current.amountCents");
    expect(review).toContain("effectiveAmountCents: effectiveAmountToSubmitCents");
    expect(review).not.toContain("reviewEffectiveCents");
    expect(review).not.toContain("source_kind");
    expect(plan).toContain("/(app)/review-goal-contributions");
    expect(save).toContain("setError");
  });
});
