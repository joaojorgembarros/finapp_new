import { describe, expect, it, vi } from "vitest";
import {
  buildFinancialKnownCashPosition,
  loadFinancialKnownCashPosition,
  type KnownCashSnapshotInput,
} from "./financialCashPosition";

const from = vi.fn();

vi.mock("./supabase", () => ({
  supabase: { from: (...args: unknown[]) => from(...args) },
}));

function snap(
  partial: Partial<KnownCashSnapshotInput> & Pick<KnownCashSnapshotInput, "id" | "bankId">,
): KnownCashSnapshotInput {
  return {
    finalBalanceCents: 100,
    balanceConfidence: "confirmed",
    periodEnd: "2026-10-08",
    createdAt: "2026-10-08T12:00:00Z",
    ...partial,
  };
}

describe("buildFinancialKnownCashPosition", () => {
  it("uses one confirmed snapshot for one bank", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [
        snap({
          id: "mp-oct",
          bankId: "mercado-pago",
          finalBalanceCents: 1_327_993,
          periodEnd: "2026-10-08",
        }),
      ],
    });

    expect(position.knownCashCents).toBe(1_327_993);
    expect(position.asOfDate).toBe("2026-10-08");
    expect(position.accounts).toEqual([
      expect.objectContaining({
        bankId: "mercado-pago",
        importId: "mp-oct",
        knownCashCents: 1_327_993,
        asOfDate: "2026-10-08",
        confidence: "confirmed",
      }),
    ]);
    expect(position.dataQuality).toMatchObject({
      hasSnapshot: true,
      isStale: false,
      datesDiffer: false,
      sameBankRisk: false,
    });
  });

  it("keeps only the latest period_end when the same bank has several months", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [
        snap({ id: "aug", bankId: "mercado-pago", finalBalanceCents: 800_000, periodEnd: "2026-08-31", createdAt: "2026-10-09T00:00:00Z" }),
        snap({ id: "sep", bankId: "mercado-pago", finalBalanceCents: 900_000, periodEnd: "2026-09-30", createdAt: "2026-10-09T00:00:00Z" }),
        snap({ id: "oct", bankId: "mercado-pago", finalBalanceCents: 1_327_993, periodEnd: "2026-10-08", createdAt: "2026-09-01T00:00:00Z" }),
      ],
    });

    expect(position.knownCashCents).toBe(1_327_993);
    expect(position.accounts.map((account) => account.importId)).toEqual(["oct"]);
  });

  it("sums the latest snapshot of each bank", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [
        snap({ id: "mp-old", bankId: "mercado-pago", finalBalanceCents: 100, periodEnd: "2026-09-30" }),
        snap({ id: "mp", bankId: "mercado-pago", finalBalanceCents: 1_327_993, periodEnd: "2026-10-08" }),
        snap({ id: "nu-old", bankId: "nubank", finalBalanceCents: 50, periodEnd: "2026-08-31" }),
        snap({ id: "nu", bankId: "nubank", finalBalanceCents: 250_000, periodEnd: "2026-10-08", balanceConfidence: "derived" }),
      ],
    });

    expect(position.knownCashCents).toBe(1_577_993);
    expect(position.accounts.map((account) => [account.bankId, account.knownCashCents])).toEqual([
      ["mercado-pago", 1_327_993],
      ["nubank", 250_000],
    ]);
    expect(position.dataQuality.sameBankRisk).toBe(true);
    expect(position.dataQuality.sameBankIds).toEqual(["nubank"]);
  });

  it("ignores unavailable confidence and a null final balance", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [
        snap({ id: "unavailable", bankId: "inter", balanceConfidence: "unavailable", finalBalanceCents: 9_999_999 }),
        snap({ id: "null-balance", bankId: "itau", balanceConfidence: "confirmed", finalBalanceCents: null }),
        snap({ id: "kept", bankId: "mercado-pago", finalBalanceCents: 1_327_993 }),
      ],
    });

    expect(position.knownCashCents).toBe(1_327_993);
    expect(position.dataQuality.ignoredSnapshotCount).toBe(2);
    expect(position.dataQuality.missingBankIds).toEqual(["inter", "itau"]);
  });

  it("breaks a period_end tie with the newer created_at", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [
        snap({ id: "older", bankId: "mercado-pago", finalBalanceCents: 100, periodEnd: "2026-10-08", createdAt: "2026-10-08T08:00:00Z" }),
        snap({ id: "newer", bankId: "mercado-pago", finalBalanceCents: 1_327_993, periodEnd: "2026-10-08", createdAt: "2026-10-08T18:00:00Z" }),
      ],
    });

    expect(position.accounts.map((account) => account.importId)).toEqual(["newer"]);
    expect(position.knownCashCents).toBe(1_327_993);
  });

  it("returns null instead of zero when there is no usable snapshot", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [],
    });
    const onlyIgnored = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [snap({ id: "bad", bankId: "inter", balanceConfidence: "unavailable", finalBalanceCents: 0 })],
    });

    expect(position.knownCashCents).toBeNull();
    expect(position.asOfDate).toBeNull();
    expect(position.dataQuality.hasSnapshot).toBe(false);
    expect(onlyIgnored.knownCashCents).toBeNull();
    expect(onlyIgnored.knownCashCents).not.toBe(0);
  });

  it("preserves a real zero and a negative statement balance", () => {
    const zero = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [snap({ id: "zero", bankId: "inter", finalBalanceCents: 0 })],
    });
    const negative = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [snap({ id: "neg", bankId: "inter", finalBalanceCents: -42_000 })],
    });

    expect(zero.knownCashCents).toBe(0);
    expect(zero.dataQuality.hasSnapshot).toBe(true);
    expect(negative.knownCashCents).toBe(-42_000);
  });

  it("keeps each account date when statement closes differ", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [
        snap({ id: "mp", bankId: "mercado-pago", finalBalanceCents: 1_000, periodEnd: "2026-10-08" }),
        snap({ id: "inter", bankId: "inter", finalBalanceCents: 2_000, periodEnd: "2026-09-30" }),
      ],
    });

    expect(position.asOfDate).toBe("2026-10-08");
    expect(position.knownCashCents).toBe(3_000);
    expect(position.dataQuality.datesDiffer).toBe(true);
    expect(position.accounts.map((account) => [account.bankId, account.asOfDate])).toEqual([
      ["inter", "2026-09-30"],
      ["mercado-pago", "2026-10-08"],
    ]);
  });

  it("marks a snapshot from before the reference month as stale", () => {
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [snap({ id: "sep", bankId: "inter", finalBalanceCents: 500, periodEnd: "2026-09-30" })],
    });

    expect(position.asOfDate).toBe("2026-09-30");
    expect(position.dataQuality.isStale).toBe(true);
  });

  it("signals same-bank risk for the shared Nubank id and for distinct account keys", () => {
    const nubank = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [snap({ id: "nu", bankId: "nubank", finalBalanceCents: 250_000 })],
    });
    const collided = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [
        snap({ id: "a", bankId: "inter", accountKey: "pf", finalBalanceCents: 100, periodEnd: "2026-10-08" }),
        snap({ id: "b", bankId: "inter", accountKey: "pj", finalBalanceCents: 900, periodEnd: "2026-09-30" }),
      ],
    });
    const single = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [snap({ id: "one", bankId: "inter", finalBalanceCents: 100 })],
    });

    expect(nubank.dataQuality.sameBankRisk).toBe(true);
    expect(nubank.dataQuality.sameBankIds).toEqual(["nubank"]);
    expect(collided.knownCashCents).toBe(100);
    expect(collided.dataQuality.sameBankRisk).toBe(true);
    expect(collided.dataQuality.sameBankIds).toEqual(["inter"]);
    expect(single.dataQuality.sameBankRisk).toBe(false);
  });

  it("does not use historical result, income, reserve, commitments or goals", () => {
    const historicalNetCents = 1_207_993;
    const unrelated = {
      incomeFixedCents: 500_000,
      reserveCents: 200_000,
      goalContributionsCents: 100_000,
      pendingCommitmentsCents: 300_000,
    };
    const position = buildFinancialKnownCashPosition({
      referenceDate: "2026-10-08",
      snapshots: [snap({ id: "mp", bankId: "mercado-pago", finalBalanceCents: 1_327_993 })],
    });

    expect(position.knownCashCents).toBe(1_327_993);
    expect(position.knownCashCents).not.toBe(historicalNetCents);
    expect(position.knownCashCents).not.toBe(
      unrelated.incomeFixedCents - unrelated.reserveCents - unrelated.goalContributionsCents - unrelated.pendingCommitmentsCents,
    );
  });
});

