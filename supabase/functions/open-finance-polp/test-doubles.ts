import { vi } from "vitest";

import type { OpenFinancePolpConnection } from "../../../src/lib/open-finance-contract";

import type { JsonObject } from "./normalizers";
import type {
  ConnectionRow,
  ConsentContext,
  ConsentRow,
  PolpRepository,
  SyncRunRow,
} from "./repository";
import {
  ACCOUNT_ID,
  authorisedConsentFixture,
  CARD_ID,
  CONNECTION_ID,
  CONSENT_ID,
  HOUSEHOLD_ID,
  INSTITUTION_ID,
  INTERNAL_CONSENT_ID,
  SYNC_RUN_ID,
  USER_ID,
} from "./test-fixtures";

export function buildConnectionRow(
  resourceType: "account" | "credit_card" | "consent" = "account",
): ConnectionRow {
  const externalAccountId = resourceType === "credit_card"
    ? CARD_ID
    : resourceType === "account"
      ? ACCOUNT_ID
      : `consent:${CONSENT_ID}`;
  return {
    id: CONNECTION_ID,
    household_id: HOUSEHOLD_ID,
    created_by: USER_ID,
    provider: "polp",
    institution_id: INSTITUTION_ID,
    institution_name: "Banco Exemplo Open Finance",
    external_connection_id: CONSENT_ID,
    external_account_id: externalAccountId,
    account_name: resourceType === "credit_card" ? "Cartão Gold Sintético" : "Conta Exemplo",
    account_mask: resourceType === "credit_card" ? "**** 4242" : "**** 4567",
    status: resourceType === "consent" ? "error" : "connected",
    consent_expires_at: null,
    last_synced_at: null,
    raw_payload: {
      resourceType,
      institution: {
        id: INSTITUTION_ID,
        name: "Banco Exemplo Open Finance",
        displayName: "Banco Exemplo Open Finance",
        provider: "polp",
        connectorId: null,
      },
    },
    created_at: "2026-08-21T15:00:00.000Z",
    updated_at: "2026-08-21T15:00:00.000Z",
  };
}

export function buildConsentRow(overrides: Partial<ConsentRow> = {}): ConsentRow {
  return {
    id: INTERNAL_CONSENT_ID,
    connection_id: CONNECTION_ID,
    household_id: HOUSEHOLD_ID,
    created_by: USER_ID,
    provider: "polp",
    external_consent_id: CONSENT_ID,
    status: "active",
    granted_at: "2026-08-21T15:05:00.000Z",
    expires_at: null,
    raw_payload: { providerStatus: "AUTHORISED", executionStatus: "SUCCESS" },
    created_at: "2026-08-21T15:00:00.000Z",
    updated_at: "2026-08-21T15:05:00.000Z",
    ...overrides,
  };
}

export function buildSyncRunRow(overrides: Partial<SyncRunRow> = {}): SyncRunRow {
  return {
    id: SYNC_RUN_ID,
    connection_id: CONNECTION_ID,
    household_id: HOUSEHOLD_ID,
    created_by: USER_ID,
    provider: "polp",
    month_key: "2026-08",
    status: "syncing",
    started_at: "2026-08-21T16:00:00.000Z",
    finished_at: null,
    found_count: 0,
    inserted_count: 0,
    duplicate_count: 0,
    error_message: null,
    raw_payload: { warnings: [] },
    created_at: "2026-08-21T16:00:00.000Z",
    updated_at: "2026-08-21T16:00:00.000Z",
    ...overrides,
  };
}

export function buildConsentContext(
  connection = buildConnectionRow(),
  consent = buildConsentRow(),
): ConsentContext {
  return { connection, consent };
}

export function buildMappedConnection(connection = buildConnectionRow()): OpenFinancePolpConnection {
  return {
    id: connection.id,
    householdId: connection.household_id,
    userId: connection.created_by,
    provider: "polp",
    institution: {
      id: INSTITUTION_ID,
      name: "Banco Exemplo Open Finance",
      displayName: "Banco Exemplo Open Finance",
      provider: "polp",
      connectorId: null,
    },
    accountName: connection.account_name,
    accountMask: connection.account_mask ?? "****",
    externalConnectionId: connection.external_connection_id,
    externalAccountId: connection.external_account_id,
    status: connection.status as OpenFinancePolpConnection["status"],
    consent: {
      id: INTERNAL_CONSENT_ID,
      connectionId: connection.id,
      externalConsentId: CONSENT_ID,
      status: "active",
      grantedAt: "2026-08-21T15:05:00.000Z",
      expiresAt: null,
      revokedAt: null,
      rawPayload: { providerStatus: "AUTHORISED" },
    },
    consentStatus: "active",
    consentExpiresAt: null,
    lastSyncedAt: connection.last_synced_at,
    lastSyncStatus: "success",
    lastSyncRun: null,
    createdAt: connection.created_at,
    updatedAt: connection.updated_at,
    rawPayload: connection.raw_payload,
  };
}

