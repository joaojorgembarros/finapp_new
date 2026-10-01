import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInternalTransfer,
  linkInternalTransfer,
  unlinkInternalTransfer,
} from "./internalTransferPersistence";

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    from: supabaseMocks.from,
  },
}));

describe("internal transfer RPCs", () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
    supabaseMocks.from.mockReset();
  });

  it("creates a transfer only through the atomic RPC", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        transfer_group_id: "group-1",
        expense_id: "tx-out",
        income_id: "tx-in",
      },
      error: null,
    });

    const result = await createInternalTransfer({
      householdId: "house-1",
      fromAccountId: "nubank",
      toAccountId: "inter",
      amountCents: 100_000,
      occurredOn: "2026-10-01",
      note: "PIX entre contas",
    });

    expect(supabaseMocks.from).not.toHaveBeenCalled();
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith("create_internal_transfer", {
      p_household_id: "house-1",
      p_from_account_id: "nubank",
      p_to_account_id: "inter",
      p_amount_cents: 100_000,
      p_occurred_on: "2026-10-01",
      p_note: "PIX entre contas",
    });
    expect(result.expense_id).toBe("tx-out");
    expect(result.income_id).toBe("tx-in");
    expect(result.expense_id).not.toBe(result.income_id);
    expect(result.transfer_group_id).toBe("group-1");
  });

  it("validates origin and destination before calling the RPC", async () => {
    await expect(createInternalTransfer({
      householdId: "house-1",
      fromAccountId: "nubank",
      toAccountId: "nubank",
      amountCents: 100_000,
      occurredOn: "2026-10-01",
    })).rejects.toThrow("contas diferentes");
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("links and unlinks through the dedicated RPCs", async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({ data: { transfer_group_id: "group-1", transaction_id: "a", counterpart_id: "b" }, error: null })
      .mockResolvedValueOnce({ data: { transfer_group_id: "group-1", unlinked: true }, error: null });

    await linkInternalTransfer({ householdId: "house-1", transactionId: "a", counterpartId: "b" });
    await unlinkInternalTransfer({ householdId: "house-1", transactionId: "a" });

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, "link_internal_transfer", {
      p_household_id: "house-1",
      p_transaction_id: "a",
      p_counterpart_id: "b",
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, "unlink_internal_transfer", {
      p_household_id: "house-1",
      p_transaction_id: "a",
    });
  });
});
