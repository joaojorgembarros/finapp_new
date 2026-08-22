import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  OPEN_FINANCE_FUNCTION_NAMES,
  OpenFinanceClientError,
  buildOpenFinanceInvokeTarget,
  completeOpenFinanceConnection,
  createOpenFinanceClient,
  getOpenFinanceConsent,
  getOpenFinanceFunctionName,
  startOpenFinanceConnection,
  syncOpenFinanceMonth,
  type OpenFinanceFunctionsClient,
} from "./open-finance-client";
import type {
  OpenFinanceConnection,
  OpenFinancePolpConsentStatus,
  OpenFinanceStartConnectionResponse,
} from "./open-finance-contract";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";
const CONNECTION_ID = "a30e8400-e29b-41d4-a716-446655440030";

function createFunctionsFake(data: unknown = {}) {
  const invoke = vi.fn(async (name: string, options?: { method?: string; body?: unknown }) => ({
    data,
    error: null,
    name,
    options,
  }));
  return {
    invoke,
    client: { invoke } as OpenFinanceFunctionsClient,
  };
}

const POLP_CONSENT: OpenFinancePolpConsentStatus = {
  provider: "polp",
  consentId: "consent-1",
  connectionId: CONNECTION_ID,
  status: "active",
  providerStatus: "AUTHORISED",
  executionStatus: "SUCCESS",
  resourcesReady: true,
  flags: [],
  hasProviderError: false,
  authorizationUrl: "https://authorization.example.test/consent-1",
  authorizationExpiresAt: null,
  expiresAt: null,
  products: ["ACCOUNT", "CREDIT_CARD_ACCOUNT"],
};

const POLP_CONNECTION = {
  id: CONNECTION_ID,
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
  accountName: "Conta",
  accountMask: "**** 1234",
  externalConnectionId: "consent-1",
  externalAccountId: "account-1",
  status: "connected",
  consent: {
    id: "local-consent",
    connectionId: CONNECTION_ID,
    externalConsentId: "consent-1",
    status: "active",
    grantedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    rawPayload: { secret: "do-not-leak" },
  },
  consentStatus: "active",
  consentExpiresAt: null,
  lastSyncedAt: null,
  lastSyncStatus: "idle",
  lastSyncRun: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  rawPayload: { resourceType: "account", secret: "do-not-leak" },
} as OpenFinanceConnection;

describe("Open Finance client routing", () => {
  it("maps each provider to the existing Edge function name", () => {
    expect(getOpenFinanceFunctionName("pluggy")).toBe("open-finance-pluggy");
    expect(getOpenFinanceFunctionName("polp")).toBe("open-finance-polp");
    expect(OPEN_FINANCE_FUNCTION_NAMES).toEqual({
      pluggy: "open-finance-pluggy",
      polp: "open-finance-polp",
    });
  });

  it("builds invoke targets with subpaths and query strings for the installed SDK", () => {
    expect(buildOpenFinanceInvokeTarget({
      provider: "polp",
      path: "/complete-connection",
    })).toBe("open-finance-polp/complete-connection");
    expect(buildOpenFinanceInvokeTarget({
      provider: "polp",
      path: "/consents/consent-1",
      query: { householdId: HOUSEHOLD_ID },
    })).toBe(`open-finance-polp/consents/consent-1?householdId=${HOUSEHOLD_ID}`);
    expect(buildOpenFinanceInvokeTarget({
      provider: "pluggy",
      path: "/sync-month",
    })).toBe("open-finance-pluggy/sync-month");
    expect(() => buildOpenFinanceInvokeTarget({
      provider: "polp",
      path: "../config",
    })).toThrow(TypeError);
  });
});

