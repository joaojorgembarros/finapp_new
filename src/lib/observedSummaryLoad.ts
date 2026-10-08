import {
  buildFinancialObservedSummary,
  type FinancialObservedSummary,
  type ObservedSummaryCategory,
  type ObservedSummaryTransaction,
} from "./financialObservedSummary";

export type ObservedSummaryUiLoad = {
  summary: FinancialObservedSummary;
  knownCategoryIds: string[];
  categoriesUnavailable: boolean;
};

export async function loadObservedSummaryForUi(input: {
  referenceDate: string;
  loadTransactions: () => Promise<ObservedSummaryTransaction[]>;
  loadCategories: () => Promise<ObservedSummaryCategory[]>;
}): Promise<ObservedSummaryUiLoad> {
  const transactions = await input.loadTransactions();
  const categories = await loadOptionalObservedCategories(input.loadCategories);
  return {
    summary: buildFinancialObservedSummary({
      transactions,
      categories: categories.items,
      referenceDate: input.referenceDate,
    }),
    knownCategoryIds: categories.items.map((category) => category.id),
    categoriesUnavailable: categories.unavailable,
  };
}

async function loadOptionalObservedCategories(
  loadCategories: () => Promise<ObservedSummaryCategory[]>,
) {
  try {
    return { items: await loadCategories(), unavailable: false };
  } catch {
    return { items: [] as ObservedSummaryCategory[], unavailable: true };
  }
}
