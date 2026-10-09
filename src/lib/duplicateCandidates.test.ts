import { describe, expect, it } from "vitest";
import {
  duplicateCandidateAlertCopy,
  findDuplicateCandidates,
  findManualReviewCandidatePairs,
  planStatementImport,
  statementRowsAfterSameDecision,
  withManualDuplicateCandidates,
  type StatementRowIdentity,
  type StoredTransactionIdentity,
} from "./statementConflictReview";

function stored(overrides: Partial<StoredTransactionIdentity> = {}): StoredTransactionIdentity {
  return {
    id: "existing-1",
    type: "expense",
    amountCents: 10000,
    occurredOn: "2026-09-28",
    note: "Mercado X",
    originalNote: null,
    categoryId: null,
    accountId: "nubank",
    statementImportId: null,
    ignoredAt: null,
    transferGroupId: null,
    ...overrides,
  };
}

function row(rawLine: number, note = "SUPERMERCADO X LTDA 123", overrides: Partial<StatementRowIdentity> = {}): StatementRowIdentity {
  return {
    rawLine,
    type: "expense",
    amountCents: 10000,
    occurredOn: "2026-09-28",
    note,
    ...overrides,
  };
}

const draft = {
  type: "expense" as const,
  amountCents: 10000,
  occurredOn: "2026-09-28",
  accountId: "nubank",
  note: "Mercado X",
};

describe("conservative duplicate candidates", () => {
  it("treats the same date, amount, type and description as a candidate", () => {
    const found = findDuplicateCandidates([stored()], draft);
    expect(found.map((item) => item.id)).toEqual(["existing-1"]);
    expect(duplicateCandidateAlertCopy(found)?.title).toBe("Encontramos um lançamento parecido");
  });

  it("still warns when the description is different", () => {
    const found = findDuplicateCandidates([stored({ note: "Mercado X" })], {
      ...draft,
      note: "SUPERMERCADO X LTDA 123",
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.note).toBe("Mercado X");
  });

  it("ignores a different amount", () => {
    expect(findDuplicateCandidates([stored({ amountCents: 9900 })], draft)).toEqual([]);
  });

  it("ignores a different date", () => {
    expect(findDuplicateCandidates([stored({ occurredOn: "2026-09-27" })], draft)).toEqual([]);
  });

  it("ignores a different type", () => {
    expect(findDuplicateCandidates([stored()], { ...draft, type: "income" })).toEqual([]);
  });

  it("keeps the existing row when the user says the new one is different", () => {
    const existing = [stored()];
    const before = existing.map((item) => ({ ...item }));
    const found = findDuplicateCandidates(existing, draft);
    expect(found).toHaveLength(1);
    expect(existing).toEqual(before);
  });

  it("warns when a new manual matches an imported row", () => {
    const imported = stored({
      id: "csv-1",
      statementImportId: "import-1",
      originalNote: "SUPERMERCADO X LTDA 123",
      note: "Mercado",
    });
    const found = findDuplicateCandidates([imported], { ...draft, note: "Mercado X" });
    expect(found.map((item) => item.id)).toEqual(["csv-1"]);
    expect(found[0]?.statementImportId).toBe("import-1");
  });

  it("sends a later CSV into duplicate review even when the manual note differs", () => {
    const manual = stored({ note: "Mercado X" });
    const incoming = [row(4, "SUPERMERCADO X LTDA 123")];
    const pairs = withManualDuplicateCandidates([], [manual], incoming, "nubank");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.matches.map((match) => match.transactionId)).toEqual(["existing-1"]);
    expect(pairs[0]?.matches[0]?.statementImportId).toBeNull();

    const same = planStatementImport({ incoming, pairs, decisions: { 4: "same" } });
    expect(same.insertedRawLines).toEqual([]);
    expect(statementRowsAfterSameDecision(incoming, pairs, { 4: "same" })).toEqual([]);

    const different = planStatementImport({ incoming, pairs, decisions: { 4: "different" } });
    expect(different.insertedRawLines).toEqual([4]);
    expect(statementRowsAfterSameDecision(incoming, pairs, { 4: "different" })).toEqual(incoming);
    expect(manual.note).toBe("Mercado X");
  });

  it("asks about both equal purchases instead of deciding that the second is new", () => {
    const pairs = findManualReviewCandidatePairs(
      [stored({ id: "padaria", amountCents: 2000, note: "Padaria" })],
      [
        row(1, "PADARIA", { amountCents: 2000 }),
        row(2, "PADARIA CENTRO", { amountCents: 2000 }),
      ],
      "nubank",
    );
    expect(pairs.map((pair) => pair.rawLine)).toEqual([1, 2]);
    const plan = planStatementImport({
      incoming: [
        row(1, "PADARIA", { amountCents: 2000 }),
        row(2, "PADARIA CENTRO", { amountCents: 2000 }),
      ],
      pairs,
      decisions: { 1: "different", 2: "different" },
    });
    expect(plan.insertedRawLines).toEqual([1, 2]);
  });

  it("does not treat another account as a candidate when both accounts are known", () => {
    expect(findDuplicateCandidates([stored({ accountId: "inter" })], draft)).toEqual([]);
    expect(findManualReviewCandidatePairs([stored({ accountId: "inter" })], [row(4)], "nubank")).toEqual([]);
  });

  it("keeps a missing account as a candidate and still requires a decision", () => {
    const unassigned = stored({ accountId: null });
    expect(findDuplicateCandidates([unassigned], draft)).toHaveLength(1);
    const pairs = findManualReviewCandidatePairs([unassigned], [row(4)], "nubank");
    const unresolved = planStatementImport({ incoming: [row(4)], pairs });
    expect(pairs).toHaveLength(1);
    expect(unresolved.canImport).toBe(false);
    expect(unresolved.insertedRawLines).toEqual([]);
  });

  it("does not confirm a hidden or internal-transfer row by itself", () => {
    expect(findDuplicateCandidates([stored({ ignoredAt: "2026-10-01T00:00:00.000Z" })], draft)).toEqual([]);
    expect(findDuplicateCandidates([stored({ transferGroupId: "group-1" })], draft)).toEqual([]);
  });

  it("ranks an equal description first without dropping the other candidate", () => {
    const found = findDuplicateCandidates([
      stored({ id: "other", note: "Loja Y" }),
      stored({ id: "same", note: "Mercado X" }),
    ], draft);
    expect(found.map((item) => item.id)).toEqual(["same", "other"]);
  });
});
