import { describe, expect, it } from "vitest";
import { filterMovementsForList } from "./internalTransfers";
import { movementRouteAfterImport, resolveMovementListContext } from "./movementImportContext";

type Movement = {
  id: string;
  type: "expense";
  amount_cents: number;
  account_id: string;
  statement_import_id: string;
  occurred_on: string;
  note: string;
};

function movement(importId: "import-a" | "import-b", accountId: string, index: number): Movement {
  return {
    id: `${importId}-${index}`,
    type: "expense",
    amount_cents: 1000 + index,
    account_id: accountId,
    statement_import_id: importId,
    occurred_on: "2026-08-15",
    note: `${importId} ${index}`,
  };
}

const bankA = Array.from({ length: 10 }, (_, index) => movement("import-a", "bank-a", index));
const bankB = Array.from({ length: 8 }, (_, index) => movement("import-b", "bank-b", index));
const movements = [...bankA, ...bankB];

function visibleCount(statementImportId: string | null, account = "all") {
  return filterMovementsForList(movements, {
    month: "all",
    account,
    statementImportId,
    flow: "all",
    search: "",
  }).length;
}

describe("movements after two statement imports", () => {
  it("opens the consolidated list after the second import", () => {
    const route = movementRouteAfterImport({
      importId: "import-b",
      reconciledCommitments: 0,
      cycleDate: "2026-08-31",
    });

    expect(route.importId).toBe("import-b");
    expect(route).not.toHaveProperty("onlyImport");

    const opened = resolveMovementListContext({
      routeImportId: route.importId,
      onlyImport: undefined,
      postImportActive: true,
      seenPostImportId: null,
    });

    expect(opened.statementImportId).toBeNull();
    expect(opened.resetListFilters).toBe(true);
    expect(visibleCount(opened.statementImportId)).toBe(18);
    expect(visibleCount(opened.statementImportId, "bank-a")).toBe(10);
    expect(visibleCount(opened.statementImportId, "bank-b")).toBe(8);
  });

  it("keeps the consolidated list when the movements screen mounts again", () => {
    const returned = resolveMovementListContext({
      routeImportId: "import-b",
      onlyImport: "import-b",
      postImportActive: true,
      seenPostImportId: null,
    });

    expect(returned.statementImportId).toBeNull();
    expect(returned.clearOnlyImportParam).toBe(true);
    expect(returned.statementImportId).not.toBe("import-b");
    expect(visibleCount(returned.statementImportId)).toBe(18);
    expect(visibleCount(returned.statementImportId, "bank-a")).toBe(10);
    expect(visibleCount(returned.statementImportId, "bank-b")).toBe(8);
  });
});

describe("explicit single-import filter", () => {
  it("shows one file only after an explicit choice and stays consolidated after clearing", () => {
    const opened = resolveMovementListContext({
      routeImportId: "import-b",
      onlyImport: undefined,
      postImportActive: true,
      seenPostImportId: null,
    });

    const selected = resolveMovementListContext({
      routeImportId: "import-b",
      onlyImport: "import-b",
      postImportActive: true,
      seenPostImportId: opened.seenPostImportId,
    });
    expect(selected.statementImportId).toBe("import-b");
    expect(selected.clearOnlyImportParam).toBe(false);
    expect(visibleCount(selected.statementImportId)).toBe(8);

    const cleared = resolveMovementListContext({
      routeImportId: "import-b",
      onlyImport: undefined,
      postImportActive: true,
      seenPostImportId: selected.seenPostImportId,
    });
    expect(cleared.statementImportId).toBeNull();
    expect(visibleCount(cleared.statementImportId)).toBe(18);

    const remounted = resolveMovementListContext({
      routeImportId: "import-b",
      onlyImport: undefined,
      postImportActive: true,
      seenPostImportId: null,
    });
    expect(remounted.statementImportId).toBeNull();
    expect(visibleCount(remounted.statementImportId)).toBe(18);
    expect(remounted.statementImportId).not.toBe(remounted.seenPostImportId);
  });

  it("does not let the route importId resurrect the file filter", () => {
    const context = resolveMovementListContext({
      routeImportId: "import-b",
      onlyImport: undefined,
      postImportActive: true,
      seenPostImportId: "import-b",
    });

    expect(context.statementImportId).toBeNull();
    expect(visibleCount(context.statementImportId)).toBe(18);
  });
});
