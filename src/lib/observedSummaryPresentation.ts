import { formatBRLFromCents } from "./format";
import type {
  FinancialObservedSummary,
  ObservedExpenseCategoryTotal,
  ObservedPeriodTotals,
} from "./financialObservedSummary";

export const OBSERVED_CATEGORY_LIMIT = 4;
export const OBSERVED_UNRESOLVED_CATEGORY_LABEL = "Categoria indisponível";
export const OBSERVED_UNCATEGORIZED_LABEL = "Sem categoria";

export const OBSERVED_SUMMARY_COPY = {
  heroTitle: "Seu mês até agora",
  heroInflow: "Entrou",
  heroOutflow: "Saiu",
  heroResult: "Resultado do mês",
  heroEmpty: "Você ainda não tem movimentações neste mês.",
  heroHistoryNote: "Há movimentações em meses anteriores.",
  addMovement: "Adicionar movimentação",
  comparisonTitle: "Comparado com o mês passado",
  comparisonEmpty: "Ainda não há histórico suficiente para comparar.",
  categoriesTitle: "Para onde foi",
  categoriesEmpty: "Nenhuma saída neste mês.",
  organizeCategories: "Organizar categorias",
} as const;

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export type ObservedAmountDelta = {
  currentCents: number;
  previousCents: number;
  deltaCents: number;
  /** Null when previous is 0 so the UI never shows NaN, Infinity or a fake 100%. */
  percent: number | null;
};

export type ObservedMonthHeroPresentation =
  | {
    kind: "empty";
    title: string;
    caption: string;
    message: string;
    historyNote: string | null;
  }
  | {
    kind: "ready";
    title: string;
    caption: string;
    inflowCents: number;
    outflowCents: number;
    netCents: number;
    resultLabel: string;
  };

export type ObservedComparisonPresentation =
  | {
    kind: "insufficient";
    title: string;
    caption: string;
    message: string;
  }
  | {
    kind: "ready";
    title: string;
    caption: string;
    inflow: ObservedAmountDelta;
    outflow: ObservedAmountDelta;
    net: ObservedAmountDelta;
  };

export type ObservedCategoryRow = {
  key: string;
  name: string;
  amountCents: number;
  percentageOfOutflows: number;
  uncategorized: boolean;
  unresolved: boolean;
};

export function civilDayNumber(referenceDate: string) {
  return Number(referenceDate.slice(8, 10));
}

export function observedMonthName(referenceDate: string) {
  return MONTHS_PT[Number(referenceDate.slice(5, 7)) - 1] ?? referenceDate;
}

export function observedPeriodCaption(referenceDate: string) {
  const day = civilDayNumber(referenceDate);
  return `De 1 a ${day} de ${observedMonthName(referenceDate)}`;
}

export function observedComparisonCaption(referenceDate: string) {
  return `Até o dia ${civilDayNumber(referenceDate)}`;
}

export function observedAmountDelta(currentCents: number, previousCents: number): ObservedAmountDelta {
  const current = integerCents(currentCents);
  const previous = integerCents(previousCents);
  const deltaCents = current - previous;
  if (previous === 0) {
    return { currentCents: current, previousCents: previous, deltaCents, percent: null };
  }
  const percent = (deltaCents * 100) / previous;
  return {
    currentCents: current,
    previousCents: previous,
    deltaCents,
    percent: Number.isFinite(percent) ? percent : null,
  };
}

export function formatObservedSignedCents(cents: number) {
  const amount = integerCents(cents);
  if (amount > 0) return `+${formatBRLFromCents(amount)}`;
  return formatBRLFromCents(amount);
}

