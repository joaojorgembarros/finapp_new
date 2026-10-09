import { formatBRLFromCents, formatDateBRFromYMD } from "./format";

export type StatementConflictMatch = {
  transactionId: string;
  note: string | null;
  categoryId: string | null;
  accountId: string | null;
  statementImportId: string | null;
  ignoredAt: string | null;
};

export type StatementConflictPair = {
  rawLine: number;
  type: "income" | "expense";
  amountCents: number;
  occurredOn: string;
  note: string;
  matches: StatementConflictMatch[];
};

export type StatementRowIdentity = {
  rawLine: number;
  type: "income" | "expense";
  amountCents: number;
  occurredOn: string;
  note: string | null;
};

export type StoredTransactionIdentity = {
  id: string;
  type: "income" | "expense";
  amountCents: number;
  occurredOn: string;
  note: string | null;
  originalNote?: string | null;
  categoryId: string | null;
  accountId: string | null;
  /**
   * Bank stored on the originating statement. Used only when an imported
   * transaction has a null account_id. Today this is the same catalog id
   * as account_id (nubank, inter, ...). Nubank pessoal and Nubank PJ still
   * share that id and can still conflict.
   */
  statementBankId?: string | null;
  statementImportId: string | null;
  ignoredAt: string | null;
  transferGroupId?: string | null;
};

export type ManualConflictDecision = "same" | "different" | "unresolved";

export type StatementImportPlan = {
  blockedByFileHash: boolean;
  invalidForceLines: number[];
  insertedRawLines: number[];
  skippedRawLines: number[];
  transactionCount: number;
  skippedCount: number;
  unresolvedCount: number;
  canImport: boolean;
};

function identityKey(type: string, amountCents: number, occurredOn: string, note: string) {
  return `${type}|${amountCents}|${occurredOn}|${note}`;
}

function presentAccount(value: string | null | undefined) {
  const account = value?.trim();
  return account ? account : null;
}

/**
 * Imported account used for dedup. A null account falls back to the statement
 * bank and is never a wildcard. Manual null is handled separately.
 */
export function effectiveImportedAccountId(transaction: {
  accountId?: string | null;
  statementBankId?: string | null;
}) {
  return presentAccount(transaction.accountId) ?? presentAccount(transaction.statementBankId);
}

/**
 * Manual rows match the import account, and a manual with no account matches
 * every import account. Imported rows match only the same effective account.
 */
export function matchesImportAccount(
  transaction: StoredTransactionIdentity,
  incomingAccountId: string,
) {
  const incoming = presentAccount(incomingAccountId);
  if (!incoming) return false;
  if (!transaction.statementImportId) {
    const account = presentAccount(transaction.accountId);
    return account == null || account === incoming;
  }
  return effectiveImportedAccountId(transaction) === incoming;
}

export function normalizeIncomingStatementNote(note: string | null | undefined) {
  return (note ?? "").trim().slice(0, 500).toLowerCase().replace(/\s+/g, " ");
}

