import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getGoalContributionEarmarkCents,
  getGoalContributionEffectiveCents,
  isReversedGoalContribution,
  goalContributionErrorCode,
  readManualContributionReconciliation,
  readSavedOutsideContribution,
} from "./goalContributionEffect";

const root = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(root, "../../supabase/migrations/20261008165450_goal_contribution_reconciliation.sql"),
  "utf8",
);

describe("goal contribution effect", () => {
  it("keeps the declared amount until a manual row is reviewed", () => {
    expect(getGoalContributionEffectiveCents({
      sourceKind: "manual_unverified",
      amountCents: 200_000,
      effectiveAmountCents: null,
    })).toBe(200_000);
    expect(getGoalContributionEarmarkCents({
      sourceKind: "manual_unverified",
      amountCents: 200_000,
    })).toBe(0);
  });

  it("uses the corrected amount for reserved and outside savings", () => {
    const reserved = {
      sourceKind: "account_reserved",
      amountCents: 200_000,
      effectiveAmountCents: 150_000,
    };
    const outside = { ...reserved, sourceKind: "saved_outside" };
    expect(getGoalContributionEffectiveCents(reserved)).toBe(150_000);
    expect(getGoalContributionEffectiveCents(outside)).toBe(150_000);
    expect(getGoalContributionEarmarkCents(reserved)).toBe(150_000);
    expect(getGoalContributionEarmarkCents(outside)).toBe(0);
  });

  it("drops reversed money from progress and from the earmark", () => {
    const reversed = {
      sourceKind: "reversed",
      amountCents: 200_000,
      effectiveAmountCents: null,
    };
    expect(getGoalContributionEffectiveCents(reversed)).toBe(0);
    expect(getGoalContributionEarmarkCents(reversed)).toBe(0);
    expect(isReversedGoalContribution("reversed")).toBe(true);
    expect(isReversedGoalContribution("saved_outside")).toBe(false);
  });

  it("earmarks trusted server rows at their original amount", () => {
    expect(getGoalContributionEarmarkCents({
      sourceKind: "known_cash",
      amountCents: 80_000,
    })).toBe(80_000);
    expect(getGoalContributionEffectiveCents({
      sourceKind: "cycle_surplus",
      amountCents: 40_000,
    })).toBe(40_000);
  });

  it("reads a partial review and a direct outside-savings result", () => {
    const review = readManualContributionReconciliation({
      contributionId: "contribution-1",
      previousKind: "manual_unverified",
      resultingKind: "account_reserved",
      originalAmountCents: 200_000,
      effectiveAmountCents: 150_000,
      goalProgressCents: 150_000,
      goalRemainingCents: 850_000,
      idempotentReplay: true,
    });
    expect(review.originalAmountCents).toBe(200_000);
    expect(review.effectiveAmountCents).toBe(150_000);
    expect(review.goalProgressCents).toBe(150_000);
    expect(review.idempotentReplay).toBe(true);
    expect(readSavedOutsideContribution({
      contributionId: "contribution-2",
      goalId: "goal-1",
      amountCents: 40_000,
      effectiveAmountCents: 40_000,
      sourceKind: "saved_outside",
      goalProgressCents: 190_000,
      goalRemainingCents: 810_000,
      idempotentReplay: false,
    }).sourceKind).toBe("saved_outside");
    expect(goalContributionErrorCode({ message: "goal_contribution:already_reconciled" })).toBe("already_reconciled");
  });

  it("does not sum the raw declared amount in the progress readers", () => {
    const goals = readFileSync(join(root, "goals.ts"), "utf8");
    const planning = readFileSync(join(root, "financialPlanning.ts"), "utf8");
    expect(goals).toContain("getGoalContributionEffectiveCents");
    expect(planning).toContain("getGoalContributionEffectiveCents");
    expect(migration).toContain("account_reserved");
    expect(migration).toContain("saved_outside");
    expect(migration).toContain("reversed");
    expect(migration).toContain("reconcile_manual_contribution");
    expect(migration).toContain("add_saved_outside_goal_contribution");
    expect(migration).not.toMatch(/sum\(entry\.amount_cents\)/);
    expect(migration).not.toMatch(/insert into public\.transactions/i);
  });
});
