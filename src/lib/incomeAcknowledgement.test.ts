import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeIncomePattern } from "./incomeAcknowledgement";

const rpc = vi.fn();

vi.mock("./supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

describe("acknowledgeIncomePattern", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("sends an absolute total and never an increment", async () => {
    rpc.mockResolvedValue({ data: { decision: "incorporated" }, error: null });
    let plannedCents = 800000;

    await acknowledgeIncomePattern({
      householdId: "house-1",
      patternKey: "merchant:v1:income:nubank:salario:empresa alpha",
      targetField: "income_fixed_cents",
      decision: "incorporated",
      suggestedCents: 480000,
      desiredTotalCents: 1280000,
      expectedCurrentCents: 800000,
      accountId: "nubank",
      normalizedMerchant: "salario:empresa alpha",
      behaviorType: "fixed_recurring_income",
    });

    expect(rpc).toHaveBeenCalledWith("acknowledge_income_pattern", expect.objectContaining({
      p_desired_total_cents: 1280000,
      p_expected_current_cents: 800000,
      p_suggested_cents: 480000,
    }));
    expect(JSON.stringify(rpc.mock.calls[0]?.[1])).not.toMatch(/increment|delta/);
    plannedCents = 1280000;
    expect(plannedCents).toBe(1280000);
  });

  it("leaves the local total unchanged when the backend rejects the call", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "falha de rede" } });
    let plannedCents = 800000;

    await expect(acknowledgeIncomePattern({
      householdId: "house-1",
      patternKey: "merchant:v1:income:nubank:empresa beta",
      targetField: "income_variable_avg_cents",
      decision: "incorporated",
      suggestedCents: 460000,
      desiredTotalCents: 460000,
      expectedCurrentCents: 0,
      accountId: "nubank",
      normalizedMerchant: "empresa beta",
      behaviorType: "variable_recurring_income",
    })).rejects.toEqual({ message: "falha de rede" });

    expect(plannedCents).toBe(800000);
  });
});
