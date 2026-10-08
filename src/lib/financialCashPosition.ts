import { monthStartYMD } from "./date";
import { supabase } from "./supabase";

const sb: any = supabase;

const KNOWN_CASH_PAGE_SIZE = 500;

/**
 * Catalog ids that can hide more than one real account.
 * Nubank pessoal and Nubank PJ share `nubank`.
 * Every unrecognized bank shares `outro-banco`.
 */
export const KNOWN_CASH_SHARED_BANK_IDS = ["nubank", "outro-banco"] as const;

export type KnownCashConfidence = "confirmed" | "derived";

export type KnownCashSnapshotInput = {
  id: string;
  bankId: string | null;
  finalBalanceCents: number | null;
  balanceConfidence: string | null;
  periodStart?: string | null;
  periodEnd: string | null;
  createdAt: string;
  /** Present only when a physical account is known apart from bankId. */
  accountKey?: string | null;
};

export type KnownCashAccount = {
  bankId: string;
  importId: string;
  knownCashCents: number;
  asOfDate: string;
  confidence: KnownCashConfidence;
};

export type KnownCashDataQuality = {
  hasSnapshot: boolean;
  /** Newest statement close is before the reference month. Not "updated today". */
  isStale: boolean;
  /** Selected accounts do not close on the same date. */
  datesDiffer: boolean;
  /** A selected bank can hide another account that shares its id. */
  sameBankRisk: boolean;
  sameBankIds: string[];
  /** Banks seen in imports that contributed no usable balance. */
  missingBankIds: string[];
  ignoredSnapshotCount: number;
};

export type FinancialKnownCashPosition = {
  referenceDate: string;
  /** Null when no usable statement balance exists. Never implied zero. */
  knownCashCents: number | null;
  /** Newest selected period_end, or null when there is no snapshot. */
  asOfDate: string | null;
  accounts: KnownCashAccount[];
  dataQuality: KnownCashDataQuality;
};

export function buildFinancialKnownCashPosition(input: {
  snapshots: KnownCashSnapshotInput[];
  referenceDate: string;
}): FinancialKnownCashPosition {
  const referenceDate = requireReferenceDate(input.referenceDate);
  const qualifying = input.snapshots.filter(isQualifyingSnapshot);
  const latestByBank = new Map<string, KnownCashSnapshotInput>();
  for (const snapshot of [...qualifying].sort(compareSnapshots)) {
    const bankId = snapshot.bankId?.trim();
    if (!bankId || latestByBank.has(bankId)) continue;
    latestByBank.set(bankId, snapshot);
  }

  const accounts = [...latestByBank.entries()]
    .map(([bankId, snapshot]) => ({
      bankId,
      importId: snapshot.id,
      knownCashCents: integerCents(snapshot.finalBalanceCents),
      asOfDate: String(snapshot.periodEnd),
      confidence: snapshot.balanceConfidence as KnownCashConfidence,
    }))
    .sort((left, right) => left.bankId.localeCompare(right.bankId) || left.importId.localeCompare(right.importId));

  const asOfDates = [...new Set(accounts.map((account) => account.asOfDate))].sort();
  const asOfDate = asOfDates.length ? asOfDates[asOfDates.length - 1] : null;
  const knownCashCents = accounts.length
    ? accounts.reduce((total, account) => total + account.knownCashCents, 0)
    : null;
  const sameBankIds = sharedBankIds(qualifying, accounts);
  const seenBankIds = new Set(
    input.snapshots
      .map((snapshot) => snapshot.bankId?.trim() || "")
      .filter(Boolean),
  );
  const selectedBankIds = new Set(accounts.map((account) => account.bankId));
  const missingBankIds = [...seenBankIds].filter((bankId) => !selectedBankIds.has(bankId)).sort();

  return {
    referenceDate,
    knownCashCents,
    asOfDate,
    accounts,
    dataQuality: {
      hasSnapshot: accounts.length > 0,
      isStale: Boolean(asOfDate && asOfDate < monthStartYMD(parseLocalYmd(referenceDate))),
      datesDiffer: asOfDates.length > 1,
      sameBankRisk: sameBankIds.length > 0,
      sameBankIds,
      missingBankIds,
      ignoredSnapshotCount: input.snapshots.length - qualifying.length,
    },
  };
}

