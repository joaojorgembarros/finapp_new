import { describe, expect, it } from "vitest";
import { filterMovementsForList } from "./internalTransfers";
import {
  ADD_MOVEMENT_HREF,
  CLEARED_MOVEMENT_LIST_FILTERS,
  hasActiveMovementListFilters,
  hasFinancialHistory,
  IMPORT_STATEMENT_HREF,
  resolveAccountFilter,
  shouldShowAccountFilter,
} from "./movementHistoryPresentation";

describe("movement history layout mode", () => {
  it("treats zero history as first use", () => {
    expect(hasFinancialHistory([])).toBe(false);
  });

  it("treats loaded history as returning, even with only manual rows", () => {
    expect(hasFinancialHistory([{ id: "manual-1" }])).toBe(true);
    expect(hasFinancialHistory([
      { id: "csv-1", statement_import_id: "import-1" },
      { id: "manual-1", statement_import_id: null },
    ])).toBe(true);
  });

  it("does not use the filtered list to decide first use", () => {
    const history = [{ id: "kept" }, { id: "other" }];
    const filtered: unknown[] = [];
    expect(hasFinancialHistory(history)).toBe(true);
    expect(hasFinancialHistory(filtered)).toBe(false);
  });
});

describe("movement action routes", () => {
  it("keeps the add and import destinations", () => {
    expect(ADD_MOVEMENT_HREF).toBe("/(app)/new-transaction");
    expect(IMPORT_STATEMENT_HREF).toBe("/(app)/import-csv");
  });
});

describe("account filter visibility", () => {
  it("hides the account filter when there is only one useful account", () => {
    expect(shouldShowAccountFilter(["nubank"])).toBe(false);
    expect(shouldShowAccountFilter(["nubank", "nubank"])).toBe(false);
    expect(resolveAccountFilter("nubank", ["nubank"])).toBe("all");
  });

  it("shows the account filter when more than one account exists", () => {
    expect(shouldShowAccountFilter(["nubank", "inter"])).toBe(true);
    expect(resolveAccountFilter("inter", ["nubank", "inter"])).toBe("inter");
  });
});

describe("movement list filters", () => {
  const rows = [
    { type: "income" as const, occurred_on: "2026-10-01", account_id: "nubank", note: "Salário", transfer_group_id: null },
    { type: "expense" as const, occurred_on: "2026-10-03", account_id: "nubank", note: "Mercado", transfer_group_id: null },
    { type: "expense" as const, occurred_on: "2026-09-12", account_id: "inter", note: "Farmácia", transfer_group_id: null },
  ];

  it("keeps type, period and account filter semantics", () => {
    expect(filterMovementsForList(rows, { month: "2026-10", account: "all", flow: "expense" }).map((row) => row.note))
      .toEqual(["Mercado"]);
    expect(filterMovementsForList(rows, { month: "all", account: "inter", flow: "all" }).map((row) => row.note))
      .toEqual(["Farmácia"]);
    expect(filterMovementsForList(rows, { month: "2026-10", search: "mercado" }).map((row) => row.note))
      .toEqual(["Mercado"]);
  });

  it("detects active filters without treating the cleared state as active", () => {
    expect(hasActiveMovementListFilters(CLEARED_MOVEMENT_LIST_FILTERS)).toBe(false);
    expect(hasActiveMovementListFilters({ ...CLEARED_MOVEMENT_LIST_FILTERS, search: "luz" })).toBe(true);
  });
});
