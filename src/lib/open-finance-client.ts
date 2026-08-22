import {
  OPEN_FINANCE_ENDPOINTS,
  isOpenFinanceProvider,
  type OpenFinanceBackendConfigResponse,
  type OpenFinanceCompleteConnectionRequest,
  type OpenFinanceCompleteConnectionResponse,
  type OpenFinanceConnection,
  type OpenFinanceDisconnectConnectionRequest,
  type OpenFinanceDisconnectConnectionResponse,
  type OpenFinanceGetConsentRequest,
  type OpenFinanceGetConsentResponse,
  type OpenFinanceListConnectionsRequest,
  type OpenFinanceListConnectionsResponse,
  type OpenFinanceListInstitutionsRequest,
  type OpenFinanceListInstitutionsResponse,
  type OpenFinancePolpCompleteConnectionResponse,
  type OpenFinancePolpCreateConnectionRequest,
  type OpenFinancePolpUpdateConnectionRequest,
  type OpenFinanceProvider,
  type OpenFinanceResourceType,
  type OpenFinanceRevokeConsentRequest,
  type OpenFinanceRevokeConsentResponse,
  type OpenFinanceStartConnectionRequest,
  type OpenFinanceStartConnectionResponse,
  type OpenFinanceSyncMonthRequest,
  type OpenFinanceSyncMonthResponse,
} from "./open-finance-contract";

export const OPEN_FINANCE_FUNCTION_NAMES = {
  pluggy: "open-finance-pluggy",
  polp: "open-finance-polp",
} as const;

export type OpenFinanceFunctionsInvokeOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
};

export type OpenFinanceFunctionsClient = {
  invoke: <T = unknown>(
    name: string,
    options?: OpenFinanceFunctionsInvokeOptions,
  ) => Promise<{ data: T | null; error: unknown }>;
};

export type OpenFinanceClientDependencies = {
  functions: OpenFinanceFunctionsClient;
};

export class OpenFinanceClientError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "OpenFinanceClientError";
    this.code = code;
    this.status = status;
  }
}

const HOUSEHOLD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const RESOURCE_TYPES = new Set<OpenFinanceResourceType>(["account", "credit_card", "consent"]);

export function getOpenFinanceFunctionName(provider: OpenFinanceProvider) {
  if (!isOpenFinanceProvider(provider)) {
    throw new TypeError("provider must be a supported Open Finance provider.");
  }
  return OPEN_FINANCE_FUNCTION_NAMES[provider];
}

