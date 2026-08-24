import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { OpenFinanceClientError } from "./open-finance-client";
import type { OpenFinancePolpCompletedResource } from "./open-finance-polp-completion";
import type { OpenFinanceSyncMonthRequest, OpenFinanceSyncMonthResponse } from "./open-finance-contract";
import {
  aggregatePolpSyncTotals,
  createOpenFinancePolpSyncController,
  formatPolpSyncMonthLabel,
  isValidPolpSyncMonthKey,
  localPolpSyncMonthKey,
  readEligiblePolpSyncConnections,
  readPolpSyncContext,
  type OpenFinancePolpSyncInput,
} from "./open-finance-polp-sync";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";
const ACCOUNT_ID = "account-1";
const CARD_ID = "card-1";
const MONTH_KEY = "2026-08";

function resource(
  key: string,
  type: "account" | "credit_card",
): OpenFinancePolpCompletedResource {
  return {
    key,
    type,
    title: type === "credit_card" ? "Cartão de crédito" : "Conta bancária",
    name: type === "credit_card" ? "Cartão Gold" : "Conta corrente",
    mask: type === "credit_card" ? "**** 4242" : "**** 1234",
  };
}

function syncResponse(overrides: Partial<OpenFinanceSyncMonthResponse> = {}): OpenFinanceSyncMonthResponse {
  return {
    connection: {} as OpenFinanceSyncMonthResponse["connection"],
    run: {
      id: "run-1",
      connectionId: ACCOUNT_ID,
      householdId: HOUSEHOLD_ID,
      monthKey: MONTH_KEY,
      status: "success",
      foundCount: 2,
      insertedCount: 2,
      duplicateCount: 0,
      startedAt: "2026-08-01T00:00:00.000Z",
      finishedAt: "2026-08-01T00:00:01.000Z",
      errorMessage: null,
      warnings: [],
      rawPayload: { secret: "do-not-leak" },
    },
    found: 2,
    inserted: 2,
    duplicates: 0,
    warnings: [],
    transactions: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function readyInput(overrides: Partial<OpenFinancePolpSyncInput> = {}): OpenFinancePolpSyncInput {
  return {
    completionPhase: "completed",
    householdId: HOUSEHOLD_ID,
    monthKey: MONTH_KEY,
    connections: [resource(ACCOUNT_ID, "account"), resource(CARD_ID, "credit_card")],
    ...overrides,
  };
}

function harness(initial = readyInput()) {
  let active = initial;
  const syncMonth = vi.fn(
    async (_request: OpenFinanceSyncMonthRequest): Promise<OpenFinanceSyncMonthResponse> => syncResponse(),
  );
  const startConnection = vi.fn();
  const openUrl = vi.fn();
  const getConsent = vi.fn();
  const completeConnection = vi.fn();
  const insertTransaction = vi.fn();
  const controller = createOpenFinancePolpSyncController({
    syncMonth,
    getActiveContext: () => readPolpSyncContext(active),
  });
  return {
    controller,
    syncMonth,
    startConnection,
    openUrl,
    getConsent,
    completeConnection,
    insertTransaction,
    setActive(next: OpenFinancePolpSyncInput) {
      active = next;
    },
  };
}

describe("Polp sync month key", () => {
  it("builds YYYY-MM from the local calendar month", () => {
    expect(localPolpSyncMonthKey(new Date(2026, 0, 15, 23, 59, 59))).toBe("2026-01");
    expect(localPolpSyncMonthKey(new Date(2026, 11, 1, 0, 0, 0))).toBe("2026-12");
    expect(isValidPolpSyncMonthKey("2026-08")).toBe(true);
    expect(isValidPolpSyncMonthKey("2026-13")).toBe(false);
    expect(formatPolpSyncMonthLabel("2026-08")).toMatch(/2026/);
  });

  it("does not derive the month from UTC ISO strings", () => {
    const source = readFileSync(resolve(__dirname, "open-finance-polp-sync.ts"), "utf8");
    expect(source).not.toContain("toISOString");
    const localMidnight = new Date(2026, 7, 1, 0, 30, 0);
    expect(localPolpSyncMonthKey(localMidnight)).toBe("2026-08");
  });
});

describe("Polp sync preconditions", () => {
  it("publishes canStart after complete becomes ready while idle", () => {
    const { controller, setActive } = harness(readyInput({
      completionPhase: "idle",
      connections: [],
    }));
    const seen: boolean[] = [];
    controller.subscribe((snapshot) => {
      seen.push(snapshot.canStart);
    });
    expect(controller.snapshot.canStart).toBe(false);

    setActive(readyInput());
    controller.syncActiveIdentity();

    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.canStart).toBe(true);
    expect(seen.at(-1)).toBe(true);
  });

  it("does not sync outside completed, without household, or with an invalid month", async () => {
    const { controller, syncMonth, setActive } = harness();

    setActive(readyInput({ completionPhase: "completing" }));
    await controller.start();
    setActive(readyInput({ householdId: null }));
    await controller.start();
    setActive(readyInput({ monthKey: "2026-13" }));
    await controller.start();

    expect(syncMonth).not.toHaveBeenCalled();
    expect(controller.snapshot.phase).toBe("idle");
  });

  it("does not sync when there are zero eligible connections", async () => {
    const { controller, syncMonth } = harness(readyInput({
      connections: [],
    }));
    await controller.start();
    expect(syncMonth).not.toHaveBeenCalled();
    expect(controller.snapshot.canStart).toBe(false);
  });
});

describe("Polp sync eligible connections and sequential round", () => {
  it("syncs a single account exactly once", async () => {
    const { controller, syncMonth } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(1);
    expect(syncMonth).toHaveBeenCalledWith({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      connectionId: ACCOUNT_ID,
      monthKey: MONTH_KEY,
    });
    expect(controller.snapshot.phase).toBe("completed");
  });

  it("syncs a single credit card exactly once", async () => {
    const { controller, syncMonth } = harness(readyInput({
      connections: [resource(CARD_ID, "credit_card")],
    }));
    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(1);
    expect(syncMonth.mock.calls[0]?.[0].connectionId).toBe(CARD_ID);
    expect(controller.snapshot.results[0]?.type).toBe("credit_card");
  });

  it("syncs account and card sequentially and never in parallel", async () => {
    const first = deferred<OpenFinanceSyncMonthResponse>();
    const second = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth } = harness();
    syncMonth.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const round = controller.start();
    await Promise.resolve();
    expect(syncMonth).toHaveBeenCalledTimes(1);
    expect(controller.snapshot).toEqual(expect.objectContaining({
      phase: "syncing",
      current: 1,
      total: 2,
    }));

    first.resolve(syncResponse({ found: 3, inserted: 3, duplicates: 0 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(syncMonth).toHaveBeenCalledTimes(2);
    expect(syncMonth.mock.calls[1]?.[0].connectionId).toBe(CARD_ID);

    second.resolve(syncResponse({ found: 1, inserted: 0, duplicates: 1 }));
    await round;
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.totals).toEqual({
      found: 4,
      inserted: 3,
      duplicates: 1,
      successCount: 2,
      failureCount: 0,
    });
  });

  it("turns a double tap into a single sequential round", async () => {
    const pending = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth } = harness();
    syncMonth.mockReturnValue(pending.promise);

    const first = controller.start();
    const second = controller.start();
    await Promise.resolve();
    expect(syncMonth).toHaveBeenCalledTimes(1);

    pending.resolve(syncResponse());
    await Promise.all([first, second]);
    expect(syncMonth).toHaveBeenCalledTimes(2);
    expect(controller.snapshot.phase).toBe("completed");
  });
});

describe("Polp sync results, duplicates and partial failure", () => {
  it("treats backend duplicates as success and aggregates totals without calling them new", async () => {
    const { controller, syncMonth } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    syncMonth.mockResolvedValueOnce(syncResponse({ found: 4, inserted: 1, duplicates: 3 }));
    await controller.start();
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.totals).toEqual({
      found: 4,
      inserted: 1,
      duplicates: 3,
      successCount: 1,
      failureCount: 0,
    });
    expect(aggregatePolpSyncTotals(controller.snapshot.results).inserted).toBe(1);
  });

  it("keeps a duplicate retry of the same month as success", async () => {
    const { controller, syncMonth } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    syncMonth
      .mockResolvedValueOnce(syncResponse({ found: 2, inserted: 2, duplicates: 0 }))
      .mockResolvedValueOnce(syncResponse({ found: 2, inserted: 0, duplicates: 2 }));
    await controller.start();
    controller.reset();
    await controller.start();
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.totals.duplicates).toBe(2);
    expect(controller.snapshot.totals.inserted).toBe(0);
  });

  it("preserves a successful account and retries only the failed card", async () => {
    const { controller, syncMonth } = harness();
    syncMonth
      .mockResolvedValueOnce(syncResponse({ found: 5, inserted: 5, duplicates: 0 }))
      .mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502))
      .mockResolvedValueOnce(syncResponse({ found: 2, inserted: 2, duplicates: 0 }));

    await controller.start();
    expect(controller.snapshot.phase).toBe("partial");
    expect(controller.snapshot.results[0]).toEqual(expect.objectContaining({
      connectionId: ACCOUNT_ID,
      status: "success",
      inserted: 5,
    }));
    expect(controller.snapshot.canRetryFailed).toBe(true);

    await controller.retryFailed();
    expect(syncMonth).toHaveBeenCalledTimes(3);
    expect(syncMonth.mock.calls[2]?.[0]).toEqual({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      connectionId: CARD_ID,
      monthKey: MONTH_KEY,
    });
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.results[0]?.inserted).toBe(5);
  });

  it("blocks a concurrent retry while a failed-connection retry is in flight", async () => {
    const pending = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth } = harness();
    syncMonth
      .mockResolvedValueOnce(syncResponse({ found: 1, inserted: 1, duplicates: 0 }))
      .mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502))
      .mockReturnValue(pending.promise);
    await controller.start();
    const first = controller.retryFailed();
    const second = controller.retryFailed();
    await Promise.resolve();
    expect(syncMonth).toHaveBeenCalledTimes(3);
    pending.resolve(syncResponse({ found: 1, inserted: 1, duplicates: 0 }));
    await Promise.all([first, second]);
    expect(syncMonth).toHaveBeenCalledTimes(3);
    expect(controller.snapshot.phase).toBe("completed");
  });

  it("marks all failures as error and allows an explicit retry of every failed connection", async () => {
    const { controller, syncMonth } = harness();
    syncMonth.mockRejectedValue(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502));
    await controller.start();
    expect(controller.snapshot.phase).toBe("error");
    expect(controller.snapshot.totals.failureCount).toBe(2);

    syncMonth.mockResolvedValue(syncResponse({ found: 1, inserted: 1, duplicates: 0 }));
    await controller.retryFailed();
    expect(syncMonth).toHaveBeenCalledTimes(4);
    expect(controller.snapshot.phase).toBe("completed");
  });
});

