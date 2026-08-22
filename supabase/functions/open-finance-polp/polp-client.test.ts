import { describe, expect, it, vi } from "vitest";

import {
  buildPolpUrl,
  parseWebhookQueryParameters,
  pickPolpFilters,
  PolpClient,
} from "./polp-client";
import {
  ACCOUNT_ID,
  accountTransactionFixture,
  CONSENT_ID,
  institutionFixture,
} from "./test-fixtures";

const API_CLIENT = "local-test-api-client";
const API_SECRET = "local-test-api-secret";

function environment(name: string) {
  if (name === "POLP_API_CLIENT") return API_CLIENT;
  if (name === "POLP_API_SECRET") return API_SECRET;
  return "";
}

describe("PolpClient v2", () => {
  it("preserves /api/v2 for paths with and without a leading slash", () => {
    expect(buildPolpUrl("institutions").toString()).toBe(
      "https://api.polp.com.br/api/v2/institutions",
    );
    expect(buildPolpUrl("/consents", { cursor: "next page" }).toString()).toBe(
      "https://api.polp.com.br/api/v2/consents?cursor=next+page",
    );
    expect(() => buildPolpUrl("../v1/consents")).toThrow(/Invalid Polp API path/);
  });

  it("keeps institutions public at the provider boundary", async () => {
    const institutions = Array.from({ length: 299 }, (_, index) => ({
      ...institutionFixture,
      id: `synthetic-institution-${index + 1}`,
    }));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://api.polp.com.br/api/v2/institutions");
      expect(request.headers.has("x-api-client")).toBe(false);
      expect(request.headers.has("x-api-secret")).toBe(false);
      return Response.json({
        data: institutions,
        links: { first: null, last: null, prev: null, next: null },
        meta: { next_cursor: null, prev_cursor: null, per_page: 500 },
      });
    });
    const client = new PolpClient({ getEnv: () => "", fetchImplementation: fetchMock });
    const result = await client.listInstitutions();

    expect(result).toEqual(institutions);
    expect(result).toHaveLength(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("adds x-api-client/x-api-secret only server-side on private routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://api.polp.com.br/api/v2/consents");
      expect(request.method).toBe("POST");
      expect(request.redirect).toBe("error");
      expect(request.headers.get("x-api-client")).toBe(API_CLIENT);
      expect(request.headers.get("x-api-secret")).toBe(API_SECRET);
      expect(await request.json()).toEqual({
        institution_id: "institution-id",
        cpf: "12345678901",
        cliente_user_id: "jwt-user-id",
        products: ["ACCOUNT"],
        avoidDuplicates: true,
      });
      return Response.json({ data: { id: CONSENT_ID } }, { status: 201 });
    });
    const client = new PolpClient({ getEnv: environment, fetchImplementation: fetchMock });

    await expect(client.createConsent({
      institution_id: "institution-id",
      cpf: "12345678901",
      cliente_user_id: "jwt-user-id",
      products: ["ACCOUNT"],
      avoidDuplicates: true,
    })).resolves.toEqual({ id: CONSENT_ID });
  });

  it("keeps two consecutive 500-item pages and advances through each next_cursor", async () => {
    const requests: Request[] = [];
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      ...accountTransactionFixture,
      id: `synthetic-page-1-transaction-${index + 1}`,
    }));
    const secondPage = Array.from({ length: 500 }, (_, index) => ({
      ...accountTransactionFixture,
      id: `synthetic-page-2-transaction-${index + 1}`,
    }));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const cursor = new URL(request.url).searchParams.get("cursor");
      if (!cursor) {
        return Response.json({
          data: firstPage,
          links: { next: "synthetic-next-link" },
          meta: { next_cursor: "cursor-2", per_page: 500 },
        });
      }
      if (cursor === "cursor-2") {
        return Response.json({
          data: secondPage,
          links: { next: "synthetic-next-link-2" },
          meta: { next_cursor: "cursor-3", per_page: 500 },
        });
      }
      return Response.json({
        data: [],
        links: { next: null },
        meta: { next_cursor: null, per_page: 500 },
      });
    });
    const client = new PolpClient({ getEnv: environment, fetchImplementation: fetchMock });

    const result = await client.listAccountTransactions(ACCOUNT_ID, {
      fromDate: "2026-08-01T00:00:00.000Z",
      toDate: "2026-08-31T23:59:59.999Z",
    });
    expect(result).toHaveLength(1_000);
    expect(requests).toHaveLength(3);
    const secondUrl = new URL(requests[1].url);
    const thirdUrl = new URL(requests[2].url);
    expect(secondUrl.pathname).toBe(`/api/v2/accounts/${ACCOUNT_ID}/transactions`);
    expect(secondUrl.searchParams.get("cursor")).toBe("cursor-2");
    expect(secondUrl.searchParams.get("fromDate")).toBe("2026-08-01T00:00:00.000Z");
    expect(thirdUrl.searchParams.get("cursor")).toBe("cursor-3");
    expect(new Set(result.map((item) => item.id)).size).toBe(1_000);
  });

  it("fails closed when a list endpoint loses the v2 data envelope", async () => {
    const client = new PolpClient({
      getEnv: environment,
      fetchImplementation: vi.fn(async () => Response.json({ unexpected: [] })),
    });
    await expect(client.listAccounts(CONSENT_ID)).rejects.toThrow(/lista inválida/);
  });

  it("fails closed on a non-object member instead of returning a partial list", async () => {
    const client = new PolpClient({
      getEnv: environment,
      fetchImplementation: vi.fn(async () => Response.json({ data: [accountTransactionFixture, null] })),
    });
    await expect(client.listAccountTransactions(ACCOUNT_ID)).rejects.toThrow(/item de lista inválido/);
  });

  it("whitelists incoming and webhook query parameters", () => {
    const params = new URLSearchParams({
      fromDate: "2026-08-01T00:00:00Z",
      toUpdatedAt: "2026-08-31T23:59:59Z",
      page: "99",
      url: "https://attacker.invalid/",
    });
    expect(pickPolpFilters(params, true)).toEqual({
      fromDate: "2026-08-01T00:00:00Z",
      toUpdatedAt: "2026-08-31T23:59:59Z",
    });
    expect(parseWebhookQueryParameters(params.toString())).toEqual({
      fromDate: "2026-08-01T00:00:00Z",
      toUpdatedAt: "2026-08-31T23:59:59Z",
    });
  });

  it("never reflects an upstream body or credential in errors or logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      message: `upstream accidentally echoed ${API_SECRET}`,
    }, { status: 401 }));
    const client = new PolpClient({ getEnv: environment, fetchImplementation: fetchMock });

    let message = "";
    try {
      await client.getConsent(CONSENT_ID);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(API_SECRET);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fails private routes before fetch when credentials are absent", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new PolpClient({ getEnv: () => "", fetchImplementation: fetchMock });
    await expect(client.getConsent(CONSENT_ID)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
