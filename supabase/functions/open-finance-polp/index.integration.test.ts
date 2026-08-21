import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createOpenFinancePolpHandler } from "./index";
import { RepositoryError, type PolpRepository } from "./repository";
import {
  buildConnectionRow,
  buildConsentRow,
  buildMappedConnection,
  createPolpClientDouble,
  createRepositoryDouble,
} from "./test-doubles";
import {
  ACCOUNT_ID,
  accountFixture,
  accountTransactionFixture,
  authorisedConsentFixture,
  awaitingConsentFixture,
  BILL_ID,
  billFixture,
  CARD_ID,
  cardTransactionFixture,
  CONSENT_ID,
  CONNECTION_ID,
  creditCardFixture,
  HOUSEHOLD_ID,
  INSTITUTION_ID,
  institutionFixture,
  USER_ID,
} from "./test-fixtures";

const ENVIRONMENT: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEYS: JSON.stringify({
    "open-finance": "sb_secret_local-polp-test-only",
  }),
  POLP_API_CLIENT: "local-polp-client-not-real",
  POLP_API_SECRET: "local-polp-secret-not-real",
  POLP_WEBHOOK_SECRET: "local-webhook-secret-not-real",
};

function makeHandler(input: {
  repository?: PolpRepository;
  client?: ReturnType<typeof createPolpClientDouble>;
  environment?: Record<string, string>;
} = {}) {
  const repository = input.repository ?? createRepositoryDouble();
  const client = input.client ?? createPolpClientDouble();
  const environment = input.environment ?? ENVIRONMENT;
  const repositoryFactory = vi.fn(() => repository);
  const handler = createOpenFinancePolpHandler({
    getEnv: (name) => environment[name] ?? "",
    repositoryFactory,
    polpClient: client as never,
    now: () => new Date("2026-08-21T17:00:00.000Z"),
  });
  return { handler, repository, client, repositoryFactory };
}

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
  } = {},
) {
  const headers = new Headers();
  if (options.token !== null) {
    headers.set("Authorization", `Bearer ${options.token ?? "valid-jwt"}`);
  }
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`http://127.0.0.1:54321/functions/v1/open-finance-polp${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("open-finance-polp Edge handler", () => {
  it("answers OPTIONS without touching Auth, Supabase or Polp", async () => {
    const { handler, client, repositoryFactory } = makeHandler();
    const response = await handler(request("/institutions", { method: "OPTIONS", token: null }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("x-webhook-signature");
    expect(repositoryFactory).not.toHaveBeenCalled();
    expect(client.listInstitutions).not.toHaveBeenCalled();
  });

  it("keeps configuration public but never exposes secret values", async () => {
    const { handler } = makeHandler();
    const response = await handler(request("/config", { token: null }));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain(ENVIRONMENT.POLP_API_CLIENT);
    expect(body).not.toContain(ENVIRONMENT.POLP_API_SECRET);
    expect(body).not.toContain(ENVIRONMENT.POLP_WEBHOOK_SECRET);
    expect(JSON.parse(body)).toEqual(expect.objectContaining({
      provider: "polp",
      configured: true,
      includeSandbox: false,
    }));
  });

  it("requires a valid JWT even though provider institutions are public", async () => {
    const { handler, client, repositoryFactory } = makeHandler();
    const missing = await handler(request("/institutions", { token: null }));
    const invalid = await handler(request("/institutions", { token: "invalid-jwt" }));
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(client.listInstitutions).not.toHaveBeenCalled();
    expect(repositoryFactory).toHaveBeenCalledTimes(1);
  });

  it("normalizes institutions after Auth without forwarding any mobile secret", async () => {
    const client = createPolpClientDouble({
      listInstitutions: vi.fn(async () => [institutionFixture]),
    });
    const { handler } = makeHandler({ client });
    const response = await handler(request("/institutions"));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      institutions: [expect.objectContaining({
        id: INSTITUTION_ID,
        provider: "polp",
        connectorId: null,
        status: "OPERATIONAL",
        type: "BOTH",
      })],
    });
  });

  it("creates consent with JWT identity and ignores hostile identity fields", async () => {
    const client = createPolpClientDouble({
      listInstitutions: vi.fn(async () => [institutionFixture]),
      createConsent: vi.fn(async () => awaitingConsentFixture),
    });
    const repository = createRepositoryDouble();
    const { handler } = makeHandler({ repository, client });
    const hostileId = "f10e8400-e29b-41d4-a716-446655440099";
    const response = await handler(request("/consents", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        institutionId: INSTITUTION_ID,
        cpf: "123.456.789-01",
        products: ["ACCOUNT", "CREDIT_CARD_ACCOUNT"],
        created_by: hostileId,
        createdBy: hostileId,
        userId: hostileId,
        actorId: hostileId,
        provider: "pluggy",
        xApiSecret: "mobile-secret-must-be-ignored",
      },
    }));
    const body = await json(response);
    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({
      provider: "polp",
      mode: "create",
      consentId: CONSENT_ID,
      authorizationUrl: expect.stringContaining("https://auth.example.invalid/"),
      expiresAt: "2026-08-21T15:30:00.000Z",
    }));
    expect(client.createConsent).toHaveBeenCalledWith({
      institution_id: INSTITUTION_ID,
      cpf: "12345678901",
      cliente_user_id: USER_ID,
      products: ["ACCOUNT", "CREDIT_CARD_ACCOUNT"],
      avoidDuplicates: true,
    });
    expect(vi.mocked(repository.persistInitialConsent).mock.calls[0][0]).toEqual(
      expect.objectContaining({ householdId: HOUSEHOLD_ID, userId: USER_ID }),
    );
    expect(JSON.stringify(vi.mocked(repository.persistInitialConsent).mock.calls[0][0]))
      .not.toContain(hostileId);
  });

  it("rejects a non-member before creating an upstream consent", async () => {
    const repository = createRepositoryDouble({
      ensureMembership: vi.fn(async () => {
        throw new RepositoryError("HOUSEHOLD_FORBIDDEN");
      }),
    });
    const client = createPolpClientDouble({
      listInstitutions: vi.fn(async () => [institutionFixture]),
    });
    const { handler } = makeHandler({ repository, client });
    const response = await handler(request("/start-connection", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        institutionId: INSTITUTION_ID,
        cpf: "12345678901",
      },
    }));
    expect(response.status).toBe(403);
    expect(client.createConsent).not.toHaveBeenCalled();
  });

  it("enforces the JSON byte limit even without a trustworthy Content-Length", async () => {
    const client = createPolpClientDouble();
    const { handler } = makeHandler({ client });
    const response = await handler(request("/start-connection", {
      method: "POST",
      body: { padding: "x".repeat(65 * 1024) },
    }));
    expect(response.status).toBe(413);
    expect(client.listInstitutions).not.toHaveBeenCalled();
    expect(client.createConsent).not.toHaveBeenCalled();
  });

  it("confirms AUTHORISED, persists accounts/cards and preserves app completion shape", async () => {
    const client = createPolpClientDouble({
      getConsent: vi.fn(async () => authorisedConsentFixture),
      listAccounts: vi.fn(async () => [accountFixture]),
      listCreditCards: vi.fn(async () => [creditCardFixture]),
    });
    const repository = createRepositoryDouble();
    const { handler } = makeHandler({ repository, client });
    const response = await handler(request("/complete-connection", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        consentId: CONSENT_ID,
        userId: "hostile-user-id",
      },
    }));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual(expect.objectContaining({
      itemId: CONSENT_ID,
      consentId: CONSENT_ID,
      consent: expect.objectContaining({ providerStatus: "AUTHORISED", status: "active" }),
      connections: expect.any(Array),
    }));
    expect(repository.persistResources).toHaveBeenCalledWith(expect.objectContaining({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      resources: [
        expect.objectContaining({ resourceType: "account", externalAccountId: ACCOUNT_ID }),
        expect.objectContaining({ resourceType: "credit_card", externalAccountId: CARD_ID }),
      ],
    }));
  });

  it("waits for execution_status before fetching resources", async () => {
    const pendingConsent = {
      ...authorisedConsentFixture,
      execution_status: "AWAITING_RESOURCES",
    };
    const client = createPolpClientDouble({
      getConsent: vi.fn(async () => pendingConsent),
    });
    const repository = createRepositoryDouble();
    const { handler } = makeHandler({ repository, client });
    const response = await handler(request("/complete-connection", {
      method: "POST",
      body: { householdId: HOUSEHOLD_ID, consentId: CONSENT_ID },
    }));
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual(expect.objectContaining({
      code: "CONSENT_RESOURCES_PENDING",
    }));
    expect(repository.updateConsentLifecycle).toHaveBeenCalled();
    expect(client.listAccounts).not.toHaveBeenCalled();
    expect(client.listCreditCards).not.toHaveBeenCalled();
  });

  it("fetches only product groups present in the consent", async () => {
    const accountOnlyConsent = {
      ...authorisedConsentFixture,
      products: ["ACCOUNT"],
    };
    const client = createPolpClientDouble({
      getConsent: vi.fn(async () => accountOnlyConsent),
      listAccounts: vi.fn(async () => [accountFixture]),
    });
    const repository = createRepositoryDouble();
    const { handler } = makeHandler({ repository, client });
    const response = await handler(request("/complete-connection", {
      method: "POST",
      body: { householdId: HOUSEHOLD_ID, consentId: CONSENT_ID },
    }));
    expect(response.status).toBe(200);
    expect(client.listAccounts).toHaveBeenCalledOnce();
    expect(client.listCreditCards).not.toHaveBeenCalled();
    expect(repository.persistResources).toHaveBeenCalledWith(expect.objectContaining({
      resources: [expect.objectContaining({ resourceType: "account" })],
    }));
  });

  it("rejects an upstream consent correlated to another user", async () => {
    const client = createPolpClientDouble({
      listInstitutions: vi.fn(async () => [institutionFixture]),
      createConsent: vi.fn(async () => ({
        ...awaitingConsentFixture,
        cliente_user_id: "different-user",
      })),
    });
    const repository = createRepositoryDouble();
    const { handler } = makeHandler({ repository, client });
    const response = await handler(request("/consents", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        institutionId: INSTITUTION_ID,
        cpf: "12345678901",
      },
    }));
    expect(response.status).toBe(502);
    expect(repository.persistInitialConsent).not.toHaveBeenCalled();
  });

  it("covers consent state, accounts, cards, account/card transactions and bills", async () => {
    const accountConnection = buildConnectionRow("account");
    const cardConnection = buildConnectionRow("credit_card");
    const repository = createRepositoryDouble({
      getConnectionByExternalAccount: vi.fn(async (_householdId, externalId) => {
        if (externalId === ACCOUNT_ID) return accountConnection;
        if (externalId === CARD_ID) return cardConnection;
        return null;
      }),
      getConnection: vi.fn(async (_householdId, connectionId) => (
        connectionId === CONNECTION_ID ? cardConnection : null
      )),
    });
    const client = createPolpClientDouble({
      getConsent: vi.fn(async () => authorisedConsentFixture),
      listAccounts: vi.fn(async () => [accountFixture]),
      listCreditCards: vi.fn(async () => [creditCardFixture]),
      listAccountTransactions: vi.fn(async () => [accountTransactionFixture]),
      listCreditCardTransactions: vi.fn(async () => [cardTransactionFixture]),
      listBills: vi.fn(async () => [billFixture]),
      listBillTransactions: vi.fn(async () => [cardTransactionFixture]),
    });
    const { handler } = makeHandler({ repository, client });

    const responses = await Promise.all([
      handler(request(`/consents/${CONSENT_ID}?householdId=${HOUSEHOLD_ID}`)),
      handler(request(`/consents/${CONSENT_ID}/accounts?householdId=${HOUSEHOLD_ID}`)),
      handler(request(`/consents/${CONSENT_ID}/credit-cards?householdId=${HOUSEHOLD_ID}`)),
      handler(request(`/accounts/${ACCOUNT_ID}/transactions?householdId=${HOUSEHOLD_ID}`)),
      handler(request(`/credit-cards/${CARD_ID}/transactions?householdId=${HOUSEHOLD_ID}`)),
      handler(request(`/credit-cards/${CARD_ID}/bills?householdId=${HOUSEHOLD_ID}`)),
      handler(request(
        `/bills/${BILL_ID}/transactions?householdId=${HOUSEHOLD_ID}&connectionId=${CONNECTION_ID}`,
      )),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    expect(await json(responses[0])).toEqual({
      consent: expect.objectContaining({ providerStatus: "AUTHORISED" }),
    });
    expect(await json(responses[1])).toEqual({
      accounts: [expect.objectContaining({ id: ACCOUNT_ID, resourceType: "account" })],
    });
    expect(await json(responses[2])).toEqual({
      creditCards: [expect.objectContaining({ id: CARD_ID, resourceType: "credit_card" })],
    });
    expect(await json(responses[3])).toEqual({
      transactions: [expect.objectContaining({ amountCents: 12345, direction: "expense" })],
    });
    expect(await json(responses[4])).toEqual({
      transactions: [expect.objectContaining({ amountCents: 8990, direction: "expense" })],
    });
    expect(await json(responses[5])).toEqual({
      bills: [expect.objectContaining({ id: BILL_ID, totalAmountCents: 58990 })],
    });
    expect(await json(responses[6])).toEqual({
      transactions: [expect.objectContaining({ externalAccountId: CARD_ID })],
    });
  });

  it("uses only the atomic RPC boundary and reports duplicate/content_changed semantics", async () => {
    const secondTransaction = {
      ...accountTransactionFixture,
      id: "d10e8400-e29b-41d4-a716-446655440010",
      transaction_name: "TRANSAÇÃO CORRIGIDA",
    };
    const client = createPolpClientDouble({
      listAccountTransactions: vi.fn(async () => [accountTransactionFixture, secondTransaction]),
    });
    const repository = createRepositoryDouble({
      importTransaction: vi.fn()
        .mockResolvedValueOnce({
          importedBankTransactionId: "d20e8400-e29b-41d4-a716-446655440020",
          transactionId: "d30e8400-e29b-41d4-a716-446655440030",
          inserted: true,
          contentChanged: false,
        })
        .mockResolvedValueOnce({
          importedBankTransactionId: "d40e8400-e29b-41d4-a716-446655440040",
          transactionId: "d50e8400-e29b-41d4-a716-446655440050",
          inserted: false,
          contentChanged: true,
        }),
    });
    const { handler } = makeHandler({ repository, client });
    const hostileId = "f10e8400-e29b-41d4-a716-446655440099";
    const response = await handler(request("/sync-month", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        connectionId: CONNECTION_ID,
        monthKey: "2026-08",
        created_by: hostileId,
        createdBy: hostileId,
        userId: hostileId,
        actorId: hostileId,
        provider: "pluggy",
      },
    }));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      found: 2,
      inserted: 1,
      duplicates: 1,
      warnings: [expect.stringMatching(/reconciliação necessária/)],
    }));
    expect(repository.importTransaction).toHaveBeenCalledTimes(2);
    for (const [call] of vi.mocked(repository.importTransaction).mock.calls) {
      expect(call.userId).toBe(USER_ID);
      expect(JSON.stringify(call)).not.toContain(hostileId);
    }
    expect(client.listAccountTransactions).toHaveBeenCalledWith(ACCOUNT_ID, {
      fromDate: "2026-08-01T00:00:00.000Z",
      toDate: "2026-08-31T23:59:59.999Z",
    });
  });

  it("stops on RPC failure, marks the run failed and has no direct-write fallback", async () => {
    const client = createPolpClientDouble({
      listAccountTransactions: vi.fn(async () => [accountTransactionFixture]),
    });
    const repository = createRepositoryDouble({
      importTransaction: vi.fn(async () => {
        throw new RepositoryError("A importação atômica Open Finance falhou.");
      }),
    });
    const { handler } = makeHandler({ repository, client });
    const response = await handler(request("/sync-month", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        connectionId: CONNECTION_ID,
        monthKey: "2026-08",
      },
    }));
    expect(response.status).toBe(500);
    expect(repository.finishSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      status: "error",
      inserted: 0,
      duplicates: 0,
    }));

    const source = ["index.ts", "repository.ts"]
      .map((name) => readFileSync(resolve(
        process.cwd(),
        "supabase/functions/open-finance-polp",
        name,
      ), "utf8"))
      .join("\n");
    expect(source).toContain('rpc("import_open_finance_transaction"');
    expect(source).not.toMatch(/\.from\(["']transactions["']\)/);
    expect(source).not.toMatch(/\.from\(["']imported_bank_transactions["']\)/);
  });

  it("never operates on a missing/non-Polp connection", async () => {
    const repository = createRepositoryDouble({
      getConnection: vi.fn(async () => null),
    });
    const client = createPolpClientDouble();
    const { handler } = makeHandler({ repository, client });
    const response = await handler(request("/sync-month", {
      method: "POST",
      body: {
        householdId: HOUSEHOLD_ID,
        connectionId: CONNECTION_ID,
        monthKey: "2026-08",
        provider: "pluggy",
      },
    }));
    expect(response.status).toBe(404);
    expect(client.listAccountTransactions).not.toHaveBeenCalled();
    expect(repository.createSyncRun).not.toHaveBeenCalled();
  });

  it("prevents future sync after revoke and preserves history by issuing no deletes", async () => {
    const repository = createRepositoryDouble();
    const client = createPolpClientDouble();
    const { handler } = makeHandler({ repository, client });
    const revoked = await handler(request(
      `/consents/${CONSENT_ID}?householdId=${HOUSEHOLD_ID}`,
      { method: "DELETE" },
    ));
    expect(revoked.status).toBe(200);
    expect(client.revokeConsent).toHaveBeenCalledWith(CONSENT_ID);
    expect(repository.revokeConsent).toHaveBeenCalledWith(HOUSEHOLD_ID, CONSENT_ID);

    const revokedRepository = createRepositoryDouble({
      getConsentForConnection: vi.fn(async () => buildConsentRow({
        status: "revoked",
        raw_payload: { providerStatus: "REVOKED_LOCAL" },
      })),
    });
    const second = makeHandler({ repository: revokedRepository, client });
    const sync = await second.handler(request("/sync-month", {
      method: "POST",
      body: { householdId: HOUSEHOLD_ID, connectionId: CONNECTION_ID, monthKey: "2026-08" },
    }));
    expect(sync.status).toBe(409);
    expect(revokedRepository.createSyncRun).not.toHaveBeenCalled();
  });

  it("lists only canonical Polp connections returned by the provider-scoped repository", async () => {
    const connection = buildMappedConnection();
    const repository = createRepositoryDouble({
      listConnections: vi.fn(async () => [connection]),
    });
    const { handler } = makeHandler({ repository });
    const response = await handler(request(`/connections?householdId=${HOUSEHOLD_ID}`));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ connections: [expect.objectContaining({ provider: "polp" })] });
    expect(repository.listConnections).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });
});
