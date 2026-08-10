import { describe, expect, it, vi } from "vitest";
import { findUnambiguousCommitmentMatches } from "./commitmentReconciliation";

vi.mock("./supabase", () => ({
  supabase: {},
}));

function expense(id: string, amountCents: number, occurredOn = "2026-08-08") {
  return {
    id,
    type: "expense" as const,
    amount_cents: amountCents,
    occurred_on: occurredOn,
  };
}

function commitment(id: string, amountCents: number, dueOn = "2026-08-10") {
  return {
    id,
    amount_cents: amountCents,
    due_on: dueOn,
    paid_cents: 0,
    pending_cents: amountCents,
    payment_id: null,
  };
}

describe("automatic commitment reconciliation", () => {
  it("matches one imported expense to one pending commitment with the exact value", () => {
    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-1", 89_90)],
      commitments: [commitment("commitment-1", 89_90)],
    })).toEqual([{
      commitmentId: "commitment-1",
      transactionId: "tx-1",
      amountCents: 89_90,
      paidOn: "2026-08-08",
    }]);
  });

  it("leaves the value untouched when expenses or commitments are ambiguous", () => {
    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-1", 10_000), expense("tx-2", 10_000)],
      commitments: [commitment("commitment-1", 10_000)],
    })).toEqual([]);

    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-1", 10_000)],
      commitments: [commitment("commitment-1", 10_000), commitment("commitment-2", 10_000)],
    })).toEqual([]);
  });

  it("accepts dates at either edge of the seven-day window and rejects dates outside it", () => {
    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-before", 12_000, "2026-08-03")],
      commitments: [commitment("commitment-before", 12_000, "2026-08-10")],
    })).toHaveLength(1);
    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-after", 13_000, "2026-08-17")],
      commitments: [commitment("commitment-after", 13_000, "2026-08-10")],
    })).toHaveLength(1);
    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-outside", 14_000, "2026-08-18")],
      commitments: [commitment("commitment-outside", 14_000, "2026-08-10")],
    })).toEqual([]);
  });

  it("excludes transactions and commitments that already have a payment link", () => {
    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-linked", 20_000)],
      commitments: [commitment("commitment-1", 20_000)],
      linkedTransactionIds: ["tx-linked"],
    })).toEqual([]);

    expect(findUnambiguousCommitmentMatches({
      expenses: [expense("tx-1", 21_000)],
      commitments: [commitment("commitment-linked", 21_000)],
      linkedCommitmentIds: ["commitment-linked"],
    })).toEqual([]);
  });
});
