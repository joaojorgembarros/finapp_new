import { describe, expect, it, vi } from "vitest";

import { SupabasePolpRepository } from "./repository";
import { buildConnectionRow } from "./test-doubles";
import {
  ACCOUNT_ID,
  accountTransactionFixture,
  CONNECTION_ID,
  CONSENT_ID,
  HOUSEHOLD_ID,
  SYNC_RUN_ID,
  USER_ID,
} from "./test-fixtures";
import { normalizePolpTransaction } from "./normalizers";

describe("SupabasePolpRepository security contract", () => {
  it("filters connection ownership by id + household + provider=polp", async () => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      }),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const admin = { from: vi.fn(() => builder) };
    const repository = new SupabasePolpRepository(admin as never);

    await expect(repository.getConnection(HOUSEHOLD_ID, CONNECTION_ID)).resolves.toBeNull();
    expect(admin.from).toHaveBeenCalledWith("bank_connections");
    expect(filters).toEqual([
      ["id", CONNECTION_ID],
      ["household_id", HOUSEHOLD_ID],
      ["provider", "polp"],
    ]);
  });

  it("calls only import_open_finance_transaction with fixed provider and JWT actor", async () => {
    const rpc = vi.fn(async () => ({
      data: [{
        imported_bank_transaction_id: "b10e8400-e29b-41d4-a716-446655440001",
        transaction_id: "b20e8400-e29b-41d4-a716-446655440002",
        inserted: true,
        content_changed: false,
      }],
      error: null,
    }));
    const from = vi.fn(() => {
      throw new Error("direct table access is forbidden in importTransaction");
    });
    const repository = new SupabasePolpRepository({ rpc, from } as never);
    const connection = buildConnectionRow("account");
    const transaction = normalizePolpTransaction({
      value: accountTransactionFixture,
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    });

    await expect(repository.importTransaction({
      connection,
      syncRunId: SYNC_RUN_ID,
      userId: USER_ID,
      transaction,
    })).resolves.toEqual({
      importedBankTransactionId: "b10e8400-e29b-41d4-a716-446655440001",
      transactionId: "b20e8400-e29b-41d4-a716-446655440002",
      inserted: true,
      contentChanged: false,
    });
    expect(rpc).toHaveBeenCalledWith("import_open_finance_transaction", {
      p_provider: "polp",
      p_connection_id: CONNECTION_ID,
      p_household_id: HOUSEHOLD_ID,
      p_created_by: USER_ID,
      p_external_account_id: ACCOUNT_ID,
      p_external_transaction_id: accountTransactionFixture.id,
      p_occurred_on: "2026-08-15",
      p_description: "PIX SUPERMERCADO EXEMPLO",
      p_amount_cents: 12345,
      p_direction: "expense",
      p_sync_run_id: SYNC_RUN_ID,
      p_posted_at: "2026-08-15T13:45:30.000Z",
      p_raw_payload: transaction.rawPayload,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    [{ inserted: false, content_changed: false }, false, false],
    [{ inserted: false, content_changed: true }, false, true],
  ])("parses duplicate/content_changed RPC results", async (flags, inserted, changed) => {
    const repository = new SupabasePolpRepository({
      rpc: vi.fn(async () => ({
        data: [{
          imported_bank_transaction_id: "b10e8400-e29b-41d4-a716-446655440001",
          transaction_id: "b20e8400-e29b-41d4-a716-446655440002",
          ...flags,
        }],
        error: null,
      })),
    } as never);
    const connection = buildConnectionRow("account");
    const transaction = normalizePolpTransaction({
      value: accountTransactionFixture,
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    });
    await expect(repository.importTransaction({
      connection,
      syncRunId: SYNC_RUN_ID,
      userId: USER_ID,
      transaction,
    })).resolves.toEqual(expect.objectContaining({
      inserted,
      contentChanged: changed,
    }));
  });

  it("raises on RPC error without attempting a fallback", async () => {
    const from = vi.fn();
    const repository = new SupabasePolpRepository({
      rpc: vi.fn(async () => ({ data: null, error: { message: "forced RPC failure" } })),
      from,
    } as never);
    const connection = buildConnectionRow("account");
    const transaction = normalizePolpTransaction({
      value: accountTransactionFixture,
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    });

    await expect(repository.importTransaction({
      connection,
      syncRunId: SYNC_RUN_ID,
      userId: USER_ID,
      transaction,
    })).rejects.toThrow(/importação atômica/);
    expect(from).not.toHaveBeenCalled();
  });
});