describe("loadFinancialKnownCashPosition", () => {
  it("pages statement imports and does not read transactions or planning tables", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: `import-${index}`,
      bank_id: index === 0 ? "mercado-pago" : "inter",
      final_balance_cents: index === 0 ? 1_327_993 : 10,
      balance_confidence: "confirmed",
      period_start: "2026-10-01",
      period_end: index === 0 ? "2026-10-08" : "2026-09-01",
      created_at: "2026-10-08T12:00:00Z",
    }));
    const ranges: [number, number][] = [];
    from.mockImplementation((table: string) => {
      expect(table).toBe("statement_imports");
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: async (start: number, end: number) => {
          ranges.push([start, end]);
          return { data: rows.slice(start, end + 1), error: null };
        },
      };
      return query;
    });

    const position = await loadFinancialKnownCashPosition({
      householdId: "house-1",
      referenceDate: "2026-10-08",
    });

    expect(ranges).toEqual([[0, 499], [500, 999]]);
    expect(from).not.toHaveBeenCalledWith("transactions");
    expect(from).not.toHaveBeenCalledWith("goals");
    expect(from).not.toHaveBeenCalledWith("financial_commitments");
    expect(from).not.toHaveBeenCalledWith("profiles");
    expect(position.knownCashCents).toBe(1_327_993 + 10);
  });
});
