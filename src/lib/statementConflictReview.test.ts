import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  confirmedSameLeavesNothingNew,
  findConflictPairs,
  forceSourceLinesForDecisions,
  isManualReviewConflict,
  planStatementImport,
  type StatementRowIdentity,
  type StoredTransactionIdentity,
} from "./statementConflictReview";

function manual(overrides: Partial<StoredTransactionIdentity> = {}): StoredTransactionIdentity {
  return {
    id: "manual-1",
    type: "expense",
    amountCents: 18000,
    occurredOn: "2026-10-02",
    note: "Supermercado BH",
    originalNote: null,
    categoryId: "market",
    accountId: "nubank",
    statementImportId: null,
    ignoredAt: null,
    ...overrides,
  };
}

function csv(rawLine: number, note = "SUPERMERCADO BH", overrides: Partial<StatementRowIdentity> = {}): StatementRowIdentity {
  return {
    rawLine,
    type: "expense",
    amountCents: 18000,
    occurredOn: "2026-10-02",
    note,
    ...overrides,
  };
}

describe("manual and CSV conflict review", () => {
  it("finds the manual candidate when the CSV line matches", () => {
    const pairs = findConflictPairs([manual()], [csv(4)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.rawLine).toBe(4);
    expect(pairs[0]?.matches.map((match) => match.transactionId)).toEqual(["manual-1"]);
    expect(isManualReviewConflict(pairs[0]!)).toBe(true);
  });

  it("treats a case-only note difference as the same conflict", () => {
    const pairs = findConflictPairs(
      [manual({ note: "Supermercado BH" })],
      [csv(4, "  SUPERMERCADO   BH ")],
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.matches[0]?.note).toBe("Supermercado BH");
  });

  it("does not match a different note", () => {
    expect(findConflictPairs([manual({ note: "Farmácia" })], [csv(4)])).toEqual([]);
  });

  it("lists every matching manual instead of inventing one pair", () => {
    const pairs = findConflictPairs([
      manual({ id: "manual-1", note: "Supermercado BH" }),
      manual({ id: "manual-2", note: "supermercado bh", categoryId: "other" }),
    ], [csv(4)]);
    expect(pairs[0]?.matches).toHaveLength(2);
    expect(pairs[0]?.matches.map((match) => match.transactionId)).toEqual(["manual-1", "manual-2"]);
  });

  it("keeps two identical CSV lines when nothing existing claims them", () => {
    const incoming = [csv(4, "SUPERMERCADO BH"), csv(9, "Supermercado BH")];
    expect(findConflictPairs([], incoming)).toEqual([]);
    const plan = planStatementImport({ incoming });
    expect(plan.insertedRawLines).toEqual([4, 9]);
    expect(plan.transactionCount).toBe(2);
    expect(plan.skippedCount).toBe(0);
  });

  it("keeps the manual untouched and skips the CSV line when the user says they are the same", () => {
    const existing = manual();
    const before = { ...existing };
    const pairs = findConflictPairs([existing], [csv(4)]);
    const plan = planStatementImport({
      incoming: [csv(4)],
      pairs,
      decisions: { 4: "same" },
    });
    expect(existing).toEqual(before);
    expect(plan.insertedRawLines).toEqual([]);
    expect(plan.skippedRawLines).toEqual([4]);
    expect(plan.canImport).toBe(false);
  });

  it("inserts only the CSV line marked as different", () => {
    const pairs = findConflictPairs([
      manual({ id: "rent", note: "Aluguel", amountCents: 100000 }),
      manual({ id: "market", note: "Supermercado BH", amountCents: 18000 }),
    ], [
      csv(4, "ALUGUEL", { amountCents: 100000 }),
      csv(8),
    ]);
    const plan = planStatementImport({
      incoming: [
        csv(4, "ALUGUEL", { amountCents: 100000 }),
        csv(8),
      ],
      pairs,
      decisions: { 4: "same", 8: "different" },
    });
    expect(forceSourceLinesForDecisions(pairs, { 4: "same", 8: "different" })).toEqual([8]);
    expect(plan.insertedRawLines).toEqual([8]);
    expect(plan.skippedRawLines).toEqual([4]);
  });

  it("does not force a sibling line or a line outside the payload", () => {
    const pairs = findConflictPairs([manual()], [csv(4), csv(8, "Farmácia", { amountCents: 900 })]);
    const forced = planStatementImport({
      incoming: [csv(4), csv(8, "Farmácia", { amountCents: 900 })],
      pairs,
      forceSourceLines: [4],
    });
    expect(forced.insertedRawLines).toEqual([4, 8]);
    expect(forced.skippedRawLines).toEqual([]);

    const twoConflicts = findConflictPairs([
      manual({ id: "a", note: "Aluguel", amountCents: 100000 }),
      manual(),
    ], [csv(4, "ALUGUEL", { amountCents: 100000 }), csv(8)]);
    const onlyOne = planStatementImport({
      incoming: [csv(4, "ALUGUEL", { amountCents: 100000 }), csv(8)],
      pairs: twoConflicts,
      forceSourceLines: [8],
    });
    expect(onlyOne.insertedRawLines).toEqual([8]);
    expect(onlyOne.skippedRawLines).toEqual([4]);

    const invalid = planStatementImport({
      incoming: [csv(4)],
      pairs: findConflictPairs([manual()], [csv(4)]),
      forceSourceLines: [4, 99],
    });
    expect(invalid.invalidForceLines).toEqual([99]);
    expect(invalid.insertedRawLines).toEqual([]);
    expect(invalid.canImport).toBe(false);
  });

  it("keeps the file hash blocking a reimport even when lines are forced", () => {
    const pairs = findConflictPairs([manual()], [csv(4)]);
    const plan = planStatementImport({
      incoming: [csv(4)],
      pairs,
      forceSourceLines: [4],
      existingFileId: "import-a",
    });
    expect(plan.blockedByFileHash).toBe(true);
    expect(plan.insertedRawLines).toEqual([]);
    expect(plan.canImport).toBe(false);
  });

  it("keeps an ignored imported transaction blocking the same CSV line", () => {
    const ignored = manual({
      id: "old-csv",
      statementImportId: "import-a",
      originalNote: "SUPERMERCADO BH",
      note: "editado pelo usuário",
      ignoredAt: "2026-10-03T12:00:00.000Z",
    });
    const pairs = findConflictPairs([ignored], [csv(4)]);
    expect(pairs).toHaveLength(1);
    expect(isManualReviewConflict(pairs[0]!)).toBe(false);
    const plan = planStatementImport({
      incoming: [csv(4)],
      pairs,
      forceSourceLines: [4],
    });
    expect(plan.insertedRawLines).toEqual([]);
    expect(plan.skippedRawLines).toEqual([4]);
  });

  it("counts same lines as skipped and different lines as imported", () => {
    const existing = [1, 2, 3, 4, 5].map((index) => manual({
      id: `manual-${index}`,
      note: `Conta ${index}`,
      amountCents: index * 100,
    }));
    const incoming = existing.map((transaction, index) => csv(index + 1, transaction.note ?? "", {
      amountCents: transaction.amountCents,
    }));
    const pairs = findConflictPairs(existing, incoming);
    const decisions = {
      1: "same" as const,
      2: "same" as const,
      3: "same" as const,
      4: "different" as const,
      5: "different" as const,
    };
    const plan = planStatementImport({ incoming, pairs, decisions });
    expect(plan.skippedCount).toBe(3);
    expect(plan.transactionCount).toBe(2);
    expect(plan.skippedRawLines).toEqual([1, 2, 3]);
    expect(plan.insertedRawLines).toEqual([4, 5]);
  });

  it("blocks import while a manual conflict is unresolved and keeps a file without conflicts on the current path", () => {
    const pairs = findConflictPairs([manual()], [csv(4), csv(9, "Salário", { type: "income", amountCents: 300000 })]);
    const unresolved = planStatementImport({
      incoming: [csv(4), csv(9, "Salário", { type: "income", amountCents: 300000 })],
      pairs,
      decisions: {},
    });
    expect(unresolved.unresolvedCount).toBe(1);
    expect(unresolved.canImport).toBe(false);

    const clear = planStatementImport({
      incoming: [csv(9, "Salário", { type: "income", amountCents: 300000 })],
      pairs: [],
    });
    expect(clear.unresolvedCount).toBe(0);
    expect(clear.insertedRawLines).toEqual([9]);
    expect(clear.skippedCount).toBe(0);
    expect(clear.canImport).toBe(true);
    expect(forceSourceLinesForDecisions([], {})).toEqual([]);
  });

  it("refuses an import when every CSV line was confirmed as the same manual movement", () => {
    const incoming = Array.from({ length: 10 }, (_, index) => csv(index + 1, `Conta ${index + 1}`, {
      amountCents: (index + 1) * 100,
    }));
    const existing = incoming.map((row, index) => manual({
      id: `manual-${index + 1}`,
      note: row.note,
      amountCents: row.amountCents,
    }));
    const pairs = findConflictPairs(existing, incoming);
    const decisions = Object.fromEntries(incoming.map((row) => [row.rawLine, "same" as const]));
    const plan = planStatementImport({ incoming, pairs, decisions });

    expect(pairs).toHaveLength(10);
    expect(pairs.every(isManualReviewConflict)).toBe(true);
    expect(forceSourceLinesForDecisions(pairs, decisions)).toEqual([]);
    expect(plan.transactionCount).toBe(0);
    expect(plan.skippedCount).toBe(10);
    expect(plan.canImport).toBe(false);
    expect(confirmedSameLeavesNothingNew(pairs, decisions, plan)).toBe(true);
    expect(existing.map((transaction) => transaction.note)).toEqual(incoming.map((row) => row.note));
  });

  it("keeps a stale different decision from inserting over a transaction imported in the meantime", () => {
    const preview = findConflictPairs([manual()], [csv(4), csv(12, "Salário", { type: "income", amountCents: 300000 })]);
    const staleForce = forceSourceLinesForDecisions(preview, { 4: "different" });
    expect(staleForce).toEqual([4]);
    expect(isManualReviewConflict(preview[0]!)).toBe(true);

    const importedMeanwhile = manual({
      id: "bank-row",
      statementImportId: "other-import",
      originalNote: "SUPERMERCADO BH",
      note: "texto exibido depois",
      ignoredAt: null,
    });
    const atSave = findConflictPairs(
      [manual(), importedMeanwhile],
      [csv(4), csv(12, "Salário", { type: "income", amountCents: 300000 })],
    );
    expect(isManualReviewConflict(atSave.find((pair) => pair.rawLine === 4)!)).toBe(false);

    const plan = planStatementImport({
      incoming: [csv(4), csv(12, "Salário", { type: "income", amountCents: 300000 })],
      pairs: atSave,
      forceSourceLines: staleForce,
    });
    expect(plan.insertedRawLines).toEqual([12]);
    expect(plan.skippedRawLines).toEqual([4]);
    expect(plan.transactionCount).toBe(1);
    expect(plan.skippedCount).toBe(1);
  });

  it("applies force only to payload lines and never widens it to other rows", () => {
    const manualConflict = csv(4);
    const plain = csv(8, "Farmácia", { amountCents: 900 });
    const importedConflict = csv(15, "TARIFA", { amountCents: 500 });
    const incoming = [manualConflict, plain, importedConflict];
    const pairs = findConflictPairs([
      manual(),
      manual({
        id: "imported-fee",
        note: "tarifa editada",
        originalNote: "TARIFA",
        amountCents: 500,
        statementImportId: "import-a",
        ignoredAt: "2026-10-03T12:00:00.000Z",
      }),
    ], incoming);

    const repeatedForce = planStatementImport({
      incoming,
      pairs,
      forceSourceLines: [4, 4, 8],
    });
    expect(repeatedForce.invalidForceLines).toEqual([]);
    expect(repeatedForce.insertedRawLines).toEqual([4, 8]);
    expect(repeatedForce.skippedRawLines).toEqual([15]);

    const negative = planStatementImport({
      incoming,
      pairs,
      forceSourceLines: [4, -1],
    });
    expect(negative.invalidForceLines).toEqual([-1]);
    expect(negative.insertedRawLines).toEqual([]);
    expect(negative.canImport).toBe(false);

    const missing = planStatementImport({
      incoming,
      pairs,
      forceSourceLines: [4, 99],
    });
    expect(missing.invalidForceLines).toEqual([99]);
    expect(missing.insertedRawLines).toEqual([]);

    const mixedInvalid = planStatementImport({
      incoming,
      pairs,
      forceSourceLines: [4, 8, 15, 99, -3],
    });
    expect(mixedInvalid.invalidForceLines).toEqual([99, -3]);
    expect(mixedInvalid.insertedRawLines).toEqual([]);
    expect(mixedInvalid.skippedRawLines).toEqual([]);

    const onlyImportedForced = planStatementImport({
      incoming,
      pairs,
      forceSourceLines: [15],
    });
    expect(onlyImportedForced.insertedRawLines).toEqual([8]);
    expect(onlyImportedForced.skippedRawLines).toEqual([4, 15]);
  });

  it("does not let a force decision change the other copy of an identical CSV line", () => {
    const first = csv(4);
    const second = csv(9);
    const withoutHistory = planStatementImport({
      incoming: [first, second],
      pairs: findConflictPairs([], [first, second]),
      forceSourceLines: [4],
    });
    expect(withoutHistory.insertedRawLines).toEqual([4, 9]);
    expect(withoutHistory.skippedRawLines).toEqual([]);

    const pairs = findConflictPairs([manual()], [first, second]);
    expect(pairs.map((pair) => pair.rawLine)).toEqual([4]);

    const forceSibling = planStatementImport({
      incoming: [first, second],
      pairs,
      forceSourceLines: [9],
    });
    expect(forceSibling.insertedRawLines).toEqual([9]);
    expect(forceSibling.skippedRawLines).toEqual([4]);

    const forceConflict = planStatementImport({
      incoming: [first, second],
      pairs,
      forceSourceLines: [4],
    });
    expect(forceConflict.insertedRawLines).toEqual([4, 9]);
    expect(forceConflict.skippedRawLines).toEqual([]);
  });
});

describe("statement conflict RPC authorization", () => {
  const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  const migration = readFileSync(join(migrationDir, "20261002190000_statement_conflict_review.sql"), "utf8");
  const previousConflict = readFileSync(join(migrationDir, "202608050001_transaction_management.sql"), "utf8");

  it("keeps the old conflict contract and adds v7 without replacing v6", () => {
    expect(previousConflict).toMatch(/function public\.find_statement_import_conflicts\([\s\S]*?\) returns integer\[\]/);
    expect(migration).not.toMatch(/function public\.find_statement_import_conflicts/);
    expect(migration).not.toMatch(/function public\.import_statement_v6/);
    expect(migration).toMatch(/function public\.import_statement_v7\(/);
    expect(migration).toMatch(/p_force_source_lines integer\[\]/);
  });

  it("rejects another household before reading its transactions or categories", () => {
    const functions = migration.split(/create or replace function public\./).slice(1);
    expect(functions).toHaveLength(2);
    for (const body of functions) {
      const authCheck = body.indexOf("if uid is null then");
      const memberCheck = body.indexOf("if not public.is_member(p_household_id) then");
      const firstRead = body.search(/from public\.(transactions|categories|statement_imports)/);
      expect(authCheck).toBeGreaterThan(-1);
      expect(memberCheck).toBeGreaterThan(authCheck);
      expect(firstRead).toBeGreaterThan(memberCheck);
      expect(body).toMatch(/security definer/);
      expect(body).toMatch(/set search_path = public/);
      expect(body).toMatch(/tx\.household_id = p_household_id|category\.household_id = p_household_id/);
    }
    expect(migration).toMatch(/revoke all on function public\.find_statement_import_conflict_pairs\(uuid, jsonb\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function public\.find_statement_import_conflict_pairs\(uuid, jsonb\) to authenticated;/);
    expect(migration).toMatch(/revoke all on function public\.import_statement_v7\(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb, integer\[\]\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function public\.import_statement_v7\(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb, integer\[\]\) to authenticated;/);
    expect(migration).not.toMatch(/grant execute on function public\.(find_statement_import_conflict_pairs|import_statement_v7)[\s\S]*to anon/);
  });
});
