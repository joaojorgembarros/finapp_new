import type {
  OpenFinanceImportedTransaction,
  OpenFinancePolpInstitution,
  OpenFinanceStartConnectionResponse,
  OpenFinanceSyncMonthResponse,
  OpenFinanceSyncRun,
} from "../../../src/lib/open-finance-contract";

import {
  asArray,
  asObject,
  normalizePolpAccount,
  normalizePolpBill,
  normalizePolpConsent,
  normalizePolpCreditCard,
  normalizePolpInstitution,
  normalizePolpTransaction,
  POLP_PROVIDER,
  type JsonObject,
  type NormalizedPolpConsent,
  type NormalizedPolpResource,
} from "./normalizers";
import {
  parseWebhookQueryParameters,
  pickPolpFilters,
  PolpClient,
  PolpClientError,
  type PolpConsentCreateInput,
  type PolpQuery,
} from "./polp-client";
import {
  canResolvePolpAdminConfiguration,
  createSupabasePolpRepository,
  RepositoryError,
  type AuthenticatedUser,
  type ConnectionRow,
  type ConsentContext,
  type PolpRepository,
  type SyncRunRow,
} from "./repository";

type RequestHandler = (request: Request) => Response | Promise<Response>;
type EdgeRuntime = {
  env: { get: (name: string) => string | undefined };
  serve: (handler: RequestHandler) => void;
};

type PolpApi = Pick<
  PolpClient,
  | "listInstitutions"
  | "createConsent"
  | "recreateConsent"
  | "getConsent"
  | "revokeConsent"
  | "listAccounts"
  | "listAccountTransactions"
  | "listCreditCards"
  | "listCreditCardTransactions"
  | "listBills"
  | "listBillTransactions"
>;

export type OpenFinancePolpDependencies = {
  getEnv: (name: string) => string;
  fetchImplementation: typeof fetch;
  repositoryFactory: () => PolpRepository;
  polpClient: PolpApi;
  now: () => Date;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const edgeRuntime = (globalThis as typeof globalThis & { Deno?: EdgeRuntime }).Deno;

function runtimeEnvironment(name: string) {
  const value = edgeRuntime?.env.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function noContentResponse() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function getPath(request: Request) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const marker = "/open-finance-polp";
  const markerIndex = pathname.indexOf(marker);
  return markerIndex >= 0
    ? pathname.slice(markerIndex + marker.length) || "/"
    : pathname;
}

function getBearerToken(request: Request) {
  const match = (request.headers.get("Authorization") ?? "").match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

async function readJsonObject(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new HttpError(413, "Request body excede o limite permitido.", "REQUEST_TOO_LARGE");
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
    throw new HttpError(413, "Request body excede o limite permitido.", "REQUEST_TOO_LARGE");
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "JSON inválido.", "INVALID_JSON");
  }

  const body = asObject(value);
  if (!body) throw new HttpError(400, "O body deve ser um objeto JSON.", "INVALID_BODY");
  return body;
}

