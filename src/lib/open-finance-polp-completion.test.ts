import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { OpenFinanceClientError } from "./open-finance-client";
import type {
  OpenFinanceConnection,
  OpenFinancePolpCompleteConnectionRequest,
  OpenFinancePolpCompleteConnectionResponse,
  OpenFinancePolpConsentStatus,
} from "./open-finance-contract";
import {
  createOpenFinancePolpCompletionController,
  readCompletionIdentity,
  readPolpCompletedResources,
  type OpenFinancePolpCompletionInput,
} from "./open-finance-polp-completion";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";
const CONSENT_ID = "consent-1";
const CONSENT_B_ID = "consent-2";

const CONSENT: OpenFinancePolpConsentStatus = {
  provider: "polp",
  consentId: CONSENT_ID,
  connectionId: null,
  status: "active",
  providerStatus: "AUTHORISED",
  executionStatus: "SUCCESS",
  resourcesReady: true,
  flags: [],
  hasProviderError: false,
  authorizationUrl: null,
  authorizationExpiresAt: null,
  expiresAt: null,
  products: ["ACCOUNT", "CREDIT_CARD_ACCOUNT"],
};

function connection(
  id: string,
  resourceType: "account" | "credit_card",
  overrides: Partial<OpenFinanceConnection> = {},
): OpenFinanceConnection {
  return {
    id,
    householdId: HOUSEHOLD_ID,
    userId: "a20e8400-e29b-41d4-a716-446655440020",
    provider: "polp",
    institution: {
      id: "institution-1",
      name: "Banco Exemplo",
      displayName: "Banco Exemplo",
      provider: "polp",
      connectorId: null,
    },
    accountName: resourceType === "account" ? "Conta corrente" : "Cartão Gold",
    accountMask: resourceType === "account" ? "**** 1234" : "**** 4242",
    externalConnectionId: CONSENT_ID,
    externalAccountId: `${resourceType}-external`,
    status: "connected",
    consent: null,
    consentStatus: "active",
    consentExpiresAt: null,
    lastSyncedAt: null,
    lastSyncStatus: "idle",
    lastSyncRun: null,
    resourceType,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    rawPayload: null,
    ...overrides,
  } as OpenFinanceConnection;
}

