import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

type Handler = (request: Request) => Response | Promise<Response>;
type Row = Record<string, unknown>;
type QueryKind = "select" | "insert" | "update";
type QueryFilter = {
  kind: "eq" | "neq" | "in" | "gte" | "lt";
  column: string;
  value: unknown;
};
type QueryOperation = {
  table: string;
  kind: QueryKind;
  payload: unknown;
  filters: QueryFilter[];
};
type DatabaseError = { code?: string; message: string };
type QueryResult = { data: unknown; error: DatabaseError | null };
type RpcImportRow = {
  imported_bank_transaction_id: string;
  transaction_id: string;
  inserted: boolean;
  content_changed: boolean;
};
type RpcPlanEntry = {
  data: RpcImportRow[] | null;
  error: DatabaseError | null;
};

const OPEN_FINANCE_SECRET = "sb_secret_open_finance_rpc_contract";
const JWT_USER_ID = "jwt-user-id";
const HOUSEHOLD_ID = "household-rpc";
const CONNECTION_ID = "connection-rpc";
const ACCOUNT_ID = "account-rpc";
const ITEM_ID = "item-rpc";
const RUN_ID = "sync-run-rpc";

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
  private payload: unknown = null;
  private filters: QueryFilter[] = [];

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

  private rowsFromPayload(existingCount: number) {
    const values = Array.isArray(this.payload) ? this.payload : [this.payload];
    return values.map((value, index) => {
      const candidate = (value ?? {}) as Row;
      const defaultId = this.table === "bank_sync_runs"
        ? RUN_ID
        : `${this.table}-${existingCount + index + 1}`;
      return {
        ...candidate,
        id: candidate.id ?? defaultId,
        finished_at: candidate.finished_at ?? null,
        error_message: candidate.error_message ?? null,
        created_at: candidate.created_at ?? "2026-08-21T00:00:00.000Z",
        updated_at: candidate.updated_at ?? "2026-08-21T00:00:00.000Z",
      };
    });
  }

  private async execute(): Promise<QueryResult> {
    const rows = this.state[this.table] ?? (this.state[this.table] = []);
    const matched = rows.filter((row) => this.matches(row));
    this.operations.push({
      table: this.table,
      kind: this.kind,
      payload: this.payload,
      filters: [...this.filters],
    });

    if (this.kind === "insert") {
      const inserted = this.rowsFromPayload(rows.length);
      rows.push(...inserted);
      return { data: inserted, error: null };
    }

    if (this.kind === "update") {
      matched.forEach((row) => Object.assign(row, this.payload as Row));
      return { data: matched, error: null };
    }

    return { data: matched, error: null };
  }
}

function baseConnection(provider = "pluggy"): Row {
  return {
    id: CONNECTION_ID,
    household_id: HOUSEHOLD_ID,
    created_by: JWT_USER_ID,
    provider,
    institution_id: "pluggy-bank",
    institution_name: "Pluggy Bank",
    external_connection_id: ITEM_ID,
    external_account_id: ACCOUNT_ID,
    account_name: "Conta Pluggy",
    account_mask: "**** 1234",
    status: "connected",
    consent_expires_at: null,
    last_synced_at: null,
    raw_payload: { account: { type: "BANK" } },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

function createDatabase(options: {
  member?: boolean;
  connectionProvider?: "pluggy" | "polp";
  rpcPlan?: RpcPlanEntry[];
} = {}) {
  const state = cloneRows({
    memberships: options.member === false
      ? []
      : [{ household_id: HOUSEHOLD_ID, user_id: JWT_USER_ID }],
    bank_connections: [baseConnection(options.connectionProvider ?? "pluggy")],
    bank_connection_consents: [],
    bank_sync_runs: [],
    imported_bank_transactions: [],
    transactions: [],
  });
  const operations: QueryOperation[] = [];
  const rpcPlan = [...(options.rpcPlan ?? [])];
  const getUser = vi.fn(async () => ({
    data: { user: { id: JWT_USER_ID } },
    error: null,
  }));
  const rpc = vi.fn(async (_name: string, _arguments: Record<string, unknown>) => {
    const result = rpcPlan.shift();
    return result ?? {
      data: null,
      error: { message: "Unexpected RPC invocation without a configured result" },
    };
  });
  const client = {
    auth: { getUser },
    from: (table: string) => new MemoryQuery(table, state, operations),
    rpc,
  };

  return { client, getUser, operations, rpc, state };
}

function installRuntime() {
  let handler: Handler | null = null;
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.example.test",
    SUPABASE_SECRET_KEYS: JSON.stringify({ open_finance: OPEN_FINANCE_SECRET }),
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

async function loadHandler(client: ReturnType<typeof createDatabase>["client"]) {
  const getHandler = installRuntime();
  createClientMock.mockReturnValue(client);
  await import("./index");
  return getHandler();
}

function authenticatedSyncRequest() {
  return new Request(
    "https://project.example.test/functions/v1/open-finance-pluggy/sync-month",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer personal-user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        householdId: HOUSEHOLD_ID,
        connectionId: CONNECTION_ID,
        monthKey: "2026-08",
        created_by: "body-user-must-be-ignored",
        createdBy: "body-user-must-be-ignored",
        userId: "body-user-must-be-ignored",
        actorId: "body-user-must-be-ignored",
        provider: "polp",
      }),
    },
  );
}

