import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  knownCashErrorCode,
  readAllocatableCashPosition,
  readKnownCashAllocationResult,
} from "./financialAllocatableCash";

vi.mock("./supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261008133516_known_cash_goal_allocation.sql"),
  "utf8",
);

describe("allocatable cash contract", () => {
  it("trusts the server amount and does not rebuild it from planned income", () => {
    const position = readAllocatableCashPosition({
      knownCashCents: 1_000_000,
      earmarkedCents: 100_000,
      pendingDueCents: 300_000,
      reservePolicyCents: 200_000,
      availableToOrganizeCents: 400_000,
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
      incomeFixedCents: 9_000_000,
    });

    expect(position.availableToOrganizeCents).toBe(400_000);
    expect(position.knownCashCents).toBe(1_000_000);
    expect("incomeFixedCents" in position).toBe(false);
  });

  it("keeps a blocked position without inventing an available amount", () => {
    const position = readAllocatableCashPosition({
      knownCashCents: null,
      earmarkedCents: 0,
      pendingDueCents: 0,
      reservePolicyCents: 0,
      availableToOrganizeCents: null,
      cashAsOfDate: null,
      referenceDate: "2026-10-08",
      cycleKey: "calendar:2026-10",
      cycleStart: "2026-10-01",
      cycleEnd: "2026-11-01",
      accounts: [],
      dataQuality: {
        hasSnapshot: false,
        isStale: false,
        datesDiffer: false,
        sameBankRisk: false,
        sameBankIds: [],
        missingBankIds: [],
        hasAmbiguousGoalContributions: true,
        ambiguousContributionCount: 2,
      },
      blockReasons: ["no_snapshot", "ambiguous_goal_contributions"],
      canAllocate: false,
    });

    expect(position.availableToOrganizeCents).toBeNull();
    expect(position.canAllocate).toBe(false);
    expect(position.blockReasons).toEqual(["no_snapshot", "ambiguous_goal_contributions"]);
    expect(position.dataQuality.ambiguousContributionCount).toBe(2);
  });

  it("reads an allocation result and a stable error code", () => {
    const result = readKnownCashAllocationResult({
      contributionId: "contribution-1",
      requestId: "request-1",
      amountCents: 200_000,
      goalId: "goal-1",
      knownCashCents: 1_000_000,
      earmarkedBeforeCents: 0,
      pendingDueCents: 0,
      reservePolicyCents: 200_000,
      availableBeforeCents: 800_000,
      availableAfterCents: 600_000,
      cashAsOfDate: "2026-10-08",
      sourceKind: "known_cash",
      idempotentReplay: false,
    });

    expect(result.availableAfterCents).toBe(600_000);
    expect(result.sourceKind).toBe("known_cash");
    expect(knownCashErrorCode({ message: "known_cash:stale_snapshot" })).toBe("stale_snapshot");
    expect(knownCashErrorCode({ message: "outro erro" })).toBeNull();
  });

  it("keeps the migration from treating planned income as cash", () => {
    const positionFunction = migration.slice(
      migration.indexOf("function public.allocatable_cash_position"),
      migration.indexOf("function public.get_allocatable_cash_position"),
    );
    expect(positionFunction).not.toMatch(/income_fixed_cents|income_variable_avg_cents/);
    expect(migration).toMatch(/source_kind in \('cycle_surplus', 'manual_unverified', 'known_cash'\)/);
    expect(migration).toMatch(/revoke all on function public\.allocate_known_cash_to_goal\(uuid, uuid, bigint, uuid\) from public, anon/);
    expect(migration).toMatch(/grant execute on function public\.allocate_known_cash_to_goal\(uuid, uuid, bigint, uuid\) to authenticated/);
    expect(migration).not.toMatch(/grant execute on function public\.allocate_known_cash_to_goal[\s\S]*to anon/);
    expect(migration).toMatch(/on delete restrict/i);
    expect(migration).toMatch(/known_cash:trusted_earmark_delete_forbidden/);
    expect(migration).toMatch(/known_cash:direct_cycle_surplus_forbidden/);
    expect(migration).toMatch(/cycle_closure_id, source_kind/);
    expect(migration).toMatch(/remove_known_cash_requests_for_user/);
    expect(migration).not.toMatch(/insert into public\.transactions/i);
  });
});