function response(
  connections: OpenFinanceConnection[] = [],
  consentId = CONSENT_ID,
): OpenFinancePolpCompleteConnectionResponse {
  return {
    itemId: consentId,
    consentId,
    consent: { ...CONSENT, consentId },
    connections,
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

function readyInput(consentId = CONSENT_ID) {
  return {
    authorizationPhase: "ready_to_complete" as const,
    householdId: HOUSEHOLD_ID,
    consentId,
  };
}

function harness() {
  let active: OpenFinancePolpCompletionInput = readyInput();
  const completeConnection = vi.fn(
    async (request: OpenFinancePolpCompleteConnectionRequest): Promise<OpenFinancePolpCompleteConnectionResponse> =>
      response([], request.consentId),
  );
  const startConnection = vi.fn();
  const openUrl = vi.fn();
  const getConsent = vi.fn();
  const syncOpenFinanceMonth = vi.fn();
  const controller = createOpenFinancePolpCompletionController({
    completeConnection,
    getActiveContext: () => readCompletionIdentity(active),
  });
  return {
    controller,
    completeConnection,
    startConnection,
    openUrl,
    getConsent,
    syncOpenFinanceMonth,
    setActive(next: OpenFinancePolpCompletionInput) {
      active = next;
    },
  };
}

describe("Polp completion preconditions and gate", () => {
  it("does not complete outside ready_to_complete or without required identifiers", async () => {
    const { controller, completeConnection } = harness();

    await controller.complete({ ...readyInput(), authorizationPhase: "checking" });
    await controller.complete({ ...readyInput(), householdId: null });
    await controller.complete({ ...readyInput(), consentId: " " });

    expect(completeConnection).not.toHaveBeenCalled();
    expect(controller.snapshot.phase).toBe("idle");
  });

  it("turns a valid explicit action and a double tap into exactly one request", async () => {
    const pending = deferred<OpenFinancePolpCompleteConnectionResponse>();
    const { controller, completeConnection } = harness();
    completeConnection.mockReturnValue(pending.promise);

    const first = controller.complete(readyInput());
    const second = controller.complete(readyInput());
    expect(controller.snapshot.phase).toBe("completing");
    expect(completeConnection).toHaveBeenCalledTimes(1);
    expect(completeConnection).toHaveBeenCalledWith({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: CONSENT_ID,
    });

    pending.resolve(response([connection("account-1", "account")]));
    await Promise.all([first, second]);
    expect(controller.snapshot.phase).toBe("completed");
  });
});

describe("Polp completion response interpretation", () => {
  it.each([
    ["account only", [connection("account-1", "account")], ["account"]],
    ["credit card only", [connection("card-1", "credit_card")], ["credit_card"]],
    [
      "account and credit card",
      [connection("account-1", "account"), connection("card-1", "credit_card")],
      ["account", "credit_card"],
    ],
    ["zero resources", [], []],
  ])("completes with %s", async (_label, connections, expectedTypes) => {
    const { controller, completeConnection } = harness();
    completeConnection.mockResolvedValue(response(connections as OpenFinanceConnection[]));

    await controller.complete(readyInput());

    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.resources.map((item) => item.type)).toEqual(expectedTypes);
  });

  it("supports multiple resources and deduplicates by the stable connection id", () => {
    const first = connection("account-1", "account");
    const resources = readPolpCompletedResources(response([
      first,
      first,
      connection("account-2", "account"),
      connection("card-1", "credit_card"),
    ]), CONSENT_ID);

    expect(resources).toHaveLength(3);
    expect(resources.map((item) => item.key)).toEqual(["account-1", "account-2", "card-1"]);
  });

  it("ignores unrelated providers, consents, placeholders and malformed presentation fields", () => {
    const resources = readPolpCompletedResources(response([
      connection("account-1", "account"),
      connection("other-consent", "account", { externalConnectionId: "consent-other" }),
      connection("placeholder", "account", { resourceType: "consent" }),
      connection("pluggy-1", "account", { provider: "pluggy" }),
    ]), CONSENT_ID);

    expect(resources).toEqual([{
      key: "account-1",
      type: "account",
      title: "Conta bancária",
      name: "Conta corrente",
      mask: "**** 1234",
    }]);
  });

  it("rejects a complete response bound to another consent", async () => {
    const { controller, completeConnection } = harness();
    completeConnection.mockResolvedValue({
      ...response(),
      consentId: "consent-other",
    });

    await controller.complete(readyInput());

    expect(controller.snapshot.phase).toBe("error");
    expect(controller.snapshot.errorMessage).toBe("Não foi possível concluir a conexão. Tente novamente.");
    expect(controller.snapshot.resources).toEqual([]);
  });
});

describe("Polp completion retry, errors and lifecycle", () => {
  it("treats confirmed resources pending as safe and retryable using the same consent", async () => {
    const { controller, completeConnection } = harness();
    completeConnection
      .mockRejectedValueOnce(new OpenFinanceClientError(
        "Consentimento autorizado; recursos Polp ainda estão em processamento.",
        "CONSENT_RESOURCES_PENDING",
        409,
      ))
      .mockResolvedValueOnce(response([connection("account-1", "account")]));

    await controller.complete(readyInput());
    expect(controller.snapshot).toEqual(expect.objectContaining({
      phase: "error",
      errorCode: "CONSENT_RESOURCES_PENDING",
      errorStatus: 409,
      retryable: true,
    }));
    expect(controller.snapshot.errorMessage).not.toContain("Polp");

    await controller.retry();
    expect(completeConnection).toHaveBeenCalledTimes(2);
    expect(completeConnection.mock.calls[1]?.[0]).toEqual(completeConnection.mock.calls[0]?.[0]);
    expect(controller.snapshot.phase).toBe("completed");
  });

  it("uses a structured safe client message and never exposes an unknown raw error", async () => {
    const { controller, completeConnection } = harness();
    completeConnection.mockRejectedValueOnce(new OpenFinanceClientError(
      "Sua sessão expirou. Entre novamente.",
      "UNAUTHORIZED",
      401,
    ));
    await controller.complete(readyInput());
    expect(controller.snapshot.errorMessage).toBe("Sua sessão expirou. Entre novamente.");
    expect(controller.snapshot.errorCode).toBe("UNAUTHORIZED");
    expect(controller.snapshot.errorStatus).toBe(401);

    controller.reset();
    completeConnection.mockRejectedValueOnce({ rawBody: { consentId: CONSENT_ID, cpf: "12345678901" } });
    await controller.complete(readyInput());
    expect(controller.snapshot.errorMessage).toBe("Não foi possível concluir a conexão. Tente novamente.");
  });

  it("ignores a late success after reset or disposal", async () => {
    const pendingAfterReset = deferred<OpenFinancePolpCompleteConnectionResponse>();
    const { controller, completeConnection } = harness();
    completeConnection.mockReturnValueOnce(pendingAfterReset.promise);
    const first = controller.complete(readyInput());
    controller.reset();
    pendingAfterReset.resolve(response([connection("account-1", "account")]));
    await first;
    expect(controller.snapshot).toEqual(expect.objectContaining({ phase: "idle", resources: [] }));

    const pendingAfterDispose = deferred<OpenFinancePolpCompleteConnectionResponse>();
    completeConnection.mockReturnValueOnce(pendingAfterDispose.promise);
    const second = controller.complete(readyInput());
    controller.dispose();
    pendingAfterDispose.resolve(response([connection("card-1", "credit_card")]));
    await second;
    expect(controller.snapshot.phase).toBe("completing");
  });

  it("gates concurrent retries and never invokes adjacent flow operations", async () => {
    const pending = deferred<OpenFinancePolpCompleteConnectionResponse>();
    const {
      controller,
      completeConnection,
      startConnection,
      openUrl,
      getConsent,
      syncOpenFinanceMonth,
    } = harness();
    completeConnection
      .mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502))
      .mockReturnValueOnce(pending.promise);
    await controller.complete(readyInput());

    const firstRetry = controller.retry();
    const secondRetry = controller.retry();
    expect(completeConnection).toHaveBeenCalledTimes(2);
    pending.resolve(response());
    await Promise.all([firstRetry, secondRetry]);

    expect(startConnection).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(getConsent).not.toHaveBeenCalled();
    expect(syncOpenFinanceMonth).not.toHaveBeenCalled();
  });
});

