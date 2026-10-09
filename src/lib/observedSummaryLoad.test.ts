import { describe, expect, it, vi } from "vitest";
import { buildObservedCategoryRows, OBSERVED_UNCATEGORIZED_LABEL, OBSERVED_UNRESOLVED_CATEGORY_LABEL } from "./observedSummaryPresentation";
import { loadObservedSummaryForUi } from "./observedSummaryLoad";
import type { ObservedSummaryTransaction } from "./financialObservedSummary";

vi.mock("./supabase", () => ({
  supabase: { from: () => ({}) },
}));

function tx(
  partial: Partial<ObservedSummaryTransaction> & Pick<ObservedSummaryTransaction, "id" | "occurredOn" | "amountCents">,
): ObservedSummaryTransaction {
  return {
    type: "expense",
    categoryId: null,
    accountId: "nubank",
    ignoredAt: null,
    transferGroupId: null,
    statementImportId: null,
    ...partial,
  };
}

const referenceDate = "2026-10-06";
const transactions: ObservedSummaryTransaction[] = [
  tx({ id: "in", type: "income", occurredOn: "2026-10-01", amountCents: 480000 }),
  tx({ id: "food", occurredOn: "2026-10-03", amountCents: 50000, categoryId: "food" }),
  tx({ id: "blank", occurredOn: "2026-10-04", amountCents: 10000, categoryId: null }),
];

describe("loadObservedSummaryForUi isolation", () => {
  it("builds a normal summary when transactions and categories succeed", async () => {
    const result = await loadObservedSummaryForUi({
      referenceDate,
      loadTransactions: async () => transactions,
      loadCategories: async () => [{ id: "food", name: "Alimentação" }],
    });

    expect(result.categoriesUnavailable).toBe(false);
    expect(result.summary.currentPeriod).toMatchObject({
      inflowCents: 480000,
      outflowCents: 60000,
      netCents: 420000,
      transactionCount: 3,
    });
    expect(buildObservedCategoryRows(result.summary, {
      knownCategoryIds: new Set(result.knownCategoryIds),
    }).map((row) => row.name)).toEqual(["Alimentação", OBSERVED_UNCATEGORIZED_LABEL]);
  });

  it("propagates a transaction load failure as the observed error", async () => {
    await expect(loadObservedSummaryForUi({
      referenceDate,
      loadTransactions: async () => {
        throw new Error("transactions down");
      },
      loadCategories: async () => [{ id: "food", name: "Alimentação" }],
    })).rejects.toThrow("transactions down");
  });

  it("keeps the observed summary when the category catalog fails", async () => {
    const result = await loadObservedSummaryForUi({
      referenceDate,
      loadTransactions: async () => transactions,
      loadCategories: async () => {
        throw new Error("categories down");
      },
    });

    expect(result.categoriesUnavailable).toBe(true);
    expect(result.knownCategoryIds).toEqual([]);
    expect(result.summary.currentPeriod).toMatchObject({
      inflowCents: 480000,
      outflowCents: 60000,
      netCents: 420000,
      transactionCount: 3,
    });
  });

  it("does not treat a named expense as Sem categoria when the catalog fails", async () => {
    const result = await loadObservedSummaryForUi({
      referenceDate,
      loadTransactions: async () => transactions,
      loadCategories: async () => {
        throw new Error("categories down");
      },
    });

    expect(result.summary.uncategorized.amountCents).toBe(10000);
    expect(result.summary.categories).toEqual([
      expect.objectContaining({ categoryId: "food", amountCents: 50000 }),
    ]);
    const rows = buildObservedCategoryRows(result.summary, {
      knownCategoryIds: new Set(result.knownCategoryIds),
    });
    expect(rows).toEqual([
      expect.objectContaining({
        name: OBSERVED_UNRESOLVED_CATEGORY_LABEL,
        amountCents: 50000,
        uncategorized: false,
        unresolved: true,
      }),
      expect.objectContaining({
        name: OBSERVED_UNCATEGORIZED_LABEL,
        amountCents: 10000,
        uncategorized: true,
      }),
    ]);
  });

  it("keeps Entrou / Saiu / Resultado identical with or without the catalog", async () => {
    const withCatalog = await loadObservedSummaryForUi({
      referenceDate,
      loadTransactions: async () => transactions,
      loadCategories: async () => [{ id: "food", name: "Alimentação" }],
    });
    const withoutCatalog = await loadObservedSummaryForUi({
      referenceDate,
      loadTransactions: async () => transactions,
      loadCategories: async () => {
        throw new Error("categories down");
      },
    });

    expect(withoutCatalog.summary.currentPeriod).toEqual(withCatalog.summary.currentPeriod);
    expect(withoutCatalog.summary.previousComparablePeriod).toEqual(withCatalog.summary.previousComparablePeriod);
  });

  it("keeps the observed load isolated when planning fails in parallel", async () => {
    const loadPlanning = vi.fn(async () => {
      throw new Error("overview down");
    });
    const observed = loadObservedSummaryForUi({
      referenceDate,
      loadTransactions: async () => transactions,
      loadCategories: async () => [{ id: "food", name: "Alimentação" }],
    });
    const settled = await Promise.allSettled([loadPlanning(), observed]);

    expect(settled[0]).toMatchObject({ status: "rejected" });
    expect(settled[1]).toMatchObject({
      status: "fulfilled",
      value: {
        summary: expect.objectContaining({
          currentPeriod: expect.objectContaining({
            inflowCents: 480000,
            outflowCents: 60000,
            netCents: 420000,
          }),
        }),
      },
    });
    expect(loadPlanning).toHaveBeenCalledTimes(1);
  });
});