export function buildOpenFinanceInvokeTarget(input: {
  provider: OpenFinanceProvider;
  path: string;
  query?: Record<string, string | undefined>;
}) {
  const functionName = getOpenFinanceFunctionName(input.provider);
  if (!input.path.startsWith("/") || input.path.includes("..") || input.path.includes("//")) {
    throw new TypeError("Open Finance path is invalid.");
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return `${functionName}${input.path}${query ? `?${query}` : ""}`;
}

function requireHouseholdId(value: string) {
  const householdId = value.trim();
  if (!HOUSEHOLD_ID_PATTERN.test(householdId)) {
    throw new TypeError("householdId is invalid.");
  }
  return householdId;
}

function requireMonthKey(value: string) {
  const monthKey = value.trim();
  if (!MONTH_KEY_PATTERN.test(monthKey)) {
    throw new TypeError("monthKey is invalid.");
  }
  return monthKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readResourceType(value: unknown): OpenFinanceResourceType | null {
  if (!isRecord(value)) return null;
  const resourceType = value.resourceType;
  return typeof resourceType === "string" && RESOURCE_TYPES.has(resourceType as OpenFinanceResourceType)
    ? resourceType as OpenFinanceResourceType
    : null;
}

function withoutRawPayload<T extends { rawPayload: Record<string, unknown> | null }>(value: T): T {
  return { ...value, rawPayload: null };
}

function toPublicConnection(connection: OpenFinanceConnection): OpenFinanceConnection {
  const resourceType = connection.resourceType ?? readResourceType(connection.rawPayload);
  return {
    ...withoutRawPayload(connection),
    resourceType,
    consent: connection.consent ? withoutRawPayload(connection.consent) : null,
    lastSyncRun: connection.lastSyncRun ? withoutRawPayload(connection.lastSyncRun) : null,
  };
}

function toPublicConnections(connections: OpenFinanceConnection[]) {
  return connections.map(toPublicConnection);
}

async function invokeOpenFinance<T>(
  deps: OpenFinanceClientDependencies,
  input: {
    provider: OpenFinanceProvider;
    path: string;
    method: "GET" | "POST" | "DELETE";
    query?: Record<string, string | undefined>;
    body?: Record<string, unknown>;
  },
): Promise<T> {
  const target = buildOpenFinanceInvokeTarget(input);
  const { data, error } = await deps.functions.invoke<T>(target, {
    method: input.method,
    body: input.method === "POST" ? input.body : undefined,
  });

  if (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "A chamada Open Finance falhou.";
    throw new OpenFinanceClientError(message);
  }
  if (data == null) {
    throw new OpenFinanceClientError("A Edge Open Finance retornou uma resposta vazia.");
  }
  return data;
}

function assertProvider<T extends { provider?: unknown }>(
  value: T,
  expected: OpenFinanceProvider,
): T {
  if (!isOpenFinanceProvider(value.provider) || value.provider !== expected) {
    throw new OpenFinanceClientError("A Edge Open Finance retornou um provider incompatível.");
  }
  return value;
}

function isPolpUpdateRequest(
  request: OpenFinanceStartConnectionRequest,
): request is OpenFinancePolpUpdateConnectionRequest {
  return request.provider === "polp" && "connectionId" in request;
}

function isPolpCreateRequest(
  request: OpenFinanceStartConnectionRequest,
): request is OpenFinancePolpCreateConnectionRequest {
  return request.provider === "polp" && "institutionId" in request;
}

export async function getOpenFinanceConfig(
  input: { provider: OpenFinanceProvider },
  deps: OpenFinanceClientDependencies,
) {
  const response = await invokeOpenFinance<OpenFinanceBackendConfigResponse>(deps, {
    provider: input.provider,
    path: OPEN_FINANCE_ENDPOINTS.config,
    method: "GET",
  });
  return assertProvider(response, input.provider);
}

export async function listOpenFinanceInstitutions(
  input: OpenFinanceListInstitutionsRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceListInstitutionsResponse> {
  return invokeOpenFinance(deps, {
    provider: input.provider,
    path: OPEN_FINANCE_ENDPOINTS.institutions,
    method: "GET",
  });
}

export async function listOpenFinanceConnections(
  input: OpenFinanceListConnectionsRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceListConnectionsResponse> {
  const householdId = requireHouseholdId(input.householdId);
  const response = await invokeOpenFinance<OpenFinanceListConnectionsResponse>(deps, {
    provider: input.provider,
    path: OPEN_FINANCE_ENDPOINTS.connections,
    method: "GET",
    query: { householdId },
  });
  return {
    connections: toPublicConnections(response.connections ?? []),
  };
}

export async function startOpenFinanceConnection(
  request: OpenFinanceStartConnectionRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceStartConnectionResponse> {
  const householdId = requireHouseholdId(request.householdId);
  let body: Record<string, unknown>;

  if (request.provider === "pluggy") {
    body = {
      householdId,
      ...(request.connectionId ? { connectionId: request.connectionId } : {}),
    };
  } else if (isPolpUpdateRequest(request)) {
    body = {
      householdId,
      connectionId: request.connectionId,
    };
  } else if (isPolpCreateRequest(request)) {
    body = {
      householdId,
      institutionId: request.institutionId,
      cpf: request.cpf,
      ...(request.cnpj ? { cnpj: request.cnpj } : {}),
      ...(request.products ? { products: request.products } : {}),
    };
  } else {
    throw new TypeError("Polp start-connection request is incomplete.");
  }

  const response = await invokeOpenFinance<OpenFinanceStartConnectionResponse>(deps, {
    provider: request.provider,
    path: OPEN_FINANCE_ENDPOINTS.startConnection,
    method: "POST",
    body,
  });
  return assertProvider(response, request.provider);
}

export async function getOpenFinanceConsent(
  request: OpenFinanceGetConsentRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceGetConsentResponse> {
  const householdId = requireHouseholdId(request.householdId);
  const response = await invokeOpenFinance<OpenFinanceGetConsentResponse>(deps, {
    provider: request.provider,
    path: OPEN_FINANCE_ENDPOINTS.consentStatus(request.consentId),
    method: "GET",
    query: { householdId },
  });
  if (!response.consent || response.consent.provider !== "polp") {
    throw new OpenFinanceClientError("A Edge Open Finance retornou um consentimento incompatível.");
  }
  return response;
}

export async function completeOpenFinanceConnection(
  request: OpenFinanceCompleteConnectionRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceCompleteConnectionResponse> {
  const householdId = requireHouseholdId(request.householdId);
  const body = request.provider === "pluggy"
    ? { householdId, itemId: request.itemId }
    : { householdId, consentId: request.consentId };

  const response = await invokeOpenFinance<OpenFinanceCompleteConnectionResponse>(deps, {
    provider: request.provider,
    path: OPEN_FINANCE_ENDPOINTS.completeConnection,
    method: "POST",
    body,
  });

  if (request.provider === "polp") {
    const polpResponse = response as OpenFinancePolpCompleteConnectionResponse;
    if (!polpResponse.consentId || !polpResponse.consent) {
      throw new OpenFinanceClientError("A Edge Open Finance retornou um complete-connection incompatível.");
    }
    return {
      ...polpResponse,
      connections: toPublicConnections(polpResponse.connections ?? []),
    };
  }

  return {
    ...response,
    connections: toPublicConnections(response.connections ?? []),
  };
}

export async function syncOpenFinanceMonth(
  request: OpenFinanceSyncMonthRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceSyncMonthResponse> {
  const body = {
    householdId: requireHouseholdId(request.householdId),
    connectionId: request.connectionId,
    monthKey: requireMonthKey(request.monthKey),
  };
  const response = await invokeOpenFinance<OpenFinanceSyncMonthResponse>(deps, {
    provider: request.provider,
    path: OPEN_FINANCE_ENDPOINTS.syncMonth,
    method: "POST",
    body,
  });
  return {
    ...response,
    connection: toPublicConnection(response.connection),
    run: response.run ? withoutRawPayload(response.run) : response.run,
    transactions: (response.transactions ?? []).map((transaction) => withoutRawPayload(transaction)),
  };
}

export async function revokeOpenFinanceConsent(
  request: OpenFinanceRevokeConsentRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceRevokeConsentResponse> {
  return invokeOpenFinance(deps, {
    provider: request.provider,
    path: OPEN_FINANCE_ENDPOINTS.revokeConsent(request.consentId),
    method: "DELETE",
    query: { householdId: requireHouseholdId(request.householdId) },
  });
}

export async function disconnectOpenFinanceConnection(
  request: OpenFinanceDisconnectConnectionRequest,
  deps: OpenFinanceClientDependencies,
): Promise<OpenFinanceDisconnectConnectionResponse> {
  return invokeOpenFinance(deps, {
    provider: request.provider,
    path: OPEN_FINANCE_ENDPOINTS.disconnectConnection(request.connectionId),
    method: "DELETE",
    query: { householdId: requireHouseholdId(request.householdId) },
  });
}

export function createOpenFinanceClient(deps: OpenFinanceClientDependencies) {
  return {
    getConfig: (input: { provider: OpenFinanceProvider }) => getOpenFinanceConfig(input, deps),
    listInstitutions: (input: OpenFinanceListInstitutionsRequest) =>
      listOpenFinanceInstitutions(input, deps),
    startConnection: (input: OpenFinanceStartConnectionRequest) =>
      startOpenFinanceConnection(input, deps),
    getConsent: (input: OpenFinanceGetConsentRequest) => getOpenFinanceConsent(input, deps),
    completeConnection: (input: OpenFinanceCompleteConnectionRequest) =>
      completeOpenFinanceConnection(input, deps),
    listConnections: (input: OpenFinanceListConnectionsRequest) =>
      listOpenFinanceConnections(input, deps),
    syncMonth: (input: OpenFinanceSyncMonthRequest) => syncOpenFinanceMonth(input, deps),
    revokeConsent: (input: OpenFinanceRevokeConsentRequest) => revokeOpenFinanceConsent(input, deps),
    disconnectConnection: (input: OpenFinanceDisconnectConnectionRequest) =>
      disconnectOpenFinanceConnection(input, deps),
  };
}
