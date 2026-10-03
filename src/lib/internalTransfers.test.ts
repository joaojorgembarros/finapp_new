import { describe, expect, it } from "vitest";
import {
  buildManualInternalTransfer,
  filterMovementsForList,
  filterMovementsForTotals,
  findInternalTransferCounterparts,
  INTERNAL_TRANSFER_ERRORS,
  periodBalanceCaption,
  periodBalanceDetail,
  summarizeMovementTotals,
  unlinkInternalTransferLegs,
  validateInternalTransferLink,
  withSaveGate,
  type InternalTransferLeg,
} from "./internalTransfers";

const GROUP_ID = "11111111-1111-1111-1111-111111111111";
const HOUSEHOLD_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function leg(overrides: Partial<InternalTransferLeg> & Pick<InternalTransferLeg, "id" | "type" | "account_id">): InternalTransferLeg {
  return {
    household_id: HOUSEHOLD_ID,
    amount_cents: 100_000,
    ignored_at: null,
    transfer_group_id: null,
    linked_to_commitment: false,
    ...overrides,
  };
}

describe("manual internal transfer", () => {
  it("builds two linked legs with matching group, accounts, amount and opposite types", () => {
    const result = buildManualInternalTransfer({
      transferGroupId: GROUP_ID,
      fromAccountId: "nubank",
      toAccountId: "inter",
      amountCents: 100_000,
      occurredOn: "2026-10-01",
      note: "PIX entre contas",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.transferGroupId).toBe(GROUP_ID);
    expect(result.legs).toEqual([
      {
        type: "expense",
        amount_cents: 100_000,
        account_id: "nubank",
        note: "PIX entre contas",
        occurred_on: "2026-10-01",
      },
      {
        type: "income",
        amount_cents: 100_000,
        account_id: "inter",
        note: "PIX entre contas",
        occurred_on: "2026-10-01",
      },
    ]);
  });

  it("rejects the same origin and destination account", () => {
    expect(buildManualInternalTransfer({
      transferGroupId: GROUP_ID,
      fromAccountId: "nubank",
      toAccountId: "nubank",
      amountCents: 100_000,
      occurredOn: "2026-10-01",
    })).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.sameAccount });
  });
});

describe("movement totals with internal transfers", () => {
  const salary = {
    type: "income" as const,
    amount_cents: 400_000,
    transfer_group_id: null,
    account_id: "nubank",
  };
  const grocery = {
    type: "expense" as const,
    amount_cents: 50_000,
    transfer_group_id: null,
    account_id: "nubank",
  };
  const nubankOut = {
    type: "expense" as const,
    amount_cents: 100_000,
    transfer_group_id: GROUP_ID,
    account_id: "nubank",
  };
  const interIn = {
    type: "income" as const,
    amount_cents: 100_000,
    transfer_group_id: GROUP_ID,
    account_id: "inter",
  };

  it("keeps consolidated income and expense uninflated and nets to zero for the transfer", () => {
    const onlyTransfer = summarizeMovementTotals([nubankOut, interIn]);
    expect(onlyTransfer).toEqual({ income: 0, expense: 0, periodBalance: 0 });

    const withOrdinary = summarizeMovementTotals([salary, grocery, nubankOut, interIn]);
    expect(withOrdinary).toEqual({
      income: 400_000,
      expense: 50_000,
      periodBalance: 350_000,
    });
  });

  it("counts the visible leg when a single account is selected", () => {
    const rows = [salary, grocery, nubankOut, interIn];
    expect(summarizeMovementTotals(rows, { accountId: "nubank" })).toEqual({
      income: 400_000,
      expense: 150_000,
      periodBalance: 250_000,
    });
    expect(summarizeMovementTotals(rows, { accountId: "inter" })).toEqual({
      income: 100_000,
      expense: 0,
      periodBalance: 100_000,
    });
  });

  it("keeps an unlinked CSV movement as ordinary income or expense", () => {
    const isolatedPixOut = {
      type: "expense" as const,
      amount_cents: 100_000,
      transfer_group_id: null,
      account_id: "nubank",
    };
    expect(summarizeMovementTotals([isolatedPixOut])).toEqual({
      income: 0,
      expense: 100_000,
      periodBalance: -100_000,
    });
  });

  it("restores ordinary totals after unlinking", () => {
    const linked = [nubankOut, interIn, grocery];
    expect(summarizeMovementTotals(linked).periodBalance).toBe(-50_000);

    const unlinked = unlinkInternalTransferLegs(linked, GROUP_ID);
    expect(summarizeMovementTotals(unlinked)).toEqual({
      income: 100_000,
      expense: 150_000,
      periodBalance: -50_000,
    });
  });
});

