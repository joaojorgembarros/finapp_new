import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  OpenFinancePolpStartError,
  createOpenFinancePolpStartController,
  createOpenFinancePolpStartGate,
  loadOpenFinancePolpInstitutions,
  normalizeOptionalPolpCnpj,
  normalizePolpCpf,
  startOpenFinancePolpConnection,
} from "./open-finance-polp-start";
import type {
  OpenFinancePolpInstitutionListItem,
  OpenFinancePolpStartConnectionResponse,
} from "./open-finance-contract";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";

const INSTITUTION: OpenFinancePolpInstitutionListItem = {
  id: "institution-1",
  name: "Banco Exemplo",
  displayName: "Banco Exemplo",
  provider: "polp",
  connectorId: null,
  description: null,
  logoUrl: "https://cdn.example.test/logo.png",
  status: "OPERATIONAL",
  type: "PERSONAL",
  credentials: ["cpf"],
};

const START_RESPONSE: OpenFinancePolpStartConnectionResponse = {
  provider: "polp",
  mode: "create",
  consentId: "consent-1",
  authorizationUrl: "https://authorization.example.test/consent-1",
  expiresAt: null,
  connectionId: "a30e8400-e29b-41d4-a716-446655440030",
};

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("Polp document normalization", () => {
  it("normalizes a masked CPF and rejects invalid values before the client", () => {
    expect(normalizePolpCpf("123.456.789-01")).toBe("12345678901");
    expect(() => normalizePolpCpf("")).toThrow(OpenFinancePolpStartError);
    expect(() => normalizePolpCpf("123")).toThrow(OpenFinancePolpStartError);
    expect(() => normalizePolpCpf("abcdefghijk")).toThrow(OpenFinancePolpStartError);
    try {
      normalizePolpCpf("123.456.789-01x");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenFinancePolpStartError);
      expect(String(error)).not.toContain("12345678901");
      expect(String(error)).not.toContain("123.456.789-01");
    }
  });

  it("accepts an optional CNPJ only after 14 digits", () => {
    expect(normalizeOptionalPolpCnpj(undefined)).toBeUndefined();
    expect(normalizeOptionalPolpCnpj("12.345.678/0001-90")).toBe("12345678000190");
    expect(() => normalizeOptionalPolpCnpj("123")).toThrow(OpenFinancePolpStartError);
  });
});

describe("Polp institutions", () => {
  it("loads institutions only through the Polp operation", async () => {
    const listInstitutions = vi.fn(async (input: { provider: "polp" }) => {
      expect(input).toEqual({ provider: "polp" });
      return { institutions: [INSTITUTION] };
    });
    const institutions = await loadOpenFinancePolpInstitutions({ listInstitutions });
    expect(listInstitutions).toHaveBeenCalledTimes(1);
    expect(listInstitutions).toHaveBeenCalledWith({ provider: "polp" });
    expect(institutions).toEqual([INSTITUTION]);
  });

  it("does not accept a Pluggy institutions call", async () => {
    const listInstitutions = vi.fn(async (input: { provider: "polp" }) => {
      if ((input as { provider: string }).provider !== "polp") {
        throw new Error("Pluggy institutions are not supported.");
      }
      return { institutions: [INSTITUTION] };
    });
    await loadOpenFinancePolpInstitutions({ listInstitutions });
    expect(listInstitutions.mock.calls[0]?.[0].provider).toBe("polp");
  });

  it("surfaces a safe error when institutions fail", async () => {
    const listInstitutions = vi.fn(async () => {
      throw new Error("upstream unavailable");
    });
    await expect(loadOpenFinancePolpInstitutions({ listInstitutions })).rejects.toMatchObject({
      code: "INSTITUTIONS_FAILED",
    });
  });

  it("reloads institutions only when asked again", async () => {
    const listInstitutions = vi.fn(async () => ({ institutions: [INSTITUTION] }));
    const controller = createOpenFinancePolpStartController({
      listInstitutions,
      startConnection: vi.fn(),
    });
    await controller.loadInstitutions();
    await controller.loadInstitutions();
    expect(listInstitutions).toHaveBeenCalledTimes(2);
  });
});