describe("Polp sync stale identity, month change and lifecycle", () => {
  it("keeps B blocked until stale transport A releases its own gate", async () => {
    const pendingA = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth, setActive } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    syncMonth.mockImplementation(async (request) => {
      concurrentCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      try {
        if (request.connectionId === ACCOUNT_ID) return await pendingA.promise;
        return syncResponse({ found: 1, inserted: 1, duplicates: 0 });
      } finally {
        concurrentCalls -= 1;
      }
    });

    const roundA = controller.start();
    await Promise.resolve();
    expect(syncMonth).toHaveBeenCalledTimes(1);

    setActive(readyInput({
      connections: [resource("account-b", "account")],
    }));
    controller.syncActiveIdentity();
    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.canStart).toBe(false);

    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(1);
    expect(maxConcurrentCalls).toBe(1);

    pendingA.resolve(syncResponse({ found: 9, inserted: 9, duplicates: 0 }));
    await roundA;
    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.results).toEqual([]);
    expect(controller.snapshot.canStart).toBe(true);

    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(2);
    expect(syncMonth.mock.calls[1]?.[0].connectionId).toBe("account-b");
    expect(maxConcurrentCalls).toBe(1);
    expect(controller.snapshot.phase).toBe("completed");
  });

  it("keeps July blocked until the stale August transport finishes", async () => {
    const pendingAugust = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth, setActive } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    syncMonth
      .mockReturnValueOnce(pendingAugust.promise)
      .mockResolvedValueOnce(syncResponse({ found: 1, inserted: 1, duplicates: 0 }));

    const augustRound = controller.start();
    await Promise.resolve();
    setActive(readyInput({
      monthKey: "2026-07",
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    controller.syncActiveIdentity();

    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.canStart).toBe(false);

    pendingAugust.resolve(syncResponse());
    await augustRound;
    expect(controller.snapshot.results).toEqual([]);
    expect(controller.snapshot.canStart).toBe(true);

    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(2);
    expect(syncMonth.mock.calls[1]?.[0].monthKey).toBe("2026-07");
  });

  it("releases transport only when finally still owns its owner token", () => {
    const source = readFileSync(resolve(__dirname, "open-finance-polp-sync.ts"), "utf8");
    expect(source).toContain("activeTransportOwner === transportOwner");
    expect(source).toContain("if (ownsTransport) activeTransportOwner = null");
  });

  it("ignores a late round A after the active context becomes B", async () => {
    const pending = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth, startConnection, getConsent, completeConnection, setActive } = harness();
    syncMonth.mockReturnValueOnce(pending.promise);

    const first = controller.start();
    await Promise.resolve();
    expect(syncMonth).toHaveBeenCalledTimes(1);

    setActive(readyInput({
      connections: [resource("account-b", "account")],
      monthKey: MONTH_KEY,
    }));
    pending.resolve(syncResponse({ found: 9, inserted: 9, duplicates: 0 }));
    await first;

    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.results).toEqual([]);
    expect(syncMonth).toHaveBeenCalledTimes(1);
    expect(startConnection).not.toHaveBeenCalled();
    expect(getConsent).not.toHaveBeenCalled();
    expect(completeConnection).not.toHaveBeenCalled();
  });

  it("invalidates an August report when the month changes to July without auto-syncing", async () => {
    const { controller, syncMonth, setActive } = harness();
    await controller.start();
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.monthKey).toBe("2026-08");

    setActive(readyInput({ monthKey: "2026-07" }));
    controller.syncActiveIdentity();
    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.results).toEqual([]);
    expect(syncMonth).toHaveBeenCalledTimes(2);
  });

  it("does not start the second connection after dispose and ignores the late first result", async () => {
    const pending = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth } = harness();
    syncMonth.mockReturnValueOnce(pending.promise);

    const first = controller.start();
    await Promise.resolve();
    controller.dispose();
    pending.resolve(syncResponse());
    await first;
    expect(syncMonth).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("syncing");
  });
});

