import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCommitmentPaid } from "./financialPlanning";

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: { from: supabaseMocks.from },
}));

function selectOne(data: unknown) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  return query;
}

function insertOne(result: { data: unknown; error: unknown }) {
  const query: any = {};
  query.insert = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.single = vi.fn().mockResolvedValue(result);
  return query;
}

function deleteOne(result: { data: unknown[]; error: unknown }) {
  const filters: [string, unknown][] = [];
  const query: any = {};
  query.delete = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    filters.push([column, value]);
    return query;
  });
  query.select = vi.fn().mockResolvedValue(result);
  return { query, filters };
}

const baseParams = {
  householdId: "house-1",
  userId: "user-1",
  commitmentId: "commitment-1",
  cycleKey: "calendar:2026-09",
};

describe("commitment payment persistence", () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
  });

  it("inserts a new link instead of replacing an existing cycle payment", async () => {
    const commitmentQuery = selectOne({ amount_cents: 100_000 });
    const transactionQuery = selectOne({
      amount_cents: 40_000,
      type: "expense",
      occurred_on: "2026-09-05",
      ignored_at: null,
    });
    const paymentQuery = insertOne({
      data: {
        id: "payment-1",
        ...baseParams,
        household_id: baseParams.householdId,
        commitment_id: baseParams.commitmentId,
        cycle_key: baseParams.cycleKey,
        paid_cents: 40_000,
        paid_on: "2026-09-05",
        transaction_id: "transaction-1",
        created_by: baseParams.userId,
      },
      error: null,
    });
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === "financial_commitments") return commitmentQuery;
      if (table === "transactions") return transactionQuery;
      return paymentQuery;
    });

    await setCommitmentPaid({
      ...baseParams,
      paid: true,
      paidCents: 40_000,
      transactionId: "transaction-1",
    });

    expect(paymentQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      paid_cents: 40_000,
      transaction_id: "transaction-1",
    }));
    expect(paymentQuery.upsert).toBeUndefined();
  });

  it("turns a uniqueness race into an explicit conflict", async () => {
    const commitmentQuery = selectOne({ amount_cents: 100_000 });
    const transactionQuery = selectOne({
      amount_cents: 40_000,
      type: "expense",
      occurred_on: "2026-09-05",
      ignored_at: null,
    });
    const paymentQuery = insertOne({ data: null, error: { code: "23505" } });
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === "financial_commitments") return commitmentQuery;
      if (table === "transactions") return transactionQuery;
      return paymentQuery;
    });

    await expect(setCommitmentPaid({
      ...baseParams,
      paid: true,
      paidCents: 40_000,
      transactionId: "transaction-1",
    })).rejects.toThrow("já possui um vínculo");
  });

  it("rejects a changed or oversized transaction instead of silently capping it", async () => {
    const commitmentQuery = selectOne({ amount_cents: 60_000 });
    const transactionQuery = selectOne({
      amount_cents: 80_000,
      type: "expense",
      occurred_on: "2026-09-05",
      ignored_at: null,
    });
    const paymentQuery = insertOne({ data: null, error: null });
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === "financial_commitments") return commitmentQuery;
      if (table === "transactions") return transactionQuery;
      return paymentQuery;
    });

    await expect(setCommitmentPaid({
      ...baseParams,
      paid: true,
      paidCents: 40_000,
      transactionId: "transaction-1",
    })).rejects.toThrow("valor do pagamento mudou");
    expect(paymentQuery.insert).not.toHaveBeenCalled();

    await expect(setCommitmentPaid({
      ...baseParams,
      paid: true,
      paidCents: 80_000,
      transactionId: "transaction-1",
    })).rejects.toThrow("maior que o valor do compromisso");
    expect(paymentQuery.insert).not.toHaveBeenCalled();
  });

  it("removes only the exact payment version the user reviewed", async () => {
    const { query, filters } = deleteOne({ data: [{ id: "payment-1" }], error: null });
    supabaseMocks.from.mockReturnValue(query);

    await setCommitmentPaid({
      ...baseParams,
      paid: false,
      expectedPaymentId: "payment-1",
      expectedPaymentUpdatedAt: "2026-09-08T12:00:00.000Z",
    });

    expect(filters).toEqual(expect.arrayContaining([
      ["id", "payment-1"],
      ["updated_at", "2026-09-08T12:00:00.000Z"],
    ]));
  });

  it("does not remove a payment that changed while the screen was open", async () => {
    const { query } = deleteOne({ data: [], error: null });
    supabaseMocks.from.mockReturnValue(query);

    await expect(setCommitmentPaid({
      ...baseParams,
      paid: false,
      expectedPaymentId: "payment-1",
      expectedPaymentUpdatedAt: "2026-09-08T12:00:00.000Z",
    })).rejects.toThrow("mudou enquanto a tela estava aberta");
  });
});
