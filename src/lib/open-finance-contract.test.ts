import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  buildOpenFinanceExternalTransactionIdentityKey,
  buildOpenFinanceTransactionFingerprint,
  isOpenFinanceDate,
  isOpenFinanceProvider,
  parseOpenFinanceDate,
  type OpenFinanceConnection,
  type OpenFinancePluggyConnection,
  type OpenFinancePluggyInstitution,
  type OpenFinancePluggyStartConnectionResponse,
  type OpenFinancePolpConnection,
  type OpenFinancePolpInstitution,
  type OpenFinancePolpStartConnectionResponse,
  type OpenFinanceStartConnectionResponse,
} from "./open-finance-contract";

const PLUGGY_START_RESPONSE: OpenFinanceStartConnectionResponse = {
  provider: "pluggy",
  mode: "create",
  connectToken: "public-widget-token",
  expiresAt: null,
  itemId: null,
  includeSandbox: false,
  widget: { theme: "light", language: "pt" },
  openFinanceParameters: null,
};

const POLP_START_RESPONSE: OpenFinanceStartConnectionResponse = {
  provider: "polp",
  mode: "create",
  consentId: "consent-1",
  authorizationUrl: "https://authorization.example.test/consent-1",
  expiresAt: null,
};

function startTarget(response: OpenFinanceStartConnectionResponse) {
  if (response.provider === "pluggy") {
    expectTypeOf(response).toEqualTypeOf<OpenFinancePluggyStartConnectionResponse>();
    return response.connectToken;
  }

  expectTypeOf(response).toEqualTypeOf<OpenFinancePolpStartConnectionResponse>();
  return response.authorizationUrl;
}

function connectionInstitution(connection: OpenFinanceConnection) {
  if (connection.provider === "pluggy") {
    expectTypeOf(connection).toEqualTypeOf<OpenFinancePluggyConnection>();
    expectTypeOf(connection.institution).toEqualTypeOf<OpenFinancePluggyInstitution>();
    return connection.institution.connectorId;
  }

  expectTypeOf(connection).toEqualTypeOf<OpenFinancePolpConnection>();
  expectTypeOf(connection.institution).toEqualTypeOf<OpenFinancePolpInstitution>();
  return connection.institution.connectorId;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(?:js|jsx|ts|tsx)$/.test(entry.name) || /\.test\.[^.]+$/.test(entry.name)) return [];
    return [path];
  });
}

describe("Open Finance providers", () => {
  it("accepts only the supported Pluggy and Polp provider discriminants", () => {
    expect(isOpenFinanceProvider("pluggy")).toBe(true);
    expect(isOpenFinanceProvider("polp")).toBe(true);
    expect(isOpenFinanceProvider("other-provider")).toBe(false);
    expect(isOpenFinanceProvider(null)).toBe(false);
  });

  it("narrows provider-specific start-connection responses without casts", () => {
    expect(startTarget(PLUGGY_START_RESPONSE)).toBe("public-widget-token");
    expect(startTarget(POLP_START_RESPONSE)).toBe(
      "https://authorization.example.test/consent-1",
    );
  });

  it("pairs a connection provider with the matching institution type", () => {
    expectTypeOf(connectionInstitution).returns.toEqualTypeOf<number | null>();
  });
});