describe("Polp completion identity A to B", () => {
  it("ignores a late success for A after the active context becomes B", async () => {
    const pending = deferred<OpenFinancePolpCompleteConnectionResponse>();
    const { controller, completeConnection, startConnection, getConsent, syncOpenFinanceMonth, setActive } = harness();
    completeConnection.mockReturnValueOnce(pending.promise);

    const first = controller.complete(readyInput());
    expect(controller.snapshot.phase).toBe("completing");
    expect(completeConnection).toHaveBeenCalledTimes(1);

    setActive(readyInput(CONSENT_B_ID));
    pending.resolve(response([connection("account-1", "account")]));
    await first;

    expect(controller.snapshot).toEqual(expect.objectContaining({
      phase: "idle",
      resources: [],
      errorMessage: null,
    }));
    expect(completeConnection).toHaveBeenCalledTimes(1);
    expect(completeConnection).toHaveBeenCalledWith({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: CONSENT_ID,
    });
    expect(startConnection).not.toHaveBeenCalled();
    expect(getConsent).not.toHaveBeenCalled();
    expect(syncOpenFinanceMonth).not.toHaveBeenCalled();
  });

  it("blocks retry of A after the active context becomes B, before the client", async () => {
    const { controller, completeConnection, startConnection, getConsent, syncOpenFinanceMonth, setActive } = harness();
    completeConnection.mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502));

    await controller.complete(readyInput());
    expect(controller.snapshot.phase).toBe("error");

    setActive(readyInput(CONSENT_B_ID));
    expect(controller.snapshot.retryable).toBe(false);
    await controller.retry();

    expect(completeConnection).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.retryable).toBe(false);
    expect(startConnection).not.toHaveBeenCalled();
    expect(getConsent).not.toHaveBeenCalled();
    expect(syncOpenFinanceMonth).not.toHaveBeenCalled();
  });

  it("still retries A with the same consent while A remains active", async () => {
    const { controller, completeConnection } = harness();
    completeConnection
      .mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502))
      .mockResolvedValueOnce(response([connection("account-1", "account")]));

    await controller.complete(readyInput());
    await controller.retry();

    expect(completeConnection).toHaveBeenCalledTimes(2);
    expect(completeConnection.mock.calls[0]?.[0]).toEqual({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: CONSENT_ID,
    });
    expect(completeConnection.mock.calls[1]?.[0]).toEqual(completeConnection.mock.calls[0]?.[0]);
    expect(controller.snapshot.phase).toBe("completed");
  });

  it("invalidates completed and error state when the active context disappears", async () => {
    const { controller, completeConnection, setActive } = harness();
    completeConnection.mockResolvedValueOnce(response([connection("account-1", "account")]));
    await controller.complete(readyInput());
    expect(controller.snapshot.phase).toBe("completed");

    setActive({ authorizationPhase: "idle", householdId: null, consentId: null });
    controller.syncActiveIdentity();
    expect(controller.snapshot).toEqual(expect.objectContaining({
      phase: "idle",
      resources: [],
    }));

    completeConnection.mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502));
    setActive(readyInput());
    await controller.complete(readyInput());
    expect(controller.snapshot.phase).toBe("error");

    setActive({ authorizationPhase: "idle", householdId: null, consentId: null });
    controller.syncActiveIdentity();
    expect(controller.snapshot.phase).toBe("idle");
    expect(controller.snapshot.retryable).toBe(false);
  });

  it("allows an explicit complete of B after A was invalidated", async () => {
    const { controller, completeConnection, setActive } = harness();
    completeConnection.mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502));
    await controller.complete(readyInput());

    setActive(readyInput(CONSENT_B_ID));
    await controller.retry();
    expect(controller.snapshot.phase).toBe("idle");

    completeConnection.mockResolvedValueOnce(response([
      connection("card-1", "credit_card", { externalConnectionId: CONSENT_B_ID }),
    ], CONSENT_B_ID));
    await controller.complete(readyInput(CONSENT_B_ID));

    expect(completeConnection).toHaveBeenCalledTimes(2);
    expect(completeConnection.mock.calls[1]?.[0]).toEqual({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: CONSENT_B_ID,
    });
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.resources.map((item) => item.type)).toEqual(["credit_card"]);
  });

  it("does not reset A when the active identity stays the same", async () => {
    const pending = deferred<OpenFinancePolpCompleteConnectionResponse>();
    const { controller, completeConnection, setActive } = harness();
    completeConnection.mockReturnValueOnce(pending.promise);

    const first = controller.complete(readyInput());
    expect(controller.snapshot.phase).toBe("completing");

    setActive(readyInput());
    controller.syncActiveIdentity();
    expect(controller.snapshot.phase).toBe("completing");
    expect(completeConnection).toHaveBeenCalledTimes(1);

    pending.resolve(response([connection("account-1", "account")]));
    await first;
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.resources).toHaveLength(1);

    setActive(readyInput());
    controller.syncActiveIdentity();
    expect(controller.snapshot.phase).toBe("completed");
    expect(controller.snapshot.resources).toHaveLength(1);
  });

  it("does not start a second complete when identity changes during an in-flight request", async () => {
    const pending = deferred<OpenFinancePolpCompleteConnectionResponse>();
    const { controller, completeConnection, setActive } = harness();
    completeConnection.mockReturnValueOnce(pending.promise);

    const first = controller.complete(readyInput());
    setActive(readyInput(CONSENT_B_ID));
    controller.syncActiveIdentity();
    await controller.complete(readyInput(CONSENT_B_ID));
    expect(completeConnection).toHaveBeenCalledTimes(1);

    pending.resolve(response([connection("account-1", "account")]));
    await first;
    expect(controller.snapshot.phase).toBe("idle");
  });
});

