import { createClient } from "@supabase/supabase-js";

import { resolveSupabaseSecretKey } from "../_shared/supabaseApiKeys";
import { createSupabaseSecretKeyFetch } from "../_shared/supabaseClientFetch";

import {
  buildOpenFinanceTransactionFingerprint,
  isOpenFinanceDate,
  OPEN_FINANCE_PROVIDER,
  OpenFinanceApiErrorPayload,
  OpenFinanceBackendConfigResponse,
  OpenFinanceConfigurationCheck,
  OpenFinanceConnectionStatus,
  OpenFinanceConsent,
  OpenFinanceConsentStatus,
  OpenFinanceDisconnectConnectionResponse,
  OpenFinanceListConnectionsResponse,
  OpenFinancePluggyConnection,
  OpenFinancePluggyInstitution,
  OpenFinanceStartConnectionResponse,
  OpenFinanceSyncMonthResponse,
  OpenFinanceSyncRun,
  OpenFinanceSyncStatus,
  OpenFinanceTransactionDirection,
} from "../../../src/lib/open-finance-contract";

type EdgeRuntime = {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
};

const edgeRuntime = (globalThis as typeof globalThis & { Deno: EdgeRuntime }).Deno;
const OPEN_FINANCE_SECRET_KEY_NAME = "open-finance";

type JsonObject = Record<string, unknown>;
type SupabaseAdmin = ReturnType<typeof createAdminClient>;

type PluggyItem = Record<string, unknown>;
type PluggyAccount = Record<string, unknown>;
type PluggyConsent = Record<string, unknown>;
type PluggyTransaction = Record<string, unknown>;

type ConnectionRow = {
  id: string;
  household_id: string;
  created_by: string;
  provider: string;
  institution_id: string | null;
  institution_name: string;
  external_connection_id: string | null;
  external_account_id: string;
  account_name: string;
  account_mask: string | null;
  status: string;
  consent_expires_at: string | null;
  last_synced_at: string | null;
  raw_payload: JsonObject | null;
  created_at: string;
  updated_at: string;
};

type ConsentRow = {
  id: string;
  connection_id: string;
  external_consent_id: string | null;
  status: string;
  granted_at: string;
  expires_at: string | null;
  raw_payload: JsonObject | null;
  created_at: string;
  updated_at: string;
};

type SyncRunRow = {
  id: string;
  connection_id: string;
  household_id: string;
  month_key: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  found_count: number;
  inserted_count: number;
  duplicate_count: number;
  error_message: string | null;
  raw_payload: JsonObject | null;
  created_at: string;
  updated_at: string;
};

type ImportedTransactionRow = {
  external_transaction_id: string;
  occurred_on: string;
  amount_cents: number;
  transaction_fingerprint: string;
};

class HttpError extends Error {
  status: number;
  code: string | null;
  details: JsonObject | null;

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    details: JsonObject | null = null
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

let pluggyApiKeyCache: { token: string; expiresAt: number } | null = null;
const pluggyOauthRedirectUri = "sonhomais://open-finance";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function noContentResponse() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function getEnv(name: string) {
  const value = edgeRuntime.env.get(name);
  return value ? value.trim() : "";
}

function getOpenFinanceSecretKey() {
  return resolveSupabaseSecretKey(edgeRuntime.env, OPEN_FINANCE_SECRET_KEY_NAME);
}

function buildConfigCheck(input: OpenFinanceConfigurationCheck): OpenFinanceConfigurationCheck {
  return input;
}

function summarizeConfigDiagnostics(diagnostics: OpenFinanceConfigurationCheck[]) {
  const firstIssue = diagnostics.find((item) => item.status !== "ok");
  return firstIssue?.message ?? "Pluggy configurada no backend.";
}

function buildBackendDiagnostics() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  let hasOpenFinanceSecretKey = false;

  try {
    getOpenFinanceSecretKey();
    hasOpenFinanceSecretKey = true;
  } catch {
    hasOpenFinanceSecretKey = false;
  }

  const pluggyClientId = getEnv("PLUGGY_CLIENT_ID");
  const pluggyClientSecret = getEnv("PLUGGY_CLIENT_SECRET");

  const diagnostics: OpenFinanceConfigurationCheck[] = [
    buildConfigCheck({
      code: "backend_supabase_url",
      location: "backend",
      label: "SUPABASE_URL",
      status: supabaseUrl ? "ok" : "missing",
      message: supabaseUrl
        ? "SUPABASE_URL disponivel na Edge Function."
        : "Secret SUPABASE_URL ausente na Edge Function.",
    }),
    buildConfigCheck({
      code: "backend_secret_key",
      location: "backend",
      label: "Secret Supabase do Open Finance",
      status: hasOpenFinanceSecretKey ? "ok" : "missing",
      message: hasOpenFinanceSecretKey
        ? "Secret Supabase moderna configurada para o Open Finance."
        : "Secret Supabase moderna do Open Finance ausente na Edge Function.",
    }),
    buildConfigCheck({
      code: "backend_pluggy_client_id",
      location: "backend",
      label: "PLUGGY_CLIENT_ID",
      status: pluggyClientId ? "ok" : "missing",
      message: pluggyClientId
        ? "PLUGGY_CLIENT_ID configurado na Edge Function."
        : "Secret PLUGGY_CLIENT_ID ausente na Edge Function.",
    }),
    buildConfigCheck({
      code: "backend_pluggy_client_secret",
      location: "backend",
      label: "PLUGGY_CLIENT_SECRET",
      status: pluggyClientSecret ? "ok" : "missing",
      message: pluggyClientSecret
        ? "PLUGGY_CLIENT_SECRET configurado na Edge Function."
        : "Secret PLUGGY_CLIENT_SECRET ausente na Edge Function.",
    }),
    buildConfigCheck({
      code: "backend_sandbox",
      location: "backend",
      label: "Sandbox Pluggy",
      status: "ok",
      message: "Connectores sandbox estao habilitados no Pluggy Connect.",
    }),
    buildConfigCheck({
      code: "backend_oauth_redirect",
      location: "backend",
      label: "OAuth redirect",
      status: "ok",
      message: `oauthRedirectUri configurado como ${pluggyOauthRedirectUri}.`,
    }),
  ];

