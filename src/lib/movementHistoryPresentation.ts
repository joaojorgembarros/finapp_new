export const ADD_MOVEMENT_HREF = "/(app)/new-transaction" as const;
export const IMPORT_STATEMENT_HREF = "/(app)/import-csv" as const;
export const MANAGE_IMPORTS_HREF = "/(app)/import-history" as const;

export const MOVEMENT_FLOW_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "income", label: "Entradas" },
  { id: "expense", label: "Gastos" },
] as const;

export type MovementFlowFilter = (typeof MOVEMENT_FLOW_FILTERS)[number]["id"];

export type MovementListFilters = {
  search: string;
  flow: MovementFlowFilter;
  month: string;
  account: string;
};

export const CLEARED_MOVEMENT_LIST_FILTERS: MovementListFilters = {
  search: "",
  flow: "all",
  month: "all",
  account: "all",
};

export function hasFinancialHistory(transactions: readonly unknown[]) {
  return transactions.length > 0;
}

export function shouldShowAccountFilter(accountIds: readonly string[]) {
  return new Set(accountIds.filter(Boolean)).size > 1;
}

export function hasActiveMovementListFilters(filters: MovementListFilters) {
  return filters.search.trim() !== ""
    || filters.flow !== "all"
    || filters.month !== "all"
    || filters.account !== "all";
}

export function resolveAccountFilter(
  selectedAccount: string,
  accountIds: readonly string[],
) {
  return shouldShowAccountFilter(accountIds) ? selectedAccount : "all";
}

export function movementMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
