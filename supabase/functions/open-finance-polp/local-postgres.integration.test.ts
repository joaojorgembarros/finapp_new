import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSupabaseSecretKeyFetch } from "../_shared/supabaseClientFetch";
import { createOpenFinancePolpHandler } from "./index";

type Handler = (request: Request) => Response | Promise<Response>;
type PolpTransaction = {
  id: string;
  account_id: string;
  transaction_name: string;
  transaction_date_time: string;
  credit_debit_type: "CREDITO" | "DEBITO";
  transaction_amount: { amount: string; currency: "BRL" };
  type: string;
  completed_authorised_payment_type: string;
  created_at: string;
  updated_at: string;
};
type SyncResponse = {
  found: number;
  inserted: number;
  duplicates: number;
  warnings: string[];
  message?: string;
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

const RUN_LOCAL_INTEGRATION = process.env.OPEN_FINANCE_POLP_LOCAL_POSTGRES === "1";

function requiredEnvironment(name: string, expectedPrefix?: string) {
  const value = process.env[name]?.trim() ?? "";
  if (!value || (expectedPrefix && !value.startsWith(expectedPrefix))) {
    throw new Error(`Missing or invalid local-only environment variable: ${name}`);
  }
  return value;
}

function assertLoopbackUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:"
    || !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)
  ) {
    throw new Error("The Polp integration test refuses a non-loopback Supabase URL.");
  }
  return url;
}

function throwOnError(context: string, error: { message: string } | null) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