  return diagnostics;
}

function isConfigured() {
  return buildBackendDiagnostics()
    .filter((item) => item.code !== "backend_sandbox" && item.code !== "backend_oauth_redirect")
    .every((item) => item.status === "ok");
}

function createAdminClient() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  let secretKey: string;

  try {
    secretKey = getOpenFinanceSecretKey();
  } catch {
    throw new HttpError(500, "Supabase Admin não configurado.");
  }

  if (!supabaseUrl) {
    throw new HttpError(500, "Supabase Admin não configurado.");
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: createSupabaseSecretKeyFetch(secretKey),
    },
  });
}

function getAuthToken(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function requireUser(request: Request, admin: SupabaseAdmin) {
  const token = getAuthToken(request);

  if (!token) {
    throw new HttpError(401, "Sessão inválida.");
  }

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) {
    throw new HttpError(401, "Sessão inválida.");
  }

  return data.user;
}

async function ensureMembership(admin: SupabaseAdmin, householdId: string, userId: string) {
  const { data, error } = await admin
    .from("memberships")
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message);
  }

  if (!data) {
    throw new HttpError(403, "Você não tem acesso a esse household.");
  }
}

function parsePath(request: Request) {
  const url = new URL(request.url);
  const marker = "/open-finance-pluggy";
  const index = url.pathname.indexOf(marker);
  const suffix = index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname;
  return suffix || "/";
}

function getFunctionRootUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto === "https" || (!url.hostname.includes("localhost") && !url.hostname.includes("127.0.0.1"))) {
    url.protocol = "https:";
  }

  const marker = "/open-finance-pluggy";
  const index = url.pathname.indexOf(marker);

  if (index < 0) {
    return `${url.origin}${url.pathname}`;
  }

  return `${url.origin}${url.pathname.slice(0, index + marker.length)}`;
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as JsonObject;
  } catch {
    return {};
  }
}

function toJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "") {
  if (value == null) return fallback;
  return String(value);
}

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeDate(value: unknown) {
  const raw = asString(value);
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toYmd(value: unknown) {
  const raw = asString(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(raw);
  const datePart = match?.[1];

  if (!datePart || !isOpenFinanceDate(datePart)) {
    return null;
  }

  if (raw === datePart) {
    return datePart;
  }

  return normalizeDate(raw) ? datePart : null;
}

function nowIso() {
  return new Date().toISOString();
}

function maskAccount(value: unknown, fallbackSource: unknown) {
  const digits = asString(value || fallbackSource).replace(/\D/g, "");
  const lastFour = digits.slice(-4);
  return lastFour ? `**** ${lastFour}` : "****";
}

function monthRange(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);

  if (!match || !isOpenFinanceDate(`${monthKey}-01`)) {
    throw new HttpError(400, "Mês inválido.");
  }

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    from: `${monthKey}-01`,
    to: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

function deriveConsentStatus(
  expiresAt: string | null,
  storedStatus: string | null,
  revokedAt?: string | null
): OpenFinanceConsentStatus {
  if (revokedAt) {
    return "revoked";
  }

  if (storedStatus === "revoked") {
    return "revoked";
  }

  if (!expiresAt) {
    return (storedStatus as OpenFinanceConsentStatus) || "active";
  }

  const expiresDate = new Date(expiresAt);
  if (Number.isNaN(expiresDate.getTime())) {
    return (storedStatus as OpenFinanceConsentStatus) || "active";
  }

  const now = Date.now();
  if (expiresDate.getTime() <= now) {
    return "expired";
  }

  if (expiresDate.getTime() - now <= 7 * 24 * 60 * 60 * 1000) {
    return "expiring";
  }

  return (storedStatus as OpenFinanceConsentStatus) || "active";
}

function mapItemStatus(item: PluggyItem): OpenFinanceConnectionStatus {
  const rawStatus = asString(item.executionStatus || item.status).toUpperCase();

  if (rawStatus.includes("ERROR")) return "error";
  if (rawStatus.includes("FAILED")) return "error";
  if (rawStatus.includes("DELETED")) return "disconnected";
  return "connected";
}

function buildInstitution(item: PluggyItem, account: PluggyAccount): OpenFinancePluggyInstitution {
  const connector = toJsonObject(item.connector) ?? {};
  const connectorId = Number(
    connector.id ??
    item.connectorId ??
    account.connectorId ??
    account.institutionId ??
    NaN
  );

  const displayName =
    asString(
      connector.name ??
      connector.displayName ??
      item.connectorName ??
      item.institutionName
    ) || "Conta bancária";

  return {
    id: asString(connector.id ?? item.connectorId ?? account.connectorId ?? "pluggy"),
    name: displayName,
    displayName,
    provider: OPEN_FINANCE_PROVIDER,
    connectorId: Number.isFinite(connectorId) ? connectorId : null,
  };
}

function mapConsentPayload(
  connectionId: string,
  row: ConsentRow | null
): OpenFinanceConsent | null {
  if (!row) return null;

  const rawPayload = row.raw_payload ?? null;
  const revokedAt = normalizeDate(rawPayload?.revokedAt ?? rawPayload?.revoked_at);
  const expiresAt = row.expires_at ? normalizeDate(row.expires_at) : null;
  const status = deriveConsentStatus(expiresAt, row.status, revokedAt);

  return {
    id: row.id,
    connectionId,
    externalConsentId: row.external_consent_id,
    status,
    grantedAt: row.granted_at,
    expiresAt,
    revokedAt,
    rawPayload,
  };
}

function mapSyncRun(row: SyncRunRow | null): OpenFinanceSyncRun | null {
  if (!row) return null;

  const rawPayload = row.raw_payload ?? null;
  const warnings = asArray(rawPayload?.warnings).map((item) => asString(item)).filter(Boolean);

  return {
    id: row.id,
    connectionId: row.connection_id,
    householdId: row.household_id,
    monthKey: row.month_key,
    status: (row.status as OpenFinanceSyncStatus) || "idle",
    foundCount: Number(row.found_count ?? 0),
    insertedCount: Number(row.inserted_count ?? 0),
    duplicateCount: Number(row.duplicate_count ?? 0),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    warnings,
    rawPayload,
  };
}

function mapConnectionPayload(
  row: ConnectionRow,
  consentRow: ConsentRow | null,
  syncRunRow: SyncRunRow | null
): OpenFinancePluggyConnection {
  const consent = mapConsentPayload(row.id, consentRow);
  const lastSyncRun = mapSyncRun(syncRunRow);
  const consentStatus = deriveConsentStatus(
    row.consent_expires_at,
    consent?.status ?? null,
    consent?.revokedAt ?? null
  );
  const rawPayload = row.raw_payload ?? null;
  const item = toJsonObject(rawPayload?.item) ?? {};
  const account = toJsonObject(rawPayload?.account) ?? {};

  return {
    id: row.id,
    householdId: row.household_id,
    userId: row.created_by,
    provider: OPEN_FINANCE_PROVIDER,
    institution: buildInstitution(item, account),
    accountName: row.account_name,
    accountMask: row.account_mask ?? "****",
    externalConnectionId: row.external_connection_id,
    externalAccountId: row.external_account_id,
    status: (row.status as OpenFinanceConnectionStatus) || "connected",
    consent,
    consentStatus,
    consentExpiresAt: row.consent_expires_at,
    lastSyncedAt: row.last_synced_at,
    lastSyncStatus: lastSyncRun?.status ?? "idle",
    lastSyncRun,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rawPayload,
  };
}

async function getPluggyApiKey() {
  if (pluggyApiKeyCache && pluggyApiKeyCache.expiresAt > Date.now() + 60_000) {
    return pluggyApiKeyCache.token;
  }

  const clientId = getEnv("PLUGGY_CLIENT_ID");
  const clientSecret = getEnv("PLUGGY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new HttpError(503, "Integração ainda não configurada.");
  }

  const response = await fetch("https://api.pluggy.ai/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      clientId,
      clientSecret,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as JsonObject;

  if (!response.ok) {
    throw new HttpError(502, asString(payload.message, "Falha ao autenticar na Pluggy."));
  }

  const token = asString(payload.accessToken ?? payload.apiKey);
  if (!token) {
    throw new HttpError(502, "A Pluggy não retornou um token válido.");
  }

  pluggyApiKeyCache = {
    token,
    expiresAt: Date.now() + 55 * 60_000,
  };

  return token;
}

async function pluggyRequest<T>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    query?: Record<string, string | number | boolean | null | undefined>;
    body?: JsonObject;
  }
) {
  const apiKey = await getPluggyApiKey();
  const url = new URL(`https://api.pluggy.ai${path}`);

  Object.entries(options?.query ?? {}).forEach(([key, value]) => {
    if (value == null) return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = (await response.json().catch(() => ({}))) as JsonObject;

  if (!response.ok) {
    throw new HttpError(
      502,
      asString(payload.message, "Falha ao comunicar com a Pluggy."),
      null,
      payload
    );
  }

  return payload as T;
}

async function listConnectionsForHousehold(
  admin: SupabaseAdmin,
  householdId: string
) {
  const { data: connectionData, error: connectionError } = await admin
    .from("bank_connections")
    .select("*")
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .eq("household_id", householdId)
    .neq("status", "disconnected")
    .order("created_at", { ascending: false });

  if (connectionError) {
    throw new HttpError(500, connectionError.message);
  }

  const connections = ((connectionData as ConnectionRow[] | null) ?? []).map((item) => item.id);

  const [consentResult, syncRunResult] = connections.length
    ? await Promise.all([
      admin
        .from("bank_connection_consents")
        .select("*")
        .eq("provider", OPEN_FINANCE_PROVIDER)
        .in("connection_id", connections),
      admin
        .from("bank_sync_runs")
        .select("*")
        .eq("provider", OPEN_FINANCE_PROVIDER)
        .in("connection_id", connections)
        .order("started_at", { ascending: false }),
    ])
    : [
      { data: [], error: null },
      { data: [], error: null },
    ];

  if (consentResult.error) {
    throw new HttpError(500, consentResult.error.message);
  }

  if (syncRunResult.error) {
    throw new HttpError(500, syncRunResult.error.message);
  }

  const consentRows = (consentResult.data as ConsentRow[] | null) ?? [];
  const syncRunRows = (syncRunResult.data as SyncRunRow[] | null) ?? [];

  return ((connectionData as ConnectionRow[] | null) ?? []).map((row) =>
    mapConnectionPayload(
      row,
      consentRows.find((consent) => consent.connection_id === row.id) ?? null,
      syncRunRows.find((syncRun) => syncRun.connection_id === row.id) ?? null
    )
  );
}

async function createSyncRun(
  admin: SupabaseAdmin,
  input: {
    connectionId: string;
    householdId: string;
    userId: string;
    monthKey: string;
  }
) {
  const { data, error } = await admin
    .from("bank_sync_runs")
    .insert({
      connection_id: input.connectionId,
      household_id: input.householdId,
      created_by: input.userId,
      provider: OPEN_FINANCE_PROVIDER,
      month_key: input.monthKey,
      status: "syncing",
      started_at: nowIso(),
      found_count: 0,
      inserted_count: 0,
      duplicate_count: 0,
      raw_payload: { warnings: [] },
    })
    .select("*")
    .single();

  if (error) {
    throw new HttpError(500, error.message);
  }

  return data as SyncRunRow;
}

async function updateSyncRun(
  admin: SupabaseAdmin,
  runId: string,
  patch: {
    status: OpenFinanceSyncStatus;
    foundCount: number;
    insertedCount: number;
    duplicateCount: number;
    finishedAt: string | null;
    errorMessage?: string | null;
    warnings?: string[];
    rawPayload?: JsonObject | null;
  }
) {
  const rawPayload = {
    ...(patch.rawPayload ?? {}),
    warnings: patch.warnings ?? [],
  };

  const { data, error } = await admin
    .from("bank_sync_runs")
    .update({
      status: patch.status,
      found_count: patch.foundCount,
      inserted_count: patch.insertedCount,
      duplicate_count: patch.duplicateCount,
      finished_at: patch.finishedAt,
      error_message: patch.errorMessage ?? null,
      raw_payload: rawPayload,
    })
    .eq("id", runId)
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .select("*")
    .single();

  if (error) {
    throw new HttpError(500, error.message);
  }

  return data as SyncRunRow;
}

async function updateConnectionsByItem(
  admin: SupabaseAdmin,
  input: {
    householdId: string;
    itemId: string;
    status: OpenFinanceConnectionStatus;
    lastSyncedAt?: string | null;
  }
) {
  const { error } = await admin
    .from("bank_connections")
    .update({
      status: input.status,
      last_synced_at: input.lastSyncedAt ?? null,
    })
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .eq("household_id", input.householdId)
    .eq("external_connection_id", input.itemId);

  if (error) {
    throw new HttpError(500, error.message);
  }
}

async function revokeConsentsByItem(
  admin: SupabaseAdmin,
  input: {
    householdId: string;
    itemId: string;
  }
) {
  const { data: connections, error: connectionsError } = await admin
    .from("bank_connections")
    .select("id")
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .eq("household_id", input.householdId)
    .eq("external_connection_id", input.itemId);

  if (connectionsError) {
    throw new HttpError(500, connectionsError.message);
  }

  const ids = ((connections as { id: string }[] | null) ?? []).map((item) => item.id);
  if (!ids.length) return;

  const { error } = await admin
    .from("bank_connection_consents")
    .update({
      status: "revoked",
      raw_payload: {
        revoked_at: nowIso(),
      },
    })
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .in("connection_id", ids);

  if (error) {
    throw new HttpError(500, error.message);
  }
}

async function persistPluggyConsent(
  admin: SupabaseAdmin,
  payload: {
    connection_id: string;
    household_id: string;
    created_by: string;
    provider: "pluggy";
    external_consent_id: string | null;
    status: OpenFinanceConsentStatus;
    granted_at: string;
    expires_at: string | null;
    raw_payload: PluggyConsent;
  },
) {
  const updateExisting = () => admin
    .from("bank_connection_consents")
    .update(payload)
    .eq("connection_id", payload.connection_id)
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .select("id");

  const { data: updated, error: updateError } = await updateExisting();

  if (updateError) {
    throw new HttpError(500, updateError.message);
  }

  if (((updated as { id: string }[] | null) ?? []).length > 0) {
    return;
  }

  const { error: insertError } = await admin
    .from("bank_connection_consents")
    .insert(payload);

  if (!insertError) {
    return;
  }

  // A concurrent Pluggy completion may have inserted the same connection.
  // Retry only a provider-scoped update; never resolve the UNIQUE(connection_id)
  // conflict by overwriting a row owned by another provider.
  if (insertError.code === "23505") {
    const { data: retried, error: retryError } = await updateExisting();
    if (retryError) {
      throw new HttpError(500, retryError.message);
    }
    if (((retried as { id: string }[] | null) ?? []).length > 0) {
      return;
    }
  }

  throw new HttpError(500, insertError.message);
}

async function upsertConnectionsFromItem(
  admin: SupabaseAdmin,
  input: {
    householdId: string;
    userId: string;
    itemId: string;
  }
) {
  const item = await pluggyRequest<PluggyItem>(`/items/${input.itemId}`);
  const accountsPayload = await pluggyRequest<JsonObject>("/accounts", {
    query: {
      itemId: input.itemId,
      pageSize: 500,
      page: 1,
    },
  });
  const consentsPayload = await pluggyRequest<JsonObject>("/consents", {
    query: {
      itemId: input.itemId,
      pageSize: 100,
      page: 1,
    },
  });

  const accounts = asArray(accountsPayload.results ?? accountsPayload);
  const consents = asArray(consentsPayload.results ?? consentsPayload);
  const latestConsent = (consents[0] ?? null) as PluggyConsent | null;
  const itemStatus = mapItemStatus(item);
  const lastSyncedAt = normalizeDate(
    item.updatedAt ?? item.lastUpdatedAt ?? item.lastSuccessfulUpdate
  );

  for (const accountEntry of accounts) {
    const account = toJsonObject(accountEntry) ?? {};
    const institution = buildInstitution(item, account);
    const externalAccountId = asString(account.id);

    if (!externalAccountId) {
      continue;
    }

    const { data: connectionData, error: connectionError } = await admin
      .from("bank_connections")
      .upsert(
        {
          household_id: input.householdId,
          created_by: input.userId,
          provider: OPEN_FINANCE_PROVIDER,
          institution_id: institution.id,
          institution_name: institution.displayName,
          external_connection_id: input.itemId,
          external_account_id: externalAccountId,
          account_name:
            asString(account.name ?? account.marketingName ?? account.type) || "Conta bancária",
          account_mask: maskAccount(account.number, account.id),
          status: itemStatus,
          consent_expires_at:
            normalizeDate(
              latestConsent?.expiresAt ??
              latestConsent?.expires_at ??
              item.consentExpiresAt
            ) ?? null,
          last_synced_at: lastSyncedAt,
          raw_payload: {
            item,
            account,
          },
        },
        {
          onConflict: "household_id,provider,external_account_id",
        }
      )
      .select("*")
      .single();

    if (connectionError) {
      throw new HttpError(500, connectionError.message);
    }

    const connectionRow = connectionData as ConnectionRow;

    if (latestConsent) {
      const consentExpiresAt = normalizeDate(
        latestConsent.expiresAt ?? latestConsent.expires_at
      );
      const externalConsentId = asString(latestConsent.id) || null;

      await persistPluggyConsent(admin, {
        connection_id: connectionRow.id,
        household_id: input.householdId,
        created_by: input.userId,
        provider: OPEN_FINANCE_PROVIDER,
        external_consent_id: externalConsentId,
        status: deriveConsentStatus(
          consentExpiresAt,
          asString(latestConsent.status, "active"),
          normalizeDate(latestConsent.revokedAt ?? latestConsent.revoked_at),
        ),
        granted_at:
          normalizeDate(latestConsent.createdAt ?? latestConsent.created_at) ?? nowIso(),
        expires_at: consentExpiresAt,
        raw_payload: latestConsent,
      });
    }
  }

  return listConnectionsForHousehold(admin, input.householdId);
}

async function listTransactionsByMonth(
  accountId: string,
  monthKey: string
) {
  const { from, to } = monthRange(monthKey);
  const results: PluggyTransaction[] = [];
  const pageSize = 500;
  let page = 1;

  while (true) {
    const payload = await pluggyRequest<JsonObject>("/transactions", {
      query: {
        accountId,
        from,
        to,
        page,
        pageSize,
      },
    });

    const batch = asArray(payload.results ?? payload).map((item) => toJsonObject(item) ?? {});
    results.push(...batch);

    const totalPages = asNumber(payload.totalPages, 0);
    if (!batch.length) break;
    if (totalPages > 0 && page >= totalPages) break;
    if (batch.length < pageSize) break;

    page += 1;
  }

  return results;
}

function mapTransactionDirection(
  transaction: PluggyTransaction,
  accountType: string | null
): OpenFinanceTransactionDirection {
  const rawType = asString(transaction.type).toUpperCase();
  const amount = asNumber(transaction.amount, 0);
  const normalizedAccountType = asString(accountType).toUpperCase();

  if (normalizedAccountType === "CREDIT") {
    return amount > 0 ? "expense" : "income";
  }

  if (rawType === "CREDIT" || rawType === "INCOME") {
    return "income";
  }

  if (rawType === "DEBIT" || rawType === "EXPENSE") {
    return "expense";
  }

  return amount >= 0 ? "income" : "expense";
}

async function handleConfig() {
  const diagnostics = buildBackendDiagnostics();
  const configured = diagnostics
    .filter((item) => item.code !== "backend_sandbox" && item.code !== "backend_oauth_redirect")
    .every((item) => item.status === "ok");

  const response: OpenFinanceBackendConfigResponse = {
    enabled: true,
    provider: OPEN_FINANCE_PROVIDER,
    configured,
    message: summarizeConfigDiagnostics(diagnostics),
    diagnostics,
    includeSandbox: true,
  };

  return jsonResponse(response);
}

async function handleListConnections(request: Request, admin: SupabaseAdmin) {
  const user = await requireUser(request, admin);
  const url = new URL(request.url);
  const householdId = asString(url.searchParams.get("householdId"));

  if (!householdId) {
    throw new HttpError(400, "householdId é obrigatório.");
  }

  await ensureMembership(admin, householdId, user.id);

  const response: OpenFinanceListConnectionsResponse = {
    connections: await listConnectionsForHousehold(admin, householdId),
  };

  return jsonResponse(response);
}

async function handleStartConnection(request: Request, admin: SupabaseAdmin) {
  if (!isConfigured()) {
    throw new HttpError(503, "Integração ainda não configurada.");
  }

  const user = await requireUser(request, admin);
  const body = await readBody(request);
  const householdId = asString(body.householdId);
  const connectionId = asString(body.connectionId);

  if (!householdId) {
    throw new HttpError(400, "householdId é obrigatório.");
  }

  await ensureMembership(admin, householdId, user.id);

  let existingItemId: string | null = null;
  if (connectionId) {
    const { data, error } = await admin
      .from("bank_connections")
      .select("external_connection_id")
      .eq("id", connectionId)
      .eq("provider", OPEN_FINANCE_PROVIDER)
      .eq("household_id", householdId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, error.message);
    }

    if (!data) {
      throw new HttpError(404, "Conta Pluggy conectada não encontrada.");
    }

    existingItemId = asString(data?.external_connection_id) || null;
  }

  const webhookUrl = new URL(`${getFunctionRootUrl(request)}/webhook`);
  webhookUrl.searchParams.set("householdId", householdId);
  webhookUrl.searchParams.set("userId", user.id);

  const payload = await pluggyRequest<JsonObject>("/connect_token", {
    method: "POST",
    body: {
      ...(existingItemId ? { itemId: existingItemId } : {}),
      options: {
        clientUserId: user.id,
        webhookUrl: webhookUrl.toString(),
        oauthRedirectUri: pluggyOauthRedirectUri,
        avoidDuplicates: true,
      },
    },
  });

  const connectToken = asString(payload.accessToken ?? payload.connectToken);
  if (!connectToken) {
    throw new HttpError(502, "A Pluggy não retornou um connect token válido.");
  }

  const response: OpenFinanceStartConnectionResponse = {
    provider: OPEN_FINANCE_PROVIDER,
    mode: existingItemId ? "update" : "create",
    connectToken,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    itemId: existingItemId,
    includeSandbox: true,
    widget: {
      theme: "light",
      language: "pt",
    },
    openFinanceParameters: null,
  };

  return jsonResponse(response);
}

async function handleCompleteConnection(request: Request, admin: SupabaseAdmin) {
  if (!isConfigured()) {
    throw new HttpError(503, "Integração ainda não configurada.");
  }

  const user = await requireUser(request, admin);
  const body = await readBody(request);
  const householdId = asString(body.householdId);
  const itemId = asString(body.itemId);

  if (!householdId || !itemId) {
    throw new HttpError(400, "householdId e itemId são obrigatórios.");
  }

  await ensureMembership(admin, householdId, user.id);

  const connections = await upsertConnectionsFromItem(admin, {
    householdId,
    userId: user.id,
    itemId,
  });

  return jsonResponse({
    itemId,
    connections,
  });
}

async function handleSyncMonth(request: Request, admin: SupabaseAdmin) {
  if (!isConfigured()) {
    throw new HttpError(503, "Integração ainda não configurada.");
  }

  const user = await requireUser(request, admin);
  const body = await readBody(request);
  const householdId = asString(body.householdId);
  const connectionId = asString(body.connectionId);
  const monthKey = asString(body.monthKey);

  if (!householdId || !connectionId || !monthKey) {
    throw new HttpError(400, "householdId, connectionId e monthKey são obrigatórios.");
  }

  // Validate before creating a sync run or changing connection state.
  monthRange(monthKey);

  await ensureMembership(admin, householdId, user.id);

  const { data: connectionData, error: connectionError } = await admin
    .from("bank_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .eq("household_id", householdId)
    .maybeSingle();

  if (connectionError) {
    throw new HttpError(500, connectionError.message);
  }

  if (!connectionData) {
    throw new HttpError(404, "Conta conectada não encontrada.");
  }

  const connectionRow = connectionData as ConnectionRow;
  const runRow = await createSyncRun(admin, {
    connectionId,
    householdId,
    userId: user.id,
    monthKey,
  });

  try {
    const warnings: string[] = [];
    const itemId = connectionRow.external_connection_id;

    if (itemId) {
      try {
        const webhookUrl = new URL(`${getFunctionRootUrl(request)}/webhook`);
        webhookUrl.searchParams.set("householdId", householdId);
        webhookUrl.searchParams.set("userId", user.id);

        await pluggyRequest<JsonObject>(`/items/${itemId}`, {
          method: "PATCH",
          body: {
            webhookUrl: webhookUrl.toString(),
          },
        });
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "Não foi possível atualizar o item antes da sincronização.");
      }
    }

    const connectionRaw = connectionRow.raw_payload ?? {};
    const accountRaw = toJsonObject(connectionRaw.account) ?? {};
    const accountType = asString(accountRaw.type || accountRaw.subtype) || null;
    const pluggyTransactions = await listTransactionsByMonth(
      connectionRow.external_account_id,
      monthKey
    );

    const { from, to } = monthRange(monthKey);
    const { data: importedData, error: importedError } = await admin
      .from("imported_bank_transactions")
      .select("external_transaction_id, occurred_on, amount_cents, transaction_fingerprint")
      .eq("provider", OPEN_FINANCE_PROVIDER)
      .eq("connection_id", connectionId)
      .gte("occurred_on", from)
      .lt("occurred_on", to);

    if (importedError) {
      throw new HttpError(500, importedError.message);
    }

    const existingRows = (importedData as ImportedTransactionRow[] | null) ?? [];
    const existingDuplicateKeys = new Set(
      existingRows.map((item) =>
        buildOpenFinanceTransactionFingerprint({
          provider: OPEN_FINANCE_PROVIDER,
          internalConnectionId: connectionId,
          externalConnectionId: connectionRow.external_connection_id,
          externalAccountId: connectionRow.external_account_id,
          externalTransactionId: item.external_transaction_id,
          occurredOn: item.occurred_on,
          amountCents: Number(item.amount_cents ?? 0),
        })
      )
    );
    const existingFingerprints = new Set(
      existingRows.map((item) => asString(item.transaction_fingerprint))
    );

    let inserted = 0;
    let duplicates = 0;
    const importedPayload: Record<string, unknown>[] = [];
    const normalizedTransactions = [];

    for (const transactionEntry of pluggyTransactions) {
      const transaction = toJsonObject(transactionEntry) ?? {};
      const externalTransactionId = asString(transaction.id);
      const occurredOn = toYmd(transaction.date ?? transaction.postedAt ?? transaction.createdAt);
      const description =
        asString(
          transaction.description ??
          transaction.descriptionRaw ??
          transaction.merchantName ??
          transaction.descriptionFormatted
        ) || "Transação bancária";
      const amountCents = Math.round(Math.abs(asNumber(transaction.amount, 0)) * 100);

      if (!externalTransactionId) {
        warnings.push("Transação Pluggy ignorada: ID externo ausente.");
        continue;
      }

      if (!occurredOn) {
        warnings.push(
          `Transação Pluggy ${externalTransactionId} ignorada: data inválida.`,
        );
        continue;
      }

      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        warnings.push(
          `Transação Pluggy ${externalTransactionId} ignorada: valor inválido.`,
        );
        continue;
      }

      const direction = mapTransactionDirection(transaction, accountType);
      const fingerprint = buildOpenFinanceTransactionFingerprint({
        provider: OPEN_FINANCE_PROVIDER,
        internalConnectionId: connectionId,
        externalConnectionId: connectionRow.external_connection_id,
        externalAccountId: connectionRow.external_account_id,
        externalTransactionId,
        occurredOn,
        amountCents,
      });

      normalizedTransactions.push({
        id: externalTransactionId,
        connectionId,
        externalTransactionId,
        externalAccountId: connectionRow.external_account_id,
        description,
        amountCents,
        direction,
        occurredOn,
        postedAt: normalizeDate(transaction.date ?? transaction.postedAt),
        fingerprint,
        rawPayload: transaction,
      });

      if (
        existingDuplicateKeys.has(fingerprint) ||
        existingFingerprints.has(fingerprint)
      ) {
        duplicates += 1;
        continue;
      }

      const { data: transactionInsert, error: transactionInsertError } = await admin
        .from("transactions")
        .insert({
          household_id: householdId,
          created_by: user.id,
          type: direction,
          amount_cents: amountCents,
          category_id: null,
          note: description,
          occurred_on: occurredOn,
        })
        .select("id")
        .single();

      if (transactionInsertError) {
        throw new HttpError(500, transactionInsertError.message);
      }

      inserted += 1;
      existingDuplicateKeys.add(fingerprint);
      existingFingerprints.add(fingerprint);

      importedPayload.push({
        sync_run_id: runRow.id,
        connection_id: connectionId,
        household_id: householdId,
        created_by: user.id,
        provider: OPEN_FINANCE_PROVIDER,
        external_transaction_id: externalTransactionId,
        external_account_id: connectionRow.external_account_id,
        posted_at: normalizeDate(transaction.date ?? transaction.postedAt),
        occurred_on: occurredOn,
        description,
        amount_cents: amountCents,
        direction,
        transaction_fingerprint: fingerprint,
        transaction_id: asString((transactionInsert as { id?: unknown } | null)?.id),
        raw_payload: transaction,
      });
    }

    if (importedPayload.length) {
      const { error: importInsertError } = await admin
        .from("imported_bank_transactions")
        .insert(importedPayload);

      if (importInsertError) {
        throw new HttpError(500, importInsertError.message);
      }
    }

    const finishedAt = nowIso();
    const updatedRun = await updateSyncRun(admin, runRow.id, {
      status: "success",
      foundCount: normalizedTransactions.length,
      insertedCount: inserted,
      duplicateCount: duplicates,
      finishedAt,
      warnings,
      rawPayload: {
        warnings,
      },
    });

    await admin
      .from("bank_connections")
      .update({
        status: "connected",
        last_synced_at: finishedAt,
      })
      .eq("id", connectionId)
      .eq("provider", OPEN_FINANCE_PROVIDER);

    const connections = await listConnectionsForHousehold(admin, householdId);
    const connection = connections.find((item) => item.id === connectionId);

    if (!connection) {
      throw new HttpError(500, "Não foi possível recarregar a conexão sincronizada.");
    }

    const response: OpenFinanceSyncMonthResponse = {
      connection,
      run: mapSyncRun(updatedRun)!,
      found: normalizedTransactions.length,
      inserted,
      duplicates,
      warnings,
      transactions: normalizedTransactions,
    };

    return jsonResponse(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível sincronizar o mês.";

    await updateSyncRun(admin, runRow.id, {
      status: "error",
      foundCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      finishedAt: nowIso(),
      errorMessage: message,
      warnings: [],
      rawPayload: {
        warnings: [],
      },
    });

    await admin
      .from("bank_connections")
      .update({
        status: "error",
      })
      .eq("id", connectionId)
      .eq("provider", OPEN_FINANCE_PROVIDER);

    throw error;
  }
}

async function handleDisconnectConnection(
  request: Request,
  admin: SupabaseAdmin,
  connectionId: string
) {
  if (!isConfigured()) {
    throw new HttpError(503, "Integração ainda não configurada.");
  }

  const user = await requireUser(request, admin);
  const url = new URL(request.url);
  const householdId = asString(url.searchParams.get("householdId"));

  if (!householdId || !connectionId) {
    throw new HttpError(400, "householdId e connectionId são obrigatórios.");
  }

  await ensureMembership(admin, householdId, user.id);

  const { data, error } = await admin
    .from("bank_connections")
    .select("external_connection_id")
    .eq("id", connectionId)
    .eq("provider", OPEN_FINANCE_PROVIDER)
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message);
  }

  if (!data) {
    throw new HttpError(404, "Conta conectada não encontrada.");
  }

  const itemId = asString(data.external_connection_id) || null;

  if (itemId) {
    try {
      await pluggyRequest<JsonObject>(`/items/${itemId}`, {
        method: "DELETE",
      });
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "Não foi possível desconectar a conta."
      );
    }

    await updateConnectionsByItem(admin, {
      householdId,
      itemId,
      status: "disconnected",
    });
    await revokeConsentsByItem(admin, {
      householdId,
      itemId,
    });
  }

  const response: OpenFinanceDisconnectConnectionResponse = {
    success: true,
    disconnectedItemId: itemId,
  };

  return jsonResponse(response);
}

