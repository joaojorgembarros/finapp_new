import { OpenFinanceClientError } from "./open-finance-client";
import type {
  OpenFinancePolpCompletedResource,
  OpenFinancePolpCompletionPhase,
} from "./open-finance-polp-completion";
import type {
  OpenFinanceSyncMonthRequest,
  OpenFinanceSyncMonthResponse,
} from "./open-finance-contract";

export type OpenFinancePolpSyncPhase =
  | "idle"
  | "syncing"
  | "completed"
  | "partial"
  | "error";

export type OpenFinancePolpSyncableType = "account" | "credit_card";

export type OpenFinancePolpSyncableConnection = {
  connectionId: string;
  type: OpenFinancePolpSyncableType;
  title: string;
  name: string;
};

export type OpenFinancePolpConnectionSyncResult = {
  connectionId: string;
  type: OpenFinancePolpSyncableType;
  title: string;
  name: string;
  status: "success" | "error";
  found: number;
  inserted: number;
  duplicates: number;
  errorMessage: string | null;
};

export type OpenFinancePolpSyncTotals = {
  found: number;
  inserted: number;
  duplicates: number;
  successCount: number;
  failureCount: number;
};

export type OpenFinancePolpSyncIdentity = {
  householdId: string;
  monthKey: string;
  connectionIds: string[];
};

export type OpenFinancePolpSyncSnapshot = {
  phase: OpenFinancePolpSyncPhase;
  monthKey: string | null;
  monthLabel: string | null;
  current: number;
  total: number;
  results: OpenFinancePolpConnectionSyncResult[];
  totals: OpenFinancePolpSyncTotals;
  errorMessage: string | null;
  canStart: boolean;
  canRetryFailed: boolean;
};

export type OpenFinancePolpSyncInput = {
  completionPhase: OpenFinancePolpCompletionPhase;
  householdId: string | null | undefined;
  monthKey: string | null | undefined;
  connections: OpenFinancePolpCompletedResource[];
};

export type OpenFinancePolpSyncDependencies = {
  syncMonth: (request: OpenFinanceSyncMonthRequest) => Promise<OpenFinanceSyncMonthResponse>;
  getActiveContext: () => OpenFinancePolpSyncContext | null;
};

export type OpenFinancePolpSyncContext = {
  householdId: string;
  monthKey: string;
  connections: OpenFinancePolpSyncableConnection[];
};

