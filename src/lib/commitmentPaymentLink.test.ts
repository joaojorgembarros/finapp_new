import { describe, expect, it, vi } from "vitest";
import {
  getUnlinkedPaymentMessage,
  linkExpenseToCommitmentWithRetry,
  rollbackUnlinkedManualPayment,
} from "./commitmentPaymentLink";

describe("linkExpenseToCommitmentWithRetry", () => {
  it("returns linked when the first attempt succeeds", async () => {
    const link = vi.fn().mockResolvedValue({ id: "payment-1" });

    await expect(linkExpenseToCommitmentWithRetry(link)).resolves.toEqual({ kind: "linked" });
    expect(link).toHaveBeenCalledTimes(1);
  });

  it("retries once after a failed link and then succeeds", async () => {
    const link = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ id: "payment-1" });

    await expect(linkExpenseToCommitmentWithRetry(link)).resolves.toEqual({ kind: "linked" });
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("keeps the expense recoverable when the link keeps failing", async () => {
    const link = vi.fn().mockRejectedValue(new Error("23514"));

    await expect(linkExpenseToCommitmentWithRetry(link)).resolves.toEqual({
      kind: "unlinked",
      message: getUnlinkedPaymentMessage(),
    });
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("rolls back the manual expense so the motor does not double-count it", async () => {
    const deleteManualTransaction = vi.fn().mockResolvedValue({ id: "tx-1" });

    await rollbackUnlinkedManualPayment({
      householdId: "house-1",
      transactionId: "tx-1",
      deleteManualTransaction,
    });

    expect(deleteManualTransaction).toHaveBeenCalledWith("house-1", "tx-1");
  });
});
