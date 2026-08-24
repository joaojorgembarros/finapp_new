import { createClient } from "@supabase/supabase-js";

import { resolveSupabaseSecretKey } from "../_shared/supabaseApiKeys";
import { createSupabaseSecretKeyFetch } from "../_shared/supabaseClientFetch";
import type {
  OpenFinanceConsent,
  OpenFinancePolpConnection,
  OpenFinancePolpInstitution,
  OpenFinanceSyncRun,
  OpenFinanceSyncStatus,
} from "../../../src/lib/open-finance-contract";

import {
  asArray,
  asObject,
  POLP_PROVIDER,
  type JsonObject,
  type NormalizedPolpConsent,
  type NormalizedPolpResource,
  type NormalizedPolpTransaction,
} from "./normalizers";

const OPEN_FINANCE_SECRET_KEY_NAME = "open_finance";
const LOCAL_SINGLE_SECRET_KEY_FALLBACK = "OPEN_FINANCE_LOCAL_SINGLE_SECRET_KEY_FALLBACK";

type AdminClient = ReturnType<typeof createPolpAdminClient>;

export type AuthenticatedUser = { id: string };

export type ConnectionRow = {
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

export type ConsentRow = {
  id: string;
  connection_id: string;
  household_id: string;
  created_by: string;
  provider: string;
  external_consent_id: string | null;
  status: string;
  granted_at: string;
  expires_at: string | null;
  raw_payload: JsonObject | null;
  created_at: string;
  updated_at: string;
};

export type SyncRunRow = {
  id: string;
  connection_id: string;
  household_id: string;
  created_by: string;
  provider: string;
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

export type ConsentContext = {
  connection: ConnectionRow;
  consent: ConsentRow;
};

export type ImportResult = {
  importedBankTransactionId: string;
  transactionId: string;
  inserted: boolean;
  contentChanged: boolean;
};

export class RepositoryError extends Error {}

function isLocalSupabaseRuntimeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && [
      "127.0.0.1",
      "localhost",
      "::1",
      "[::1]",
      "kong",
      "host.docker.internal",
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

function getOpenFinanceSecretKey(getEnv: (name: string) => string) {
  const environment = { get: (name: string) => getEnv(name) || undefined };

  try {
    return resolveSupabaseSecretKey(environment, OPEN_FINANCE_SECRET_KEY_NAME);
  } catch (error) {
    if (
      getEnv(LOCAL_SINGLE_SECRET_KEY_FALLBACK) !== "true"
      || !isLocalSupabaseRuntimeUrl(getEnv("SUPABASE_URL"))
    ) {
      throw error;
    }

    return resolveSupabaseSecretKey(environment, "default");
  }
}

export function canResolvePolpAdminConfiguration(getEnv: (name: string) => string) {
  if (!getEnv("SUPABASE_URL")) return false;
  try {
    getOpenFinanceSecretKey(getEnv);
    return true;
  } catch {
    return false;
  }
}

export function createPolpAdminClient(
  getEnv: (name: string) => string,
  fetchImplementation: typeof fetch = fetch,
) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  if (!supabaseUrl) throw new RepositoryError("Supabase Admin não configurado.");

  let secretKey: string;
  try {
    secretKey = getOpenFinanceSecretKey(getEnv);
  } catch {
    throw new RepositoryError("Supabase Admin não configurado.");
  }

  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseSecretKeyFetch(secretKey, fetchImplementation) },
  });
}

function throwDatabaseError(error: { message: string } | null) {
  if (error) throw new RepositoryError("A persistência Open Finance falhou.");
}

function isoNow() {
  return new Date().toISOString();
}

function mapConsent(row: ConsentRow | null): OpenFinanceConsent | null {
  if (!row) return null;
  const raw = row.raw_payload ?? {};
  const revokedAt = typeof raw.revokedAt === "string" ? raw.revokedAt : null;

  return {
    id: row.id,
    connectionId: row.connection_id,
    externalConsentId: row.external_consent_id,
    status: row.status as OpenFinanceConsent["status"],
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt,
    rawPayload: raw,
  };
}