describe("Polp start connection", () => {
  it("blocks start without an authenticated household before calling the client", async () => {
    const startConnection = vi.fn();
    await expect(startOpenFinancePolpConnection({
      householdId: null,
      institutionId: "institution-1",
      cpf: "12345678901",
    }, { startConnection })).rejects.toMatchObject({ code: "MISSING_HOUSEHOLD" });
    expect(startConnection).not.toHaveBeenCalled();
  });

  it("blocks start without an institution before calling the client", async () => {
    const startConnection = vi.fn();
    await expect(startOpenFinancePolpConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: "   ",
      cpf: "12345678901",
    }, { startConnection })).rejects.toMatchObject({ code: "INVALID_INSTITUTION" });
    expect(startConnection).not.toHaveBeenCalled();
  });

  it("blocks an invalid CPF before calling the client", async () => {
    const startConnection = vi.fn();
    await expect(startOpenFinancePolpConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "123",
    }, { startConnection })).rejects.toMatchObject({ code: "INVALID_CPF" });
    expect(startConnection).not.toHaveBeenCalled();
  });

  it("sends the normalized Polp create request and returns the typed start payload", async () => {
    const startConnection = vi.fn(async () => START_RESPONSE);
    const response = await startOpenFinancePolpConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: " institution-1 ",
      cpf: "123.456.789-01",
      cnpj: "12.345.678/0001-90",
      products: ["ACCOUNT"],
    }, { startConnection });

    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(startConnection).toHaveBeenCalledWith({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
      cnpj: "12345678000190",
      products: ["ACCOUNT"],
    });
    expect(response).toEqual({
      provider: "polp",
      mode: "create",
      consentId: "consent-1",
      authorizationUrl: "https://authorization.example.test/consent-1",
      expiresAt: null,
      connectionId: START_RESPONSE.connectionId,
    });
  });

  it("blocks a second concurrent start and does not retry a failed POST", async () => {
    const deferred = createDeferred<OpenFinancePolpStartConnectionResponse>();
    const startConnection = vi.fn(async () => deferred.promise);
    const gate = createOpenFinancePolpStartGate();
    const first = startOpenFinancePolpConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    }, { startConnection }, gate);
    const second = startOpenFinancePolpConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    }, { startConnection }, gate);

    await expect(second).rejects.toMatchObject({ code: "START_IN_PROGRESS" });
    expect(startConnection).toHaveBeenCalledTimes(1);
    deferred.resolve(START_RESPONSE);
    await expect(first).resolves.toEqual(START_RESPONSE);
  });

  it("does not automatically retry a failed POST and releases the gate for an explicit retry", async () => {
    const startConnection = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(START_RESPONSE);
    const controller = createOpenFinancePolpStartController({
      listInstitutions: vi.fn(),
      startConnection,
    });

    await expect(controller.startConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    })).rejects.toMatchObject({ code: "START_FAILED" });
    expect(controller.starting).toBe(false);
    expect(startConnection).toHaveBeenCalledTimes(1);

    await expect(controller.startConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    })).resolves.toEqual(START_RESPONSE);
    expect(startConnection).toHaveBeenCalledTimes(2);
  });

  it("does not mention the CPF in start errors", async () => {
    const startConnection = vi.fn(async () => {
      throw new Error("rejected");
    });
    await expect(startOpenFinancePolpConnection({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    }, { startConnection })).rejects.toSatisfy((error: unknown) => {
      const text = String(error);
      return !text.includes("12345678901") && !text.includes("123.456.789-01");
    });
  });
});

describe("Polp start source boundary", () => {
  it("does not open URLs, persist documents, or call later Open Finance steps", () => {
    const files = [
      resolve(process.cwd(), "src/lib/open-finance-polp-start.ts"),
      resolve(process.cwd(), "src/hooks/useOpenFinancePolpStart.ts"),
    ];
    const forbidden = [
      "Linking.openURL",
      "complete-connection",
      "completeOpenFinanceConnection",
      "sync-month",
      "syncOpenFinanceMonth",
      "AsyncStorage",
      "SecureStore",
      "console.log",
      ["POLP", "API", "CLIENT"].join("_"),
      ["POLP", "API", "SECRET"].join("_"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(forbidden.filter((name) => source.includes(name))).toEqual([]);
    }
  });
});