export function normalizeStoredStatementNote(transaction: {
  statementImportId?: string | null;
  note?: string | null;
  originalNote?: string | null;
}) {
  const source = transaction.statementImportId
    ? transaction.originalNote ?? ""
    : transaction.note ?? "";
  return source.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findConflictPairs(
  existing: StoredTransactionIdentity[],
  incoming: StatementRowIdentity[],
  incomingAccountId: string,
): StatementConflictPair[] {
  const groups = new Map<string, StoredTransactionIdentity[]>();
  for (const transaction of existing) {
    if (!matchesImportAccount(transaction, incomingAccountId)) continue;
    const key = identityKey(
      transaction.type,
      transaction.amountCents,
      transaction.occurredOn,
      normalizeStoredStatementNote(transaction),
    );
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }

  const seen = new Map<string, number>();
  const pairs: StatementConflictPair[] = [];
  for (const row of [...incoming].sort((left, right) => left.rawLine - right.rawLine)) {
    const key = identityKey(
      row.type,
      row.amountCents,
      row.occurredOn,
      normalizeIncomingStatementNote(row.note),
    );
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const matches = groups.get(key) ?? [];
    if (occurrence > matches.length) continue;
    pairs.push({
      rawLine: row.rawLine,
      type: row.type,
      amountCents: row.amountCents,
      occurredOn: row.occurredOn,
      note: row.note ?? "",
      matches: matches.map((transaction) => ({
        transactionId: transaction.id,
        note: transaction.statementImportId ? transaction.originalNote ?? null : transaction.note,
        categoryId: transaction.categoryId,
        accountId: transaction.accountId,
        statementImportId: transaction.statementImportId,
        ignoredAt: transaction.ignoredAt,
      })),
    });
  }
  return pairs;
}

export function isManualReviewConflict(pair: StatementConflictPair) {
  return pair.matches.length > 0 && pair.matches.every((match) => !match.statementImportId);
}

export function manualReviewConflicts(pairs: StatementConflictPair[]) {
  return pairs.filter(isManualReviewConflict);
}

export function unresolvedManualConflictCount(
  pairs: StatementConflictPair[],
  decisions: Record<number, ManualConflictDecision | undefined> = {},
) {
  return manualReviewConflicts(pairs).filter((pair) => {
    const decision = decisions[pair.rawLine] ?? "unresolved";
    return decision !== "same" && decision !== "different";
  }).length;
}

export const CONFIRMED_SAME_NOTHING_NEW_MESSAGE =
  "Você confirmou que estas movimentações já estão no Sonho+. Nenhuma linha nova será importada.";

export function confirmedSameLeavesNothingNew(
  pairs: StatementConflictPair[],
  decisions: Record<number, ManualConflictDecision | undefined>,
  plan: StatementImportPlan,
) {
  const manuals = manualReviewConflicts(pairs);
  return manuals.length > 0
    && !plan.blockedByFileHash
    && plan.invalidForceLines.length === 0
    && plan.unresolvedCount === 0
    && plan.transactionCount === 0
    && manuals.every((pair) => decisions[pair.rawLine] === "same");
}

export function forceSourceLinesForDecisions(
  pairs: StatementConflictPair[],
  decisions: Record<number, ManualConflictDecision | undefined> = {},
) {
  return manualReviewConflicts(pairs)
    .filter((pair) => decisions[pair.rawLine] === "different")
    .map((pair) => pair.rawLine);
}

export function planStatementImport(input: {
  incoming: StatementRowIdentity[];
  pairs?: StatementConflictPair[];
  decisions?: Record<number, ManualConflictDecision | undefined>;
  forceSourceLines?: number[];
  legacyConflictLines?: number[];
  existingFileId?: string | null;
}): StatementImportPlan {
  const pairs = input.pairs ?? [];
  const decisions = input.decisions ?? {};
  const payloadLines = new Set(input.incoming.map((row) => row.rawLine));
  const serverAuthoritative = input.forceSourceLines !== undefined;
  const requestedForce = [...new Set(
    serverAuthoritative
      ? input.forceSourceLines ?? []
      : forceSourceLinesForDecisions(pairs, decisions),
  )];
  const invalidForceLines = requestedForce.filter((line) => !payloadLines.has(line));
  const unresolvedCount = serverAuthoritative
    ? 0
    : unresolvedManualConflictCount(pairs, decisions);
  const blockedByFileHash = Boolean(input.existingFileId);
  const pairByLine = new Map(pairs.map((pair) => [pair.rawLine, pair]));
  const legacy = new Set(input.legacyConflictLines ?? []);
  const force = new Set(requestedForce);

  if (blockedByFileHash || invalidForceLines.length) {
    return {
      blockedByFileHash,
      invalidForceLines,
      insertedRawLines: [],
      skippedRawLines: [],
      transactionCount: 0,
      skippedCount: 0,
      unresolvedCount,
      canImport: false,
    };
  }

  const insertedRawLines: number[] = [];
  const skippedRawLines: number[] = [];
  for (const row of input.incoming) {
    const pair = pairByLine.get(row.rawLine);
    if (!pair && !legacy.has(row.rawLine)) {
      insertedRawLines.push(row.rawLine);
      continue;
    }
    if (pair && isManualReviewConflict(pair) && force.has(row.rawLine)) {
      insertedRawLines.push(row.rawLine);
      continue;
    }
    skippedRawLines.push(row.rawLine);
  }

  const transactionCount = insertedRawLines.length;
  return {
    blockedByFileHash: false,
    invalidForceLines: [],
    insertedRawLines,
    skippedRawLines,
    transactionCount,
    skippedCount: skippedRawLines.length,
    unresolvedCount,
    canImport: unresolvedCount === 0 && transactionCount > 0,
  };
}

function presentComparableAccount(value: string | null | undefined) {
  const account = value?.trim();
  return account ? account : null;
}

function normalizedCandidateNote(note: string | null | undefined) {
  return (note ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A candidate is only a prompt. Same day and amount are not proof of a duplicate.
 * Description can rank the match. It is not required to show it.
 */
export function isConservativeDuplicateCandidate(
  existing: {
    type: "income" | "expense";
    amountCents: number;
    occurredOn: string;
    accountId?: string | null;
    ignoredAt?: string | null;
    transferGroupId?: string | null;
  },
  incoming: {
    type: "income" | "expense";
    amountCents: number;
    occurredOn: string;
    accountId?: string | null;
  },
) {
  if (existing.ignoredAt || existing.transferGroupId) return false;
  if (existing.type !== incoming.type) return false;
  if (existing.amountCents !== incoming.amountCents) return false;
  if (existing.occurredOn !== incoming.occurredOn) return false;
  const existingAccount = presentComparableAccount(existing.accountId);
  const incomingAccount = presentComparableAccount(incoming.accountId);
  if (existingAccount && incomingAccount) return existingAccount === incomingAccount;
  return true;
}

export function rankDuplicateCandidates<T extends {
  note?: string | null;
  originalNote?: string | null;
  statementImportId?: string | null;
}>(candidates: T[], incomingNote: string | null | undefined) {
  const needle = normalizedCandidateNote(incomingNote);
  return [...candidates].sort((left, right) => {
    const leftNote = normalizedCandidateNote(left.statementImportId ? left.originalNote : left.note);
    const rightNote = normalizedCandidateNote(right.statementImportId ? right.originalNote : right.note);
    const leftScore = needle && leftNote === needle ? 0 : 1;
    const rightScore = needle && rightNote === needle ? 0 : 1;
    return leftScore - rightScore;
  });
}

export function findDuplicateCandidates(
  existing: StoredTransactionIdentity[],
  incoming: {
    type: "income" | "expense";
    amountCents: number;
    occurredOn: string;
    accountId?: string | null;
    note?: string | null;
  },
) {
  return rankDuplicateCandidates(
    existing.filter((transaction) => isConservativeDuplicateCandidate(transaction, incoming)),
    incoming.note,
  );
}

function toConflictMatch(transaction: StoredTransactionIdentity): StatementConflictMatch {
  return {
    transactionId: transaction.id,
    note: transaction.statementImportId ? transaction.originalNote ?? null : transaction.note,
    categoryId: transaction.categoryId,
    accountId: transaction.accountId,
    statementImportId: transaction.statementImportId,
    ignoredAt: transaction.ignoredAt,
  };
}

/** Manual rows that share type, amount, date and a compatible account. Note may differ. */
export function findManualReviewCandidatePairs(
  existing: StoredTransactionIdentity[],
  incoming: StatementRowIdentity[],
  incomingAccountId: string,
): StatementConflictPair[] {
  const pairs: StatementConflictPair[] = [];
  for (const row of [...incoming].sort((left, right) => left.rawLine - right.rawLine)) {
    const matches = existing.filter((transaction) => (
      !transaction.statementImportId
      && isConservativeDuplicateCandidate(transaction, {
        type: row.type,
        amountCents: row.amountCents,
        occurredOn: row.occurredOn,
        accountId: incomingAccountId,
      })
    ));
    if (!matches.length) continue;
    pairs.push({
      rawLine: row.rawLine,
      type: row.type,
      amountCents: row.amountCents,
      occurredOn: row.occurredOn,
      note: row.note ?? "",
      matches: rankDuplicateCandidates(matches, row.note).map(toConflictMatch),
    });
  }
  return pairs;
}

/**
 * Adds description-agnostic manual candidates to the review.
 * An imported exact conflict from the server stays a hard conflict.
 */
export function withManualDuplicateCandidates(
  serverPairs: StatementConflictPair[],
  existing: StoredTransactionIdentity[],
  incoming: StatementRowIdentity[],
  incomingAccountId: string,
) {
  const byLine = new Map(serverPairs.map((pair) => [pair.rawLine, pair]));
  for (const extra of findManualReviewCandidatePairs(existing, incoming, incomingAccountId)) {
    const current = byLine.get(extra.rawLine);
    if (!current) {
      byLine.set(extra.rawLine, extra);
      continue;
    }
    if (!isManualReviewConflict(current)) continue;
    const seen = new Set(current.matches.map((match) => match.transactionId));
    const added = extra.matches.filter((match) => !seen.has(match.transactionId));
    if (!added.length) continue;
    byLine.set(extra.rawLine, { ...current, matches: [...current.matches, ...added] });
  }
  return [...byLine.values()].sort((left, right) => left.rawLine - right.rawLine);
}

/**
 * Lines the user called the same must leave the import payload.
 * The server still requires an identical note, so it would otherwise insert them.
 */
export function statementRowsAfterSameDecision<T extends { rawLine: number }>(
  rows: T[],
  pairs: StatementConflictPair[],
  decisions: Record<number, ManualConflictDecision | undefined> = {},
) {
  const omitted = new Set(
    manualReviewConflicts(pairs)
      .filter((pair) => decisions[pair.rawLine] === "same")
      .map((pair) => pair.rawLine),
  );
  return rows.filter((row) => !omitted.has(row.rawLine));
}

export function duplicateCandidateAlertCopy(candidates: {
  occurredOn: string;
  amountCents: number;
  note?: string | null;
}[]) {
  const primary = candidates[0];
  if (!primary) return null;
  const date = formatDateBRFromYMD(primary.occurredOn);
  const amount = formatBRLFromCents(primary.amountCents);
  const title = candidates.length > 1
    ? "Encontramos lançamentos parecidos"
    : "Encontramos um lançamento parecido";
  const lead = candidates.length > 1
    ? `Há ${candidates.length} lançamentos em ${date} de ${amount}.`
    : `Já existe um lançamento em ${date} de ${amount}.`;
  const note = primary.note?.trim();
  return {
    title,
    message: note ? `${lead}\n${note}` : lead,
  };
}
