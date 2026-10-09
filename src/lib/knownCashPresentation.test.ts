import { describe, expect, it } from "vitest";
import type { FinancialKnownCashPosition, KnownCashAccount } from "./financialCashPosition";
import {
  KNOWN_CASH_COPY,
  buildKnownCashCard,
  formatKnownCashDay,
} from "./knownCashPresentation";

function account(
  partial: Partial<KnownCashAccount> & Pick<KnownCashAccount, "bankId" | "asOfDate" | "knownCashCents">,
): KnownCashAccount {
  return {
    importId: partial.bankId,
    confidence: "confirmed",
    ...partial,
  };
}

function position(partial: {
  accounts: KnownCashAccount[];
  dataQuality?: Partial<FinancialKnownCashPosition["dataQuality"]>;
}): FinancialKnownCashPosition {
  const accounts = partial.accounts;
  const dates = [...new Set(accounts.map((item) => item.asOfDate))].sort();
  const knownCashCents = accounts.length
    ? accounts.reduce((total, item) => total + item.knownCashCents, 0)
    : null;
  return {
    referenceDate: "2026-10-08",
    knownCashCents,
    asOfDate: dates.length ? dates[dates.length - 1] : null,
    accounts,
    dataQuality: {
      hasSnapshot: accounts.length > 0,
      isStale: false,
      datesDiffer: dates.length > 1,
      sameBankRisk: false,
      sameBankIds: [],
      missingBankIds: [],
      ignoredSnapshotCount: 0,
      ...partial.dataQuality,
    },
  };
}

describe("known cash presentation", () => {
  it("shows the statement date and never calls the amount available money", () => {
    const card = buildKnownCashCard({
      status: "ready",
      position: position({
        accounts: [account({ bankId: "mercado-pago", asOfDate: "2026-10-08", knownCashCents: 1_327_993 })],
      }),
    });
    const copy = JSON.stringify({ ...KNOWN_CASH_COPY, card }).toLowerCase();

    expect(card).toMatchObject({
      kind: "ready",
      title: "Saldo conhecido",
      amountCents: 1_327_993,
      caption: "Em 08/10",
      notes: [],
    });
    expect(formatKnownCashDay("2026-10-08")).toBe("08/10");
    expect(copy.replaceAll("indisponível", "")).not.toMatch(/disponível|dinheiro livre|sem destino|pode guardar|pode distribuir|saldo atual/);
  });

  it("explains a missing snapshot without using zero", () => {
    const card = buildKnownCashCard({
      status: "ready",
      position: position({ accounts: [] }),
    });

    expect(card).toEqual({
      kind: "unavailable",
      title: KNOWN_CASH_COPY.unavailableTitle,
      detail: KNOWN_CASH_COPY.unavailableDetail,
    });
  });

  it("labels a stale close by its statement date", () => {
    const card = buildKnownCashCard({
      status: "ready",
      position: position({
        accounts: [account({ bankId: "inter", asOfDate: "2026-09-30", knownCashCents: 500 })],
        dataQuality: { isStale: true },
      }),
    });

    expect(card).toMatchObject({
      kind: "ready",
      caption: "Em 30/09",
      notes: [KNOWN_CASH_COPY.staleNote],
    });
  });

  it("does not pretend different account dates are one close", () => {
    const card = buildKnownCashCard({
      status: "ready",
      position: position({
        accounts: [
          account({ bankId: "mercado-pago", asOfDate: "2026-10-08", knownCashCents: 1_000 }),
          account({ bankId: "inter", asOfDate: "2026-09-30", knownCashCents: 2_000 }),
        ],
      }),
    });

    expect(card).toMatchObject({
      kind: "ready",
      amountCents: 3_000,
      caption: "Dados mais recentes até 08/10",
    });
    if (card.kind === "ready") {
      expect(card.notes).toContain(KNOWN_CASH_COPY.mixedDatesNote);
    }
  });

  it("warns when a selected bank can hide another account", () => {
    const card = buildKnownCashCard({
      status: "ready",
      position: position({
        accounts: [account({ bankId: "nubank", asOfDate: "2026-10-08", knownCashCents: 250_000 })],
        dataQuality: { sameBankRisk: true, sameBankIds: ["nubank"] },
      }),
    });

    expect(card.kind).toBe("ready");
    if (card.kind === "ready") expect(card.notes).toContain(KNOWN_CASH_COPY.sameBankNote);
  });

  it("keeps a cash failure local", () => {
    const card = buildKnownCashCard({ status: "error", position: null });

    expect(card).toMatchObject({
      kind: "error",
      title: "Saldo conhecido",
      message: KNOWN_CASH_COPY.errorMessage,
    });
  });
});