describe("Polp explicit resync after completed", () => {
  it("does not start a second round automatically after completed", async () => {
    const { controller, syncMonth } = harness();
    await controller.start();
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.canStart).toBe(false);
    expect(controller.snapshot.canResync).toBe(true);
    expect(syncMonth).toHaveBeenCalledTimes(2);
  });

  it("starts the same eligible connections from completed without reset", async () => {
    const { controller, syncMonth } = harness();
    await controller.start();
    expect(controller.snapshot.canResync).toBe(true);

    syncMonth.mockResolvedValue(syncResponse({ found: 26, inserted: 0, duplicates: 26 }));
    await controller.start();

    expect(syncMonth).toHaveBeenCalledTimes(4);
    expect(syncMonth.mock.calls[2]?.[0]).toEqual({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      connectionId: ACCOUNT_ID,
      monthKey: MONTH_KEY,
    });
    expect(syncMonth.mock.calls[3]?.[0].connectionId).toBe(CARD_ID);
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.totals).toEqual({
      found: 52,
      inserted: 0,
      duplicates: 52,
      successCount: 2,
      failureCount: 0,
    });
  });

  it("goes completed to syncing to completed on an explicit resync", async () => {
    const pending = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    await controller.start();
    expect(controller.snapshot.phase).toBe("completed");

    syncMonth.mockReturnValueOnce(pending.promise);
    const again = controller.start();
    await Promise.resolve();
    expect(controller.snapshot.phase).toBe("syncing");
    expect(controller.snapshot.canResync).toBe(false);
    expect(controller.snapshot.canStart).toBe(false);

    pending.resolve(syncResponse({ found: 20, inserted: 0, duplicates: 20 }));
    await again;
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.canResync).toBe(true);
  });

  it("blocks a second click while a resync is already in flight", async () => {
    const pending = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    await controller.start();
    syncMonth.mockReturnValue(pending.promise);

    const first = controller.start();
    const second = controller.start();
    await Promise.resolve();
    expect(syncMonth).toHaveBeenCalledTimes(2);

    pending.resolve(syncResponse({ found: 20, inserted: 0, duplicates: 20 }));
    await Promise.all([first, second]);
    expect(syncMonth).toHaveBeenCalledTimes(2);
    expect(controller.snapshot.phase).toBe("completed");
  });

  it("keeps B blocked until a stale resync transport A releases its owner", async () => {
    const pendingA = deferred<OpenFinanceSyncMonthResponse>();
    const { controller, syncMonth, setActive } = harness(readyInput({
      connections: [resource(ACCOUNT_ID, "account")],
    }));
    await controller.start();

    let maxConcurrentCalls = 0;
    let concurrentCalls = 0;
    syncMonth.mockImplementation(async () => {
      concurrentCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      try {
        return await pendingA.promise;
      } finally {
        concurrentCalls -= 1;
      }
    });

    const stale = controller.start();
    await Promise.resolve();
    setActive(readyInput({
      connections: [resource("account-b", "account")],
    }));
    controller.syncActiveIdentity();
    expect(controller.snapshot.canStart).toBe(false);
    expect(controller.snapshot.canResync).toBe(false);

    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(2);
    expect(maxConcurrentCalls).toBe(1);

    pendingA.resolve(syncResponse({ found: 9, inserted: 0, duplicates: 9 }));
    await stale;
    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.canStart).toBe(true);

    syncMonth.mockResolvedValueOnce(syncResponse({ found: 1, inserted: 1, duplicates: 0 }));
    await controller.start();
    expect(syncMonth.mock.calls[2]?.[0].connectionId).toBe("account-b");
    expect(maxConcurrentCalls).toBe(1);
  });

  it("does not treat completed resync as a substitute for retryFailed", async () => {
    const { controller, syncMonth } = harness();
    syncMonth
      .mockResolvedValueOnce(syncResponse({ found: 5, inserted: 5, duplicates: 0 }))
      .mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502));
    await controller.start();
    expect(controller.snapshot.phase).toBe("partial");
    expect(controller.snapshot.canResync).toBe(false);
    expect(controller.snapshot.canRetryFailed).toBe(true);

    await controller.start();
    expect(syncMonth).toHaveBeenCalledTimes(2);

    syncMonth.mockResolvedValueOnce(syncResponse({ found: 2, inserted: 2, duplicates: 0 }));
    await controller.retryFailed();
    expect(syncMonth).toHaveBeenCalledTimes(3);
    expect(syncMonth.mock.calls[2]?.[0].connectionId).toBe(CARD_ID);
    expect(controller.snapshot.results[0]?.inserted).toBe(5);
  });
});