function requireString(value: unknown, field: string, maxLength = 512) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${field} é obrigatório.`, "INVALID_REQUEST");
  }
  return value.trim();
}

function requireHouseholdId(value: unknown) {
  const householdId = requireString(value, "householdId", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(householdId)) {
    throw new HttpError(400, "householdId inválido.", "INVALID_HOUSEHOLD_ID");
  }
  return householdId;
}

function requireInternalId(value: unknown, field: string) {
  const id = requireString(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, `${field} inválido.`, "INVALID_INTERNAL_ID");
  }
  return id;
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Identificador de rota inválido.", "INVALID_PATH_ID");
  }
}

function normalizeDocument(value: unknown, length: number, field: string) {
  const raw = requireString(value, field, 32).replace(/\D/g, "");
  if (raw.length !== length) {
    throw new HttpError(400, `${field} inválido.`, "INVALID_DOCUMENT");
  }
  return raw;
}

function normalizeProducts(value: unknown) {
  // This integration currently persists only accounts and credit-card accounts.
  // Requesting other v2 product groups would imply a sync capability that is not
  // implemented by the canonical model/database foundation yet.
  const allowed = new Set(["ACCOUNT", "CREDIT_CARD_ACCOUNT"]);
  const products = value === undefined
    ? ["ACCOUNT", "CREDIT_CARD_ACCOUNT"]
    : asArray(value).map((item) => typeof item === "string" ? item.toUpperCase() : "");

  if (products.length === 0 || products.some((product) => !allowed.has(product))) {
    throw new HttpError(400, "products contém um produto não suportado.", "INVALID_PRODUCTS");
  }
  return [...new Set(products)];
}

async function authenticate(
  request: Request,
  repositoryFactory: () => PolpRepository,
): Promise<{ user: AuthenticatedUser; repository: PolpRepository }> {
  const token = getBearerToken(request);
  if (!token) throw new HttpError(401, "Sessão inválida.", "INVALID_SESSION");

  const repository = repositoryFactory();
  const user = await repository.authenticate(token);
  if (!user) throw new HttpError(401, "Sessão inválida.", "INVALID_SESSION");
  return { user, repository };
}

async function ensureMembership(
  repository: PolpRepository,
  householdId: string,
  userId: string,
) {
  try {
    await repository.ensureMembership(householdId, userId);
  } catch (error) {
    if (error instanceof RepositoryError && error.message === "HOUSEHOLD_FORBIDDEN") {
      throw new HttpError(403, "Você não tem acesso a esse household.", "HOUSEHOLD_FORBIDDEN");
    }
    throw error;
  }
}

async function authorizeHousehold(
  request: Request,
  repositoryFactory: () => PolpRepository,
  householdId: string,
) {
  const context = await authenticate(request, repositoryFactory);
  await ensureMembership(context.repository, householdId, context.user.id);
  return context;
}

function institutionMetadata(raw: JsonObject) {
  const institution = normalizePolpInstitution(raw);
  return {
    ...institution,
    description: typeof raw.description === "string" ? raw.description : null,
    logoUrl: typeof raw.logo_url === "string" ? raw.logo_url : null,
    status: typeof raw.status === "string" ? raw.status : null,
    type: typeof raw.type === "string" ? raw.type : null,
    credentials: asArray(raw.credentials).filter((item): item is string => typeof item === "string"),
  };
}

function institutionFromConnection(connection: ConnectionRow): OpenFinancePolpInstitution {
  const rawInstitution = asObject(connection.raw_payload?.institution);
  return {
    id: typeof rawInstitution?.id === "string"
      ? rawInstitution.id
      : connection.institution_id ?? "polp",
    name: typeof rawInstitution?.name === "string"
      ? rawInstitution.name
      : connection.institution_name,
    displayName: typeof rawInstitution?.displayName === "string"
      ? rawInstitution.displayName
      : connection.institution_name,
    provider: POLP_PROVIDER,
    connectorId: null,
  };
}

function consentResponse(consent: NormalizedPolpConsent, connectionId: string | null) {
  return {
    provider: POLP_PROVIDER,
    consentId: consent.externalConsentId,
    connectionId,
    status: consent.status,
    providerStatus: consent.providerStatus,
    executionStatus: consent.executionStatus,
    resourcesReady: consent.resourcesReady,
    flags: consent.flags,
    hasProviderError: consent.hasProviderError,
    authorizationUrl: consent.authorizationUrl,
    authorizationExpiresAt: consent.authorizationExpiresAt,
    expiresAt: consent.expiresAt,
    products: consent.products,
  };
}

function requireConsentResourcesReady(consent: NormalizedPolpConsent) {
  if (consent.providerStatus !== "AUTHORISED") {
    throw new HttpError(409, "Consentimento ainda não está AUTHORISED.", "CONSENT_NOT_AUTHORISED");
  }
  if (!consent.resourcesReady) {
    throw new HttpError(
      409,
      "Consentimento autorizado; recursos Polp ainda estão em processamento.",
      "CONSENT_RESOURCES_PENDING",
    );
  }
}

function requireProviderConsentBinding(
  consent: NormalizedPolpConsent,
  expectedConsentId: string | null,
  expectedInstitutionId: string | null,
) {
  if (expectedConsentId && consent.externalConsentId !== expectedConsentId) {
    throw new TypeError("Polp consent response does not match the requested consent.");
  }
  if (expectedInstitutionId && consent.institutionId !== expectedInstitutionId) {
    throw new TypeError("Polp consent response does not match the requested institution.");
  }
}

function resourceResponse(resource: NormalizedPolpResource) {
  return {
    provider: POLP_PROVIDER,
    id: resource.externalAccountId,
    consentId: resource.externalConsentId,
    name: resource.accountName,
    mask: resource.accountMask,
    type: resource.type,
    subtype: resource.subtype,
    currency: resource.currency,
    resourceType: resource.resourceType,
  };
}

function syncRunResponse(row: SyncRunRow, warnings: string[]): OpenFinanceSyncRun {
  return {
    id: row.id,
    connectionId: row.connection_id,
    householdId: row.household_id,
    monthKey: row.month_key,
    status: row.status as OpenFinanceSyncRun["status"],
    foundCount: row.found_count,
    insertedCount: row.inserted_count,
    duplicateCount: row.duplicate_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    warnings,
    rawPayload: row.raw_payload,
  };
}

function monthQuery(monthKey: string): PolpQuery {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || year < 1 || month < 1 || month > 12) {
    throw new HttpError(400, "monthKey inválido.", "INVALID_MONTH_KEY");
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromDate: `${monthKey}-01T00:00:00.000Z`,
    toDate: `${monthKey}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`,
  };
}

async function requireConsentContext(
  repository: PolpRepository,
  householdId: string,
  consentId: string,
) {
  const context = await repository.getConsentContext(householdId, consentId);
  if (!context) {
    throw new HttpError(404, "Consentimento Polp não encontrado.", "CONSENT_NOT_FOUND");
  }
  return context;
}

async function requireConnection(
  repository: PolpRepository,
  householdId: string,
  connectionId: string,
) {
  const connection = await repository.getConnection(householdId, connectionId);
  if (!connection) {
    throw new HttpError(404, "Conexão Polp não encontrada.", "CONNECTION_NOT_FOUND");
  }
  return connection;
}

async function createConsentFlow(input: {
  body: JsonObject;
  user: AuthenticatedUser;
  repository: PolpRepository;
  polpClient: PolpApi;
  mode: "create" | "update";
}) {
  const householdId = requireHouseholdId(input.body.householdId);
  await ensureMembership(input.repository, householdId, input.user.id);

  if (input.mode === "update") {
    const connectionId = requireInternalId(input.body.connectionId, "connectionId");
    const connection = await requireConnection(input.repository, householdId, connectionId);
    const localConsent = await input.repository.getConsentForConnection(connection.id, householdId);
    const consentId = localConsent?.external_consent_id;
    if (!consentId) throw new HttpError(409, "Conexão sem consentimento Polp.", "CONSENT_MISSING");

    const providerConsent = await input.polpClient.recreateConsent(
      consentId,
      input.body.products === undefined ? undefined : normalizeProducts(input.body.products),
    );
    const consent = normalizePolpConsent(providerConsent);
    requireProviderConsentBinding(consent, consentId, connection.institution_id);
    await input.repository.updateConsentLifecycle(consent, householdId);
    if (!consent.authorizationUrl) {
      throw new HttpError(502, "A Polp não retornou url_to_authenticate.", "POLP_AUTH_URL_MISSING");
    }
    const response: OpenFinanceStartConnectionResponse = {
      provider: POLP_PROVIDER,
      mode: "update",
      consentId: consent.externalConsentId,
      authorizationUrl: consent.authorizationUrl,
      expiresAt: consent.authorizationExpiresAt,
    };
    return response;
  }

  const institutionId = requireString(input.body.institutionId, "institutionId");
  const cpf = normalizeDocument(input.body.cpf, 11, "cpf");
  const cnpj = input.body.cnpj === undefined || input.body.cnpj === null || input.body.cnpj === ""
    ? null
    : normalizeDocument(input.body.cnpj, 14, "cnpj");
  const products = normalizeProducts(input.body.products);
  const rawInstitutions = await input.polpClient.listInstitutions();
  const rawInstitution = rawInstitutions.find((item) => item.id === institutionId);
  if (!rawInstitution) {
    throw new HttpError(400, "Instituição Polp não encontrada.", "INSTITUTION_NOT_FOUND");
  }
  if (rawInstitution.status !== "OPERATIONAL") {
    throw new HttpError(409, "Instituição temporariamente indisponível.", "INSTITUTION_UNAVAILABLE");
  }
  const institutionType = typeof rawInstitution.type === "string" ? rawInstitution.type : null;
  if (institutionType === "PERSONAL" && cnpj) {
    throw new HttpError(400, "Instituição pessoal não aceita CNPJ.", "INVALID_DOCUMENTS");
  }
  if (institutionType === "BUSINESS" && !cnpj) {
    throw new HttpError(400, "Instituição empresarial exige CNPJ.", "INVALID_DOCUMENTS");
  }

  const providerInput: PolpConsentCreateInput = {
    institution_id: institutionId,
    cpf,
    ...(cnpj ? { cnpj } : {}),
    cliente_user_id: input.user.id,
    products,
    avoidDuplicates: true,
  };
  const providerConsent = await input.polpClient.createConsent(providerInput);
  const consent = normalizePolpConsent(providerConsent);
  requireProviderConsentBinding(consent, null, institutionId);
  const echoedUserId = typeof providerConsent.cliente_user_id === "string"
    ? providerConsent.cliente_user_id
    : null;
  if (echoedUserId !== null && echoedUserId !== input.user.id) {
    throw new TypeError("Polp consent response belongs to a different user correlation.");
  }
  if (!consent.authorizationUrl) {
    throw new HttpError(502, "A Polp não retornou url_to_authenticate.", "POLP_AUTH_URL_MISSING");
  }
  const institution = normalizePolpInstitution(rawInstitution);
  const connection = await input.repository.persistInitialConsent({
    householdId,
    userId: input.user.id,
    institution,
    consent,
  });

  const response: OpenFinanceStartConnectionResponse = {
    provider: POLP_PROVIDER,
    mode: "create",
    consentId: consent.externalConsentId,
    authorizationUrl: consent.authorizationUrl,
    expiresAt: consent.authorizationExpiresAt,
  };
  return { response, connectionId: connection.id, consent };
}

async function fetchAndPersistResources(input: {
  repository: PolpRepository;
  polpClient: PolpApi;
  householdId: string;
  user: AuthenticatedUser;
  context: ConsentContext;
}) {
  const providerConsent = await input.polpClient.getConsent(
    input.context.consent.external_consent_id ?? "",
  );
  const consent = normalizePolpConsent(providerConsent);
  requireProviderConsentBinding(
    consent,
    input.context.consent.external_consent_id,
    input.context.connection.institution_id,
  );
  if (!consent.resourcesReady) {
    await input.repository.updateConsentLifecycle(consent, input.householdId);
    requireConsentResourcesReady(consent);
  }

  const [accountPayloads, cardPayloads] = await Promise.all([
    consent.products.includes("ACCOUNT")
      ? input.polpClient.listAccounts(consent.externalConsentId)
      : Promise.resolve([]),
    consent.products.includes("CREDIT_CARD_ACCOUNT")
      ? input.polpClient.listCreditCards(consent.externalConsentId)
      : Promise.resolve([]),
  ]);
  const accounts = accountPayloads.map((value) => normalizePolpAccount(value, consent.externalConsentId));
  const cards = cardPayloads.map((value) => normalizePolpCreditCard(value, consent.externalConsentId));
  await input.repository.updateConsentLifecycle(consent, input.householdId);
  await input.repository.persistResources({
    householdId: input.householdId,
    userId: input.user.id,
    institution: institutionFromConnection(input.context.connection),
    consent,
    resources: [...accounts, ...cards],
  });
  return { consent, accounts, cards };
}

const WEBHOOK_EVENT_RESOURCES: Record<string, string> = {
  consents: "consents",
  accounts: "consents",
  "accounts.transactions": "accounts",
  credit_cards: "consents",
  "credit_cards.transactions": "credit-cards",
  bills: "credit-cards",
};

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function verifyWebhookHmac(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader ?? "");
  if (!match || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // Web Crypto performs HMAC verification in the runtime implementation,
  // avoiding an observable JavaScript byte-by-byte comparison.
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(match[1]),
    encoder.encode(rawBody),
  );
}

export function createOpenFinancePolpHandler(
  overrides: Partial<OpenFinancePolpDependencies> = {},
): RequestHandler {
  const getEnv = overrides.getEnv ?? runtimeEnvironment;
  const fetchImplementation = overrides.fetchImplementation ?? fetch;
  const repositoryFactory = overrides.repositoryFactory
    ?? (() => createSupabasePolpRepository(getEnv, fetchImplementation));
  const polpClient = overrides.polpClient ?? new PolpClient({
    getEnv,
    fetchImplementation,
  });
  const now = overrides.now ?? (() => new Date());
  const replayCache = new Map<string, number>();

  async function handleConfig() {
    const adminConfigured = canResolvePolpAdminConfiguration(getEnv);
    const diagnostics = [
      {
        code: "backend_supabase_url",
        location: "backend",
        label: "Supabase Admin",
        status: adminConfigured ? "ok" : "missing",
        message: adminConfigured
          ? "Supabase Admin configurado para Open Finance."
          : "Supabase Admin do Open Finance ausente.",
      },
      {
        code: "backend_polp_api_client",
        location: "backend",
        label: "Polp API client",
        status: getEnv("POLP_API_CLIENT") ? "ok" : "missing",
        message: getEnv("POLP_API_CLIENT")
          ? "Identificador Polp configurado."
          : "Identificador Polp ausente.",
      },
      {
        code: "backend_polp_api_secret",
        location: "backend",
        label: "Polp API secret",
        status: getEnv("POLP_API_SECRET") ? "ok" : "missing",
        message: getEnv("POLP_API_SECRET")
          ? "Secret Polp configurado."
          : "Secret Polp ausente.",
      },
      {
        code: "backend_polp_webhook_secret",
        location: "backend",
        label: "Polp webhook signing secret",
        status: getEnv("POLP_WEBHOOK_SECRET") ? "ok" : "missing",
        message: getEnv("POLP_WEBHOOK_SECRET")
          ? "Assinatura do webhook configurada."
          : "Secret de assinatura do webhook ausente.",
      },
    ];
    const configured = diagnostics.every((item) => item.status === "ok");
    const response = {
      enabled: true,
      provider: POLP_PROVIDER,
      configured,
      message: configured ? "Polp configurada no backend." : "Configuração Polp incompleta.",
      diagnostics,
      includeSandbox: false,
    };
    return jsonResponse(response);
  }

  async function handleInstitutions(request: Request) {
    await authenticate(request, repositoryFactory);
    const institutions = (await polpClient.listInstitutions()).map(institutionMetadata);
    return jsonResponse({ institutions });
  }

  async function handleConnections(request: Request) {
    const url = new URL(request.url);
    const householdId = requireHouseholdId(url.searchParams.get("householdId"));
    const { repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    return jsonResponse({ connections: await repository.listConnections(householdId) });
  }

  async function handleStartConnection(request: Request, mode: "create" | "update" | null = null) {
    const { user, repository } = await authenticate(request, repositoryFactory);
    const body = await readJsonObject(request);
    const selectedMode = mode ?? (typeof body.connectionId === "string" && body.connectionId
      ? "update"
      : "create");
    const result = await createConsentFlow({
      body,
      user,
      repository,
      polpClient,
      mode: selectedMode,
    });

    if ("response" in result) {
      return jsonResponse({
        ...result.response,
        connectionId: result.connectionId,
      }, 201);
    }
    return jsonResponse(result);
  }

  async function handleGetConsent(request: Request, consentId: string) {
    const url = new URL(request.url);
    const householdId = requireHouseholdId(url.searchParams.get("householdId"));
    const { repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    const context = await requireConsentContext(repository, householdId, consentId);
    const consent = normalizePolpConsent(await polpClient.getConsent(consentId));
    requireProviderConsentBinding(consent, consentId, context.connection.institution_id);
    await repository.updateConsentLifecycle(consent, householdId);
    return jsonResponse({ consent: consentResponse(consent, context.connection.id) });
  }

  async function handleCompleteConnection(request: Request) {
    const { user, repository } = await authenticate(request, repositoryFactory);
    const body = await readJsonObject(request);
    const householdId = requireHouseholdId(body.householdId);
    const consentId = requireString(body.consentId ?? body.itemId, "consentId");
    await ensureMembership(repository, householdId, user.id);
    const context = await requireConsentContext(repository, householdId, consentId);
    const result = await fetchAndPersistResources({
      repository,
      polpClient,
      householdId,
      user,
      context,
    });
    return jsonResponse({
      itemId: consentId,
      consentId,
      consent: consentResponse(result.consent, context.connection.id),
      connections: await repository.listConnections(householdId),
    });
  }

  async function handleConsentAccounts(request: Request, consentId: string) {
    const url = new URL(request.url);
    const householdId = requireHouseholdId(url.searchParams.get("householdId"));
    const { user, repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    const context = await requireConsentContext(repository, householdId, consentId);
    const consent = normalizePolpConsent(await polpClient.getConsent(consentId));
    requireProviderConsentBinding(consent, consentId, context.connection.institution_id);
    if (!consent.resourcesReady) {
      await repository.updateConsentLifecycle(consent, householdId);
      requireConsentResourcesReady(consent);
    }
    if (!consent.products.includes("ACCOUNT")) {
      throw new HttpError(409, "Consentimento não inclui contas.", "CONSENT_PRODUCT_NOT_GRANTED");
    }
    const accounts = (await polpClient.listAccounts(
      consentId,
      pickPolpFilters(url.searchParams, false),
    )).map((value) => normalizePolpAccount(value, consentId));
    await repository.persistResources({
      householdId,
      userId: user.id,
      institution: institutionFromConnection(context.connection),
      consent,
      resources: accounts,
    });
    return jsonResponse({ accounts: accounts.map(resourceResponse) });
  }

  async function handleConsentCards(request: Request, consentId: string) {
    const url = new URL(request.url);
    const householdId = requireHouseholdId(url.searchParams.get("householdId"));
    const { user, repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    const context = await requireConsentContext(repository, householdId, consentId);
    const consent = normalizePolpConsent(await polpClient.getConsent(consentId));
    requireProviderConsentBinding(consent, consentId, context.connection.institution_id);
    if (!consent.resourcesReady) {
      await repository.updateConsentLifecycle(consent, householdId);
      requireConsentResourcesReady(consent);
    }
    if (!consent.products.includes("CREDIT_CARD_ACCOUNT")) {
      throw new HttpError(409, "Consentimento não inclui cartões.", "CONSENT_PRODUCT_NOT_GRANTED");
    }
    const cards = (await polpClient.listCreditCards(
      consentId,
      pickPolpFilters(url.searchParams, false),
    )).map((value) => normalizePolpCreditCard(value, consentId));
    await repository.persistResources({
      householdId,
      userId: user.id,
      institution: institutionFromConnection(context.connection),
      consent,
      resources: cards,
    });
    return jsonResponse({ creditCards: cards.map(resourceResponse) });
  }

  async function handleTransactions(
    request: Request,
    externalAccountId: string,
    resourceType: "account" | "credit_card",
  ) {
    const url = new URL(request.url);
    const householdId = requireHouseholdId(url.searchParams.get("householdId"));
    const { repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    const connection = await repository.getConnectionByExternalAccount(householdId, externalAccountId);
    if (!connection || connection.raw_payload?.resourceType !== resourceType) {
      throw new HttpError(404, "Recurso Polp não encontrado.", "RESOURCE_NOT_FOUND");
    }
    const payloads = resourceType === "account"
      ? await polpClient.listAccountTransactions(
        externalAccountId,
        pickPolpFilters(url.searchParams, true),
      )
      : await polpClient.listCreditCardTransactions(
        externalAccountId,
        pickPolpFilters(url.searchParams, true),
      );
    const transactions = payloads.map((value) => normalizePolpTransaction({
      value,
      resourceType,
      internalConnectionId: connection.id,
      externalConnectionId: connection.external_connection_id,
      expectedExternalAccountId: externalAccountId,
    }));
    return jsonResponse({ transactions });
  }

  async function handleBills(request: Request, cardId: string) {
    const url = new URL(request.url);
    const householdId = requireHouseholdId(url.searchParams.get("householdId"));
    const { repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    const connection = await repository.getConnectionByExternalAccount(householdId, cardId);
    if (!connection || connection.raw_payload?.resourceType !== "credit_card") {
      throw new HttpError(404, "Cartão Polp não encontrado.", "CARD_NOT_FOUND");
    }
    const bills = (await polpClient.listBills(
      cardId,
      pickPolpFilters(url.searchParams, false),
    )).map((value) => normalizePolpBill(value, cardId));
    return jsonResponse({ bills });
  }

  async function handleBillTransactions(request: Request, billId: string) {
    const url = new URL(request.url);
    const householdId = requireHouseholdId(url.searchParams.get("householdId"));
    const connectionId = requireInternalId(url.searchParams.get("connectionId"), "connectionId");
    const { repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    const connection = await requireConnection(repository, householdId, connectionId);
    if (connection.raw_payload?.resourceType !== "credit_card") {
      throw new HttpError(404, "Cartão Polp não encontrado.", "CARD_NOT_FOUND");
    }

    const ownedBills = (await polpClient.listBills(connection.external_account_id))
      .map((bill) => normalizePolpBill(bill, connection.external_account_id));
    if (!ownedBills.some((bill) => bill.id === billId)) {
      throw new HttpError(404, "Fatura Polp não encontrada.", "BILL_NOT_FOUND");
    }
    const payloads = await polpClient.listBillTransactions(
      billId,
      pickPolpFilters(url.searchParams, true),
    );
    const transactions = payloads.map((value) => normalizePolpTransaction({
      value,
      resourceType: "credit_card",
      internalConnectionId: connection.id,
      externalConnectionId: connection.external_connection_id,
      expectedExternalAccountId: connection.external_account_id,
      expectedBillId: billId,
    }));
    return jsonResponse({ transactions });
  }

  async function handleSyncMonth(request: Request) {
    const { user, repository } = await authenticate(request, repositoryFactory);
    const body = await readJsonObject(request);
    const householdId = requireHouseholdId(body.householdId);
    const connectionId = requireInternalId(body.connectionId, "connectionId");
    const monthKey = requireString(body.monthKey, "monthKey", 7);
    const query = monthQuery(monthKey);
    await ensureMembership(repository, householdId, user.id);
    const connection = await requireConnection(repository, householdId, connectionId);
    const resourceType = connection.raw_payload?.resourceType;
    if (resourceType !== "account" && resourceType !== "credit_card") {
      throw new HttpError(409, "Conexão Polp ainda não possui recurso sincronizável.", "CONNECTION_NOT_READY");
    }
    if (connection.status === "disconnected") {
      throw new HttpError(409, "Conexão Polp revogada.", "CONNECTION_REVOKED");
    }
    const consent = await repository.getConsentForConnection(connection.id, householdId);
    if (
      !consent
      || consent.status !== "active"
      || consent.raw_payload?.providerStatus !== "AUTHORISED"
      || !["SUCCESS", "PARTIAL_SUCCESS"].includes(String(consent.raw_payload?.executionStatus ?? ""))
    ) {
      throw new HttpError(409, "Consentimento Polp não está AUTHORISED.", "CONSENT_NOT_AUTHORISED");
    }

    const run = await repository.createSyncRun({
      connectionId,
      householdId,
      userId: user.id,
      monthKey,
    });
    const warnings: string[] = [];
    const returnedTransactions: OpenFinanceImportedTransaction[] = [];
    let found = 0;
    let inserted = 0;
    let duplicates = 0;

    try {
      const payloads = resourceType === "account"
        ? await polpClient.listAccountTransactions(connection.external_account_id, query)
        : await polpClient.listCreditCardTransactions(connection.external_account_id, query);
      found = payloads.length;

      for (const payload of payloads) {
        let transaction;
        try {
          transaction = normalizePolpTransaction({
            value: payload,
            resourceType,
            internalConnectionId: connection.id,
            externalConnectionId: connection.external_connection_id,
            expectedExternalAccountId: connection.external_account_id,
          });
        } catch {
          const externalId = typeof payload.id === "string" ? payload.id : "sem-id";
          warnings.push(`Transação Polp ${externalId} ignorada por payload inválido.`);
          continue;
        }

        // The actor is exclusively the user returned by auth.getUser(token).
        // Body fields such as created_by, userId, createdBy and actorId are ignored.
        const result = await repository.importTransaction({
          connection,
          syncRunId: run.id,
          userId: user.id,
          transaction,
        });
        if (result.inserted) inserted += 1;
        else duplicates += 1;
        if (result.contentChanged) {
          warnings.push(
            `Transação Polp ${transaction.externalTransactionId} já importada possui conteúdo divergente; reconciliação necessária.`,
          );
        }
        returnedTransactions.push({
          id: result.importedBankTransactionId,
          connectionId: connection.id,
          externalTransactionId: transaction.externalTransactionId,
          externalAccountId: transaction.externalAccountId,
          description: transaction.description,
          amountCents: transaction.amountCents,
          direction: transaction.direction,
          occurredOn: transaction.occurredOn,
          postedAt: transaction.postedAt,
          fingerprint: transaction.fingerprint,
          rawPayload: transaction.rawPayload,
        });
      }

      const finishedRun = await repository.finishSyncRun({
        runId: run.id,
        connectionId,
        householdId,
        status: "success",
        found,
        inserted,
        duplicates,
        warnings,
      });
      const connections = await repository.listConnections(householdId);
      const mappedConnection = connections.find((item) => item.id === connection.id);
      if (!mappedConnection) throw new RepositoryError("Conexão sincronizada não encontrada.");

      const response: OpenFinanceSyncMonthResponse = {
        connection: mappedConnection,
        run: syncRunResponse(finishedRun, warnings),
        found,
        inserted,
        duplicates,
        warnings,
        transactions: returnedTransactions,
      };
      return jsonResponse(response);
    } catch (error) {
      try {
        await repository.finishSyncRun({
          runId: run.id,
          connectionId,
          householdId,
          status: "error",
          found,
          inserted,
          duplicates,
          warnings,
          errorMessage: "Falha no sync Polp.",
        });
      } catch {
        // Preserve the original failure and never fall back to direct inserts.
      }
      throw error;
    }
  }

  async function revoke(request: Request, householdId: string, consentId: string) {
    const { repository } = await authorizeHousehold(request, repositoryFactory, householdId);
    const context = await requireConsentContext(repository, householdId, consentId);
    if (context.consent.status !== "revoked") {
      try {
        await polpClient.revokeConsent(consentId);
      } catch (error) {
        if (!(error instanceof PolpClientError && error.upstreamStatus === 404)) throw error;
      }
    }
    await repository.revokeConsent(householdId, consentId);
    return jsonResponse({ success: true, consentId });
  }

  async function handleWebhook(request: Request) {
    const secret = getEnv("POLP_WEBHOOK_SECRET");
    if (!secret) throw new HttpError(503, "Webhook Polp não configurado.", "WEBHOOK_NOT_CONFIGURED");
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
      throw new HttpError(413, "Webhook excede o limite permitido.", "WEBHOOK_TOO_LARGE");
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
      throw new HttpError(413, "Webhook excede o limite permitido.", "WEBHOOK_TOO_LARGE");
    }
    const signature = request.headers.get("X-Webhook-Signature");
    if (!await verifyWebhookHmac(rawBody, signature, secret)) {
      throw new HttpError(401, "Assinatura de webhook inválida.", "INVALID_WEBHOOK_SIGNATURE");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "Payload de webhook inválido.", "INVALID_WEBHOOK_PAYLOAD");
    }
    const payload = asObject(parsed);
    const event = typeof payload?.event === "string" ? payload.event : "";
    const resource = typeof payload?.resource === "string" ? payload.resource : "";
    const resourceId = typeof payload?.resource_id === "string" ? payload.resource_id.trim() : "";
    if (!event || !resourceId || WEBHOOK_EVENT_RESOURCES[event] !== resource) {
      throw new HttpError(400, "Payload de webhook v2 inválido.", "INVALID_WEBHOOK_PAYLOAD");
    }
    const hasQueryParameters = typeof payload?.query_parameters === "string";
    if ((event === "consents" && hasQueryParameters) || (event !== "consents" && !hasQueryParameters)) {
      throw new HttpError(400, "query_parameters incompatível com o evento v2.", "INVALID_WEBHOOK_PAYLOAD");
    }
    const queryParameters = parseWebhookQueryParameters(payload?.query_parameters);

    const replayKey = (signature ?? "").toLowerCase();
    const cutoff = now().getTime() - 15 * 60_000;
    for (const [key, timestamp] of replayCache) {
      if (timestamp < cutoff) replayCache.delete(key);
    }
    if (replayCache.has(replayKey)) {
      return jsonResponse({ accepted: true, replay: true, event }, 202);
    }
    // Reserve before the first persistence/provider await so concurrent
    // deliveries in this isolate cannot both process the same signed body.
    replayCache.set(replayKey, now().getTime());

    let tracked = false;
    try {
      const repository = repositoryFactory();
      if (resource === "consents") {
        const contexts = await repository.findWebhookConsentContexts(resourceId);
        tracked = contexts.length > 0;
        if (event === "consents" && tracked) {
          const consent = normalizePolpConsent(await polpClient.getConsent(resourceId));
          requireProviderConsentBinding(consent, resourceId, null);
          await repository.updateConsentLifecycle(consent);
        }
      } else if (resource === "accounts" || resource === "credit-cards") {
        tracked = (await repository.findWebhookConnections(resourceId)).length > 0;
      }
    } catch (error) {
      replayCache.delete(replayKey);
      throw error;
    }

    if (replayCache.size > 1_000) replayCache.delete(replayCache.keys().next().value ?? "");

    // Resource webhooks are authenticated signals. Transaction import remains
    // in /sync-month so p_created_by always comes from a validated user JWT.
    return jsonResponse({
      accepted: true,
      replay: false,
      tracked,
      event,
      queryParameters,
    }, 202);
  }

  return async (request: Request) => {
    if (request.method === "OPTIONS") return noContentResponse();
    const path = getPath(request);

    try {
      if (request.method === "GET" && path === "/config") return await handleConfig();
      if (request.method === "GET" && path === "/institutions") {
        return await handleInstitutions(request);
      }
      if (request.method === "GET" && path === "/connections") {
        return await handleConnections(request);
      }
      if (request.method === "POST" && path === "/start-connection") {
        return await handleStartConnection(request);
      }
      if (request.method === "POST" && path === "/consents") {
        return await handleStartConnection(request, "create");
      }
      if (request.method === "POST" && path === "/complete-connection") {
        return await handleCompleteConnection(request);
      }
      if (request.method === "POST" && path === "/sync-month") {
        return await handleSyncMonth(request);
      }
      if (request.method === "POST" && path === "/webhook") {
        return await handleWebhook(request);
      }

      let match = /^\/consents\/([^/]+)\/accounts$/.exec(path);
      if (request.method === "GET" && match) {
        return await handleConsentAccounts(request, decodePathSegment(match[1]));
      }
      match = /^\/consents\/([^/]+)\/credit-cards$/.exec(path);
      if (request.method === "GET" && match) {
        return await handleConsentCards(request, decodePathSegment(match[1]));
      }
      match = /^\/consents\/([^/]+)$/.exec(path);
      if (request.method === "GET" && match) {
        return await handleGetConsent(request, decodePathSegment(match[1]));
      }
      if (request.method === "DELETE" && match) {
        const url = new URL(request.url);
        const householdId = requireHouseholdId(url.searchParams.get("householdId"));
        return await revoke(request, householdId, decodePathSegment(match[1]));
      }

      match = /^\/accounts\/([^/]+)\/transactions$/.exec(path);
      if (request.method === "GET" && match) {
        return await handleTransactions(request, decodePathSegment(match[1]), "account");
      }
      match = /^\/credit-cards\/([^/]+)\/transactions$/.exec(path);
      if (request.method === "GET" && match) {
        return await handleTransactions(request, decodePathSegment(match[1]), "credit_card");
      }
      match = /^\/credit-cards\/([^/]+)\/bills$/.exec(path);
      if (request.method === "GET" && match) {
        return await handleBills(request, decodePathSegment(match[1]));
      }
      match = /^\/bills\/([^/]+)\/transactions$/.exec(path);
      if (request.method === "GET" && match) {
        return await handleBillTransactions(request, decodePathSegment(match[1]));
      }
      match = /^\/connections\/([^/]+)$/.exec(path);
      if (request.method === "DELETE" && match) {
        const url = new URL(request.url);
        const householdId = requireHouseholdId(url.searchParams.get("householdId"));
        const context = await authorizeHousehold(request, repositoryFactory, householdId);
        const connection = await requireConnection(
          context.repository,
          householdId,
          decodePathSegment(match[1]),
        );
        const consent = await context.repository.getConsentForConnection(connection.id, householdId);
        if (!consent?.external_consent_id) {
          throw new HttpError(409, "Conexão sem consentimento Polp.", "CONSENT_MISSING");
        }
        const response = await revoke(request, householdId, consent.external_consent_id);
        const payload = await response.json();
        return jsonResponse({
          ...asObject(payload),
          disconnectedItemId: consent.external_consent_id,
        });
      }

      throw new HttpError(404, "Rota não encontrada.", "NOT_FOUND");
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ message: error.message, code: error.code }, error.status);
      }
      if (error instanceof PolpClientError) {
        return jsonResponse({ message: error.message, code: "POLP_UPSTREAM_ERROR" }, error.status);
      }
      if (error instanceof RepositoryError) {
        return jsonResponse({ message: error.message, code: "OPEN_FINANCE_PERSISTENCE_ERROR" }, 500);
      }
      if (error instanceof TypeError) {
        return jsonResponse({
          message: "A API Polp retornou um payload incompatível.",
          code: "POLP_INVALID_PAYLOAD",
        }, 502);
      }
      return jsonResponse({ message: "Erro interno.", code: "INTERNAL_ERROR" }, 500);
    }
  };
}

if (edgeRuntime?.serve) {
  edgeRuntime.serve(createOpenFinancePolpHandler());
}