function pluggyTransactions() {
  return [
    {
      id: "external-inserted",
      date: "2026-08-10T10:30:00.000Z",
      description: "Compra nova",
      amount: 10.25,
      type: "DEBIT",
    },
    {
      id: "external-duplicate",
      date: "2026-08-11T11:30:00.000Z",
      description: "Crédito repetido",
      amount: 20,
      type: "CREDIT",
    },
    {
      id: "external-content-changed",
      date: "2026-08-12T12:30:00.000Z",
      description: "Conteúdo alterado",
      amount: 30.75,
      type: "DEBIT",
    },
  ];
}

function installPluggyFetch(transactions = pluggyTransactions()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "https://api.pluggy.ai/auth") {
      return new Response(JSON.stringify({ accessToken: "pluggy-api-key" }), { status: 200 });
    }

    if (url === `https://api.pluggy.ai/items/${ITEM_ID}`) {
      return new Response("{}", { status: 200 });
    }

    if (url.startsWith("https://api.pluggy.ai/transactions?")) {
      return new Response(JSON.stringify({ results: transactions, totalPages: 1 }), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function rpcRow(
  suffix: string,
  inserted: boolean,
  contentChanged: boolean,
): RpcPlanEntry {
  return {
    data: [{
      imported_bank_transaction_id: `imported-${suffix}`,
      transaction_id: `transaction-${suffix}`,
      inserted,
      content_changed: contentChanged,
    }],
    error: null,
  };
}

function directImportWrites(operations: QueryOperation[]) {
  return operations.filter((operation) =>
    operation.kind === "insert"
    && (operation.table === "transactions" || operation.table === "imported_bank_transactions")
  );
}

describe("open-finance-pluggy atomic transaction RPC", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the RPC contract, JWT identity, result counters, and content_changed signal", async () => {
    const database = createDatabase({
      rpcPlan: [
        rpcRow("inserted", true, false),
        rpcRow("duplicate", false, false),
        rpcRow("content-changed", false, true),
      ],
    });
    installPluggyFetch();
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedSyncRequest());
    const body = (await response.json()) as {
      found: number;
      inserted: number;
      duplicates: number;
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(database.getUser).toHaveBeenCalledWith("personal-user-jwt");
    expect(database.rpc).toHaveBeenCalledTimes(3);
    expect(database.rpc.mock.calls.map((call) => call[0])).toEqual([
      "import_open_finance_transaction",
      "import_open_finance_transaction",
      "import_open_finance_transaction",
    ]);
    expect(database.rpc.mock.calls[0][1]).toEqual({
      p_provider: "pluggy",
      p_connection_id: CONNECTION_ID,
      p_household_id: HOUSEHOLD_ID,
      p_created_by: JWT_USER_ID,
      p_external_account_id: ACCOUNT_ID,
      p_external_transaction_id: "external-inserted",
      p_occurred_on: "2026-08-10",
      p_description: "Compra nova",
      p_amount_cents: 1025,
      p_direction: "expense",
      p_sync_run_id: RUN_ID,
      p_posted_at: "2026-08-10T10:30:00.000Z",
      p_raw_payload: pluggyTransactions()[0],
    });
    expect(database.rpc.mock.calls[1][1]).toEqual(expect.objectContaining({
      p_provider: "pluggy",
      p_created_by: JWT_USER_ID,
      p_external_transaction_id: "external-duplicate",
      p_amount_cents: 2000,
      p_direction: "income",
    }));
    expect(database.rpc.mock.calls[2][1]).toEqual(expect.objectContaining({
      p_provider: "pluggy",
      p_created_by: JWT_USER_ID,
      p_external_transaction_id: "external-content-changed",
      p_amount_cents: 3075,
      p_direction: "expense",
    }));
    database.rpc.mock.calls.forEach(([, rpcArguments]) => {
      expect(JSON.stringify(rpcArguments)).not.toContain("body-user-must-be-ignored");
    });

    expect(body).toEqual(expect.objectContaining({
      found: 3,
      inserted: 1,
      duplicates: 2,
    }));
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/external-content-changed.*reconcil/i),
    ]));
    expect(database.state.bank_sync_runs).toEqual([
      expect.objectContaining({
        id: RUN_ID,
        status: "success",
        found_count: 3,
        inserted_count: 1,
        duplicate_count: 2,
      }),
    ]);
    expect(directImportWrites(database.operations)).toEqual([]);
  });

  it("fails closed on an RPC error and never falls back to direct inserts", async () => {
    const database = createDatabase({
      rpcPlan: [{
        data: null,
        error: { code: "P0001", message: "OPEN_FINANCE_TEST_RPC_FAILURE" },
      }],
    });
    installPluggyFetch([pluggyTransactions()[0]]);
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedSyncRequest());
    const body = (await response.json()) as { message: string };

    expect(response.status).toBe(500);
    expect(body.message).toContain("OPEN_FINANCE_TEST_RPC_FAILURE");
    expect(database.rpc).toHaveBeenCalledTimes(1);
    expect(directImportWrites(database.operations)).toEqual([]);
    expect(database.state.transactions).toEqual([]);
    expect(database.state.imported_bank_transactions).toEqual([]);
    expect(database.state.bank_sync_runs).toEqual([
      expect.objectContaining({
        id: RUN_ID,
        status: "error",
        found_count: 1,
        inserted_count: 0,
        duplicate_count: 0,
        error_message: "OPEN_FINANCE_TEST_RPC_FAILURE",
      }),
    ]);
  });

  it("preserves confirmed counters when a later RPC call fails", async () => {
    const database = createDatabase({
      rpcPlan: [
        rpcRow("inserted-before-error", true, false),
        {
          data: null,
          error: { code: "P0001", message: "OPEN_FINANCE_LATER_RPC_FAILURE" },
        },
      ],
    });
    installPluggyFetch();
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedSyncRequest());

    expect(response.status).toBe(500);
    expect(database.rpc).toHaveBeenCalledTimes(2);
    expect(directImportWrites(database.operations)).toEqual([]);
    expect(database.state.bank_sync_runs).toEqual([
      expect.objectContaining({
        id: RUN_ID,
        status: "error",
        found_count: 3,
        inserted_count: 1,
        duplicate_count: 0,
        error_message: "OPEN_FINANCE_LATER_RPC_FAILURE",
      }),
    ]);
  });

  it("rejects a non-member before Pluggy access, sync-run creation, or RPC execution", async () => {
    const database = createDatabase({ member: false });
    const fetchMock = installPluggyFetch();
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedSyncRequest());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
    expect(database.state.bank_sync_runs).toEqual([]);
    expect(directImportWrites(database.operations)).toEqual([]);
  });

  it("rejects a non-Pluggy connection before Pluggy access or RPC execution", async () => {
    const database = createDatabase({ connectionProvider: "polp" });
    const fetchMock = installPluggyFetch();
    const handler = await loadHandler(database.client);

    const response = await handler(authenticatedSyncRequest());

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
    expect(database.state.bank_sync_runs).toEqual([]);
    expect(directImportWrites(database.operations)).toEqual([]);
  });
});
