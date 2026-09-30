import { describe, expect, it } from "vitest";
import {
  groupPaymentsByCommitment,
  resolveCommitmentCyclePayment,
} from "./commitmentPaymentState";

function payment(id: string, paidCents: number, transactionId: string | null = id) {
  return {
    id,
    paid_cents: paidCents,
    paid_on: "2026-09-05",
    transaction_id: transactionId,
  };
}

function expense(amountCents: number) {
  return { type: "expense" as const, amount_cents: amountCents };
}

describe("resolveCommitmentCyclePayment", () => {
  it("keeps the remaining balance after an initial partial payment", () => {
    const resolved = resolveCommitmentCyclePayment({
      commitmentAmountCents: 100_000,
      payments: [payment("pay-1", 40_000, "tx-1")],
      transactionsById: new Map([["tx-1", expense(40_000)]]),
    });

    expect(resolved).toMatchObject({
      paidCents: 40_000,
      pendingCents: 60_000,
      paymentId: "pay-1",
    });
  });

  it("completes the same cycle when a second payment covers the remainder", () => {
    const resolved = resolveCommitmentCyclePayment({
      commitmentAmountCents: 100_000,
      payments: [
        payment("pay-1", 40_000, "tx-1"),
        payment("pay-2", 60_000, "tx-2"),
      ],
      transactionsById: new Map([
        ["tx-1", expense(40_000)],
        ["tx-2", expense(60_000)],
      ]),
    });

    expect(resolved.paidCents).toBe(100_000);
    expect(resolved.pendingCents).toBe(0);
  });

  it("never lets the paid total exceed the commitment", () => {
    const resolved = resolveCommitmentCyclePayment({
      commitmentAmountCents: 100_000,
      payments: [
        payment("pay-1", 40_000, "tx-1"),
        payment("pay-2", 80_000, "tx-2"),
      ],
      transactionsById: new Map([
        ["tx-1", expense(40_000)],
        ["tx-2", expense(80_000)],
      ]),
    });

    expect(resolved.paidCents).toBe(100_000);
    expect(resolved.pendingCents).toBe(0);
  });

  it("treats a fully paid commitment as having nothing pending", () => {
    const resolved = resolveCommitmentCyclePayment({
      commitmentAmountCents: 100_000,
      payments: [payment("pay-1", 100_000, "tx-1")],
      transactionsById: new Map([["tx-1", expense(100_000)]]),
    });

    expect(resolved.pendingCents).toBe(0);
  });

  it("counts a visible expense toward the bill even if the stored link is imperfect", () => {
    const resolved = resolveCommitmentCyclePayment({
      commitmentAmountCents: 100_000,
      payments: [payment("pay-1", 40_000, "tx-1")],
      transactionsById: new Map([["tx-1", expense(40_000)]]),
    });

    expect(resolved.pendingCents).toBe(60_000);
    expect(resolved.invalidUncounted).toBe(0);
  });

  it("does not keep the bill fully pending when the linked expense still exists", () => {
    const withLink = resolveCommitmentCyclePayment({
      commitmentAmountCents: 100_000,
      payments: [payment("pay-1", 40_000, "tx-1")],
      transactionsById: new Map([["tx-1", expense(40_000)]]),
    });
    const withoutExpense = resolveCommitmentCyclePayment({
      commitmentAmountCents: 100_000,
      payments: [payment("pay-1", 40_000, "tx-1")],
      transactionsById: new Map(),
    });

    expect(withLink.pendingCents).toBe(60_000);
    expect(withoutExpense.pendingCents).toBe(100_000);
    expect(withoutExpense.invalidUncounted).toBe(1);
  });
});

describe("groupPaymentsByCommitment", () => {
  it("keeps every payment event for the same commitment", () => {
    const grouped = groupPaymentsByCommitment([
      { commitment_id: "a", id: "1" },
      { commitment_id: "a", id: "2" },
      { commitment_id: "b", id: "3" },
    ]);

    expect(grouped.get("a")?.map((item) => item.id)).toEqual(["1", "2"]);
    expect(grouped.get("b")?.map((item) => item.id)).toEqual(["3"]);
  });
});