describe("linking existing movements", () => {
  const nubankOut = leg({ id: "tx-out", type: "expense", account_id: "nubank" });
  const interIn = leg({ id: "tx-in", type: "income", account_id: "inter" });

  it("accepts two opposite visible movements of equal value in different accounts", () => {
    expect(validateInternalTransferLink(nubankOut, interIn)).toEqual({ ok: true });
  });

  it("rejects invalid pairs", () => {
    expect(validateInternalTransferLink(nubankOut, nubankOut)).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.sameTransaction });
    expect(validateInternalTransferLink(nubankOut, { ...interIn, household_id: "other" })).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.household });
    expect(validateInternalTransferLink(nubankOut, { ...interIn, ignored_at: "2026-10-01T12:00:00Z" })).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.ignored });
    expect(validateInternalTransferLink({ ...nubankOut, transfer_group_id: GROUP_ID }, interIn)).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.alreadyLinked });
    expect(validateInternalTransferLink({ ...nubankOut, linked_to_commitment: true }, interIn)).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.commitment });
    expect(validateInternalTransferLink(nubankOut, { ...interIn, amount_cents: 90_000 })).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.amount });
    expect(validateInternalTransferLink(nubankOut, { ...interIn, type: "expense" })).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.type });
    expect(validateInternalTransferLink(nubankOut, { ...interIn, account_id: "nubank" })).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.sameAccount });
    expect(validateInternalTransferLink(nubankOut, { ...interIn, account_id: null })).toEqual({ ok: false, message: INTERNAL_TRANSFER_ERRORS.accountMissing });
  });

  it("lists only valid counterparts and refuses commitment or already linked rows", () => {
    const counterparts = findInternalTransferCounterparts(nubankOut, [
      interIn,
      { ...interIn, id: "wrong-amount", amount_cents: 90_000 },
      { ...interIn, id: "same-account", account_id: "nubank" },
      { ...interIn, id: "linked", transfer_group_id: GROUP_ID },
      { ...interIn, id: "paid", linked_to_commitment: true },
    ]);
    expect(counterparts.map((item) => item.id)).toEqual(["tx-in"]);
  });
});

describe("period totals and list filters", () => {
  const GROUP = "transfer-1";
  const salary = { id: "salary", type: "income" as const, amount_cents: 300_000, account_id: "nubank", occurred_on: "2026-10-05", transfer_group_id: null, note: "Salário" };
  const grocery = { id: "grocery", type: "expense" as const, amount_cents: 50_000, account_id: "nubank", occurred_on: "2026-10-08", transfer_group_id: null, note: "Mercado" };
  const nubankOut = { id: "out", type: "expense" as const, amount_cents: 100_000, account_id: "nubank", occurred_on: "2026-10-01", transfer_group_id: GROUP, note: "PIX enviado" };
  const interIn = { id: "in", type: "income" as const, amount_cents: 100_000, account_id: "inter", occurred_on: "2026-10-01", transfer_group_id: GROUP, note: "PIX recebido" };
  const rows = [salary, grocery, nubankOut, interIn];

  it("keeps consolidated entries, exits and period balance uninflated", () => {
    expect(summarizeMovementTotals(rows)).toEqual({
      income: 300_000,
      expense: 50_000,
      periodBalance: 250_000,
    });
    expect(summarizeMovementTotals(rows, { accountId: "nubank" })).toEqual({
      income: 300_000,
      expense: 150_000,
      periodBalance: 150_000,
    });
    expect(summarizeMovementTotals(rows, { accountId: "inter" })).toEqual({
      income: 100_000,
      expense: 0,
      periodBalance: 100_000,
    });
  });

  it("lets the Gastos list filter hide expenses without changing the period balance", () => {
    const totalsRows = filterMovementsForTotals(rows, { month: "2026-10", account: "all" });
    const listRows = filterMovementsForList(rows, { month: "2026-10", account: "all", flow: "expense" });
    expect(summarizeMovementTotals(totalsRows)).toEqual({
      income: 300_000,
      expense: 50_000,
      periodBalance: 250_000,
    });
    expect(listRows.map((row) => row.id).sort()).toEqual(["grocery", "out"]);
  });

  it("keeps search on the list without changing period totals", () => {
    const totalsRows = filterMovementsForTotals(rows, { month: "2026-10", search: "mercado" });
    const listRows = filterMovementsForList(rows, { month: "2026-10", search: "mercado" });
    expect(summarizeMovementTotals(totalsRows).periodBalance).toBe(250_000);
    expect(listRows.map((row) => row.id)).toEqual(["grocery"]);
  });

  it("uses account-specific copy for the period balance hint", () => {
    expect(periodBalanceCaption("all")).toContain("Entradas menos saídas");
    expect(periodBalanceCaption("nubank")).toContain("desta conta");
  });

  it("labels every date or the selected month without changing a negative period result", () => {
    const totals = summarizeMovementTotals([
      { type: "income", amount_cents: 450_000, account_id: "inter", transfer_group_id: null },
      { type: "expense", amount_cents: 490_000, account_id: "bradesco", transfer_group_id: null },
    ]);
    expect(totals).toEqual({ income: 450_000, expense: 490_000, periodBalance: -40_000 });
    expect(totals.periodBalance).toBe(totals.income - totals.expense);
    expect(periodBalanceDetail("all")).toBe("Entradas − saídas • Todas as datas");
    expect(periodBalanceDetail("2026-09")).toBe("Entradas − saídas • 01/09/2026 a 30/09/2026");
  });
});

describe("save gate", () => {
  it("blocks a second submit while the first is in flight", async () => {
    const gate = { current: false };
    let started = 0;
    let finished = 0;
    const run = () => withSaveGate(gate, async () => {
      started += 1;
      await Promise.resolve();
      finished += 1;
      return started;
    });

    const first = run();
    const second = await run();
    await first;

    expect(second).toBe("blocked");
    expect(started).toBe(1);
    expect(finished).toBe(1);
  });
});