describe("Open Finance client requests", () => {
  it("narrows Pluggy start to connectToken/itemId and omits provider from the body", async () => {
    const start: OpenFinanceStartConnectionResponse = {
      provider: "pluggy",
      mode: "create",
      connectToken: "public-widget-token",
      expiresAt: null,
      itemId: null,
      includeSandbox: false,
      widget: { theme: "light", language: "pt" },
      openFinanceParameters: null,
    };
    const { invoke, client } = createFunctionsFake(start);
    const response = await startOpenFinanceConnection({
      provider: "pluggy",
      householdId: HOUSEHOLD_ID,
    }, { functions: client });

    expect(invoke).toHaveBeenCalledWith("open-finance-pluggy/start-connection", {
      method: "POST",
      body: { householdId: HOUSEHOLD_ID },
    });
    if (response.provider !== "pluggy") throw new Error("expected Pluggy start response");
    expect(response.connectToken).toBe("public-widget-token");
    expect(response.itemId).toBeNull();
  });

  it("narrows Polp start to authorizationUrl/consentId/connectionId", async () => {
    const { invoke, client } = createFunctionsFake({
      provider: "polp",
      mode: "create",
      consentId: "consent-1",
      authorizationUrl: "https://authorization.example.test/consent-1",
      expiresAt: null,
      connectionId: CONNECTION_ID,
    });
    const response = await startOpenFinanceConnection({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    }, { functions: client });

    expect(invoke).toHaveBeenCalledWith("open-finance-polp/start-connection", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        institutionId: "institution-1",
        cpf: "12345678901",
      },
    });
    if (response.provider !== "polp") throw new Error("expected Polp start response");
    expect(response.authorizationUrl).toBe("https://authorization.example.test/consent-1");
    expect(response.consentId).toBe("consent-1");
    expect(response.connectionId).toBe(CONNECTION_ID);
  });

  it("sends the correct complete-connection identity for each provider", async () => {
    const pluggy = createFunctionsFake({
      itemId: "item-1",
      connections: [],
    });
    await completeOpenFinanceConnection({
      provider: "pluggy",
      householdId: HOUSEHOLD_ID,
      itemId: "item-1",
    }, { functions: pluggy.client });
    expect(pluggy.invoke).toHaveBeenCalledWith("open-finance-pluggy/complete-connection", {
      method: "POST",
      body: { householdId: HOUSEHOLD_ID, itemId: "item-1" },
    });

    const polp = createFunctionsFake({
      itemId: "consent-1",
      consentId: "consent-1",
      consent: POLP_CONSENT,
      connections: [POLP_CONNECTION],
    });
    const completed = await completeOpenFinanceConnection({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: "consent-1",
    }, { functions: polp.client });
    expect(polp.invoke).toHaveBeenCalledWith("open-finance-polp/complete-connection", {
      method: "POST",
      body: { householdId: HOUSEHOLD_ID, consentId: "consent-1" },
    });
    expect(completed.connections[0]?.rawPayload).toBeNull();
    expect(completed.connections[0]?.resourceType).toBe("account");
  });

  it("syncs a month with connectionId and monthKey only", async () => {
    const { invoke, client } = createFunctionsFake({
      connection: POLP_CONNECTION,
      run: {
        id: "run-1",
        connectionId: CONNECTION_ID,
        householdId: HOUSEHOLD_ID,
        monthKey: "2026-07",
        status: "success",
        foundCount: 2,
        insertedCount: 2,
        duplicateCount: 0,
        startedAt: "2026-08-01T00:00:00.000Z",
        finishedAt: "2026-08-01T00:00:01.000Z",
        errorMessage: null,
        warnings: [],
        rawPayload: { warnings: [] },
      },
      found: 2,
      inserted: 2,
      duplicates: 0,
      warnings: [],
      transactions: [{
        id: "imported-1",
        connectionId: CONNECTION_ID,
        externalTransactionId: "tx-1",
        externalAccountId: "account-1",
        description: "synthetic",
        amountCents: 100,
        direction: "expense",
        occurredOn: "2026-07-02",
        postedAt: null,
        fingerprint: "fp",
        rawPayload: { amount: "1.00" },
      }],
    });

    const response = await syncOpenFinanceMonth({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
      monthKey: "2026-07",
    }, { functions: client });

    expect(invoke).toHaveBeenCalledWith("open-finance-polp/sync-month", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        connectionId: CONNECTION_ID,
        monthKey: "2026-07",
      },
    });
    expect(response.found).toBe(2);
    expect(response.inserted).toBe(2);
    expect(response.duplicates).toBe(0);
    expect(response.run.rawPayload).toBeNull();
    expect(response.transactions[0]?.rawPayload).toBeNull();
  });

  it("uses encoded dynamic paths for Polp-only consent operations", async () => {
    const { invoke, client } = createFunctionsFake({
      consent: POLP_CONSENT,
    });
    const api = createOpenFinanceClient({ functions: client });
    await api.getConsent({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: "consent 1",
    });
    await api.revokeConsent({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: "consent 1",
    });
    await api.disconnectConnection({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
    });

    expect(invoke.mock.calls[0]?.[0]).toBe(
      `open-finance-polp/consents/consent%201?householdId=${HOUSEHOLD_ID}`,
    );
    expect(invoke.mock.calls[1]?.[0]).toBe(
      `open-finance-polp/consents/consent%201?householdId=${HOUSEHOLD_ID}`,
    );
    expect(invoke.mock.calls[1]?.[1]).toEqual({ method: "DELETE", body: undefined });
    expect(invoke.mock.calls[2]?.[0]).toBe(
      `open-finance-polp/connections/${CONNECTION_ID}?householdId=${HOUSEHOLD_ID}`,
    );
  });

  it("does not embed Polp private credential names in the client source", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/open-finance-client.ts"), "utf8");
    const forbidden = [
      ["POLP", "API", "CLIENT"].join("_"),
      ["POLP", "API", "SECRET"].join("_"),
      ["POLP", "WEBHOOK", "SECRET"].join("_"),
      "EXPO_PUBLIC_",
    ];
    expect(forbidden.filter((name) => source.includes(name))).toEqual([]);
  });
});

