import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createOpenFinancePolpHandler, verifyWebhookHmac } from "./index";
import { createPolpClientDouble, createRepositoryDouble } from "./test-doubles";
import {
  authorisedConsentFixture,
  CONSENT_ID,
  webhookFixture,
} from "./test-fixtures";

const WEBHOOK_SECRET = "local-webhook-secret-for-tests-only";

function signature(rawBody: string, secret = WEBHOOK_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function webhookRequest(rawBody: string, signatureHeader?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signatureHeader !== undefined) {
    headers.set("X-Webhook-Signature", signatureHeader);
  }
  return new Request(
    "http://127.0.0.1:54321/functions/v1/open-finance-polp/webhook",
    { method: "POST", headers, body: rawBody },
  );
}

function setup(secret = WEBHOOK_SECRET) {
  const repository = createRepositoryDouble();
  const repositoryFactory = vi.fn(() => repository);
  const client = createPolpClientDouble({
    getConsent: vi.fn(async () => authorisedConsentFixture),
  });
  const handler = createOpenFinancePolpHandler({
    getEnv: (name) => name === "POLP_WEBHOOK_SECRET" ? secret : "",
    repositoryFactory,
    polpClient: client as never,
    now: () => new Date("2026-08-21T17:00:00.000Z"),
  });
  return { handler, repository, repositoryFactory, client };
}

describe("Polp v2 signed webhook", () => {
  it("rejects a missing signature with 401 and zero side effects", async () => {
    const { handler, repositoryFactory, client } = setup();
    const rawBody = JSON.stringify(webhookFixture);
    const response = await handler(webhookRequest(rawBody));
    expect(response.status).toBe(401);
    expect(repositoryFactory).not.toHaveBeenCalled();
    expect(client.getConsent).not.toHaveBeenCalled();
  });

  it("rejects malformed and altered signatures with 401", async () => {
    const { handler, repositoryFactory } = setup();
    const rawBody = JSON.stringify(webhookFixture);
    const malformed = await handler(webhookRequest(rawBody, "invalid-format"));
    const altered = await handler(webhookRequest(rawBody, `sha256=${"0".repeat(64)}`));
    expect(malformed.status).toBe(401);
    expect(altered.status).toBe(401);
    expect(repositoryFactory).not.toHaveBeenCalled();
  });

  it("authenticates the exact raw body before JSON parsing", async () => {
    const { handler, repositoryFactory } = setup();
    const compact = JSON.stringify(webhookFixture);
    const pretty = JSON.stringify(webhookFixture, null, 2);
    const alteredWhitespace = await handler(webhookRequest(pretty, signature(compact)));
    expect(alteredWhitespace.status).toBe(401);

    const invalidJson = "{ definitely-not-json";
    const invalidSignature = await handler(webhookRequest(invalidJson, `sha256=${"0".repeat(64)}`));
    expect(invalidSignature.status).toBe(401);
    const validSignature = await handler(webhookRequest(invalidJson, signature(invalidJson)));
    expect(validSignature.status).toBe(400);
    expect(repositoryFactory).not.toHaveBeenCalled();
  });

  it("uses Web Crypto HMAC verify instead of a JavaScript early-exit comparison", async () => {
    const rawBody = JSON.stringify(webhookFixture);
    const verifySpy = vi.spyOn(crypto.subtle, "verify");
    await expect(verifyWebhookHmac(rawBody, signature(rawBody), WEBHOOK_SECRET)).resolves.toBe(true);
    expect(verifySpy).toHaveBeenCalledWith(
      "HMAC",
      expect.anything(),
      expect.any(Uint8Array),
      expect.any(Uint8Array),
    );
    verifySpy.mockRestore();
  });

  it("accepts the official v2 payload and only whitelisted query parameters", async () => {
    const { handler, repositoryFactory, client } = setup();
    const rawBody = JSON.stringify({
      ...webhookFixture,
      query_parameters: `${webhookFixture.query_parameters}&url=https%3A%2F%2Fattacker.invalid%2F&page=99`,
      created_by: "hostile-user-id",
      userId: "hostile-user-id",
      actorId: "hostile-user-id",
    });
    const response = await handler(webhookRequest(rawBody, signature(rawBody)));
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toEqual(expect.objectContaining({
      accepted: true,
      replay: false,
      event: "accounts.transactions",
      queryParameters: {
        fromCreatedAt: "2026-08-21T15:00:00.000Z",
        toCreatedAt: "2026-08-21T15:05:00.000Z",
        fromUpdatedAt: "2026-08-21T15:00:00.000Z",
        toUpdatedAt: "2026-08-21T15:05:00.000Z",
      },
    }));
    expect(repositoryFactory).toHaveBeenCalledTimes(1);
    expect(client.getConsent).not.toHaveBeenCalled();
  });

  it("refreshes tracked consent state and treats replay as idempotent", async () => {
    const { handler, repository, client } = setup();
    const rawBody = JSON.stringify({
      event: "consents",
      resource: "consents",
      resource_id: CONSENT_ID,
    });
    const first = await handler(webhookRequest(rawBody, signature(rawBody)));
    const second = await handler(webhookRequest(rawBody, signature(rawBody)));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await first.json()).toEqual(expect.objectContaining({
      accepted: true,
      replay: false,
      tracked: true,
    }));
    expect(await second.json()).toEqual({
      accepted: true,
      replay: true,
      event: "consents",
    });
    expect(client.getConsent).toHaveBeenCalledTimes(1);
    expect(repository.updateConsentLifecycle).toHaveBeenCalledTimes(1);
    expect(repository.importTransaction).not.toHaveBeenCalled();
  });

  it("reserves the replay digest before concurrent processing in one isolate", async () => {
    const { handler, repository, client } = setup();
    const rawBody = JSON.stringify({
      event: "consents",
      resource: "consents",
      resource_id: CONSENT_ID,
    });
    const canonicalSignature = signature(rawBody);
    const upperHexSignature = `sha256=${canonicalSignature.slice("sha256=".length).toUpperCase()}`;
    const [first, second] = await Promise.all([
      handler(webhookRequest(rawBody, canonicalSignature)),
      handler(webhookRequest(rawBody, upperHexSignature)),
    ]);
    expect([first.status, second.status]).toEqual([202, 202]);
    const bodies = await Promise.all([first.json(), second.json()]);
    expect(bodies.filter((body) => body.replay === false)).toHaveLength(1);
    expect(bodies.filter((body) => body.replay === true)).toHaveLength(1);
    expect(client.getConsent).toHaveBeenCalledTimes(1);
    expect(repository.updateConsentLifecycle).toHaveBeenCalledTimes(1);
  });

  it("rejects legacy v1 fields even when correctly signed", async () => {
    const { handler, repositoryFactory } = setup();
    const rawBody = JSON.stringify({
      event: "transactions.created",
      entity: "transactions",
      entity_id: "legacy-id",
      changes: null,
    });
    const response = await handler(webhookRequest(rawBody, signature(rawBody)));
    expect(response.status).toBe(400);
    expect(repositoryFactory).not.toHaveBeenCalled();
  });

  it("fails closed when the signing secret is not configured", async () => {
    const { handler, repositoryFactory } = setup("");
    const rawBody = JSON.stringify(webhookFixture);
    const response = await handler(webhookRequest(rawBody, signature(rawBody)));
    expect(response.status).toBe(503);
    expect(repositoryFactory).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(WEBHOOK_SECRET);
  });
});