function mapSyncRun(row: SyncRunRow | null): OpenFinanceSyncRun | null {
  if (!row) return null;
  const raw = row.raw_payload ?? {};
  const warnings = asArray(raw.warnings).filter((item): item is string => typeof item === "string");

  return {
    id: row.id,
    connectionId: row.connection_id,
    householdId: row.household_id,
    monthKey: row.month_key,
    status: row.status as OpenFinanceSyncStatus,
    foundCount: row.found_count,
    insertedCount: row.inserted_count,
    duplicateCount: row.duplicate_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    warnings,
    rawPayload: raw,
  };
}

function mapConnection(
  row: ConnectionRow,
  consentRow: ConsentRow | null,
  syncRunRow: SyncRunRow | null,
): OpenFinancePolpConnection {
  const raw = row.raw_payload ?? {};
  const rawInstitution = asObject(raw.institution);
  const institution: OpenFinancePolpInstitution = {
    id: typeof rawInstitution?.id === "string"
      ? rawInstitution.id
      : row.institution_id ?? "polp",
    name: typeof rawInstitution?.name === "string"
      ? rawInstitution.name
      : row.institution_name,
    displayName: typeof rawInstitution?.displayName === "string"
      ? rawInstitution.displayName
      : row.institution_name,
    provider: POLP_PROVIDER,
    connectorId: null,
  };
  const consent = mapConsent(consentRow);
  const lastSyncRun = mapSyncRun(syncRunRow);

  return {
    id: row.id,
    householdId: row.household_id,
    userId: row.created_by,
    provider: POLP_PROVIDER,
    institution,
    accountName: row.account_name,
    accountMask: row.account_mask ?? "****",
    externalConnectionId: row.external_connection_id,
    externalAccountId: row.external_account_id,
    status: row.status as OpenFinancePolpConnection["status"],
    consent,
    consentStatus: consent?.status ?? "expired",
    consentExpiresAt: row.consent_expires_at,
    lastSyncedAt: row.last_synced_at,
    lastSyncStatus: lastSyncRun?.status ?? "idle",
    lastSyncRun,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rawPayload: raw,
  };
}

export interface PolpRepository {
  authenticate(token: string): Promise<AuthenticatedUser | null>;
  ensureMembership(householdId: string, userId: string): Promise<void>;
  listConnections(householdId: string): Promise<OpenFinancePolpConnection[]>;
  getConnection(householdId: string, connectionId: string): Promise<ConnectionRow | null>;
  getConnectionByExternalAccount(
    householdId: string,
    externalAccountId: string,
  ): Promise<ConnectionRow | null>;
  getConsentContext(householdId: string, externalConsentId: string): Promise<ConsentContext | null>;
  getConsentForConnection(connectionId: string, householdId: string): Promise<ConsentRow | null>;
  findWebhookConsentContexts(externalConsentId: string): Promise<ConsentContext[]>;
  findWebhookConnections(externalAccountId: string): Promise<ConnectionRow[]>;
  persistInitialConsent(input: {
    householdId: string;
    userId: string;
    institution: OpenFinancePolpInstitution;
    consent: NormalizedPolpConsent;
  }): Promise<ConnectionRow>;
  persistResources(input: {
    householdId: string;
    userId: string;
    institution: OpenFinancePolpInstitution;
    consent: NormalizedPolpConsent;
    resources: NormalizedPolpResource[];
  }): Promise<void>;
  updateConsentLifecycle(consent: NormalizedPolpConsent, householdId?: string): Promise<void>;
  revokeConsent(householdId: string, externalConsentId: string): Promise<void>;
  createSyncRun(input: {
    connectionId: string;
    householdId: string;
    userId: string;
    monthKey: string;
  }): Promise<SyncRunRow>;
  finishSyncRun(input: {
    runId: string;
    connectionId: string;
    householdId: string;
    status: "success" | "error";
    found: number;
    inserted: number;
    duplicates: number;
    warnings: string[];
    errorMessage?: string | null;
  }): Promise<SyncRunRow>;
  importTransaction(input: {
    connection: ConnectionRow;
    syncRunId: string;
    userId: string;
    transaction: NormalizedPolpTransaction;
  }): Promise<ImportResult>;
}