describe("Open Finance client invoke errors", () => {
  it("throws when functions.invoke returns an error", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: new Error("upstream exploded") }));
    await expect(getOpenFinanceConsent({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: "consent-1",
    }, { functions: { invoke } })).rejects.toMatchObject({
      name: "OpenFinanceClientError",
      message: "A chamada Open Finance falhou.",
      code: null,
      status: null,
    });
  });

  it("preserves HTTP status, Edge code and a safe message from FunctionsHttpError", async () => {
    const json = vi.fn(async () => ({
      code: "CONSENT_RESOURCES_PENDING",
      message: "Consentimento autorizado; recursos ainda estao em processamento.",
      details: { secret: "do-not-leak", stack: "Error: hidden" },
    }));
    const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: { status: 409, json },
    });
    const thrown = await startOpenFinanceConnection({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    }, { functions: { invoke: vi.fn(async () => ({ data: null, error })) } }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(thrown).toBeInstanceOf(OpenFinanceClientError);
    expect(thrown).toMatchObject({
      code: "CONSENT_RESOURCES_PENDING",
      status: 409,
      message: "Consentimento autorizado; recursos ainda estao em processamento.",
    });
    expect(json).toHaveBeenCalledTimes(1);
    expect(String(thrown)).not.toContain("do-not-leak");
    expect(String(thrown)).not.toContain("12345678901");
  });

  it("keeps FunctionsFetchError and FunctionsRelayError as clear failures", async () => {
    const fetchError = Object.assign(new Error("Failed to send a request to the Edge Function"), {
      name: "FunctionsFetchError",
      context: { cause: "offline" },
    });
    await expect(getOpenFinanceConsent({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: "consent-1",
    }, { functions: { invoke: vi.fn(async () => ({ data: null, error: fetchError })) } })).rejects.toMatchObject({
      name: "OpenFinanceClientError",
      message: "Não foi possível conectar ao Open Finance.",
      code: null,
      status: null,
    });

    const relayError = Object.assign(new Error("Relay Error invoking the Edge Function"), {
      name: "FunctionsRelayError",
      context: { headers: { Authorization: "secret" } },
    });
    await expect(getOpenFinanceConsent({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: "consent-1",
    }, { functions: { invoke: vi.fn(async () => ({ data: null, error: relayError })) } })).rejects.toMatchObject({
      name: "OpenFinanceClientError",
      message: "A Edge Open Finance não pôde processar a chamada.",
      code: null,
      status: null,
    });
  });
});
