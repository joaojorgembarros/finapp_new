import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createSupabaseSecretKeyFetch } from "../_shared/supabaseClientFetch";

type Handler = (request: Request) => Response | Promise<Response>;
type EdgeRuntime = {
  env: { get: (name: string) => string | undefined };
  serve: (handler: Handler) => void;
};
type PluggyTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
};
type SyncResponse = {
  found: number;
  inserted: number;
  duplicates: number;
  warnings: string[];
};
type ImportedRow = {
  id: string;
  transaction_id: string | null;
  created_by: string;
  occurred_on: string;
  description: string;
  amount_cents: number;
  direction: string;
};

const RUN_LOCAL_INTEGRATION = process.env.OPEN_FINANCE_LOCAL_POSTGRES === "1";
const MONTH_KEY = "2026-08";

function requiredLocalEnvironment(name: string, expectedPrefix?: string) {
  const value = process.env[name]?.trim() ?? "";

  if (!value || (expectedPrefix && !value.startsWith(expectedPrefix))) {
    throw new Error(`Missing or invalid local-only environment variable: ${name}`);
  }

  return value;
}

function assertLoopbackUrl(value: string) {
  const url = new URL(value);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname)) {
    throw new Error("The local integration test refuses a non-loopback Supabase URL");
  }

  return url;
}

function throwOnError(context: string, error: { message: string } | null) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