const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const GENERIC_SYNC_ERROR = "Não foi possível sincronizar as movimentações. Tente novamente.";

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export function localPolpSyncMonthKey(now: Date = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function isValidPolpSyncMonthKey(value: string) {
  return MONTH_KEY_PATTERN.test(value.trim());
}

export function formatPolpSyncMonthLabel(monthKey: string, locale = "pt-BR") {
  if (!isValidPolpSyncMonthKey(monthKey)) return null;
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}

export function readEligiblePolpSyncConnections(
  resources: OpenFinancePolpCompletedResource[],
) {
  const byId = new Map<string, OpenFinancePolpSyncableConnection>();
  for (const resource of resources) {
    if (resource.type !== "account" && resource.type !== "credit_card") continue;
    const connectionId = readNonEmptyString(resource.key);
    if (!connectionId) continue;
    if (byId.has(connectionId)) continue;
    byId.set(connectionId, {
      connectionId,
      type: resource.type,
      title: readNonEmptyString(resource.title) ?? (resource.type === "credit_card" ? "Cartão de crédito" : "Conta bancária"),
      name: readNonEmptyString(resource.name) ?? (readNonEmptyString(resource.title) ?? "Conexão"),
    });
  }
  return [...byId.values()];
}

export function samePolpSyncIdentity(
  a: OpenFinancePolpSyncIdentity | null | undefined,
  b: OpenFinancePolpSyncIdentity | null | undefined,
) {
  return Boolean(
    a
    && b
    && a.householdId === b.householdId
    && a.monthKey === b.monthKey
    && a.connectionIds.length === b.connectionIds.length
    && a.connectionIds.every((id, index) => id === b.connectionIds[index]),
  );
}

function toIdentity(context: OpenFinancePolpSyncContext): OpenFinancePolpSyncIdentity {
  return {
    householdId: context.householdId,
    monthKey: context.monthKey,
    connectionIds: context.connections.map((item) => item.connectionId),
  };
}

export function readPolpSyncContext(input: OpenFinancePolpSyncInput): OpenFinancePolpSyncContext | null {
  if (input.completionPhase !== "completed") return null;
  const householdId = readNonEmptyString(input.householdId);
  const monthKey = readNonEmptyString(input.monthKey);
  if (!householdId || !monthKey || !isValidPolpSyncMonthKey(monthKey)) return null;
  const connections = readEligiblePolpSyncConnections(input.connections);
  if (!connections.length) return null;
  return { householdId, monthKey, connections };
}

function emptyTotals(): OpenFinancePolpSyncTotals {
  return {
    found: 0,
    inserted: 0,
    duplicates: 0,
    successCount: 0,
    failureCount: 0,
  };
}

export function aggregatePolpSyncTotals(results: OpenFinancePolpConnectionSyncResult[]) {
  return results.reduce((totals, result) => ({
    found: totals.found + result.found,
    inserted: totals.inserted + result.inserted,
    duplicates: totals.duplicates + result.duplicates,
    successCount: totals.successCount + (result.status === "success" ? 1 : 0),
    failureCount: totals.failureCount + (result.status === "error" ? 1 : 0),
  }), emptyTotals());
}

function readSyncCounts(response: OpenFinanceSyncMonthResponse) {
  const found = readCount(response.found);
  const inserted = readCount(response.inserted);
  const duplicates = readCount(response.duplicates);
  if (found == null || inserted == null || duplicates == null) {
    throw new TypeError("A sincronização retornou totais inválidos.");
  }
  return { found, inserted, duplicates };
}

function syncError(error: unknown) {
  if (error instanceof OpenFinanceClientError) {
    return {
      message: error.message || GENERIC_SYNC_ERROR,
    };
  }
  return { message: GENERIC_SYNC_ERROR };
}

function finishPhase(totals: OpenFinancePolpSyncTotals): OpenFinancePolpSyncPhase {
  if (totals.failureCount === 0) return "completed";
  if (totals.successCount === 0) return "error";
  return "partial";
}

export function createOpenFinancePolpSyncController(
  deps: OpenFinancePolpSyncDependencies,
) {
  let phase: OpenFinancePolpSyncPhase = "idle";
  let monthKey: string | null = null;
  let current = 0;
  let total = 0;
  let results: OpenFinancePolpConnectionSyncResult[] = [];
  let errorMessage: string | null = null;
  let round: OpenFinancePolpSyncContext | null = null;
  let generation = 0;
  let nextTransportOwner = 0;
  let activeTransportOwner: number | null = null;
  const listeners = new Set<(snapshot: OpenFinancePolpSyncSnapshot) => void>();

  function transportBusy() {
    return activeTransportOwner !== null;
  }

  function snapshot(): OpenFinancePolpSyncSnapshot {
    const totals = aggregatePolpSyncTotals(results);
    const active = deps.getActiveContext();
    return {
      phase,
      monthKey,
      monthLabel: monthKey ? formatPolpSyncMonthLabel(monthKey) : null,
      current,
      total,
      results,
      totals,
      errorMessage,
      canStart: phase === "idle" && !transportBusy() && Boolean(active),
      canRetryFailed: (phase === "partial" || phase === "error")
        && totals.failureCount > 0
        && !transportBusy()
        && samePolpSyncIdentity(round ? toIdentity(round) : null, active ? toIdentity(active) : null),
    };
  }

  function emit() {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function clearToIdle() {
    generation += 1;
    round = null;
    phase = "idle";
    monthKey = null;
    current = 0;
    total = 0;
    results = [];
    errorMessage = null;
  }

  function reset() {
    clearToIdle();
    emit();
  }

  function belongsToActiveIdentity(context: OpenFinancePolpSyncContext | null) {
    const active = deps.getActiveContext();
    return samePolpSyncIdentity(
      context ? toIdentity(context) : null,
      active ? toIdentity(active) : null,
    );
  }

  function isCurrent(token: number, context: OpenFinancePolpSyncContext) {
    if (token !== generation) return false;
    if (belongsToActiveIdentity(context)) return true;
    reset();
    return false;
  }

  function syncActiveIdentity() {
    if (!round && phase === "idle") {
      emit();
      return;
    }
    if (belongsToActiveIdentity(round)) return;
    reset();
  }

  function upsertResult(result: OpenFinancePolpConnectionSyncResult) {
    const index = results.findIndex((item) => item.connectionId === result.connectionId);
    if (index >= 0) results[index] = result;
    else results = [...results, result];
  }

  async function run(context: OpenFinancePolpSyncContext, queue: OpenFinancePolpSyncableConnection[]) {
    if (transportBusy()) return;
    const transportOwner = ++nextTransportOwner;
    activeTransportOwner = transportOwner;
    phase = "syncing";
    monthKey = context.monthKey;
    errorMessage = null;
    const token = ++generation;
    emit();

    try {
      for (let index = 0; index < queue.length; index += 1) {
        if (!isCurrent(token, context)) return;
        const connection = queue[index];
        current = index + 1;
        total = queue.length;
        emit();
        try {
          const response = await deps.syncMonth({
            provider: "polp",
            householdId: context.householdId,
            connectionId: connection.connectionId,
            monthKey: context.monthKey,
          });
          if (!isCurrent(token, context)) return;
          const counts = readSyncCounts(response);
          upsertResult({
            connectionId: connection.connectionId,
            type: connection.type,
            title: connection.title,
            name: connection.name,
            status: "success",
            ...counts,
            errorMessage: null,
          });
        } catch (error) {
          if (!isCurrent(token, context)) return;
          upsertResult({
            connectionId: connection.connectionId,
            type: connection.type,
            title: connection.title,
            name: connection.name,
            status: "error",
            found: 0,
            inserted: 0,
            duplicates: 0,
            errorMessage: syncError(error).message,
          });
        }
      }
      if (!isCurrent(token, context)) return;
      const totals = aggregatePolpSyncTotals(results);
      phase = finishPhase(totals);
      errorMessage = phase === "error"
        ? (results.find((item) => item.status === "error")?.errorMessage ?? GENERIC_SYNC_ERROR)
        : phase === "partial"
          ? "Parte das movimentações foi sincronizada. Você pode tentar novamente as que falharam."
          : null;
    } finally {
      const ownsTransport = activeTransportOwner === transportOwner;
      if (ownsTransport) activeTransportOwner = null;
      if (ownsTransport || token === generation) emit();
    }
  }

  return {
    get snapshot() {
      return snapshot();
    },
    subscribe(listener: (value: OpenFinancePolpSyncSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      if (phase !== "idle" || transportBusy()) return;
      const active = deps.getActiveContext();
      if (!active) return;
      round = active;
      results = [];
      current = 0;
      total = active.connections.length;
      await run(active, active.connections);
    },
    async retryFailed() {
      if (transportBusy() || (phase !== "partial" && phase !== "error") || !round) return;
      if (!belongsToActiveIdentity(round)) {
        reset();
        return;
      }
      const failedIds = new Set(
        results.filter((item) => item.status === "error").map((item) => item.connectionId),
      );
      const queue = round.connections.filter((item) => failedIds.has(item.connectionId));
      if (!queue.length) return;
      await run(round, queue);
    },
    syncActiveIdentity,
    reset,
    dispose() {
      generation += 1;
      listeners.clear();
    },
  };
}
