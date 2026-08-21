import { asObject, type JsonObject } from "./normalizers";

export const POLP_API_BASE_URL = "https://api.polp.com.br/api/v2";

export type PolpConsentCreateInput = {
  institution_id: string;
  cpf: string;
  cnpj?: string;
  cliente_user_id: string;
  products: string[];
  avoidDuplicates: true;
};

export type PolpQuery = Record<string, string | null | undefined>;

export class PolpClientError extends Error {
  readonly status: number;
  readonly upstreamStatus: number | null;

  constructor(message: string, status = 502, upstreamStatus: number | null = null) {
    super(message);
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

export function buildPolpUrl(path: string, query: PolpQuery = {}) {
  const normalizedPath = path.replace(/^\/+/, "");
  if (
    !normalizedPath
    || normalizedPath.includes("..")
    || normalizedPath.includes(":")
    || normalizedPath.includes("\\")
  ) {
    throw new TypeError("Invalid Polp API path.");
  }

  const url = new URL(normalizedPath, `${POLP_API_BASE_URL}/`);
  if (!url.pathname.startsWith("/api/v2/")) {
    throw new TypeError("Polp API path escaped the v2 base URL.");
  }

  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

const RESOURCE_FILTERS = new Set([
  "cursor",
  "fromCreatedAt",
  "toCreatedAt",
  "fromUpdatedAt",
  "toUpdatedAt",
]);

const TRANSACTION_FILTERS = new Set([
  ...RESOURCE_FILTERS,
  "fromDate",
  "toDate",
]);

export function pickPolpFilters(
  searchParams: URLSearchParams,
  includeTransactionDates: boolean,
): PolpQuery {
  const allowed = includeTransactionDates ? TRANSACTION_FILTERS : RESOURCE_FILTERS;
  const result: PolpQuery = {};

  for (const [key, value] of searchParams) {
    if (!allowed.has(key) || value.length > 2_048) continue;
    result[key] = value;
  }

  return result;
}

export function parseWebhookQueryParameters(value: unknown) {
  if (typeof value !== "string" || value.length > 8_192) return {};
  return pickPolpFilters(new URLSearchParams(value), true);
}

type PolpClientOptions = {
  getEnv: (name: string) => string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
};

export class PolpClient {
  private readonly getEnv: PolpClientOptions["getEnv"];
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: PolpClientOptions) {
    this.getEnv = options.getEnv;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  isConfigured() {
    return Boolean(this.getEnv("POLP_API_CLIENT") && this.getEnv("POLP_API_SECRET"));
  }

  private credentials() {
    const client = this.getEnv("POLP_API_CLIENT");
    const secret = this.getEnv("POLP_API_SECRET");
    if (!client || !secret) {
      throw new PolpClientError("Integração Polp ainda não configurada.", 503);
    }
    return { client, secret };
  }

  private async request(
    path: string,
    options: {
      method?: "GET" | "POST" | "DELETE";
      query?: PolpQuery;
      body?: JsonObject;
      isPublic?: boolean;
    } = {},
  ): Promise<unknown> {
    const url = buildPolpUrl(path, options.query);
    const headers = new Headers({ Accept: "application/json" });

    if (!options.isPublic) {
      const { client, secret } = this.credentials();
      headers.set("x-api-client", client);
      headers.set("x-api-secret", secret);
    }

    if (options.body) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;

    try {
      response = await this.fetchImplementation(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        // Never forward private Polp headers to a redirect target. A contract
        // change must fail closed and be reviewed explicitly.
        redirect: "error",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new PolpClientError("A API Polp excedeu o tempo limite.", 504);
      }
      throw new PolpClientError("Não foi possível acessar a API Polp.");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new PolpClientError(
        `A API Polp recusou a operação (HTTP ${response.status}).`,
        response.status === 429 ? 503 : 502,
        response.status,
      );
    }

    if (response.status === 204) return null;

    try {
      return await response.json();
    } catch {
      throw new PolpClientError("A API Polp retornou JSON inválido.");
    }
  }

  private unwrapObject(value: unknown): JsonObject {
    const envelope = asObject(value);
    const data = envelope && Object.hasOwn(envelope, "data") ? envelope.data : value;
    const object = asObject(data);
    if (!object) throw new PolpClientError("A API Polp retornou um objeto inválido.");
    return object;
  }

  private async listAll(path: string, query: PolpQuery = {}, isPublic = false) {
    const results: JsonObject[] = [];
    let cursor: string | null = query.cursor ?? null;

    for (let page = 0; page < 100; page += 1) {
      const payload = await this.request(path, {
        query: { ...query, cursor },
        isPublic,
      });
      const envelope = asObject(payload);
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(envelope?.data)
          ? envelope.data
          : null;
      if (!items) {
        throw new PolpClientError("A API Polp retornou uma lista inválida.");
      }

      for (const item of items) {
        const object = asObject(item);
        if (!object) {
          throw new PolpClientError("A API Polp retornou um item de lista inválido.");
        }
        results.push(object);
      }

      const meta = asObject(envelope?.meta);
      const nextCursor = typeof meta?.next_cursor === "string" && meta.next_cursor
        ? meta.next_cursor
        : null;

      if (!nextCursor) return results;
      if (nextCursor === cursor) {
        throw new PolpClientError("A paginação da API Polp não avançou.");
      }
      cursor = nextCursor;
    }

    throw new PolpClientError("A paginação da API Polp excedeu o limite seguro.");
  }

  async listInstitutions() {
    return this.listAll("institutions", {}, true);
  }

  async createConsent(input: PolpConsentCreateInput) {
    return this.unwrapObject(await this.request("consents", {
      method: "POST",
      body: input,
    }));
  }

  async recreateConsent(consentId: string, products?: string[]) {
    return this.unwrapObject(await this.request(
      `consents/${encodeURIComponent(consentId)}/recreate`,
      {
        method: "POST",
        body: products ? { products } : {},
      },
    ));
  }

  async getConsent(consentId: string) {
    return this.unwrapObject(await this.request(`consents/${encodeURIComponent(consentId)}`));
  }

  async revokeConsent(consentId: string) {
    await this.request(`consents/${encodeURIComponent(consentId)}`, { method: "DELETE" });
  }

  async listAccounts(consentId: string, query: PolpQuery = {}) {
    return this.listAll(`consents/${encodeURIComponent(consentId)}/accounts`, query);
  }

  async listAccountTransactions(accountId: string, query: PolpQuery = {}) {
    return this.listAll(`accounts/${encodeURIComponent(accountId)}/transactions`, query);
  }

  async listCreditCards(consentId: string, query: PolpQuery = {}) {
    return this.listAll(`consents/${encodeURIComponent(consentId)}/credit-cards`, query);
  }

  async listCreditCardTransactions(cardId: string, query: PolpQuery = {}) {
    return this.listAll(`credit-cards/${encodeURIComponent(cardId)}/transactions`, query);
  }

  async listBills(cardId: string, query: PolpQuery = {}) {
    return this.listAll(`credit-cards/${encodeURIComponent(cardId)}/bills`, query);
  }

  async listBillTransactions(billId: string, query: PolpQuery = {}) {
    return this.listAll(`bills/${encodeURIComponent(billId)}/transactions`, query);
  }
}