describe("F4A production boundaries and hidden route", () => {
  it("keeps completion isolated from start, browser, polling and sync", () => {
    const controllerSource = readFileSync(resolve(__dirname, "open-finance-polp-completion.ts"), "utf8");
    expect(controllerSource).not.toMatch(/startConnection|openUrl|getConsent|syncOpenFinanceMonth|sync-month/);
    expect(controllerSource).not.toMatch(/AsyncStorage|SecureStore|fetch\s*\(|console\./);
  });

  it("renders completion states without exposing sync or technical identifiers", () => {
    const routeSource = readFileSync(
      resolve(__dirname, "../../app/(app)/open-finance-connect.tsx"),
      "utf8",
    );
    expect(routeSource).toContain("Concluir conexão");
    expect(routeSource).toContain("Concluindo conexão...");
    expect(routeSource).toContain("Banco conectado");
    expect(routeSource).toContain("Tentar concluir novamente");
    expect(routeSource).not.toMatch(/syncOpenFinanceMonth|sync-month/);
    expect(routeSource).not.toContain("consentId}");
    expect(routeSource).not.toMatch(/<Text[^>]*>\{resource\.key\}<\/Text>/);
  });

  it("does not expose the route from existing app flows", () => {
    for (const relativePath of [
      "../../app/(app)/import-extract.tsx",
      "../../app/(app)/journey.tsx",
      "../../app/(app)/new-transaction.tsx",
      "../../app/(app)/link-commitment.tsx",
    ]) {
      const source = readFileSync(resolve(__dirname, relativePath), "utf8");
      expect(source).not.toContain("open-finance-connect");
    }
  });
});