describe.skipIf(!RUN_LOCAL_INTEGRATION)(
  "open-finance-pluggy /sync-month with local Auth, PostgREST, and PostgreSQL",
  () => {
    let nativeFetch: typeof fetch;
    let localFetch: typeof fetch;
    let admin: SupabaseClient;
    let handler: Handler;
    let localOrigin: string;
    let secretKey: string;
    let publishableKey: string;
    let userId = "";
    let userJwt = "";
    let householdId = "";
    let connectionId = "";
    let itemId = "";
    let accountId = "";
    let baseExternalTransactionId = "";
    let concurrentExternalTransactionId = "";
    let currentPluggyTransactions: PluggyTransaction[] = [];
    let observedAuthUserRequests = 0;
    let observedModernSecretRequests = 0;
    let observedSecretBearerRequests = 0;

    beforeAll(async () => {
      const supabaseUrl = requiredLocalEnvironment("OPEN_FINANCE_LOCAL_SUPABASE_URL");
      publishableKey = requiredLocalEnvironment(
        "OPEN_FINANCE_LOCAL_PUBLISHABLE_KEY",
        "sb_publishable_",
      );
      secretKey = requiredLocalEnvironment(
        "OPEN_FINANCE_LOCAL_SECRET_KEY",
        "sb_secret_",
      );
      localOrigin = assertLoopbackUrl(supabaseUrl).origin;

      nativeFetch = globalThis.fetch.bind(globalThis);
      const pluggyApiKey = `local-pluggy-token-${randomUUID()}`;

      localFetch = async (input, init) => {
        const inspectedRequest = new Request(input, init);
        const url = new URL(inspectedRequest.url);

        if (url.origin === "https://api.pluggy.ai") {
          if (url.pathname === "/auth" && inspectedRequest.method === "POST") {
            return Response.json({ accessToken: pluggyApiKey });
          }

          if (
            url.pathname === `/items/${itemId}`
            && inspectedRequest.method === "PATCH"
          ) {
            expect(inspectedRequest.headers.get("X-API-KEY")).toBe(pluggyApiKey);
            return Response.json({});
          }

          if (url.pathname === "/transactions" && inspectedRequest.method === "GET") {
            expect(inspectedRequest.headers.get("X-API-KEY")).toBe(pluggyApiKey);
            expect(url.searchParams.get("accountId")).toBe(accountId);
            expect(url.searchParams.get("from")).toBe("2026-08-01");
            expect(url.searchParams.get("to")).toBe("2026-09-01");
            return Response.json({
              results: currentPluggyTransactions,
              totalPages: 1,
            });
          }

          throw new Error(`Unexpected mocked Pluggy request: ${url.pathname}`);
        }

        if (url.origin === localOrigin) {
          const authorization = inspectedRequest.headers.get("Authorization");

          if (url.pathname === "/auth/v1/user") observedAuthUserRequests += 1;
          if (inspectedRequest.headers.get("apikey") === secretKey) {
            observedModernSecretRequests += 1;
          }
          if (authorization === `Bearer ${secretKey}`) {
            observedSecretBearerRequests += 1;
          }
        }

        return nativeFetch(input, init);
      };

      vi.stubGlobal("fetch", localFetch);

      admin = createClient(supabaseUrl, secretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          fetch: createSupabaseSecretKeyFetch(secretKey, localFetch),
        },
      });

      const fixtureSuffix = randomUUID();
      const email = `open-finance-local-${fixtureSuffix}@example.invalid`;
      const password = `Local-only-${fixtureSuffix}!Aa9`;
      connectionId = randomUUID();
      itemId = `local-item-${fixtureSuffix}`;
      accountId = `local-account-${fixtureSuffix}`;
      baseExternalTransactionId = `local-base-${fixtureSuffix}`;
      concurrentExternalTransactionId = `local-concurrent-${fixtureSuffix}`;

      const createUserResult = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      throwOnError("create local Auth user", createUserResult.error);
      userId = createUserResult.data.user?.id ?? "";
      if (!userId) throw new Error("Local Auth did not return a user ID");

      const publishableFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${publishableKey}`) {
          headers.delete("Authorization");
        }
        return localFetch(input, { ...init, headers });
      };
      const userClient = createClient(supabaseUrl, publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: { fetch: publishableFetch },
      });
      const signInResult = await userClient.auth.signInWithPassword({ email, password });
      throwOnError("sign in local Auth user", signInResult.error);
      userJwt = signInResult.data.session?.access_token ?? "";
      if (!userJwt) throw new Error("Local Auth did not return a personal JWT");

      // Core tables intentionally do not grant direct service-role fixture
      // writes. Exercise the real authenticated RPC that creates both rows.
      const householdResult = await userClient.rpc("create_household", {
        household_name: "Open Finance local PostgreSQL integration",
        household_type: "individual",
      });
      throwOnError("create local household through authenticated RPC", householdResult.error);
      householdId = typeof householdResult.data === "string" ? householdResult.data : "";
      if (!householdId) throw new Error("create_household did not return a household ID");

      const connectionResult = await admin.from("bank_connections").insert({
        id: connectionId,
        household_id: householdId,
        created_by: userId,
        provider: "pluggy",
        institution_id: "local-institution",
        institution_name: "Local Pluggy Bank",
        external_connection_id: itemId,
        external_account_id: accountId,
        account_name: "Local integration account",
        account_mask: "**** 4242",
        status: "connected",
        raw_payload: {
          account: { type: "BANK" },
        },
      });
      throwOnError("insert local bank connection", connectionResult.error);

      let registeredHandler: Handler | null = null;
      const runtimeValues: Record<string, string> = {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SECRET_KEYS: JSON.stringify({ open_finance: secretKey }),
        PLUGGY_CLIENT_ID: "local-http-mock-client",
        PLUGGY_CLIENT_SECRET: "local-http-mock-secret",
      };
      const runtime: EdgeRuntime = {
        env: { get: (name) => runtimeValues[name] },
        serve: (nextHandler) => {
          registeredHandler = nextHandler;
        },
      };
      (globalThis as typeof globalThis & { Deno: EdgeRuntime }).Deno = runtime;

      vi.resetModules();
      await import("./index");
      if (!registeredHandler) throw new Error("The Pluggy handler was not registered");
      handler = registeredHandler;

      // Ignore setup traffic. Observations below must come from the handler.
      observedAuthUserRequests = 0;
      observedModernSecretRequests = 0;
      observedSecretBearerRequests = 0;
    }, 60_000);

    afterAll(async () => {
      const cleanupErrors: string[] = [];

      if (admin && userId) {
        // Deleting this single-member personal user is the production cleanup
        // path and cascades the household plus every banking/ledger fixture.
        const userCleanup = await admin.auth.admin.deleteUser(userId);
        if (userCleanup.error) cleanupErrors.push(userCleanup.error.message);
      }

      vi.unstubAllGlobals();
      delete (globalThis as typeof globalThis & { Deno?: EdgeRuntime }).Deno;

      if (cleanupErrors.length > 0) {
        throw new Error(`Local fixture cleanup failed (${cleanupErrors.length} error(s))`);
      }
    }, 60_000);

    function syncRequest() {
      return new Request(
        `${localOrigin}/functions/v1/open-finance-pluggy/sync-month`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${userJwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            householdId,
            connectionId,
            monthKey: MONTH_KEY,
            created_by: randomUUID(),
            createdBy: randomUUID(),
            userId: randomUUID(),
            actorId: randomUUID(),
          }),
        },
      );
    }

    async function invokeSyncMonth() {
      const response = await handler(syncRequest());
      const body = await response.json() as SyncResponse & { message?: string };
      expect(response.status, body.message).toBe(200);
      return body;
    }

    async function importedRows(externalTransactionId: string) {
      const result = await admin
        .from("imported_bank_transactions")
        .select(
          "id,transaction_id,created_by,occurred_on,description,amount_cents,direction",
        )
        .eq("provider", "pluggy")
        .eq("connection_id", connectionId)
        .eq("external_account_id", accountId)
        .eq("external_transaction_id", externalTransactionId);
      throwOnError("read imported transaction", result.error);
      return (result.data ?? []) as ImportedRow[];
    }

    it("proves new, retry, content_changed, and concurrent imports through the real handler", async () => {
      const originalTransaction: PluggyTransaction = {
        id: baseExternalTransactionId,
        date: "2026-08-10T10:30:00.000Z",
        description: "Local original transaction",
        amount: -12.34,
        type: "DEBIT",
      };
      currentPluggyTransactions = [originalTransaction];

      const first = await invokeSyncMonth();
      expect(first).toEqual(expect.objectContaining({
        found: 1,
        inserted: 1,
        duplicates: 0,
      }));

      const afterFirst = await importedRows(baseExternalTransactionId);
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0]).toEqual(expect.objectContaining({
        created_by: userId,
        occurred_on: "2026-08-10",
        description: "Local original transaction",
        amount_cents: 1234,
        direction: "expense",
      }));
      expect(afterFirst[0].transaction_id).toBeTruthy();

      const firstLedger = await admin
        .from("transactions")
        .select("id,created_by,household_id,note,amount_cents,occurred_on")
        .eq("id", afterFirst[0].transaction_id)
        .single();
      throwOnError("read first ledger transaction", firstLedger.error);
      expect(firstLedger.data).toEqual(expect.objectContaining({
        created_by: userId,
        household_id: householdId,
        note: "Local original transaction",
        amount_cents: 1234,
        occurred_on: "2026-08-10",
      }));

      const repeated = await invokeSyncMonth();
      expect(repeated).toEqual(expect.objectContaining({
        found: 1,
        inserted: 0,
        duplicates: 1,
      }));
      expect(repeated.warnings).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/reconcil/i),
      ]));
      expect(await importedRows(baseExternalTransactionId)).toHaveLength(1);

      currentPluggyTransactions = [{
        ...originalTransaction,
        date: "2026-08-11T10:30:00.000Z",
        description: "Local corrected transaction",
        amount: -98.76,
      }];
      const changed = await invokeSyncMonth();
      expect(changed).toEqual(expect.objectContaining({
        found: 1,
        inserted: 0,
        duplicates: 1,
      }));
      expect(changed.warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(new RegExp(`${baseExternalTransactionId}.*reconcil`, "i")),
      ]));

      const afterChanged = await importedRows(baseExternalTransactionId);
      expect(afterChanged).toHaveLength(1);
      expect(afterChanged[0]).toEqual(expect.objectContaining({
        transaction_id: afterFirst[0].transaction_id,
        occurred_on: "2026-08-10",
        description: "Local original transaction",
        amount_cents: 1234,
      }));

      currentPluggyTransactions = [{
        id: concurrentExternalTransactionId,
        date: "2026-08-20T15:00:00.000Z",
        description: "Local concurrent transaction",
        amount: -42.42,
        type: "DEBIT",
      }];
      const concurrent = await Promise.all([
        invokeSyncMonth(),
        invokeSyncMonth(),
      ]);
      expect(concurrent.map((result) => result.inserted).sort()).toEqual([0, 1]);
      expect(concurrent.map((result) => result.duplicates).sort()).toEqual([0, 1]);

      const concurrentImported = await importedRows(concurrentExternalTransactionId);
      expect(concurrentImported).toHaveLength(1);
      expect(concurrentImported[0].transaction_id).toBeTruthy();
      const concurrentLedger = await admin
        .from("transactions")
        .select("id")
        .eq("id", concurrentImported[0].transaction_id);
      throwOnError("read concurrent ledger transaction", concurrentLedger.error);
      expect(concurrentLedger.data).toHaveLength(1);

      const allFixtureLedger = await admin
        .from("transactions")
        .select("id")
        .eq("household_id", householdId)
        .eq("created_by", userId);
      throwOnError("count fixture ledger transactions", allFixtureLedger.error);
      expect(allFixtureLedger.data).toHaveLength(2);

      expect(observedAuthUserRequests).toBeGreaterThanOrEqual(5);
      expect(observedModernSecretRequests).toBeGreaterThan(0);
      expect(observedSecretBearerRequests).toBe(0);
    }, 120_000);
  },
);
