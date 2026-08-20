import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOpenFinanceTransactionFingerprint } from "../../../src/lib/open-finance-contract";

const { createClientMock, resolveSupabaseSecretKeyMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  resolveSupabaseSecretKeyMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

vi.mock("../_shared/supabaseApiKeys", () => ({
  resolveSupabaseSecretKey: resolveSupabaseSecretKeyMock,
}));

type Handler = (request: Request) => Response | Promise<Response>;
type Row = Record<string, unknown>;
type QueryKind = "select" | "insert" | "update" | "upsert";
type QueryFilter = {
  kind: "eq" | "neq" | "in" | "gte" | "lt";
  column: string;
  value: unknown;
};
type QueryOperation = {
  table: string;
  kind: QueryKind;
  filters: QueryFilter[];
  payload: unknown;
  conflictColumns: string[];
};
type QueryError = { code?: string; message: string };
type QueryResult = { data: unknown; error: QueryError | null };

const OPEN_FINANCE_SECRET = "synthetic-open-finance-provider-isolation-fixture";
resolveSupabaseSecretKeyMock.mockReturnValue(OPEN_FINANCE_SECRET);
const SHARED_PROVIDER_TABLES = new Set([
  "bank_connections",
  "bank_connection_consents",
  "bank_sync_runs",
  "imported_bank_transactions",
]);

function cloneRows(input: Record<string, Row[]>) {
  return Object.fromEntries(
    Object.entries(input).map(([table, rows]) => [
      table,
      rows.map((row) => ({ ...row })),
    ]),
  );
}

class MemoryQuery implements PromiseLike<QueryResult> {
  private kind: QueryKind = "select";
  private filters: QueryFilter[] = [];
  private payload: unknown = null;
  private conflictColumns: string[] = [];

  constructor(
    private readonly table: string,
    private readonly state: Record<string, Row[]>,
    private readonly operations: QueryOperation[],
  ) {}

  select(_columns = "*") {
    return this;
  }

  insert(payload: unknown) {
    this.kind = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.kind = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown, options?: { onConflict?: string }) {
    this.kind = "upsert";
    this.payload = payload;
    this.conflictColumns = options?.onConflict
      ?.split(",")
      .map((column) => column.trim())
      .filter(Boolean) ?? [];
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }

  order(_column: string, _options?: unknown) {
    return this;
  }

  async maybeSingle() {
    const result = await this.execute();
    if (result.error) return { data: null, error: result.error };
    const rows = result.data as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const result = await this.execute();
    if (result.error) return { data: null, error: result.error };
    const rows = result.data as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: Row) {
    return this.filters.every((filter) => {
      const current = row[filter.column];

      if (filter.kind === "eq") return current === filter.value;
      if (filter.kind === "neq") return current !== filter.value;
      if (filter.kind === "in") return (filter.value as unknown[]).includes(current);
      if (filter.kind === "gte") return String(current) >= String(filter.value);
      return String(current) < String(filter.value);
    });
  }

  private payloadRows(): Row[] {
    const values = Array.isArray(this.payload) ? this.payload : [this.payload];
    return values.map((value, index) => ({
      ...((value ?? {}) as Row),
      id: ((value ?? {}) as Row).id ?? `${this.table}-${this.state[this.table].length + index + 1}`,
    }) as Row);
  }

  private async execute(): Promise<QueryResult> {
    const rows = this.state[this.table] ?? (this.state[this.table] = []);
    const matched = rows.filter((row) => this.matches(row));

    this.operations.push({
      table: this.table,
      kind: this.kind,
      filters: [...this.filters],
      payload: this.payload,
      conflictColumns: [...this.conflictColumns],
    });

    if (this.kind === "update") {
      matched.forEach((row) => Object.assign(row, this.payload as Row));
      return { data: matched, error: null };
    }

    if (this.kind === "upsert") {
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
      const upserted = payloads.map((value, index) => {
        const candidate = (value ?? {}) as Row;
        const existing = this.conflictColumns.length > 0
          ? rows.find((row) => this.conflictColumns.every(
            (column) => row[column] === candidate[column],
          ))
          : undefined;

        if (existing) {
          Object.assign(existing, candidate);
          return existing;
        }

        const inserted = {
          ...candidate,
          id: candidate.id ?? `${this.table}-${rows.length + index + 1}`,
        };
        rows.push(inserted);
        return inserted;
      });
      return { data: upserted, error: null };
    }

    if (this.kind === "insert") {
      const inserted = this.payloadRows();

      if (
        this.table === "bank_connection_consents"
        && inserted.some((candidate) => rows.some(
          (row) => row.connection_id === candidate.connection_id,
        ))
      ) {
        return {
          data: null,
          error: {
            code: "23505",
            message: "duplicate key value violates bank_connection_consents_connection_id_key",
          },
        };
      }

      rows.push(...inserted);
      return { data: inserted, error: null };
    }

    return { data: matched, error: null };
  }
}

function createMemoryClient(initialRows: Record<string, Row[]>) {
  const state = cloneRows(initialRows);
  const operations: QueryOperation[] = [];
  const getUser = vi.fn(async () => ({
    data: { user: { id: "user-1" } },
    error: null,
  }));
  const client = {
    auth: { getUser },
    from: (table: string) => new MemoryQuery(table, state, operations),
  };

  return { client, state, operations };
}

function installRuntime() {
  let handler: Handler | null = null;
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.example.test",
    SUPABASE_SECRET_KEYS: JSON.stringify({ "open-finance": OPEN_FINANCE_SECRET }),
    PLUGGY_CLIENT_ID: "pluggy-client-id",
    PLUGGY_CLIENT_SECRET: "pluggy-client-secret",
  };
  const runtime = {
    env: { get: vi.fn((name: string) => values[name]) },
    serve: (nextHandler: Handler) => {
      handler = nextHandler;
    },
  };

  (globalThis as typeof globalThis & { Deno: typeof runtime }).Deno = runtime;

  return () => {
    if (!handler) throw new Error("handler was not registered");
    return handler;
  };
}