export class SupabasePolpRepository implements PolpRepository {
  constructor(private readonly admin: AdminClient) {}

  async authenticate(token: string) {
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  }

  async ensureMembership(householdId: string, userId: string) {
    const { data, error } = await this.admin
      .from("memberships")
      .select("household_id")
      .eq("household_id", householdId)
      .eq("user_id", userId)
      .maybeSingle();
    throwDatabaseError(error);
    if (!data) throw new RepositoryError("HOUSEHOLD_FORBIDDEN");
  }

  async listConnections(householdId: string) {
    const { data, error } = await this.admin
      .from("bank_connections")
      .select("*")
      .eq("provider", POLP_PROVIDER)
      .eq("household_id", householdId)
      .neq("status", "disconnected")
      .order("created_at", { ascending: false });
    throwDatabaseError(error);
    const rows = (data ?? []) as ConnectionRow[];
    const ids = rows.map((row) => row.id);

    if (ids.length === 0) return [];

    const [consents, syncRuns] = await Promise.all([
      this.admin
        .from("bank_connection_consents")
        .select("*")
        .eq("provider", POLP_PROVIDER)
        .in("connection_id", ids),
      this.admin
        .from("bank_sync_runs")
        .select("*")
        .eq("provider", POLP_PROVIDER)
        .in("connection_id", ids)
        .order("started_at", { ascending: false }),
    ]);
    throwDatabaseError(consents.error);
    throwDatabaseError(syncRuns.error);
    const consentRows = (consents.data ?? []) as ConsentRow[];
    const syncRows = (syncRuns.data ?? []) as SyncRunRow[];

    return rows.map((row) => mapConnection(
      row,
      consentRows.find((consent) => consent.connection_id === row.id) ?? null,
      syncRows.find((run) => run.connection_id === row.id) ?? null,
    ));
  }