export function createRepositoryDouble(
  overrides: Partial<PolpRepository> = {},
): PolpRepository {
  const connection = buildConnectionRow();
  const consent = buildConsentRow();
  const context = buildConsentContext(connection, consent);
  const base: PolpRepository = {
    authenticate: vi.fn(async (token) => token === "valid-jwt" ? { id: USER_ID } : null),
    ensureMembership: vi.fn(async () => undefined),
    listConnections: vi.fn(async () => [buildMappedConnection(connection)]),
    getConnection: vi.fn(async () => connection),
    getConnectionByExternalAccount: vi.fn(async (_householdId, externalAccountId) => (
      externalAccountId === connection.external_account_id ? connection : null
    )),
    getConsentContext: vi.fn(async () => context),
    getConsentForConnection: vi.fn(async () => consent),
    findWebhookConsentContexts: vi.fn(async () => [context]),
    findWebhookConnections: vi.fn(async () => [connection]),
    persistInitialConsent: vi.fn(async () => connection),
    persistResources: vi.fn(async () => undefined),
    updateConsentLifecycle: vi.fn(async () => undefined),
    revokeConsent: vi.fn(async () => undefined),
    createSyncRun: vi.fn(async () => buildSyncRunRow()),
    finishSyncRun: vi.fn(async (input) => buildSyncRunRow({
      status: input.status,
      finished_at: "2026-08-21T16:01:00.000Z",
      found_count: input.found,
      inserted_count: input.inserted,
      duplicate_count: input.duplicates,
      error_message: input.errorMessage ?? null,
      raw_payload: { warnings: input.warnings },
    })),
    importTransaction: vi.fn(async () => ({
      importedBankTransactionId: "b10e8400-e29b-41d4-a716-446655440001",
      transactionId: "b20e8400-e29b-41d4-a716-446655440002",
      inserted: true,
      contentChanged: false,
    })),
  };
  return Object.assign(base, overrides);
}

export type PolpClientDouble = {
  isConfigured: ReturnType<typeof vi.fn>;
  listInstitutions: ReturnType<typeof vi.fn>;
  createConsent: ReturnType<typeof vi.fn>;
  recreateConsent: ReturnType<typeof vi.fn>;
  getConsent: ReturnType<typeof vi.fn>;
  revokeConsent: ReturnType<typeof vi.fn>;
  listAccounts: ReturnType<typeof vi.fn>;
  listAccountTransactions: ReturnType<typeof vi.fn>;
  listCreditCards: ReturnType<typeof vi.fn>;
  listCreditCardTransactions: ReturnType<typeof vi.fn>;
  listBills: ReturnType<typeof vi.fn>;
  listBillTransactions: ReturnType<typeof vi.fn>;
};

export function createPolpClientDouble(
  overrides: Partial<PolpClientDouble> = {},
): PolpClientDouble {
  const base: PolpClientDouble = {
    isConfigured: vi.fn(() => true),
    listInstitutions: vi.fn(async () => [] as JsonObject[]),
    createConsent: vi.fn(async () => authorisedConsentFixture),
    recreateConsent: vi.fn(async () => authorisedConsentFixture),
    getConsent: vi.fn(async () => authorisedConsentFixture),
    revokeConsent: vi.fn(async () => undefined),
    listAccounts: vi.fn(async () => [] as JsonObject[]),
    listAccountTransactions: vi.fn(async () => [] as JsonObject[]),
    listCreditCards: vi.fn(async () => [] as JsonObject[]),
    listCreditCardTransactions: vi.fn(async () => [] as JsonObject[]),
    listBills: vi.fn(async () => [] as JsonObject[]),
    listBillTransactions: vi.fn(async () => [] as JsonObject[]),
  };
  return Object.assign(base, overrides);
}