describe.skipIf(!RUN_LOCAL_INTEGRATION)(
  "open-finance-polp /sync-month with local Auth, PostgREST and PostgreSQL",
  () => {
    let admin: SupabaseClient;
    let handler: Handler;
    let nativeFetch: typeof fetch;
    let localFetch: typeof fetch;
    let localOrigin = "";
    let userId = "";
    let userJwt = "";
    let householdId = "";
    let connectionId = "";
    let consentId = "";
    let accountId = "";
    let baseTransactionId = "";
    let concurrentTransactionId = "";
    let currentTransactions: PolpTransaction[] = [];
    let observedPolpRequests = 0;
    let observedAuthUserRequests = 0;
    let observedSecretBearerRequests = 0;

    beforeAll(async () => {
      const supabaseUrl = requiredEnvironment("OPEN_FINANCE_LOCAL_SUPABASE_URL");
      const publishableKey = requiredEnvironment(
        "OPEN_FINANCE_LOCAL_PUBLISHABLE_KEY",
        "sb_publishable_",
      );
      const secretKey = requiredEnvironment(
        "OPEN_FINANCE_LOCAL_SECRET_KEY",
        "sb_secret_",
      );
      localOrigin = assertLoopbackUrl(supabaseUrl).origin;
      nativeFetch = globalThis.fetch.bind(globalThis);

      const fixtureSuffix = randomUUID();
      connectionId = randomUUID();
      consentId = randomUUID();
      accountId = randomUUID();
      baseTransactionId = randomUUID();
      concurrentTransactionId = randomUUID();

      localFetch = async (input, init) => {
        const inspected = new Request(input, init);
        const url = new URL(inspected.url);

        if (url.origin === "https://api.polp.com.br") {
          observedPolpRequests += 1;
          expect(url.pathname).toBe(`/api/v2/accounts/${accountId}/transactions`);
          expect(url.searchParams.get("fromDate")).toBe("2026-08-01T00:00:00.000Z");
          expect(url.searchParams.get("toDate")).toBe("2026-08-31T23:59:59.999Z");
          expect(inspected.headers.get("x-api-client")).toBe("local-polp-client");
          expect(inspected.headers.get("x-api-secret")).toBe("local-polp-secret");
          return Response.json({
            data: currentTransactions,
            links: { first: null, last: null, prev: null, next: null },
            meta: { next_cursor: null, prev_cursor: null, per_page: 500 },
          });
        }

        if (url.origin === localOrigin) {
          if (url.pathname === "/auth/v1/user") observedAuthUserRequests += 1;
          if (inspected.headers.get("Authorization") === `Bearer ${secretKey}`) {
            observedSecretBearerRequests += 1;
          }
        }

        return nativeFetch(input, init);
      };

      admin = createClient(supabaseUrl, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: createSupabaseSecretKeyFetch(secretKey, localFetch) },
      });
      const email = `polp-local-${fixtureSuffix}@example.invalid`;
      const password = `Local-only-${fixtureSuffix}!Aa9`;
      const createdUser = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      throwOnError("create local Auth user", createdUser.error);
      userId = createdUser.data.user?.id ?? "";
      if (!userId) throw new Error("Local Auth did not return a user ID.");

      const publishableFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${publishableKey}`) {
          headers.delete("Authorization");
        }
        return localFetch(input, { ...init, headers });
      };
      const userClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: publishableFetch },
      });
      const signedIn = await userClient.auth.signInWithPassword({ email, password });
      throwOnError("sign in local Auth user", signedIn.error);
      userJwt = signedIn.data.session?.access_token ?? "";
      if (!userJwt) throw new Error("Local Auth did not return a user JWT.");

      const household = await userClient.rpc("create_household", {
        household_name: "Polp local PostgreSQL integration",
        household_type: "individual",
      });
      throwOnError("create local household", household.error);
      householdId = typeof household.data === "string" ? household.data : "";
      if (!householdId) throw new Error("create_household did not return an ID.");

      const connection = await admin.from("bank_connections").insert({
        id: connectionId,
        household_id: householdId,
        created_by: userId,
        provider: "polp",
        institution_id: randomUUID(),
        institution_name: "Local Polp Bank",
        external_connection_id: consentId,
        external_account_id: accountId,
        account_name: "Local Polp account",
        account_mask: "**** 4242",
        status: "connected",
        raw_payload: { resourceType: "account" },
      });
      throwOnError("insert local Polp connection", connection.error);

      const consent = await admin.from("bank_connection_consents").insert({
        connection_id: connectionId,
        household_id: householdId,
        created_by: userId,
        provider: "polp",
        external_consent_id: consentId,
        status: "active",
        granted_at: "2026-08-01T00:00:00.000Z",
        expires_at: null,
        raw_payload: { providerStatus: "AUTHORISED", executionStatus: "SUCCESS" },
      });
      throwOnError("insert local Polp consent", consent.error);

      const runtimeValues: Record<string, string> = {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SECRET_KEYS: JSON.stringify({ "open-finance": secretKey }),
        POLP_API_CLIENT: "local-polp-client",
        POLP_API_SECRET: "local-polp-secret",
        POLP_WEBHOOK_SECRET: "local-webhook-secret",
      };
      handler = createOpenFinancePolpHandler({
        getEnv: (name) => runtimeValues[name] ?? "",
        fetchImplementation: localFetch,
      });
      observedPolpRequests = 0;
      observedAuthUserRequests = 0;
      observedSecretBearerRequests = 0;
    }, 60_000);

    afterAll(async () => {
      if (admin && userId) {
        const cleanup = await admin.auth.admin.deleteUser(userId);
        throwOnError("delete local Auth fixture", cleanup.error);
      }
    }, 60_000);

    function syncRequest() {
      return new Request(`${localOrigin}/functions/v1/open-finance-polp/sync-month`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          householdId,
          connectionId,
          monthKey: "2026-08",
          created_by: randomUUID(),
          createdBy: randomUUID(),
          userId: randomUUID(),
          actorId: randomUUID(),
          provider: "pluggy",
        }),
      });
    }

    async function invokeSync() {
      const response = await handler(syncRequest());
      const body = await response.json() as SyncResponse;
      expect(response.status, body.message).toBe(200);
      return body;
    }

    async function importedRows(externalTransactionId: string) {
      const result = await admin
        .from("imported_bank_transactions")
        .select("id,transaction_id,created_by,occurred_on,description,amount_cents,direction")
        .eq("provider", "polp")
        .eq("connection_id", connectionId)
        .eq("external_account_id", accountId)
        .eq("external_transaction_id", externalTransactionId);
      throwOnError("read local imported Polp transaction", result.error);
      return (result.data ?? []) as ImportedRow[];
    }

    function transaction(id: string, overrides: Partial<PolpTransaction> = {}): PolpTransaction {
      return {
        id,
        account_id: accountId,
        transaction_name: "Local Polp transaction",
        transaction_date_time: "2026-08-10T10:30:00.000Z",
        credit_debit_type: "DEBITO",
        transaction_amount: { amount: "12.34", currency: "BRL" },
        type: "PIX",
        completed_authorised_payment_type: "TRANSACAO_EFETIVADA",
        created_at: "2026-08-10T10:30:01.000Z",
        updated_at: "2026-08-10T10:30:01.000Z",
        ...overrides,
      };
    }

    it("proves JWT actor, retry, content_changed and concurrency through the real RPC", async () => {
      const original = transaction(baseTransactionId);
      currentTransactions = [original];
      expect(await invokeSync()).toEqual(expect.objectContaining({
        found: 1,
        inserted: 1,
        duplicates: 0,
      }));

      const afterFirst = await importedRows(baseTransactionId);
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0]).toEqual(expect.objectContaining({
        created_by: userId,
        occurred_on: "2026-08-10",
        description: "Local Polp transaction",
        amount_cents: 1234,
        direction: "expense",
      }));
      expect(afterFirst[0].transaction_id).toBeTruthy();

      expect(await invokeSync()).toEqual(expect.objectContaining({
        found: 1,
        inserted: 0,
        duplicates: 1,
      }));
      expect(await importedRows(baseTransactionId)).toHaveLength(1);

      currentTransactions = [transaction(baseTransactionId, {
        transaction_name: "Local corrected transaction",
        transaction_date_time: "2026-08-11T10:30:00.000Z",
        transaction_amount: { amount: "98.76", currency: "BRL" },
      })];
      const changed = await invokeSync();
      expect(changed).toEqual(expect.objectContaining({ inserted: 0, duplicates: 1 }));
      expect(changed.warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/reconciliação necessária/i),
      ]));
      expect((await importedRows(baseTransactionId))[0]).toEqual(expect.objectContaining({
        transaction_id: afterFirst[0].transaction_id,
        description: "Local Polp transaction",
        amount_cents: 1234,
      }));

      currentTransactions = [transaction(concurrentTransactionId, {
        transaction_name: "Local concurrent Polp transaction",
        transaction_date_time: "2026-08-20T15:00:00.000Z",
        transaction_amount: { amount: "42.42", currency: "BRL" },
      })];
      const concurrent = await Promise.all([invokeSync(), invokeSync()]);
      expect(concurrent.map((result) => result.inserted).sort()).toEqual([0, 1]);
      expect(concurrent.map((result) => result.duplicates).sort()).toEqual([0, 1]);
      expect(await importedRows(concurrentTransactionId)).toHaveLength(1);

      const fixtureLedger = await admin
        .from("transactions")
        .select("id")
        .eq("household_id", householdId)
        .eq("created_by", userId);
      throwOnError("count local Polp ledger rows", fixtureLedger.error);
      expect(fixtureLedger.data).toHaveLength(2);
      expect(observedPolpRequests).toBeGreaterThanOrEqual(5);
      expect(observedAuthUserRequests).toBeGreaterThanOrEqual(5);
      expect(observedSecretBearerRequests).toBe(0);
    }, 120_000);
  },
);
