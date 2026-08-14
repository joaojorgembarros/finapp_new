export const OPEN_FINANCE_PROVIDER = "pluggy" as const;

export const OPEN_FINANCE_ENDPOINTS = {
  config: "/config",
  connections: "/connections",
  startConnection: "/start-connection",
  completeConnection: "/complete-connection",
  syncMonth: "/sync-month",
  webhook: "/webhook",
} as const;

export type OpenFinanceProvider = typeof OPEN_FINANCE_PROVIDER;
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

export type OpenFinanceInstitution = {
  id: string;
  name: string;
  displayName: string;
  provider: OpenFinanceProvider;
  connectorId: number | null;
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

export type OpenFinanceConnection = {
  id: string;
  householdId: string;
  userId: string;
  provider: OpenFinanceProvider;
  institution: OpenFinanceInstitution;
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
  createdAt: string;
  updatedAt: string;
  rawPayload: Record<string, unknown> | null;
};

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

export type OpenFinanceListConnectionsRequest = {
  householdId: string;
};

export type OpenFinanceListConnectionsResponse = {
  connections: OpenFinanceConnection[];
};

export type OpenFinanceStartConnectionRequest = {
  householdId: string;
  connectionId?: string | null;
};

export type OpenFinanceStartConnectionResponse = {
  provider: OpenFinanceProvider;
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

export type OpenFinanceCompleteConnectionRequest = {
  householdId: string;
  itemId: string;
};

export type OpenFinanceCompleteConnectionResponse = {
  itemId: string;
  connections: OpenFinanceConnection[];
};

export type OpenFinanceSyncMonthRequest = {
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

export type OpenFinanceDisconnectConnectionRequest = {
  householdId: string;
  connectionId: string;
};

export type OpenFinanceDisconnectConnectionResponse = {
  success: true;
  disconnectedItemId: string | null;
};

export type OpenFinanceApiErrorPayload = {
  message: string;
  code?: string | null;
  details?: Record<string, unknown> | null;
};
