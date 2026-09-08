import { describe, expect, it } from "vitest";
import {
  formatShortDateFromYmd,
  getCommitmentPaymentProgress,
  getPaymentAmountIssue,
  sortPendingCommitments,
} from "./financialOverviewPresentation";

describe("financial overview presentation", () => {
  it("formats a cycle date without depending on timezone", () => {
    expect(formatShortDateFromYmd("2026-09-10")).toBe("10 set");
    expect(formatShortDateFromYmd("invalid")).toBe("invalid");
  });

  it("keeps only pending commitments in chronological order without mutating the input", () => {
    const commitments = [
      { id: "next-month", due_on: "2026-09-05", created_at: "2026-01-01", pending_cents: 20_000 },
      { id: "paid", due_on: "2026-08-12", created_at: "2026-01-01", pending_cents: 0 },
      { id: "later", due_on: "2026-08-20", created_at: "2026-01-01", pending_cents: 30_000 },
      { id: "first", due_on: "2026-08-15", created_at: "2026-01-01", pending_cents: 10_000 },
    ] as const;

    expect(sortPendingCommitments(commitments).map((item) => item.id)).toEqual([
      "first",
      "later",
      "next-month",
    ]);
    expect(commitments.map((item) => item.id)).toEqual(["next-month", "paid", "later", "first"]);
  });

  it("uses creation order to make equal due dates deterministic", () => {
    const commitments = [
      { id: "second", due_on: "2026-09-10", created_at: "2026-02-01", pending_cents: 1 },
      { id: "first", due_on: "2026-09-10", created_at: "2026-01-01", pending_cents: 1 },
    ];

    expect(sortPendingCommitments(commitments).map((item) => item.id)).toEqual(["first", "second"]);
  });
});

describe("commitment payment presentation", () => {
  it.each([
    {
      caseName: "without a payment",
      paidCents: 0,
      expected: { totalCents: 100_000, paidCents: 0, remainingCents: 100_000, status: "Não pago" },
    },
    {
      caseName: "with a partial payment",
      paidCents: 40_000,
      expected: { totalCents: 100_000, paidCents: 40_000, remainingCents: 60_000, status: "Pago parcialmente" },
    },
    {
      caseName: "fully paid",
      paidCents: 100_000,
      expected: { totalCents: 100_000, paidCents: 100_000, remainingCents: 0, status: "Pago" },
    },
  ])("calculates total, paid and remaining $caseName", ({ paidCents, expected }) => {
    expect(getCommitmentPaymentProgress(100_000, paidCents)).toEqual(expected);
  });

  it("never returns a negative remaining value", () => {
    expect(getCommitmentPaymentProgress(100_000, 140_000)).toEqual({
      totalCents: 100_000,
      paidCents: 100_000,
      remainingCents: 0,
      status: "Pago",
    });
  });

  it("allows a partial or exact payment and rejects a value above the remaining balance", () => {
    expect(getPaymentAmountIssue(60_000, 40_000)).toBeNull();
    expect(getPaymentAmountIssue(60_000, 60_000)).toBeNull();
    expect(getPaymentAmountIssue(60_000, 80_000)).toBe("exceeds-remaining");
  });
});