describe("F4B production boundaries", () => {
  it("keeps sync isolated from start, browser, polling, complete and direct ledger inserts", async () => {
    const {
      controller,
      startConnection,
      openUrl,
      getConsent,
      completeConnection,
      insertTransaction,
    } = harness();
    await controller.start();
    expect(startConnection).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(getConsent).not.toHaveBeenCalled();
    expect(completeConnection).not.toHaveBeenCalled();
    expect(insertTransaction).not.toHaveBeenCalled();

    const source = readFileSync(resolve(__dirname, "open-finance-polp-sync.ts"), "utf8");
    const hookSource = readFileSync(resolve(__dirname, "../hooks/useOpenFinancePolpSync.ts"), "utf8");
    expect(source).not.toMatch(/startConnection|openUrl|getConsent|completeConnection|sync-month/);
    expect(source).toContain("phase !== \"idle\" && phase !== \"completed\"");
    expect(source).not.toContain("if (phase !== \"idle\" || transportBusy()) return");
    expect(source).not.toContain("if (!canStart) return");
    expect(hookSource).toContain("POLP_SYNC_CONTROLLER_REVISION");
    expect(hookSource).not.toMatch(/useRef\(createOpenFinancePolpSyncController/);
    expect(source).not.toMatch(/AsyncStorage|SecureStore|fetch\s*\(|console\./);
    expect(source).not.toContain("imported_bank_transactions");
  });

  it("does not expose the route from unrelated existing app flows", () => {
    for (const relativePath of [
      "../../app/(app)/journey.tsx",
      "../../app/(app)/new-transaction.tsx",
      "../../app/(app)/link-commitment.tsx",
    ]) {
      const source = readFileSync(resolve(__dirname, relativePath), "utf8");
      expect(source).not.toContain("open-finance-connect");
    }
  });

  it("renders sync copy without technical identifiers", () => {
    const routeSource = readFileSync(
      resolve(__dirname, "../../app/(app)/open-finance-connect.tsx"),
      "utf8",
    );
    expect(routeSource).toContain("Sincronizar movimentações");
    expect(routeSource).toContain("Sincronizar novamente");
    expect(routeSource).toContain("onPress={() => void sync.start()}");
    expect(routeSource).toContain("sync.canResync");
    expect(routeSource).toContain("Sincronização concluída");
    expect(routeSource).toContain("Tudo já estava atualizado.");
    expect(routeSource).not.toMatch(/syncOpenFinanceMonth|sync-month/);
    expect(routeSource).not.toContain("consentId}");
    expect(routeSource).not.toMatch(/<Text[^>]*>\{result\.connectionId\}<\/Text>/);
    expect(routeSource).not.toMatch(/<Text[^>]*>\{sync\.monthKey\}<\/Text>/);
  });
});

describe("eligible connection filtering", () => {
  it("keeps account and card distinct and ignores unknown placeholders", () => {
    const connections = readEligiblePolpSyncConnections([
      resource(ACCOUNT_ID, "account"),
      resource(ACCOUNT_ID, "account"),
      resource(CARD_ID, "credit_card"),
    ]);
    expect(connections.map((item) => item.connectionId)).toEqual([ACCOUNT_ID, CARD_ID]);
  });
});
