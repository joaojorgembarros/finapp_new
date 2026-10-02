import { describe, expect, it, vi } from "vitest";
import { formatDateBRFromYMD } from "./format";
import { resolveMovementListContext } from "./movementImportContext";
import {
  IMPORTED_COMMITMENT_REMOVAL_NOTE,
  IMPORTED_REMOVAL_CONFIRMATION,
  auditStatementDeletion,
  buildStatementDeletionDialog,
  chunkLookupIds,
  ignoredImportedTransaction,
  importedRemovalMessage,
  importsAfterDeletion,
  movementsRouteForStatement,
  onlyImportAfterStatementDeletion,
  removalPlan,
  sameFileReimportStatus,
  statementExcludedCountLabel,
  statementImportedCountLabel,
  statementImportFacts,
  totalsWithoutIgnored,
  transactionOriginLabel,
  transactionsAfterStatementDeletion,
} from "./statementImportManagement";

vi.mock("./supabase", () => ({
  supabase: {},
}));

const nubank = {
  id: "import-a",
  bank_id: "nubank" as const,
  file_name: "nubank-setembro.csv",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  created_at: "2026-10-02T12:00:00.000Z",
  transaction_count: 10,
  income_cents: 300000,
  expense_cents: 80000,
  final_balance_cents: 500000,
  skipped_transaction_count: 0,
  rejected_transaction_count: 1,
};

const inter = {
  ...nubank,
  id: "import-b",
  bank_id: "inter" as const,
  file_name: "inter-setembro.csv",
  transaction_count: 8,
  income_cents: 100000,
  expense_cents: 20000,
  final_balance_cents: 180000,
};

describe("imported transaction removal", () => {
  it("keeps a real delete for manual transactions and ignores imported ones", () => {
    expect(removalPlan({ statement_import_id: null })).toBe("delete");
    expect(removalPlan({ statement_import_id: "import-a" })).toBe("ignore");
    expect(IMPORTED_REMOVAL_CONFIRMATION.title).toBe("Excluir lançamento?");
    expect(IMPORTED_REMOVAL_CONFIRMATION.confirm).toBe("Excluir");
    expect(importedRemovalMessage(false)).toBe(IMPORTED_REMOVAL_CONFIRMATION.message);
    expect(importedRemovalMessage(true)).toContain(IMPORTED_COMMITMENT_REMOVAL_NOTE);
  });

  it("hides an ignored imported transaction from totals without removing it from the statement", () => {
    const imported = {
      id: "tx-1",
      type: "expense" as const,
      amount_cents: 18000,
      statement_import_id: "import-a",
      source_line: 4,
      original_note: "SUPERMERCADO BH",
      ignored_at: null,
      transfer_group_id: null,
    };
    const salary = {
      id: "tx-2",
      type: "income" as const,
      amount_cents: 300000,
      statement_import_id: null,
      ignored_at: null,
      transfer_group_id: null,
    };
    const ignored = ignoredImportedTransaction(imported, "2026-10-02T15:00:00.000Z");

    expect(ignored.statement_import_id).toBe("import-a");
    expect(ignored.source_line).toBe(4);
    expect(ignored.original_note).toBe("SUPERMERCADO BH");
    expect(ignored.ignored_at).toBeTruthy();
    expect(totalsWithoutIgnored([ignored, salary])).toEqual({
      income: 300000,
      expense: 0,
      periodBalance: 300000,
    });
  });

  it("labels the editor origin from the account already stored on the transaction", () => {
    expect(transactionOriginLabel({ statementImportId: null, accountName: "Nubank" })).toBe("Manual");
    expect(transactionOriginLabel({ statementImportId: "import-a", accountName: "Nubank" })).toBe("Nubank • Importado");
    expect(transactionOriginLabel({ statementImportId: "import-a", accountName: null })).toBe("Importado via extrato");
  });
});

