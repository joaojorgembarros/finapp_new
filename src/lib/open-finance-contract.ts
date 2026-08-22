export const OPEN_FINANCE_PROVIDERS = ["pluggy", "polp"] as const;

export type OpenFinanceProvider = (typeof OPEN_FINANCE_PROVIDERS)[number];

/**
 * Provider used by the existing Pluggy Edge Function.
 *
 * Keep this export while the current frontend is Pluggy-backed. New shared code
 * should use `OpenFinanceProvider` instead of deriving the provider type from
 * this compatibility constant.
 */
export const OPEN_FINANCE_PROVIDER = "pluggy" as const satisfies OpenFinanceProvider;

function openFinancePathSegment(value: string, field: string) {
  const trimmed = value.trim();
  if (!trimmed || /[/\\?#]/.test(trimmed) || trimmed.includes("..")) {
    throw new TypeError(`${field} is not a safe Open Finance path identifier.`);
  }
  return encodeURIComponent(trimmed);
}

function consentPath(consentId: string) {
  return `/consents/${openFinancePathSegment(consentId, "consentId")}`;
}

function connectionPath(connectionId: string) {
  return `/connections/${openFinancePathSegment(connectionId, "connectionId")}`;
}

export const OPEN_FINANCE_ENDPOINTS = {
  config: "/config",
  institutions: "/institutions",
  connections: "/connections",
  startConnection: "/start-connection",
  completeConnection: "/complete-connection",
  syncMonth: "/sync-month",
  consentStatus: consentPath,
  revokeConsent: consentPath,
  disconnectConnection: connectionPath,
} as const;

export const OPEN_FINANCE_POLP_PRODUCTS = ["ACCOUNT", "CREDIT_CARD_ACCOUNT"] as const;
export type OpenFinancePolpProduct = (typeof OPEN_FINANCE_POLP_PRODUCTS)[number];
export type OpenFinanceResourceType = "account" | "credit_card" | "consent";
export type OpenFinancePolpProviderStatus =
  | "AWAITING_AUTHORIZATION"
  | "AUTHORISED"
  | "REJECTED"
  | "EXPIRED";
export type OpenFinancePolpExecutionStatus =
  | "AWAITING_RESOURCES"
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | null;

export type OpenFinanceConfigurationStatus =
  | "ready"
  | "disabled"
  | "unsupported_provider"
  | "missing_api_url"
  | "backend_not_configured"
  | "backend_unreachable";

export type OpenFinanceConfigurationCheckCode =
  | "app_enabled_flag"
  | "app_provider"
  | "app_api_url"
  | "backend_function"
  | "backend_supabase_url"
  | "backend_service_role_key"
  | "backend_secret_key"
  | "backend_pluggy_client_id"
  | "backend_pluggy_client_secret"
  | "backend_polp_api_client"
  | "backend_polp_api_secret"
  | "backend_polp_webhook_secret"
  | "backend_sandbox"
  | "backend_oauth_redirect";

export type OpenFinanceConfigurationCheckStatus =
  | "ok"
  | "missing"
  | "invalid"
  | "unreachable";

export type OpenFinanceConfigurationCheckLocation = "app" | "backend";

export type OpenFinanceConfigurationCheck = {
  code: OpenFinanceConfigurationCheckCode;
  location: OpenFinanceConfigurationCheckLocation;
  label: string;
  status: OpenFinanceConfigurationCheckStatus;
  message: string;
};

export type OpenFinanceConnectionStatus = "connected" | "error" | "disconnected";
export type OpenFinanceConsentStatus = "active" | "expiring" | "expired" | "revoked";
export type OpenFinanceSyncStatus = "idle" | "syncing" | "success" | "error";
export type OpenFinanceTransactionDirection = "income" | "expense";
export type OpenFinanceWidgetMode = "create" | "update";

export type OpenFinanceDate = string & { readonly __openFinanceDate: unique symbol };

export type OpenFinanceExternalTransactionIdentity = {
  provider: OpenFinanceProvider;
  /** UUID of the local `bank_connections` row. */
  internalConnectionId: string;
  /** Connection/item/consent identifier assigned by the provider, when one exists. */
  externalConnectionId: string | null;
  /** Account identifier assigned by the provider. */
  externalAccountId: string;
  /** Transaction identifier assigned by the provider. */
  externalTransactionId: string;
};

export type OpenFinanceTransactionFingerprintInput =
  OpenFinanceExternalTransactionIdentity & {
    occurredOn: string;
    amountCents: number;
  };

export function isOpenFinanceProvider(value: unknown): value is OpenFinanceProvider {
  return typeof value === "string" && OPEN_FINANCE_PROVIDERS.some((provider) => provider === value);
}

export function isOpenFinanceDate(value: unknown): value is OpenFinanceDate {
  if (typeof value !== "string") return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function parseOpenFinanceDate(value: unknown): OpenFinanceDate {
  if (!isOpenFinanceDate(value)) {
    throw new RangeError("Open Finance date must be a valid YYYY-MM-DD calendar date.");
  }

  return value;
}

function assertIdentityPart(name: string, value: string) {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty identifier.`);
  }
}

function serializeIdentityPart(value: string | null) {
  return value === null ? "n" : `s${value.length}:${value}`;
}

function serializeTransactionIdentity(
  identity: OpenFinanceExternalTransactionIdentity,
  suffix: readonly (string | null)[] = [],
) {
  if (!isOpenFinanceProvider(identity.provider)) {
    throw new TypeError("provider must be a supported Open Finance provider.");
  }

  assertIdentityPart("internalConnectionId", identity.internalConnectionId);
  if (identity.externalConnectionId !== null) {
    assertIdentityPart("externalConnectionId", identity.externalConnectionId);
  }
  assertIdentityPart("externalAccountId", identity.externalAccountId);
  assertIdentityPart("externalTransactionId", identity.externalTransactionId);

  return [
    identity.provider,
    identity.internalConnectionId,
    identity.externalConnectionId,
    identity.externalAccountId,
    identity.externalTransactionId,
    ...suffix,
  ].map(serializeIdentityPart).join("|");
}

export function buildOpenFinanceExternalTransactionIdentityKey(
  identity: OpenFinanceExternalTransactionIdentity,
) {
  return `open-finance-transaction-identity:v1|${serializeTransactionIdentity(identity)}`;
}

export function buildOpenFinanceTransactionFingerprint(
  input: OpenFinanceTransactionFingerprintInput,
) {
  const occurredOn = parseOpenFinanceDate(input.occurredOn);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RangeError("amountCents must be a positive safe integer.");
  }

  return `open-finance-transaction-fingerprint:v1|${serializeTransactionIdentity(input, [
    occurredOn,
    String(input.amountCents),
  ])}`;
}

type OpenFinanceInstitutionBase = {
  id: string;
  name: string;
  displayName: string;
};

export type OpenFinancePluggyInstitution = OpenFinanceInstitutionBase & {
  provider: "pluggy";
  connectorId: number | null;
};

export type OpenFinancePolpInstitution = OpenFinanceInstitutionBase & {
  provider: "polp";
  connectorId: null;
};

export type OpenFinanceInstitution =
  | OpenFinancePluggyInstitution
  | OpenFinancePolpInstitution;

export type OpenFinancePolpInstitutionListItem = OpenFinancePolpInstitution & {
  description: string | null;
  logoUrl: string | null;
  status: string | null;
  type: string | null;
  credentials: string[];
};

export type OpenFinanceConsent = {
  id: string;
  connectionId: string;
  externalConsentId: string | null;
  status: OpenFinanceConsentStatus;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  rawPayload: Record<string, unknown> | null;
};

export type OpenFinanceSyncRun = {
  id: string;
  connectionId: string;
  householdId: string;
  monthKey: string;
  status: OpenFinanceSyncStatus;
  foundCount: number;
  insertedCount: number;
  duplicateCount: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  warnings: string[];
  rawPayload: Record<string, unknown> | null;
};

export type OpenFinanceImportedTransaction = {
  id: string;
  connectionId: string;
  externalTransactionId: string;
  externalAccountId: string;
  description: string;
  amountCents: number;
  direction: OpenFinanceTransactionDirection;
  occurredOn: string;
  postedAt: string | null;
  fingerprint: string;
  rawPayload: Record<string, unknown> | null;
};

type OpenFinanceConnectionBase = {
  id: string;
  householdId: string;
  userId: string;
  accountName: string;
  accountMask: string;
  externalConnectionId: string | null;
  externalAccountId: string;
  status: OpenFinanceConnectionStatus;
  consent: OpenFinanceConsent | null;
  consentStatus: OpenFinanceConsentStatus;
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: OpenFinanceSyncStatus;
  lastSyncRun: OpenFinanceSyncRun | null;
  resourceType?: OpenFinanceResourceType | null;
  createdAt: string;
  updatedAt: string;
  rawPayload: Record<string, unknown> | null;
};

export type OpenFinancePluggyConnection = OpenFinanceConnectionBase & {
  provider: "pluggy";
  institution: OpenFinancePluggyInstitution;
};

export type OpenFinancePolpConnection = OpenFinanceConnectionBase & {
  provider: "polp";
  institution: OpenFinancePolpInstitution;
};

export type OpenFinanceConnection =
  | OpenFinancePluggyConnection
  | OpenFinancePolpConnection;

export type OpenFinanceRuntime = {
  enabled: boolean;
  provider: OpenFinanceProvider | null;
  providerLabel: string;
  apiUrl: string | null;
  configured: boolean;
  status: OpenFinanceConfigurationStatus;
  message: string;
  diagnostics: OpenFinanceConfigurationCheck[];
};

export type OpenFinanceBackendConfigResponse = {
  enabled: boolean;
  provider: OpenFinanceProvider;
  configured: boolean;
  message: string;
  diagnostics: OpenFinanceConfigurationCheck[];
  includeSandbox: boolean;
};

export type OpenFinanceListInstitutionsRequest = {
  provider: "polp";
};

export type OpenFinanceListInstitutionsResponse = {
  institutions: OpenFinancePolpInstitutionListItem[];
};

export type OpenFinanceListConnectionsRequest = {
  provider: OpenFinanceProvider;
  householdId: string;
};

export type OpenFinanceListConnectionsResponse = {
  connections: OpenFinanceConnection[];
};

export type OpenFinancePluggyStartConnectionRequest = {
  provider: "pluggy";
  householdId: string;
  connectionId?: string | null;
};

export type OpenFinancePolpCreateConnectionRequest = {
  provider: "polp";
  householdId: string;
  institutionId: string;
  cpf: string;
  cnpj?: string | null;
  products?: OpenFinancePolpProduct[];
};

export type OpenFinancePolpUpdateConnectionRequest = {
  provider: "polp";
  householdId: string;
  connectionId: string;
};

export type OpenFinanceStartConnectionRequest =
  | OpenFinancePluggyStartConnectionRequest
  | OpenFinancePolpCreateConnectionRequest
  | OpenFinancePolpUpdateConnectionRequest;

export type OpenFinancePluggyStartConnectionResponse = {
  provider: "pluggy";
  mode: OpenFinanceWidgetMode;
  connectToken: string;
  expiresAt: string | null;
  itemId: string | null;
  includeSandbox: boolean;
  widget: {
    theme: "light" | "dark";
    language: string;
  };
  openFinanceParameters: {
    cpf?: string;
    cnpj?: string;
  } | null;
};

export type OpenFinancePolpStartConnectionResponse = {
  provider: "polp";
  mode: OpenFinanceWidgetMode;
  consentId: string;
  authorizationUrl: string;
  expiresAt: string | null;
  connectionId?: string;
};

export type OpenFinanceStartConnectionResponse =
  | OpenFinancePluggyStartConnectionResponse
  | OpenFinancePolpStartConnectionResponse;

export type OpenFinancePolpConsentStatus = {
  provider: "polp";
  consentId: string;
  connectionId: string | null;
  status: OpenFinanceConsentStatus;
  providerStatus: OpenFinancePolpProviderStatus;
  executionStatus: OpenFinancePolpExecutionStatus;
  resourcesReady: boolean;
  flags: string[];
  hasProviderError: boolean;
  authorizationUrl: string | null;
  authorizationExpiresAt: string | null;
  expiresAt: string | null;
  products: string[];
};

export type OpenFinanceGetConsentRequest = {
  provider: "polp";
  householdId: string;
  consentId: string;
};

export type OpenFinanceGetConsentResponse = {
  consent: OpenFinancePolpConsentStatus;
};

export type OpenFinancePluggyCompleteConnectionRequest = {
  provider: "pluggy";
  householdId: string;
  itemId: string;
};

export type OpenFinancePolpCompleteConnectionRequest = {
  provider: "polp";
  householdId: string;
  consentId: string;
};

export type OpenFinanceCompleteConnectionRequest =
  | OpenFinancePluggyCompleteConnectionRequest
  | OpenFinancePolpCompleteConnectionRequest;

export type OpenFinancePluggyCompleteConnectionResponse = {
  itemId: string;
  connections: OpenFinanceConnection[];
};

export type OpenFinancePolpCompleteConnectionResponse = {
  itemId: string;
  consentId: string;
  consent: OpenFinancePolpConsentStatus;
  connections: OpenFinanceConnection[];
};

export type OpenFinanceCompleteConnectionResponse =
  | OpenFinancePluggyCompleteConnectionResponse
  | OpenFinancePolpCompleteConnectionResponse;

export type OpenFinanceSyncMonthRequest = {
  provider: OpenFinanceProvider;
  householdId: string;
  connectionId: string;
  monthKey: string;
};

export type OpenFinanceSyncMonthResponse = {
  connection: OpenFinanceConnection;
  run: OpenFinanceSyncRun;
  found: number;
  inserted: number;
  duplicates: number;
  warnings: string[];
  transactions: OpenFinanceImportedTransaction[];
};

export type OpenFinanceRevokeConsentRequest = {
  provider: "polp";
  householdId: string;
  consentId: string;
};

export type OpenFinanceRevokeConsentResponse = {
  success: true;
  consentId: string;
};

export type OpenFinanceDisconnectConnectionRequest = {
  provider: OpenFinanceProvider;
  householdId: string;
  connectionId: string;
};

export type OpenFinancePluggyDisconnectConnectionResponse = {
  success: true;
  disconnectedItemId: string | null;
};

export type OpenFinancePolpDisconnectConnectionResponse = {
  success: true;
  consentId: string;
  disconnectedItemId: string | null;
};

export type OpenFinanceDisconnectConnectionResponse =
  | OpenFinancePluggyDisconnectConnectionResponse
  | OpenFinancePolpDisconnectConnectionResponse;

export type OpenFinanceApiErrorPayload = {
  message: string;
  code?: string | null;
  details?: Record<string, unknown> | null;
};
