import { describe, expect, it } from "vitest";
import {
  assertCyclePaymentFits,
  cyclePaymentAlreadyPaidCents,
  getCyclePaymentAcceptance,
} from "./commitmentPaymentPersistence";

describe("cycle payment persistence rules", () => {
  it("accepts R$ 400 + R$ 600 in the same cycle", () => {
    const first = getCyclePaymentAcceptance({
      commitmentAmountCents: 100_000,
      alreadyPaidCents: 0,
      nextPaidCents: 40_000,
    });
    const second = getCyclePaymentAcceptance({
      commitmentAmountCents: 100_000,
      alreadyPaidCents: 40_000,
      nextPaidCents: 60_000,
    });

    expect(first).toMatchObject({ ok: true, nextTotalCents: 40_000 });
    expect(second).toMatchObject({ ok: true, nextTotalCents: 100_000, remainingCents: 60_000 });
  });

  it("rejects a second payment that would exceed the commitment", () => {
    expect(getCyclePaymentAcceptance({
      commitmentAmountCents: 100_000,
      alreadyPaidCents: 40_000,
      nextPaidCents: 70_000,
    })).toEqual({
      ok: false,
      code: "exceeds-remaining",
      remainingCents: 60_000,
    });
    expect(() => assertCyclePaymentFits({
      commitmentAmountCents: 100_000,
      alreadyPaidCents: 40_000,
      nextPaidCents: 70_000,
    })).toThrow("ultrapassa o restante");
  });

  it("treats a fully paid cycle as having nothing pending", () => {
    const accepted = getCyclePaymentAcceptance({
      commitmentAmountCents: 100_000,
      alreadyPaidCents: 40_000,
      nextPaidCents: 60_000,
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(Math.max(0, 100_000 - accepted.nextTotalCents)).toBe(0);
    }
  });

  it("keeps cycles independent", () => {
    const september = cyclePaymentAlreadyPaidCents([{ paid_cents: 40_000 }]);
    const october = cyclePaymentAlreadyPaidCents([]);

    expect(getCyclePaymentAcceptance({
      commitmentAmountCents: 100_000,
      alreadyPaidCents: september,
      nextPaidCents: 60_000,
    }).ok).toBe(true);
    expect(getCyclePaymentAcceptance({
      commitmentAmountCents: 100_000,
      alreadyPaidCents: october,
      nextPaidCents: 100_000,
    }).ok).toBe(true);
  });
});