export async function loadFinancialKnownCashPosition(params: {
  householdId: string;
  referenceDate: string;
}) {
  const referenceDate = requireReferenceDate(params.referenceDate);
  const snapshots = await paginateKnownCashSnapshots(async (from, to) => {
    const { data, error } = await sb
      .from("statement_imports")
      .select("id,bank_id,final_balance_cents,balance_confidence,period_start,period_end,created_at")
      .eq("household_id", params.householdId)
      .order("period_end", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(mapKnownCashSnapshot);
  });
  return buildFinancialKnownCashPosition({ snapshots, referenceDate });
}

function sharedBankIds(qualifying: KnownCashSnapshotInput[], accounts: KnownCashAccount[]) {
  const ids = new Set<string>();
  for (const account of accounts) {
    if ((KNOWN_CASH_SHARED_BANK_IDS as readonly string[]).includes(account.bankId)) {
      ids.add(account.bankId);
    }
  }
  const keysByBank = new Map<string, Set<string>>();
  for (const snapshot of qualifying) {
    const bankId = snapshot.bankId?.trim();
    const accountKey = snapshot.accountKey?.trim();
    if (!bankId || !accountKey) continue;
    const keys = keysByBank.get(bankId) ?? new Set<string>();
    keys.add(accountKey);
    keysByBank.set(bankId, keys);
  }
  for (const [bankId, keys] of keysByBank) {
    if (keys.size > 1) ids.add(bankId);
  }
  return [...ids].sort();
}

function isQualifyingSnapshot(snapshot: KnownCashSnapshotInput) {
  const bankId = snapshot.bankId?.trim();
  if (!bankId) return false;
  if (snapshot.balanceConfidence !== "confirmed" && snapshot.balanceConfidence !== "derived") return false;
  if (snapshot.finalBalanceCents == null || !Number.isFinite(snapshot.finalBalanceCents)) return false;
  return isYmd(snapshot.periodEnd);
}

function compareSnapshots(left: KnownCashSnapshotInput, right: KnownCashSnapshotInput) {
  const byPeriod = String(right.periodEnd).localeCompare(String(left.periodEnd));
  if (byPeriod) return byPeriod;
  const byCreated = String(right.createdAt).localeCompare(String(left.createdAt));
  if (byCreated) return byCreated;
  return String(right.id).localeCompare(String(left.id));
}

function mapKnownCashSnapshot(row: Record<string, unknown>): KnownCashSnapshotInput {
  return {
    id: String(row.id),
    bankId: row.bank_id == null ? null : String(row.bank_id),
    finalBalanceCents: optionalCents(row.final_balance_cents),
    balanceConfidence: row.balance_confidence == null ? null : String(row.balance_confidence),
    periodStart: row.period_start == null ? null : String(row.period_start),
    periodEnd: row.period_end == null ? null : String(row.period_end),
    createdAt: row.created_at == null ? "" : String(row.created_at),
    accountKey: null,
  };
}

async function paginateKnownCashSnapshots(
  fetchPage: (from: number, to: number) => Promise<KnownCashSnapshotInput[]>,
  pageSize = KNOWN_CASH_PAGE_SIZE,
) {
  const snapshots: KnownCashSnapshotInput[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    snapshots.push(...page);
    if (page.length < pageSize) break;
  }
  return snapshots;
}

function requireReferenceDate(referenceDate: string) {
  const value = (referenceDate || "").trim();
  if (!isYmd(value)) throw new Error("A data de referência do saldo conhecido é inválida.");
  return value;
}

function isYmd(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  return local.getFullYear() === year && local.getMonth() === month - 1 && local.getDate() === day;
}

function parseLocalYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function optionalCents(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function integerCents(value: number | null) {
  return Math.trunc(Number(value ?? 0));
}