describe("imported statement list and deletion", () => {
  it("shows bank, file, period and final balance for an imported statement", () => {
    const facts = statementImportFacts(nubank);
    expect(facts).toMatchObject({
      bankId: "nubank",
      fileName: "nubank-setembro.csv",
      periodLabel: `${formatDateBRFromYMD("2026-09-01")} a ${formatDateBRFromYMD("2026-09-30")}`,
      transactionCount: 10,
      incomeCents: 300000,
      expenseCents: 80000,
      finalBalanceCents: 500000,
      showsFinalBalance: true,
    });
    expect(facts.importedAt).toBe(nubank.created_at);
    expect(facts.periodLabel).not.toBe(facts.importedAt);
    expect(facts.transactionCount).toBe(10);
    expect(statementImportedCountLabel(facts.transactionCount)).toBe("10 movimentações importadas");
    expect(statementExcludedCountLabel(2)).toBe("2 excluídas");
    expect(statementExcludedCountLabel(0)).toBeNull();
    expect(facts.skippedCount).toBe(0);
    expect(facts.rejectedCount).toBe(1);
  });

  it("removes only the deleted statement from the list and from visible totals", () => {
    expect(importsAfterDeletion([nubank, inter], "import-a").map((item) => item.id)).toEqual(["import-b"]);
    const rows = [
      { id: "a", statement_import_id: "import-a", type: "expense" as const, amount_cents: 80000 },
      { id: "b", statement_import_id: "import-b", type: "income" as const, amount_cents: 100000 },
    ];
    const remaining = transactionsAfterStatementDeletion(rows, "import-a");
    expect(remaining.map((row) => row.id)).toEqual(["b"]);
    expect(totalsWithoutIgnored(remaining)).toEqual({
      income: 100000,
      expense: 0,
      periodBalance: 100000,
    });
  });

  it("identifies commitment payments and blocks a transfer whose other leg is outside the statement", () => {
    const withPayment = auditStatementDeletion({
      importId: "import-b",
      importTransactions: [
        { id: "b1", statement_import_id: "import-b", transfer_group_id: null },
      ],
      relatedTransferLegs: [],
      commitmentPaymentCount: 2,
    });
    const dialog = buildStatementDeletionDialog({
      bankName: "Inter",
      periodLabel: "01/09/2026 a 30/09/2026",
      preflight: withPayment,
    });
    expect(withPayment.commitmentPaymentCount).toBe(2);
    expect(dialog.canDelete).toBe(true);
    expect(dialog.message).toContain("2 pagamento(s)");

    const blocked = auditStatementDeletion({
      importId: "import-b",
      importTransactions: [
        { id: "b-out", statement_import_id: "import-b", transfer_group_id: "group-1" },
      ],
      relatedTransferLegs: [
        { id: "a-in", statement_import_id: "import-a", transfer_group_id: "group-1" },
      ],
      commitmentPaymentCount: 0,
    });
    expect(blocked.blockedByExternalTransfer).toBe(true);
    expect(buildStatementDeletionDialog({
      bankName: "Inter",
      periodLabel: "01/09/2026 a 30/09/2026",
      preflight: blocked,
    }).canDelete).toBe(false);
  });

  it("allows deletion when both transfer legs belong to the same statement", () => {
    const legs = [
      { id: "out", statement_import_id: "import-b", transfer_group_id: "group-1" },
      { id: "in", statement_import_id: "import-b", transfer_group_id: "group-1" },
    ];
    const preflight = auditStatementDeletion({
      importId: "import-b",
      importTransactions: legs,
      relatedTransferLegs: [],
      commitmentPaymentCount: 0,
    });
    const remaining = transactionsAfterStatementDeletion([
      ...legs,
      { id: "other", statement_import_id: "import-a", transfer_group_id: null },
    ], "import-b");
    expect(preflight.blockedByExternalTransfer).toBe(false);
    expect(preflight.transactionCount).toBe(2);
    expect(remaining.map((row) => row.id)).toEqual(["other"]);
    expect(remaining.some((row) => row.transfer_group_id)).toBe(false);
  });

  it("allows the same file hash to be imported again only after the statement row is gone", () => {
    expect(sameFileReimportStatus("import-a")).toBe("blocked");
    const deleted = importsAfterDeletion([nubank], nubank.id);
    expect(sameFileReimportStatus(deleted.find((item) => item.file_name === nubank.file_name)?.id)).toBe("allowed");
  });

  it("clears onlyImport when the filtered statement is deleted and opens movements through that explicit filter", () => {
    expect(onlyImportAfterStatementDeletion("import-b", "import-b")).toBeNull();
    expect(onlyImportAfterStatementDeletion("import-a", "import-b")).toBe("import-a");

    const route = movementsRouteForStatement("import-b");
    const context = resolveMovementListContext({
      routeImportId: route.importId,
      onlyImport: route.onlyImport,
      postImportActive: route.postImport === "1",
      seenPostImportId: null,
    });
    expect(route.importId).toBe("");
    expect(context.statementImportId).toBe("import-b");
    expect(context.clearOnlyImportParam).toBe(false);
  });

  it("keeps lookup chunks small enough for 50, 500 and 2000 rows", () => {
    for (const total of [50, 500, 2000]) {
      const ids = Array.from({ length: total }, (_, index) => `tx-${index}`);
      const chunks = chunkLookupIds(ids);
      expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 80)).toBe(true);
      expect(chunks.flat()).toEqual(ids);
    }
    expect(chunkLookupIds(Array.from({ length: 2000 }, (_, index) => `tx-${index}`))).toHaveLength(25);
  });

  it("blocks an external transfer without needing every transaction id", () => {
    const preflight = auditStatementDeletion({
      importId: "import-b",
      transactionCount: 2000,
      importTransactions: [
        { id: "b-out", statement_import_id: "import-b", transfer_group_id: "group-1" },
      ],
      relatedTransferLegs: [
        { id: "a-in", statement_import_id: "import-a", transfer_group_id: "group-1" },
      ],
      commitmentPaymentCount: 1,
    });
    expect(preflight.transactionCount).toBe(2000);
    expect(preflight.blockedByExternalTransfer).toBe(true);
    expect(buildStatementDeletionDialog({
      bankName: "Inter",
      periodLabel: "01/09/2026 a 30/09/2026",
      preflight,
    }).canDelete).toBe(false);
  });
});