describe("Open Finance external transaction identity", () => {
  const baseIdentity = {
    provider: "pluggy" as const,
    internalConnectionId: "a1c5b907-33d4-4bcc-9584-d3b42e891cf0",
    externalConnectionId: "same-provider-id",
    externalAccountId: "same-account-id",
    externalTransactionId: "same-transaction-id",
  };

  it("isolates equal external IDs belonging to different providers", () => {
    const pluggyKey = buildOpenFinanceExternalTransactionIdentityKey(baseIdentity);
    const polpKey = buildOpenFinanceExternalTransactionIdentityKey({
      ...baseIdentity,
      provider: "polp",
    });

    expect(pluggyKey).not.toBe(polpKey);
  });

  it("isolates equal transaction IDs belonging to different connections and accounts", () => {
    const baseKey = buildOpenFinanceExternalTransactionIdentityKey(baseIdentity);
    const connectionKey = buildOpenFinanceExternalTransactionIdentityKey({
      ...baseIdentity,
      internalConnectionId: "c536f738-dbc1-4eb8-a988-0afe96d1bb72",
    });
    const accountKey = buildOpenFinanceExternalTransactionIdentityKey({
      ...baseIdentity,
      externalAccountId: "another-account",
    });

    expect(new Set([baseKey, connectionKey, accountKey]).size).toBe(3);
  });

  it("uses unambiguous length-prefixed serialization", () => {
    const first = buildOpenFinanceExternalTransactionIdentityKey({
      ...baseIdentity,
      externalAccountId: "ab",
      externalTransactionId: "c|d",
    });
    const second = buildOpenFinanceExternalTransactionIdentityKey({
      ...baseIdentity,
      externalAccountId: "ab|c",
      externalTransactionId: "d",
    });

    expect(first).not.toBe(second);
  });

  it("includes the provider context, date, and amount in the fingerprint", () => {
    const fingerprint = buildOpenFinanceTransactionFingerprint({
      ...baseIdentity,
      occurredOn: "2026-08-20",
      amountCents: 1099,
    });
    const otherAmount = buildOpenFinanceTransactionFingerprint({
      ...baseIdentity,
      occurredOn: "2026-08-20",
      amountCents: 1100,
    });
    const otherDate = buildOpenFinanceTransactionFingerprint({
      ...baseIdentity,
      occurredOn: "2026-08-21",
      amountCents: 1099,
    });
    const otherProvider = buildOpenFinanceTransactionFingerprint({
      ...baseIdentity,
      provider: "polp",
      occurredOn: "2026-08-20",
      amountCents: 1099,
    });

    expect(new Set([fingerprint, otherAmount, otherDate, otherProvider]).size).toBe(4);
  });
});

describe("Open Finance database dates", () => {
  it.each(["2024-02-29", "2026-08-20", "9999-12-31"])(
    "accepts the valid calendar date %s",
    (date) => {
      expect(isOpenFinanceDate(date)).toBe(true);
      expect(parseOpenFinanceDate(date)).toBe(date);
    },
  );

  it.each([
    "",
    "0000-01-01",
    "2025-02-29",
    "2026-00-10",
    "2026-13-10",
    "2026-04-31",
    "2026-8-20",
    "2026-08-20T00:00:00.000Z",
  ])("rejects the invalid database date %j", (date) => {
    expect(isOpenFinanceDate(date)).toBe(false);
    expect(() => parseOpenFinanceDate(date)).toThrow(RangeError);
  });

  it("rejects an invalid date and invalid cents before creating a fingerprint", () => {
    const identity = {
      provider: "pluggy" as const,
      internalConnectionId: "connection-1",
      externalConnectionId: "item-1",
      externalAccountId: "account-1",
      externalTransactionId: "transaction-1",
    };

    expect(() => buildOpenFinanceTransactionFingerprint({
      ...identity,
      occurredOn: "2026-02-30",
      amountCents: 100,
    })).toThrow(RangeError);
    expect(() => buildOpenFinanceTransactionFingerprint({
      ...identity,
      occurredOn: "2026-02-28",
      amountCents: 10.5,
    })).toThrow(RangeError);
    expect(() => buildOpenFinanceTransactionFingerprint({
      ...identity,
      occurredOn: "2026-02-28",
      amountCents: 0,
    })).toThrow(RangeError);
  });
});

describe("Open Finance frontend boundary", () => {
  it("does not reference provider credentials from production mobile source", () => {
    const forbiddenCredentialNames = [
      ["POLP", "API", "CLIENT"].join("_"),
      ["POLP", "API", "SECRET"].join("_"),
      ["POLP", "WEBHOOK", "SECRET"].join("_"),
      ["PLUGGY", "CLIENT", "ID"].join("_"),
      ["PLUGGY", "CLIENT", "SECRET"].join("_"),
    ];
    const frontendFiles = [
      ...sourceFiles(resolve(process.cwd(), "app")),
      ...sourceFiles(resolve(process.cwd(), "src")),
      resolve(process.cwd(), "app.json"),
      resolve(process.cwd(), "babel.config.js"),
    ];

    const leaks = frontendFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbiddenCredentialNames
        .filter((credentialName) => source.includes(credentialName))
        .map((credentialName) => ({ file, credentialName }));
    });

    expect(leaks).toEqual([]);
  });
});