async function loadHandler(client: ReturnType<typeof createMemoryClient>["client"]) {
  const getHandler = installRuntime();
  createClientMock.mockReturnValue(client);
  await import("./index");
  return getHandler();
}

function membership() {
  return { household_id: "household-1", user_id: "user-1" };
}

function connection(provider: "pluggy" | "polp", id: string): Row {
  return {
    id,
    household_id: "household-1",
    created_by: "user-1",
    provider,
    institution_id: "institution-1",
    institution_name: `${provider} bank`,
    external_connection_id: "same-external-item",
    external_account_id: "same-external-account",
    account_name: `${provider} account`,
    account_mask: "**** 1234",
    status: "connected",
    consent_expires_at: null,
    last_synced_at: null,
    raw_payload: { account: { type: "BANK" } },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

function authenticatedRequest(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", "Bearer personal-user-jwt");
  if (init?.body) headers.set("Content-Type", "application/json");

  return new Request(`https://project.example.test/functions/v1/open-finance-pluggy${path}`, {
    ...init,
    headers,
  });
}

function createPluggyCompletionFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "https://api.pluggy.ai/auth") {
      return new Response(JSON.stringify({ accessToken: "pluggy-api-key" }), { status: 200 });
    }

    if (url === "https://api.pluggy.ai/items/same-external-item") {
      return new Response(JSON.stringify({
        id: "same-external-item",
        status: "UPDATED",
        connector: { id: 10, name: "Pluggy Bank" },
      }), { status: 200 });
    }

    if (url.startsWith("https://api.pluggy.ai/accounts?")) {
      return new Response(JSON.stringify({
        results: [{
          id: "same-external-account",
          name: "Updated Pluggy account",
          number: "1234",
          type: "BANK",
        }],
      }), { status: 200 });
    }

    if (url.startsWith("https://api.pluggy.ai/consents?")) {
      return new Response(JSON.stringify({
        results: [{
          id: "new-pluggy-consent",
          status: "ACTIVE",
          createdAt: "2026-08-20T00:00:00.000Z",
        }],
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function expectProviderScopedOperations(operations: QueryOperation[]) {
  const sharedOperations = operations.filter((operation) =>
    SHARED_PROVIDER_TABLES.has(operation.table)
  );

  expect(sharedOperations.length).toBeGreaterThan(0);

  sharedOperations.forEach((operation) => {
    if (operation.kind === "insert" || operation.kind === "upsert") {
      const payloads = Array.isArray(operation.payload)
        ? operation.payload
        : [operation.payload];
      payloads.forEach((payload) => {
        expect(payload).toEqual(expect.objectContaining({ provider: "pluggy" }));
      });
      if (operation.kind === "upsert" && operation.table === "bank_connections") {
        expect(operation.conflictColumns).toContain("provider");
      }
      return;
    }

    expect(operation.filters).toContainEqual({
      kind: "eq",
      column: "provider",
      value: "pluggy",
    });
  });
}

describe("open-finance-pluggy provider isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists only Pluggy rows even when both providers reuse the same external IDs", async () => {
    const database = createMemoryClient({
      memberships: [membership()],
      bank_connections: [
        connection("polp", "polp-connection"),
        connection("pluggy", "pluggy-connection"),
      ],
      bank_connection_consents: [
        {
          id: "polp-consent-row",
          provider: "polp",
          connection_id: "pluggy-connection",
          external_consent_id: "polp-consent",
          status: "active",
          granted_at: "2026-08-01T00:00:00.000Z",
          expires_at: null,
          raw_payload: null,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "pluggy-consent-row",
          provider: "pluggy",
          connection_id: "pluggy-connection",
          external_consent_id: "pluggy-consent",
          status: "active",
          granted_at: "2026-08-01T00:00:00.000Z",
          expires_at: null,
          raw_payload: null,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
      ],
      bank_sync_runs: [],
    });
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedRequest(
      "/connections?householdId=household-1",
    ));
    const body = (await response.json()) as {
      connections: { id: string; provider: string; consent: { externalConsentId: string } }[];
    };

    expect(response.status).toBe(200);
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toEqual(expect.objectContaining({
      id: "pluggy-connection",
      provider: "pluggy",
    }));
    expect(body.connections[0].consent.externalConsentId).toBe("pluggy-consent");
    expectProviderScopedOperations(database.operations);
  });

  it("preserves the existing Pluggy update flow for a Pluggy connection", async () => {
    const database = createMemoryClient({
      memberships: [membership()],
      bank_connections: [
        connection("polp", "polp-connection"),
        connection("pluggy", "pluggy-connection"),
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "https://api.pluggy.ai/auth") {
        return new Response(JSON.stringify({ accessToken: "pluggy-api-key" }), { status: 200 });
      }

      if (url === "https://api.pluggy.ai/connect_token") {
        return new Response(JSON.stringify({ accessToken: "connect-token" }), { status: 200 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedRequest("/start-connection", {
      method: "POST",
      body: JSON.stringify({
        householdId: "household-1",
        connectionId: "pluggy-connection",
      }),
    }));
    const body = (await response.json()) as {
      provider: string;
      mode: string;
      itemId: string;
      connectToken: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      provider: "pluggy",
      mode: "update",
      itemId: "same-external-item",
      connectToken: "connect-token",
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectProviderScopedOperations(database.operations);
  });

  it("completes a Pluggy connection without updating provider-matched Polp rows", async () => {
    const database = createMemoryClient({
      memberships: [membership()],
      bank_connections: [
        connection("polp", "polp-connection"),
        connection("pluggy", "pluggy-connection"),
      ],
      bank_connection_consents: [
        {
          id: "polp-consent-row",
          provider: "polp",
          connection_id: "polp-connection",
          household_id: "household-1",
          created_by: "user-1",
          external_consent_id: "polp-consent",
          status: "active",
        },
        {
          id: "pluggy-consent-row",
          provider: "pluggy",
          connection_id: "pluggy-connection",
          household_id: "household-1",
          created_by: "user-1",
          external_consent_id: "old-pluggy-consent",
          status: "active",
        },
      ],
      bank_sync_runs: [],
    });
    const fetchMock = createPluggyCompletionFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedRequest("/complete-connection", {
      method: "POST",
      body: JSON.stringify({
        householdId: "household-1",
        itemId: "same-external-item",
      }),
    }));

    expect(response.status).toBe(200);
    expect(database.state.bank_connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "polp-connection", account_name: "polp account" }),
      expect.objectContaining({ id: "pluggy-connection", account_name: "Updated Pluggy account" }),
    ]));
    expect(database.state.bank_connection_consents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "polp-consent-row",
        provider: "polp",
        external_consent_id: "polp-consent",
      }),
      expect.objectContaining({
        id: "pluggy-consent-row",
        provider: "pluggy",
        external_consent_id: "new-pluggy-consent",
      }),
    ]));
    expect(database.operations).not.toContainEqual(expect.objectContaining({
      table: "bank_connection_consents",
      kind: "upsert",
    }));
    expectProviderScopedOperations(database.operations);
  });

  it("fails closed when a mismatched Polp consent occupies the connection unique key", async () => {
    const database = createMemoryClient({
      memberships: [membership()],
      bank_connections: [connection("pluggy", "pluggy-connection")],
      bank_connection_consents: [{
        id: "mismatched-polp-consent",
        provider: "polp",
        connection_id: "pluggy-connection",
        household_id: "household-1",
        created_by: "user-1",
        external_consent_id: "must-not-be-overwritten",
        status: "active",
      }],
      bank_sync_runs: [],
    });
    const fetchMock = createPluggyCompletionFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedRequest("/complete-connection", {
      method: "POST",
      body: JSON.stringify({
        householdId: "household-1",
        itemId: "same-external-item",
      }),
    }));

    expect(response.status).toBe(500);
    expect(database.state.bank_connection_consents).toEqual([
      expect.objectContaining({
        id: "mismatched-polp-consent",
        provider: "polp",
        external_consent_id: "must-not-be-overwritten",
        status: "active",
      }),
    ]);
    expect(database.operations.filter((operation) => (
      operation.table === "bank_connection_consents"
      && operation.kind === "update"
    ))).toHaveLength(2);
    expectProviderScopedOperations(database.operations);
  });

  it.each([
    {
      name: "start/update",
      path: "/start-connection",
      init: {
        method: "POST",
        body: JSON.stringify({
          householdId: "household-1",
          connectionId: "polp-connection",
        }),
      },
    },
    {
      name: "sync",
      path: "/sync-month",
      init: {
        method: "POST",
        body: JSON.stringify({
          householdId: "household-1",
          connectionId: "polp-connection",
          monthKey: "2026-08",
        }),
      },
    },
    {
      name: "disconnect",
      path: "/connections/polp-connection?householdId=household-1",
      init: { method: "DELETE" },
    },
  ])("does not allow Pluggy to $name a Polp connection", async ({ path, init }) => {
    const database = createMemoryClient({
      memberships: [membership()],
      bank_connections: [connection("polp", "polp-connection")],
      bank_connection_consents: [],
      bank_sync_runs: [],
      imported_bank_transactions: [],
      transactions: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedRequest(path, init));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.state.bank_connections[0]).toEqual(
      expect.objectContaining({ provider: "polp", status: "connected" }),
    );
    expect(database.state.bank_sync_runs).toHaveLength(0);
    expectProviderScopedOperations(database.operations);
  });

  it("scopes webhook updates and consent revocation by provider and external item ID", async () => {
    const database = createMemoryClient({
      bank_connections: [
        connection("pluggy", "pluggy-connection"),
        connection("polp", "polp-connection"),
      ],
      bank_connection_consents: [
        {
          id: "pluggy-consent",
          provider: "pluggy",
          connection_id: "pluggy-connection",
          status: "active",
        },
        {
          id: "polp-consent",
          provider: "polp",
          connection_id: "polp-connection",
          status: "active",
        },
      ],
    });
    const handler = await loadHandler(database.client);

    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/webhook" +
        "?householdId=household-1&userId=user-1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "item.deleted", itemId: "same-external-item" }),
      },
    ));

    expect(response.status).toBe(204);
    expect(database.state.bank_connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pluggy-connection", status: "disconnected" }),
      expect.objectContaining({ id: "polp-connection", status: "connected" }),
    ]));
    expect(database.state.bank_connection_consents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pluggy-consent", status: "revoked" }),
      expect.objectContaining({ id: "polp-consent", status: "active" }),
    ]));
    expectProviderScopedOperations(database.operations);
  });

  it.each(["2026-00", "2026-13", "2026-1", "2026-1.5"])(
    "rejects invalid month key %s before creating a sync run",
    async (monthKey) => {
      const database = createMemoryClient({
        memberships: [membership()],
        bank_connections: [connection("pluggy", "pluggy-connection")],
        bank_connection_consents: [],
        bank_sync_runs: [],
        imported_bank_transactions: [],
        transactions: [],
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const handler = await loadHandler(database.client);

      const response = await handler(authenticatedRequest("/sync-month", {
        method: "POST",
        body: JSON.stringify({
          householdId: "household-1",
          connectionId: "pluggy-connection",
          monthKey,
        }),
      }));

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(database.state.bank_sync_runs).toHaveLength(0);
      expect(database.state.bank_connections[0]).toEqual(
        expect.objectContaining({ status: "connected" }),
      );
    },
  );

  it("rejects invalid calendar dates and stores a provider/context-aware fingerprint", async () => {
    const polpFingerprint = buildOpenFinanceTransactionFingerprint({
      provider: "polp",
      internalConnectionId: "polp-connection",
      externalConnectionId: "same-external-item",
      externalAccountId: "same-external-account",
      externalTransactionId: "same-external-transaction",
      occurredOn: "2026-02-28",
      amountCents: 1250,
    });
    const database = createMemoryClient({
      memberships: [membership()],
      bank_connections: [connection("pluggy", "pluggy-connection")],
      bank_connection_consents: [],
      bank_sync_runs: [],
      imported_bank_transactions: [{
        id: "polp-import",
        provider: "polp",
        connection_id: "polp-connection",
        external_account_id: "same-external-account",
        external_transaction_id: "same-external-transaction",
        occurred_on: "2026-02-28",
        amount_cents: 1250,
        transaction_fingerprint: polpFingerprint,
      }],
      transactions: [],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "https://api.pluggy.ai/auth") {
        return new Response(JSON.stringify({ accessToken: "pluggy-api-key" }), { status: 200 });
      }

      if (url.includes("/items/same-external-item")) {
        return new Response("{}", { status: 200 });
      }

      if (url.includes("/transactions?")) {
        return new Response(JSON.stringify({
          results: [
            {
              id: "invalid-date-transaction",
              date: "2026-02-30T10:00:00.000Z",
              description: "Invalid calendar date",
              amount: 9.99,
              type: "DEBIT",
            },
            {
              id: "same-external-transaction",
              date: "2026-02-28",
              description: "Valid calendar date",
              amount: 12.5,
              type: "DEBIT",
            },
            {
              id: "unsafe-amount-transaction",
              date: "2026-02-28",
              description: "Unsafe amount",
              amount: 1e20,
              type: "DEBIT",
            },
          ],
          totalPages: 1,
        }), { status: 200 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedRequest("/sync-month", {
      method: "POST",
      body: JSON.stringify({
        householdId: "household-1",
        connectionId: "pluggy-connection",
        monthKey: "2026-02",
      }),
    }));

    const responseBody = (await response.json()) as { warnings: string[] };

    expect(response.status).toBe(200);
    expect(responseBody.warnings).toContain(
      "Transação Pluggy invalid-date-transaction ignorada: data inválida.",
    );
    expect(responseBody.warnings).toContain(
      "Transação Pluggy unsafe-amount-transaction ignorada: valor inválido.",
    );
    expect(database.state.transactions).toHaveLength(1);
    expect(database.state.transactions[0]).toEqual(expect.objectContaining({
      occurred_on: "2026-02-28",
      amount_cents: 1250,
    }));

    const pluggyImports = database.state.imported_bank_transactions.filter(
      (row) => row.provider === "pluggy",
    );
    expect(pluggyImports).toHaveLength(1);
    expect(pluggyImports[0].transaction_fingerprint).toBe(
      buildOpenFinanceTransactionFingerprint({
        provider: "pluggy",
        internalConnectionId: "pluggy-connection",
        externalConnectionId: "same-external-item",
        externalAccountId: "same-external-account",
        externalTransactionId: "same-external-transaction",
        occurredOn: "2026-02-28",
        amountCents: 1250,
      }),
    );
    expect(pluggyImports[0].transaction_fingerprint).not.toBe(polpFingerprint);
    expectProviderScopedOperations(database.operations);
  });
});