  async getConnection(householdId: string, connectionId: string) {
    const { data, error } = await this.admin
      .from("bank_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("household_id", householdId)
      .eq("provider", POLP_PROVIDER)
      .maybeSingle();
    throwDatabaseError(error);
    return (data as ConnectionRow | null) ?? null;
  }

  async getConnectionByExternalAccount(householdId: string, externalAccountId: string) {
    const { data, error } = await this.admin
      .from("bank_connections")
      .select("*")
      .eq("household_id", householdId)
      .eq("provider", POLP_PROVIDER)
      .eq("external_account_id", externalAccountId)
      .maybeSingle();
    throwDatabaseError(error);
    return (data as ConnectionRow | null) ?? null;
  }

  async getConsentContext(householdId: string, externalConsentId: string) {
    const { data, error } = await this.admin
      .from("bank_connection_consents")
      .select("*")
      .eq("household_id", householdId)
      .eq("provider", POLP_PROVIDER)
      .eq("external_consent_id", externalConsentId)
      .limit(1)
      .maybeSingle();
    throwDatabaseError(error);
    if (!data) return null;
    const consent = data as ConsentRow;
    const connection = await this.getConnection(householdId, consent.connection_id);
    return connection ? { connection, consent } : null;
  }

  async getConsentForConnection(connectionId: string, householdId: string) {
    const { data, error } = await this.admin
      .from("bank_connection_consents")
      .select("*")
      .eq("connection_id", connectionId)
      .eq("household_id", householdId)
      .eq("provider", POLP_PROVIDER)
      .maybeSingle();
    throwDatabaseError(error);
    return (data as ConsentRow | null) ?? null;
  }

  async findWebhookConsentContexts(externalConsentId: string) {
    const { data, error } = await this.admin
      .from("bank_connection_consents")
      .select("*")
      .eq("provider", POLP_PROVIDER)
      .eq("external_consent_id", externalConsentId);
    throwDatabaseError(error);

    const contexts: ConsentContext[] = [];
    for (const consent of (data ?? []) as ConsentRow[]) {
      const connection = await this.getConnection(consent.household_id, consent.connection_id);
      if (connection) contexts.push({ connection, consent });
    }
    return contexts;
  }

  async findWebhookConnections(externalAccountId: string) {
    const { data, error } = await this.admin
      .from("bank_connections")
      .select("*")
      .eq("provider", POLP_PROVIDER)
      .eq("external_account_id", externalAccountId);
    throwDatabaseError(error);
    return (data ?? []) as ConnectionRow[];
  }

  async persistInitialConsent(input: {
    householdId: string;
    userId: string;
    institution: OpenFinancePolpInstitution;
    consent: NormalizedPolpConsent;
  }) {
    const existing = await this.getConsentContext(
      input.householdId,
      input.consent.externalConsentId,
    );
    const connectionPayload = {
      household_id: input.householdId,
      created_by: input.userId,
      provider: POLP_PROVIDER,
      institution_id: input.institution.id,
      institution_name: input.institution.displayName,
      external_connection_id: input.consent.externalConsentId,
      external_account_id: `consent:${input.consent.externalConsentId}`,
      account_name: input.institution.displayName,
      account_mask: "****",
      status: input.consent.connectionStatus,
      consent_expires_at: null,
      raw_payload: {
        resourceType: "consent",
        institution: input.institution,
        consent: input.consent.rawPayload,
        providerStatus: input.consent.providerStatus,
        executionStatus: input.consent.executionStatus,
        authorizationExpiresAt: input.consent.authorizationExpiresAt,
      },
    };

    if (existing) {
      const existingResourceType = existing.connection.raw_payload?.resourceType;
      const hasDiscoveredResource = existingResourceType === "account"
        || existingResourceType === "credit_card";
      const { data, error } = await this.admin
        .from("bank_connections")
        .update({
          ...connectionPayload,
          external_account_id: existing.connection.external_account_id,
          account_name: hasDiscoveredResource
            ? existing.connection.account_name
            : connectionPayload.account_name,
          account_mask: hasDiscoveredResource
            ? existing.connection.account_mask
            : connectionPayload.account_mask,
          raw_payload: hasDiscoveredResource
            ? {
              ...existing.connection.raw_payload,
              providerStatus: input.consent.providerStatus,
              executionStatus: input.consent.executionStatus,
            }
            : connectionPayload.raw_payload,
          created_by: existing.connection.created_by,
        })
        .eq("id", existing.connection.id)
        .eq("household_id", input.householdId)
        .eq("provider", POLP_PROVIDER)
        .select("*")
        .single();
      throwDatabaseError(error);
      await this.updateConsentLifecycle(input.consent, input.householdId);
      return data as ConnectionRow;
    }

    const connectionResult = await this.admin
      .from("bank_connections")
      .insert(connectionPayload)
      .select("*")
      .single();
    throwDatabaseError(connectionResult.error);
    const connection = connectionResult.data as ConnectionRow;

    const consentResult = await this.admin.from("bank_connection_consents").insert({
      connection_id: connection.id,
      household_id: input.householdId,
      created_by: input.userId,
      provider: POLP_PROVIDER,
      external_consent_id: input.consent.externalConsentId,
      status: input.consent.status,
      granted_at: input.consent.grantedAt,
      expires_at: null,
      raw_payload: {
        ...input.consent.rawPayload,
        providerStatus: input.consent.providerStatus,
        executionStatus: input.consent.executionStatus,
      },
    });

    if (consentResult.error) {
      await this.admin
        .from("bank_connections")
        .delete()
        .eq("id", connection.id)
        .eq("household_id", input.householdId)
        .eq("provider", POLP_PROVIDER);
      throw new RepositoryError("A persistência do consentimento falhou.");
    }

    return connection;
  }

  async persistResources(input: {
    householdId: string;
    userId: string;
    institution: OpenFinancePolpInstitution;
    consent: NormalizedPolpConsent;
    resources: NormalizedPolpResource[];
  }) {
    const { data, error } = await this.admin
      .from("bank_connections")
      .select("*")
      .eq("household_id", input.householdId)
      .eq("provider", POLP_PROVIDER)
      .eq("external_connection_id", input.consent.externalConsentId);
    throwDatabaseError(error);
    const existing = (data ?? []) as ConnectionRow[];
    let placeholder = existing.find((row) => row.external_account_id.startsWith("consent:"));

    for (const resource of input.resources) {
      const exact = existing.find((row) => row.external_account_id === resource.externalAccountId);
      const rawPayload = {
        resourceType: resource.resourceType,
        institution: input.institution,
        resource: resource.rawPayload,
        providerStatus: input.consent.providerStatus,
      };
      const mutable = exact ?? placeholder ?? null;

      let connection: ConnectionRow;
      if (mutable) {
        const result = await this.admin
          .from("bank_connections")
          .update({
            institution_id: input.institution.id,
            institution_name: input.institution.displayName,
            external_connection_id: input.consent.externalConsentId,
            external_account_id: resource.externalAccountId,
            account_name: resource.accountName,
            account_mask: resource.accountMask,
            status: input.consent.connectionStatus,
            consent_expires_at: null,
            raw_payload: rawPayload,
          })
          .eq("id", mutable.id)
          .eq("household_id", input.householdId)
          .eq("provider", POLP_PROVIDER)
          .select("*")
          .single();
        throwDatabaseError(result.error);
        connection = result.data as ConnectionRow;
        if (placeholder?.id === mutable.id) placeholder = undefined;
      } else {
        const result = await this.admin
          .from("bank_connections")
          .insert({
            household_id: input.householdId,
            created_by: input.userId,
            provider: POLP_PROVIDER,
            institution_id: input.institution.id,
            institution_name: input.institution.displayName,
            external_connection_id: input.consent.externalConsentId,
            external_account_id: resource.externalAccountId,
            account_name: resource.accountName,
            account_mask: resource.accountMask,
            status: input.consent.connectionStatus,
            consent_expires_at: null,
            raw_payload: rawPayload,
          })
          .select("*")
          .single();
        throwDatabaseError(result.error);
        connection = result.data as ConnectionRow;
        existing.push(connection);
      }

      const consentResult = await this.admin
        .from("bank_connection_consents")
        .upsert({
          connection_id: connection.id,
          household_id: input.householdId,
          created_by: connection.created_by,
          provider: POLP_PROVIDER,
          external_consent_id: input.consent.externalConsentId,
          status: input.consent.status,
          granted_at: input.consent.grantedAt,
          expires_at: null,
          raw_payload: {
            ...input.consent.rawPayload,
            providerStatus: input.consent.providerStatus,
            executionStatus: input.consent.executionStatus,
          },
        }, { onConflict: "connection_id" });
      throwDatabaseError(consentResult.error);
    }
  }

  async updateConsentLifecycle(consent: NormalizedPolpConsent, householdId?: string) {
    let consentQuery = this.admin
      .from("bank_connection_consents")
      .update({
        status: consent.status,
        granted_at: consent.grantedAt,
        expires_at: null,
        raw_payload: {
          ...consent.rawPayload,
          providerStatus: consent.providerStatus,
          executionStatus: consent.executionStatus,
        },
      })
      .eq("provider", POLP_PROVIDER)
      .eq("external_consent_id", consent.externalConsentId);
    if (householdId) consentQuery = consentQuery.eq("household_id", householdId);
    const consentResult = await consentQuery;
    throwDatabaseError(consentResult.error);

    let connectionQuery = this.admin
      .from("bank_connections")
      .update({ status: consent.connectionStatus, consent_expires_at: null })
      .eq("provider", POLP_PROVIDER)
      .eq("external_connection_id", consent.externalConsentId);
    if (householdId) connectionQuery = connectionQuery.eq("household_id", householdId);
    const connectionResult = await connectionQuery;
    throwDatabaseError(connectionResult.error);
  }

  async revokeConsent(householdId: string, externalConsentId: string) {
    const revokedAt = isoNow();
    const consentResult = await this.admin
      .from("bank_connection_consents")
      .update({
        status: "revoked",
        expires_at: null,
        raw_payload: { providerStatus: "REVOKED_LOCAL", revokedAt },
      })
      .eq("household_id", householdId)
      .eq("provider", POLP_PROVIDER)
      .eq("external_consent_id", externalConsentId);
    throwDatabaseError(consentResult.error);

    const connectionResult = await this.admin
      .from("bank_connections")
      .update({ status: "disconnected", consent_expires_at: null })
      .eq("household_id", householdId)
      .eq("provider", POLP_PROVIDER)
      .eq("external_connection_id", externalConsentId);
    throwDatabaseError(connectionResult.error);
  }

  async createSyncRun(input: {
    connectionId: string;
    householdId: string;
    userId: string;
    monthKey: string;
  }) {
    const { data, error } = await this.admin
      .from("bank_sync_runs")
      .insert({
        connection_id: input.connectionId,
        household_id: input.householdId,
        created_by: input.userId,
        provider: POLP_PROVIDER,
        month_key: input.monthKey,
        status: "syncing",
        started_at: isoNow(),
        found_count: 0,
        inserted_count: 0,
        duplicate_count: 0,
        raw_payload: { warnings: [] },
      })
      .select("*")
      .single();
    throwDatabaseError(error);
    return data as SyncRunRow;
  }

  async finishSyncRun(input: {
    runId: string;
    connectionId: string;
    householdId: string;
    status: "success" | "error";
    found: number;
    inserted: number;
    duplicates: number;
    warnings: string[];
    errorMessage?: string | null;
  }) {
    const finishedAt = isoNow();
    const { data, error } = await this.admin
      .from("bank_sync_runs")
      .update({
        status: input.status,
        finished_at: finishedAt,
        found_count: input.found,
        inserted_count: input.inserted,
        duplicate_count: input.duplicates,
        error_message: input.errorMessage ?? null,
        raw_payload: { warnings: input.warnings },
      })
      .eq("id", input.runId)
      .eq("connection_id", input.connectionId)
      .eq("household_id", input.householdId)
      .eq("provider", POLP_PROVIDER)
      .select("*")
      .single();
    throwDatabaseError(error);

    if (input.status === "success") {
      const connectionResult = await this.admin
        .from("bank_connections")
        .update({ last_synced_at: finishedAt, status: "connected" })
        .eq("id", input.connectionId)
        .eq("household_id", input.householdId)
        .eq("provider", POLP_PROVIDER);
      throwDatabaseError(connectionResult.error);
    }

    return data as SyncRunRow;
  }

  async importTransaction(input: {
    connection: ConnectionRow;
    syncRunId: string;
    userId: string;
    transaction: NormalizedPolpTransaction;
  }) {
    const { data, error } = await this.admin.rpc("import_open_finance_transaction", {
      p_provider: POLP_PROVIDER,
      p_connection_id: input.connection.id,
      p_household_id: input.connection.household_id,
      p_created_by: input.userId,
      p_external_account_id: input.transaction.externalAccountId,
      p_external_transaction_id: input.transaction.externalTransactionId,
      p_occurred_on: input.transaction.occurredOn,
      p_description: input.transaction.description,
      p_amount_cents: input.transaction.amountCents,
      p_direction: input.transaction.direction,
      p_sync_run_id: input.syncRunId,
      p_posted_at: input.transaction.postedAt,
      p_raw_payload: input.transaction.rawPayload,
    });

    if (error) throw new RepositoryError("A importação atômica Open Finance falhou.");
    const rows = Array.isArray(data) ? data : [data];
    const row = asObject(rows[0]);
    if (
      rows.length !== 1
      || !row
      || typeof row.imported_bank_transaction_id !== "string"
      || !row.imported_bank_transaction_id
      || typeof row.transaction_id !== "string"
      || !row.transaction_id
      || typeof row.inserted !== "boolean"
      || typeof row.content_changed !== "boolean"
      || (row.inserted && row.content_changed)
    ) {
      throw new RepositoryError("A RPC de importação retornou uma resposta inválida.");
    }

    return {
      importedBankTransactionId: row.imported_bank_transaction_id,
      transactionId: row.transaction_id,
      inserted: row.inserted,
      contentChanged: row.content_changed,
    };
  }
}

export function createSupabasePolpRepository(
  getEnv: (name: string) => string,
  fetchImplementation: typeof fetch = fetch,
) {
  return new SupabasePolpRepository(
    createPolpAdminClient(getEnv, fetchImplementation),
  );
}