async function handleWebhook(request: Request, admin: SupabaseAdmin) {
  if (!isConfigured()) {
    return noContentResponse();
  }

  const url = new URL(request.url);
  const householdId = asString(url.searchParams.get("householdId"));
  const userId = asString(url.searchParams.get("userId"));
  const body = await readBody(request);
  const bodyItem = toJsonObject(body.item);
  const bodyData = toJsonObject(body.data);
  const bodyDataItem = toJsonObject(bodyData?.item);
  const itemId = asString(
    body.itemId ?? bodyItem?.id ?? bodyData?.itemId ?? bodyDataItem?.id
  );
  const event = asString(body.event ?? body.type).toLowerCase();

  if (!householdId || !userId || !itemId) {
    return noContentResponse();
  }

  try {
    if (event.includes("deleted")) {
      await updateConnectionsByItem(admin, {
        householdId,
        itemId,
        status: "disconnected",
      });
      await revokeConsentsByItem(admin, {
        householdId,
        itemId,
      });
      return noContentResponse();
    }

    await upsertConnectionsFromItem(admin, {
      householdId,
      userId,
      itemId,
    });
  } catch {
    return noContentResponse();
  }

  return noContentResponse();
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    const payload: OpenFinanceApiErrorPayload = {
      message: error.message,
      code: error.code,
      details: error.details,
    };
    return jsonResponse(payload, error.status);
  }

  const payload: OpenFinanceApiErrorPayload = {
    message: error instanceof Error ? error.message : "Erro inesperado.",
  };

  return jsonResponse(payload, 500);
}

edgeRuntime.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return noContentResponse();
  }

  try {
    const path = parsePath(request).replace(/\/+$/, "") || "/";

    if (request.method === "GET" && path === "/config") {
      return await handleConfig();
    }

    const admin = createAdminClient();

    if (request.method === "GET" && path === "/connections") {
      return await handleListConnections(request, admin);
    }

    if (request.method === "POST" && path === "/start-connection") {
      return await handleStartConnection(request, admin);
    }

    if (request.method === "POST" && path === "/complete-connection") {
      return await handleCompleteConnection(request, admin);
    }

    if (request.method === "POST" && path === "/sync-month") {
      return await handleSyncMonth(request, admin);
    }

    if (request.method === "POST" && path === "/webhook") {
      return await handleWebhook(request, admin);
    }

    if (request.method === "DELETE" && path.startsWith("/connections/")) {
      const connectionId = path.split("/").pop() ?? "";
      return await handleDisconnectConnection(request, admin, connectionId);
    }

    throw new HttpError(404, "Rota de Open Finance não encontrada.");
  } catch (error) {
    return errorResponse(error);
  }
});
