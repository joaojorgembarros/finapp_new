import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseApiKeys } from "../_shared/supabaseApiKeys";
import { createSupabaseSecretKeyFetch } from "../_shared/supabaseClientFetch";
import {
  handleAccountDeletion,
  isAllowedAccountDeletionOrigin,
} from "./deleteAccount";

type EdgeRuntime = {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
};

const edgeRuntime = (globalThis as typeof globalThis & { Deno: EdgeRuntime }).Deno;

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STORAGE_DELETE_BATCH_SIZE = 100;
const DATABASE_PAGE_SIZE = 500;
const EXTERNAL_PROVIDER_TIMEOUT_MS = 10_000;
const DELETE_ACCOUNT_API_KEY_NAMES = {
  publishable: "default",
  secret: "delete-account",
} as const;

function responseHeaders(origin: string | null): Record<string, string> {
  return {
    ...BASE_CORS_HEADERS,
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  };
}

function jsonResponse(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...responseHeaders(origin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isMissingUserError(error: { status?: number; code?: string } | null): boolean {
  return error?.status === 404 || error?.code === "user_not_found";
}

async function collectRpcRows(
  createQuery: () => {
    range: (from: number, to: number) => PromiseLike<{
      data: Record<string, unknown>[] | null;
      error: unknown;
    }>;
  },
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for (let from = 0; ; from += DATABASE_PAGE_SIZE) {
    const { data, error } = await createQuery().range(
      from,
      from + DATABASE_PAGE_SIZE - 1,
    );
    if (error || !Array.isArray(data)) throw new Error("account deletion lookup failed");
    rows.push(...data);
    if (data.length < DATABASE_PAGE_SIZE) return rows;
  }
}

edgeRuntime.serve(async (request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigins = edgeRuntime.env.get("ACCOUNT_DELETE_ALLOWED_ORIGINS");

  if (!isAllowedAccountDeletionOrigin(origin, allowedOrigins)) {
    return jsonResponse(403, { error: "origin_not_allowed" }, null);
  }

  if (request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }

  const supabaseUrl = edgeRuntime.env.get("SUPABASE_URL");
  let apiKeys: ReturnType<typeof resolveSupabaseApiKeys>;

  try {
    apiKeys = resolveSupabaseApiKeys(edgeRuntime.env, DELETE_ACCOUNT_API_KEY_NAMES);
  } catch {
    return jsonResponse(500, { error: "account_deletion_failed" }, origin);
  }

  if (!supabaseUrl) {
    return jsonResponse(500, { error: "account_deletion_failed" }, origin);
  }

  let bodyText: string;

  try {
    bodyText = await request.text();
  } catch {
    return jsonResponse(400, { error: "invalid_request" }, origin);
  }

  const clients = (() => {
    try {
      return {
        authClient: createClient(supabaseUrl, apiKeys.publishableKey, {
          auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
        }),
        serviceClient: createClient(supabaseUrl, apiKeys.secretKey, {
          auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
          global: { fetch: createSupabaseSecretKeyFetch(apiKeys.secretKey) },
        }),
      };
    } catch {
      return null;
    }
  })();

  if (!clients) {
    return jsonResponse(500, { error: "account_deletion_failed" }, origin);
  }

  const { authClient, serviceClient } = clients;

  const result = await handleAccountDeletion(
    {
      method: request.method,
      authorization: request.headers.get("Authorization"),
      bodyText,
      url: request.url,
    },
    {
      authenticate: async (accessToken) => {
        const { data, error } = await authClient.auth.getUser(accessToken);

        if (error || !data.user) return null;
        return { userId: data.user.id, email: data.user.email ?? null };
      },
      getHouseholds: async (userId) => {
        const data = await collectRpcRows(() => serviceClient.rpc(
          "account_deletion_households",
          { target_user_id: userId },
        ));

        return data.map((row) => ({
          householdId: String(row.household_id),
          householdType: String(row.household_type),
          memberCount: Number(row.member_count),
          hasOtherMembers: row.has_other_members === true,
        }));
      },
      hasUnsafeHouseholdReferences: async (userId) => {
        const { data, error } = await serviceClient.rpc(
          "account_deletion_has_unsafe_references",
          { target_user_id: userId },
        );
        if (error || typeof data !== "boolean") {
          throw new Error("account deletion lookup failed");
        }
        return data;
      },
      getExternalConnectionIds: async (userId) => {
        const data = await collectRpcRows(() => serviceClient.rpc(
          "account_deletion_external_connections",
          { target_user_id: userId },
        ));

        return data.map((row) => {
          const externalConnectionId = row.external_connection_id;
          if (typeof externalConnectionId !== "string") {
            throw new Error("account deletion lookup failed");
          }
          return externalConnectionId;
        });
      },
      revokeExternalConnections: async (externalConnectionIds) => {
        const clientId = edgeRuntime.env.get("PLUGGY_CLIENT_ID");
        const clientSecret = edgeRuntime.env.get("PLUGGY_CLIENT_SECRET");

        if (!clientId || !clientSecret) throw new Error("external provider unavailable");

        const authenticationResponse = await fetch("https://api.pluggy.ai/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, clientSecret }),
          signal: AbortSignal.timeout(EXTERNAL_PROVIDER_TIMEOUT_MS),
        });

        if (!authenticationResponse.ok) throw new Error("external provider unavailable");

        const authentication = await authenticationResponse.json() as { apiKey?: unknown };
        if (typeof authentication.apiKey !== "string" || !authentication.apiKey) {
          throw new Error("external provider unavailable");
        }

        for (const externalConnectionId of externalConnectionIds) {
          const deletionResponse = await fetch(
            `https://api.pluggy.ai/items/${encodeURIComponent(externalConnectionId)}`,
            {
              method: "DELETE",
              headers: { "X-API-KEY": authentication.apiKey },
              signal: AbortSignal.timeout(EXTERNAL_PROVIDER_TIMEOUT_MS),
            },
          );

          if (![200, 204, 404].includes(deletionResponse.status)) {
            throw new Error("external provider deletion failed");
          }
        }
      },
      getStorageObjects: async (userId) => {
        const data = await collectRpcRows(() => serviceClient.rpc(
          "account_deletion_storage_objects",
          { target_user_id: userId },
        ));

        return data.map((row) => ({
          bucketId: String(row.bucket_id),
          objectName: String(row.object_name),
        }));
      },
      removeStorageObjects: async (bucketId, objectNames) => {
        for (let start = 0; start < objectNames.length; start += STORAGE_DELETE_BATCH_SIZE) {
          const batch = objectNames.slice(start, start + STORAGE_DELETE_BATCH_SIZE);
          const { error } = await serviceClient.storage.from(bucketId).remove(batch);

          if (error) throw new Error("storage deletion failed");
        }
      },
      deleteAuthUser: async (userId) => {
        const { error } = await serviceClient.auth.admin.deleteUser(userId);

        if (error && !isMissingUserError(error)) {
          throw new Error("auth user deletion failed");
        }
      },
    },
  );

  return jsonResponse(result.status, result.body, origin);
});