export function formatObservedPercent(percent: number | null) {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function buildObservedMonthHero(summary: FinancialObservedSummary): ObservedMonthHeroPresentation {
  const caption = observedPeriodCaption(summary.referenceDate);
  if (summary.dataQuality.isCurrentPeriodEmpty) {
    return {
      kind: "empty",
      title: OBSERVED_SUMMARY_COPY.heroTitle,
      caption,
      message: OBSERVED_SUMMARY_COPY.heroEmpty,
      historyNote: summary.dataQuality.hasHistoricalData ? OBSERVED_SUMMARY_COPY.heroHistoryNote : null,
    };
  }
  return {
    kind: "ready",
    title: OBSERVED_SUMMARY_COPY.heroTitle,
    caption,
    inflowCents: summary.currentPeriod.inflowCents,
    outflowCents: summary.currentPeriod.outflowCents,
    netCents: summary.currentPeriod.netCents,
    resultLabel: OBSERVED_SUMMARY_COPY.heroResult,
  };
}

export function buildObservedComparison(summary: FinancialObservedSummary): ObservedComparisonPresentation {
  const caption = observedComparisonCaption(summary.referenceDate);
  if (!summary.dataQuality.hasPreviousComparableData) {
    return {
      kind: "insufficient",
      title: OBSERVED_SUMMARY_COPY.comparisonTitle,
      caption,
      message: OBSERVED_SUMMARY_COPY.comparisonEmpty,
    };
  }
  return {
    kind: "ready",
    title: OBSERVED_SUMMARY_COPY.comparisonTitle,
    caption,
    inflow: periodDelta(summary.currentPeriod, summary.previousComparablePeriod, "inflowCents"),
    outflow: periodDelta(summary.currentPeriod, summary.previousComparablePeriod, "outflowCents"),
    net: periodDelta(summary.currentPeriod, summary.previousComparablePeriod, "netCents"),
  };
}

export function observedCategoryLabel(
  category: Pick<ObservedExpenseCategoryTotal, "categoryId" | "categoryName">,
  knownCategoryIds?: ReadonlySet<string>,
) {
  if (knownCategoryIds && !knownCategoryIds.has(category.categoryId)) {
    return OBSERVED_UNRESOLVED_CATEGORY_LABEL;
  }
  const name = (category.categoryName || "").trim();
  if (!name || name === category.categoryId) return OBSERVED_UNRESOLVED_CATEGORY_LABEL;
  return name;
}

export function buildObservedCategoryRows(
  summary: FinancialObservedSummary,
  options?: {
    limit?: number;
    knownCategoryIds?: ReadonlySet<string>;
  },
): ObservedCategoryRow[] {
  if (summary.dataQuality.isCurrentPeriodEmpty || summary.currentPeriod.outflowCents <= 0) {
    return [];
  }

  const knownCategoryIds = options?.knownCategoryIds;
  const limit = Math.max(1, options?.limit ?? OBSERVED_CATEGORY_LIMIT);
  const named = summary.categories.map((category) => {
    const name = observedCategoryLabel(category, knownCategoryIds);
    return {
      key: category.categoryId,
      name,
      amountCents: category.amountCents,
      percentageOfOutflows: category.percentageOfOutflows,
      uncategorized: false,
      unresolved: name === OBSERVED_UNRESOLVED_CATEGORY_LABEL,
    };
  }).sort((left, right) => (
    right.amountCents - left.amountCents
    || left.key.localeCompare(right.key)
  ));

  const uncategorized = summary.uncategorized.amountCents > 0 || summary.uncategorized.transactionCount > 0
    ? {
      key: "uncategorized",
      name: OBSERVED_UNCATEGORIZED_LABEL,
      amountCents: summary.uncategorized.amountCents,
      percentageOfOutflows: summary.uncategorized.percentageOfOutflows,
      uncategorized: true,
      unresolved: false,
    } satisfies ObservedCategoryRow
    : null;

  const namedLimit = uncategorized ? Math.max(1, limit - 1) : limit;
  const rows = named.slice(0, namedLimit);
  if (uncategorized) rows.push(uncategorized);
  return rows;
}

function periodDelta(
  current: ObservedPeriodTotals,
  previous: ObservedPeriodTotals,
  field: "inflowCents" | "outflowCents" | "netCents",
) {
  return observedAmountDelta(current[field], previous[field]);
}

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}
