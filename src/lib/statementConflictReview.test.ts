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

function reviewPairs(
  existing: StoredTransactionIdentity[],
  incoming: StatementRowIdentity[],
) {
  return findConflictPairs(existing, incoming, "nubank");
}

describe("manual and CSV conflict review", () => {
  it("finds the manual candidate when the CSV line matches", () => {
    const pairs = reviewPairs([manual()], [csv(4)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.rawLine).toBe(4);
    expect(pairs[0]?.matches.map((match) => match.transactionId)).toEqual(["manual-1"]);
    expect(isManualReviewConflict(pairs[0]!)).toBe(true);
  });

  it("treats a case-only note difference as the same conflict", () => {
    const pairs = reviewPairs(
      [manual({ note: "Supermercado BH" })],
      [csv(4, "  SUPERMERCADO   BH ")],
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.matches[0]?.note).toBe("Supermercado BH");
  });

  it("does not match a different note", () => {
    expect(reviewPairs([manual({ note: "Farmácia" })], [csv(4)])).toEqual([]);
  });

  it("lists every matching manual instead of inventing one pair", () => {
    const pairs = reviewPairs([
      manual({ id: "manual-1", note: "Supermercado BH" }),
      manual({ id: "manual-2", note: "supermercado bh", categoryId: "other" }),
    ], [csv(4)]);
    expect(pairs[0]?.matches).toHaveLength(2);
    expect(pairs[0]?.matches.map((match) => match.transactionId)).toEqual(["manual-1", "manual-2"]);
  });

  it("keeps two identical CSV lines when nothing existing claims them", () => {
    const incoming = [csv(4, "SUPERMERCADO BH"), csv(9, "Supermercado BH")];
    expect(reviewPairs([], incoming)).toEqual([]);
    const plan = planStatementImport({ incoming });
    expect(plan.insertedRawLines).toEqual([4, 9]);
    expect(plan.transactionCount).toBe(2);
    expect(plan.skippedCount).toBe(0);
  });

  it("keeps the manual untouched and skips the CSV line when the user says they are the same", () => {
    const existing = manual();
    const before = { ...existing };
    const pairs = reviewPairs([existing], [csv(4)]);
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
    const pairs = reviewPairs([
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
    const pairs = reviewPairs([manual()], [csv(4), csv(8, "Farmácia", { amountCents: 900 })]);
    const forced = planStatementImport({
      incoming: [csv(4), csv(8, "Farmácia", { amountCents: 900 })],
      pairs,
      forceSourceLines: [4],
    });
    expect(forced.insertedRawLines).toEqual([4, 8]);
    expect(forced.skippedRawLines).toEqual([]);

    const twoConflicts = reviewPairs([
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
      pairs: reviewPairs([manual()], [csv(4)]),
      forceSourceLines: [4, 99],
    });
    expect(invalid.invalidForceLines).toEqual([99]);
    expect(invalid.insertedRawLines).toEqual([]);
    expect(invalid.canImport).toBe(false);
  });

  it("keeps the file hash blocking a reimport even when lines are forced", () => {
    const pairs = reviewPairs([manual()], [csv(4)]);
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
    const pairs = reviewPairs([ignored], [csv(4)]);
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
    const pairs = reviewPairs(existing, incoming);
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
    const pairs = reviewPairs([manual()], [csv(4), csv(9, "Salário", { type: "income", amountCents: 300000 })]);
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
    const pairs = reviewPairs(existing, incoming);
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
    const preview = reviewPairs([manual()], [csv(4), csv(12, "Salário", { type: "income", amountCents: 300000 })]);
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
    const atSave = reviewPairs(
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
    const pairs = reviewPairs([
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
      pairs: reviewPairs([], [first, second]),
      forceSourceLines: [4],
    });
    expect(withoutHistory.insertedRawLines).toEqual([4, 9]);
    expect(withoutHistory.skippedRawLines).toEqual([]);

    const pairs = reviewPairs([manual()], [first, second]);
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

function pix(rawLine = 2): StatementRowIdentity {
  return csv(rawLine, "PIX JOÃO", { amountCents: 10000, occurredOn: "2026-10-02" });
}

describe("deduplication by origin account", () => {
  it("imports an equal Inter line when Nubank already has the same movement", () => {
    const nubank = manual({
      id: "nubank-pix",
      accountId: "nubank",
      statementImportId: "import-nubank",
      originalNote: "PIX JOÃO",
      note: "PIX JOÃO",
      amountCents: 10000,
    });
    const pairs = findConflictPairs([nubank], [pix()], "inter");
    const plan = planStatementImport({ incoming: [pix()], pairs });
    expect(pairs).toEqual([]);
    expect(plan.insertedRawLines).toEqual([2]);
    expect(plan.skippedRawLines).toEqual([]);
    expect(plan.transactionCount).toBe(1);
    expect(plan.skippedCount).toBe(0);
  });

  it("still conflicts when the same movement is imported again on Nubank and cannot be forced", () => {
    const nubank = manual({
      id: "nubank-pix",
      accountId: "nubank",
      statementImportId: "import-nubank",
      originalNote: "PIX JOÃO",
      note: "PIX JOÃO",
      amountCents: 10000,
    });
    const pairs = findConflictPairs([nubank], [pix()], "nubank");
    expect(pairs).toHaveLength(1);
    expect(isManualReviewConflict(pairs[0]!)).toBe(false);
    const plan = planStatementImport({
      incoming: [pix()],
      pairs,
      forceSourceLines: [2],
    });
    expect(plan.insertedRawLines).toEqual([]);
    expect(plan.skippedRawLines).toEqual([2]);
  });

  it("lets Inter in when the equal Nubank row is ignored", () => {
    const ignored = manual({
      id: "nubank-ignored",
      accountId: "nubank",
      statementImportId: "import-nubank",
      originalNote: "PIX JOÃO",
      ignoredAt: "2026-10-03T12:00:00.000Z",
      amountCents: 10000,
    });
    const pairs = findConflictPairs([ignored], [pix()], "inter");
    const plan = planStatementImport({ incoming: [pix()], pairs, forceSourceLines: [2] });
    expect(pairs).toEqual([]);
    expect(plan.insertedRawLines).toEqual([2]);
    expect(plan.skippedCount).toBe(0);
  });

  it("keeps an ignored Nubank row blocking the same Nubank line", () => {
    const ignored = manual({
      id: "nubank-ignored",
      accountId: "nubank",
      statementImportId: "import-nubank",
      originalNote: "PIX JOÃO",
      ignoredAt: "2026-10-03T12:00:00.000Z",
      amountCents: 10000,
    });
    const pairs = findConflictPairs([ignored], [pix()], "nubank");
    const plan = planStatementImport({
      incoming: [pix()],
      pairs,
      forceSourceLines: [2],
    });
    expect(isManualReviewConflict(pairs[0]!)).toBe(false);
    expect(plan.insertedRawLines).toEqual([]);
    expect(plan.skippedRawLines).toEqual([2]);
  });

  it("uses the statement bank when an ignored imported row has no account", () => {
    const ignored = manual({
      id: "nubank-cleared",
      accountId: null,
      statementBankId: "nubank",
      statementImportId: "import-nubank",
      originalNote: "PIX JOÃO",
      ignoredAt: "2026-10-03T12:00:00.000Z",
      amountCents: 10000,
    });
    const nubank = findConflictPairs([ignored], [pix()], "nubank");
    const inter = findConflictPairs([ignored], [pix()], "inter");
    const blocked = planStatementImport({
      incoming: [pix()],
      pairs: nubank,
      forceSourceLines: [2],
    });
    const allowed = planStatementImport({ incoming: [pix()], pairs: inter });
    expect(isManualReviewConflict(nubank[0]!)).toBe(false);
    expect(blocked.skippedRawLines).toEqual([2]);
    expect(inter).toEqual([]);
    expect(allowed.insertedRawLines).toEqual([2]);
    expect(allowed.skippedCount).toBe(0);
  });

  it("keeps a Nubank manual in the same and different review", () => {
    const existing = manual({ id: "manual-nubank", note: "PIX JOÃO", amountCents: 10000 });
    const pairs = findConflictPairs([existing], [pix()], "nubank");
    expect(isManualReviewConflict(pairs[0]!)).toBe(true);
    const same = planStatementImport({
      incoming: [pix()],
      pairs,
      decisions: { 2: "same" },
    });
    expect(forceSourceLinesForDecisions(pairs, { 2: "same" })).toEqual([]);
    expect(same.skippedRawLines).toEqual([2]);
    expect(same.canImport).toBe(false);
    const different = planStatementImport({
      incoming: [pix()],
      pairs,
      decisions: { 2: "different" },
    });
    expect(forceSourceLinesForDecisions(pairs, { 2: "different" })).toEqual([2]);
    expect(different.insertedRawLines).toEqual([2]);
    expect(different.skippedCount).toBe(0);
  });

  it("does not treat an Inter manual as a conflict of a Nubank CSV", () => {
    const interManual = manual({
      id: "manual-inter",
      accountId: "inter",
      note: "PIX JOÃO",
      amountCents: 10000,
    });
    const pairs = findConflictPairs([interManual], [pix()], "nubank");
    const plan = planStatementImport({ incoming: [pix()], pairs });
    expect(pairs).toEqual([]);
    expect(plan.insertedRawLines).toEqual([2]);
    expect(plan.skippedCount).toBe(0);
  });

  it("reviews a manual without an account and honors same or different", () => {
    const unassigned = manual({
      id: "manual-unassigned",
      accountId: null,
      note: "PIX JOÃO",
      amountCents: 10000,
    });
    const pairs = findConflictPairs([unassigned], [pix()], "nubank");
    expect(pairs).toHaveLength(1);
    expect(isManualReviewConflict(pairs[0]!)).toBe(true);
    expect(findConflictPairs([unassigned], [pix()], "inter")).toHaveLength(1);
    const same = planStatementImport({
      incoming: [pix()],
      pairs,
      decisions: { 2: "same" },
    });
    expect(same.skippedRawLines).toEqual([2]);
    expect(same.insertedRawLines).toEqual([]);
    const different = planStatementImport({
      incoming: [pix()],
      pairs,
      decisions: { 2: "different" },
    });
    expect(different.insertedRawLines).toEqual([2]);
    expect(different.skippedRawLines).toEqual([]);
  });

  it("keeps two identical lines from the same CSV when nothing prior matches that account", () => {
    const first = pix(2);
    const second = pix(9);
    const pairs = findConflictPairs([], [first, second], "inter");
    const plan = planStatementImport({
      incoming: [first, second],
      pairs,
      forceSourceLines: [2],
    });
    expect(pairs).toEqual([]);
    expect(plan.insertedRawLines).toEqual([2, 9]);
    expect(plan.skippedCount).toBe(0);
    expect(plan.transactionCount).toBe(2);
  });

  it("still blocks the identical file even when the account key would allow the line", () => {
    const plan = planStatementImport({
      incoming: [pix()],
      pairs: [],
      existingFileId: "import-nubank",
      forceSourceLines: [2],
    });
    expect(plan.blockedByFileHash).toBe(true);
    expect(plan.insertedRawLines).toEqual([]);
    expect(plan.canImport).toBe(false);
  });

  it("does not let force change an imported row that belongs to another account", () => {
    const nubank = manual({
      id: "nubank-pix",
      accountId: "nubank",
      statementImportId: "import-nubank",
      originalNote: "PIX JOÃO",
      amountCents: 10000,
    });
    const pairs = findConflictPairs([nubank], [pix()], "inter");
    const plan = planStatementImport({
      incoming: [pix()],
      pairs,
      forceSourceLines: [2],
    });
    expect(pairs).toEqual([]);
    expect(plan.insertedRawLines).toEqual([2]);
    expect(plan.skippedCount).toBe(0);
  });

  it("keeps both legs when the same text exists on two accounts", () => {
    const interOut = manual({
      id: "inter-out",
      accountId: "inter",
      statementImportId: "import-inter",
      originalNote: "PIX JOÃO",
      amountCents: 10000,
    });
    const bradescoIn = pix();
    bradescoIn.type = "income";
    expect(findConflictPairs([interOut], [bradescoIn], "bradesco")).toEqual([]);
    expect(findConflictPairs([interOut], [pix()], "bradesco")).toEqual([]);
  });

  it("documents that two Nubank accounts still share the catalog id", () => {
    const personal = manual({
      id: "nubank-personal",
      accountId: "nubank",
      statementImportId: "import-personal",
      originalNote: "PIX JOÃO",
      amountCents: 10000,
    });
    // Nubank PJ is not a distinct account_id today, so it still conflicts with Nubank pessoal.
    expect(findConflictPairs([personal], [pix()], "nubank")).toHaveLength(1);
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

describe("account-aware statement conflict RPCs", () => {
  const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  const accountMigration = readFileSync(join(migrationDir, "20261003140000_statement_conflict_by_account.sql"), "utf8");
  const reviewMigration = readFileSync(join(migrationDir, "20261002190000_statement_conflict_review.sql"), "utf8");
  const v6Migration = readFileSync(join(migrationDir, "202608060001_financial_planning.sql"), "utf8");
  const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "statementImports.ts"), "utf8");
  const screen = readFileSync(join(migrationDir, "../../app/(app)/import-csv.tsx"), "utf8");

  it("adds v8 and the account RPCs without replacing v6 or v7", () => {
    expect(v6Migration).toMatch(/function public\.import_statement_v6\(/);
    expect(reviewMigration).toMatch(/function public\.import_statement_v7\(/);
    expect(reviewMigration).toMatch(/function public\.find_statement_import_conflict_pairs\(/);
    expect(accountMigration).toMatch(/function public\.find_statement_import_conflicts_v2\(/);
    expect(accountMigration).toMatch(/function public\.find_statement_import_conflict_pairs_v2\(/);
    expect(accountMigration).toMatch(/function public\.import_statement_v8\(/);
    expect(accountMigration).not.toMatch(/function public\.find_statement_import_conflicts\(/);
    expect(accountMigration).not.toMatch(/function public\.find_statement_import_conflict_pairs\(/);
    expect(accountMigration).not.toMatch(/function public\.import_statement_v6/);
    expect(accountMigration).not.toMatch(/function public\.import_statement_v7\(/);
    expect(accountMigration).toMatch(/find_statement_import_conflicts_v2\(p_household_id, import_account, p_rows\)/);
    expect(accountMigration).not.toMatch(/find_statement_import_conflicts\(p_household_id, p_rows\)/);
    expect(accountMigration).toMatch(/Nubank pessoal[\s\S]*Nubank PJ[\s\S]*account_id = 'nubank'/);
    expect(accountMigration).toMatch(/file_hash = p_file_hash/);
  });

  it("rejects another household before reading and keeps anon without execute", () => {
    const functions = accountMigration.split(/create or replace function public\./).slice(1);
    expect(functions).toHaveLength(3);
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
    expect(accountMigration).toMatch(/revoke all on function public\.find_statement_import_conflicts_v2\(uuid, text, jsonb\) from public, anon;/);
    expect(accountMigration).toMatch(/grant execute on function public\.find_statement_import_conflicts_v2\(uuid, text, jsonb\) to authenticated;/);
    expect(accountMigration).toMatch(/revoke all on function public\.find_statement_import_conflict_pairs_v2\(uuid, text, jsonb\) from public, anon;/);
    expect(accountMigration).toMatch(/grant execute on function public\.find_statement_import_conflict_pairs_v2\(uuid, text, jsonb\) to authenticated;/);
    expect(accountMigration).toMatch(/revoke all on function public\.import_statement_v8\(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb, integer\[\]\) from public, anon;/);
    expect(accountMigration).toMatch(/grant execute on function public\.import_statement_v8\(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb, integer\[\]\) to authenticated;/);
    expect(accountMigration).not.toMatch(/grant execute on function public\.(find_statement_import_conflicts_v2|find_statement_import_conflict_pairs_v2|import_statement_v8)[\s\S]*to anon/);
  });

  it("calls v8 from the new app and does not fall back to v7", () => {
    expect(client).toMatch(/rpc\("import_statement_v8"/);
    expect(client).toMatch(/rpc\("find_statement_import_conflicts_v2"/);
    expect(client).toMatch(/rpc\("find_statement_import_conflict_pairs_v2"/);
    expect(client).not.toMatch(/rpc\("import_statement_v7"/);
    expect(client).not.toMatch(/rpc\("import_statement_v6"/);
    expect(client).not.toMatch(/rpc\("find_statement_import_conflicts"/);
    expect(client).not.toMatch(/rpc\("find_statement_import_conflict_pairs"/);
    expect(screen).toMatch(/findStatementImportConflictPairs\(householdId, result\.rows, selectedBankId\)/);
    expect(screen).toMatch(/findStatementImportConflicts\(householdId, result\.rows, selectedBankId\)/);
    expect(client).toMatch(/O serviço de importação ainda não está atualizado\. Tente novamente em alguns minutos\./);
    expect(client).not.toMatch(/Atualize o banco antes de importar o extrato/);
  });
});
