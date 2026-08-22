import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  OpenFinanceGetConsentResponse,
  OpenFinancePolpConsentStatus,
  OpenFinancePolpStartConnectionResponse,
} from "./open-finance-contract";
import {
  POLP_AUTHORIZATION_POLL_DELAYS_MS,
  createOpenFinancePolpAuthorizationController,
  interpretPolpConsentStatus,
  requireHttpsAuthorizationUrl,
  shouldCheckConsentOnAppState,
} from "./open-finance-polp-authorization";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";
const START: OpenFinancePolpStartConnectionResponse = {
  provider: "polp",
  mode: "create",
  consentId: "consent-1",
  authorizationUrl: "https://authorization.example.test/consent-1",
  expiresAt: null,
  connectionId: "a30e8400-e29b-41d4-a716-446655440030",
};

function consent(overrides: Partial<OpenFinancePolpConsentStatus> = {}): OpenFinancePolpConsentStatus {
  return {
    provider: "polp",
    consentId: "consent-1",
    connectionId: START.connectionId ?? null,
    status: "active",
    providerStatus: "AWAITING_AUTHORIZATION",
    executionStatus: null,
    resourcesReady: false,
    flags: [],
    hasProviderError: false,
    authorizationUrl: START.authorizationUrl,
    authorizationExpiresAt: null,
    expiresAt: null,
    products: ["ACCOUNT"],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createHarness() {
  const startConnection = vi.fn(async () => START);
  const getConsent = vi.fn(async (): Promise<OpenFinanceGetConsentResponse> => ({ consent: consent() }));
  const openUrl = vi.fn(async () => undefined);
  const completeConnection = vi.fn();
  const syncMonth = vi.fn();
  const controller = createOpenFinancePolpAuthorizationController({
    startConnection,
    getConsent,
    openUrl,
    sleep: async () => undefined,
  });
  return { controller, startConnection, getConsent, openUrl, completeConnection, syncMonth };
}

describe("Polp authorization URL and consent interpretation", () => {
  it("accepts only the original https authorization URL", () => {
    expect(requireHttpsAuthorizationUrl(START.authorizationUrl)).toBe(START.authorizationUrl);
    expect(() => requireHttpsAuthorizationUrl("")).toThrow(TypeError);
    expect(() => requireHttpsAuthorizationUrl("javascript:alert(1)")).toThrow(TypeError);
    expect(() => requireHttpsAuthorizationUrl("http://authorization.example.test/consent-1")).toThrow(TypeError);
    expect(() => requireHttpsAuthorizationUrl("file:///tmp/auth")).toThrow(TypeError);
  });

  it("uses Edge resourcesReady and hasProviderError without duplicating execution rules", () => {
    expect(interpretPolpConsentStatus(consent({
      providerStatus: "AUTHORISED",
      executionStatus: "SUCCESS",
      resourcesReady: true,
    }))).toBe("ready");
    expect(interpretPolpConsentStatus(consent({
      providerStatus: "AUTHORISED",
      executionStatus: "AWAITING_RESOURCES",
      resourcesReady: false,
    }))).toBe("pending");
    expect(interpretPolpConsentStatus(consent({ providerStatus: "REJECTED" }))).toBe("rejected");
    expect(interpretPolpConsentStatus(consent({ providerStatus: "EXPIRED" }))).toBe("expired");
    expect(interpretPolpConsentStatus(consent({ hasProviderError: true }))).toBe("provider_error");
  });
});

describe("Polp authorization start", () => {
  it("starts once, opens the returned URL, and ignores a second click", async () => {
    const { controller, startConnection, openUrl } = createHarness();
    const first = controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    const second = controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    await Promise.all([first, second]);
    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(START.authorizationUrl);
    expect(controller.snapshot.phase).toBe("awaiting_authorization");
  });

  it("does not open a browser when start fails", async () => {
    const { controller, startConnection, openUrl } = createHarness();
    startConnection.mockRejectedValueOnce(new Error("network"));
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(controller.snapshot.phase).toBe("error");
    expect(controller.snapshot.hasConsent).toBe(false);
    expect(controller.snapshot.canStart).toBe(true);
  });

  it("does not open a non-https URL and keeps no reusable authorization", async () => {
    const { controller, startConnection, openUrl } = createHarness();
    startConnection.mockResolvedValueOnce({
      ...START,
      authorizationUrl: "javascript:alert(1)",
    });
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(controller.snapshot.hasConsent).toBe(false);
    expect(controller.snapshot.phase).toBe("error");
  });

  it("keeps the same consent when opening the URL fails", async () => {
    const { controller, startConnection, openUrl } = createHarness();
    openUrl.mockRejectedValueOnce(new Error("blocked"));
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("awaiting_authorization");
    expect(controller.snapshot.hasConsent).toBe(true);
    expect(controller.snapshot.canOpenAuthorization).toBe(true);

    openUrl.mockResolvedValueOnce(undefined);
    await controller.openAuthorization();
    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(openUrl).toHaveBeenLastCalledWith(START.authorizationUrl);
  });

  it("does not start a second poll while one check is in flight", async () => {
    const deferred = createDeferred<OpenFinanceGetConsentResponse>();
    const { controller, getConsent, startConnection } = createHarness();
    getConsent.mockReturnValue(deferred.promise);
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    const first = controller.checkAgain();
    const second = controller.checkAgain();
    await Promise.resolve();
    await Promise.resolve();
    expect(getConsent).toHaveBeenCalledTimes(1);
    deferred.resolve({ consent: consent({
      providerStatus: "AUTHORISED",
      executionStatus: "SUCCESS",
      resourcesReady: true,
    }) });
    await Promise.all([first, second]);
    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("ready_to_complete");
  });
});

describe("Polp authorization AppState and polling", () => {
  it("checks once on background to active and ignores a repeated active event", async () => {
    const deferred = createDeferred<OpenFinanceGetConsentResponse>();
    const { controller, getConsent } = createHarness();
    getConsent.mockReturnValueOnce(deferred.promise);
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    expect(controller.snapshot.phase).toBe("awaiting_authorization");

    controller.handleAppState("background");
    const pending = controller.handleAppState("active");
    controller.handleAppState("active");
    await Promise.resolve();
    await Promise.resolve();
    expect(getConsent).toHaveBeenCalledTimes(1);
    expect(getConsent).toHaveBeenCalledWith({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      consentId: "consent-1",
    });

    deferred.resolve({ consent: consent({
      providerStatus: "AUTHORISED",
      executionStatus: "SUCCESS",
      resourcesReady: true,
    }) });
    await pending;
    expect(controller.snapshot.phase).toBe("ready_to_complete");
    expect(shouldCheckConsentOnAppState({
      previous: "background",
      next: "active",
      phase: "awaiting_authorization",
      hasConsent: true,
      checking: false,
    })).toBe(true);
    expect(shouldCheckConsentOnAppState({
      previous: "active",
      next: "active",
      phase: "awaiting_authorization",
      hasConsent: true,
      checking: false,
    })).toBe(false);
  });

  it("continues while awaiting authorization or resources, then times out without a new start", async () => {
    const { controller, startConnection, getConsent } = createHarness();
    getConsent
      .mockResolvedValueOnce({ consent: consent() })
      .mockResolvedValueOnce({ consent: consent({
        providerStatus: "AUTHORISED",
        executionStatus: "AWAITING_RESOURCES",
        resourcesReady: false,
      }) })
      .mockResolvedValue({ consent: consent() });
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    await controller.checkAgain();
    expect(getConsent).toHaveBeenCalledTimes(POLP_AUTHORIZATION_POLL_DELAYS_MS.length);
    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("timed_out");
    expect(controller.snapshot.canCheckAgain).toBe(true);
    expect(controller.snapshot.hasConsent).toBe(true);
  });

  it("keeps timed out passive on AppState and retries only through checkAgain", async () => {
    const { controller, startConnection, getConsent, openUrl } = createHarness();
    getConsent.mockResolvedValue({ consent: consent() });
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    await controller.checkAgain();
    expect(controller.snapshot.phase).toBe("timed_out");

    getConsent.mockClear();
    controller.handleAppState("background");
    const appStateResult = controller.handleAppState("active");
    await appStateResult;
    await Promise.resolve();
    expect(getConsent).not.toHaveBeenCalled();
    expect(startConnection).toHaveBeenCalledTimes(1);

    getConsent.mockResolvedValueOnce({ consent: consent({
      providerStatus: "AUTHORISED",
      executionStatus: "SUCCESS",
      resourcesReady: true,
    }) });
    await controller.checkAgain();
    expect(getConsent).toHaveBeenCalledTimes(1);
    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("ready_to_complete");
  });

  it("stops on rejected, expired and provider error", async () => {
    for (const [overrides, phase] of [
      [{ providerStatus: "REJECTED" as const }, "rejected"],
      [{ providerStatus: "EXPIRED" as const }, "expired"],
      [{ hasProviderError: true }, "provider_error"],
    ] as const) {
      const { controller, startConnection, getConsent } = createHarness();
      getConsent.mockResolvedValueOnce({ consent: consent(overrides) });
      await controller.start({
        householdId: HOUSEHOLD_ID,
        institutionId: "institution-1",
        cpf: "12345678901",
      });
      await controller.checkAgain();
      expect(controller.snapshot.phase).toBe(phase);
      expect(startConnection).toHaveBeenCalledTimes(1);
      expect(getConsent).toHaveBeenCalledTimes(1);
      expect(controller.snapshot.canStart).toBe(false);
    }
  });

  it("starts a new GET round from Verificar novamente without a new POST", async () => {
    const { controller, startConnection, getConsent } = createHarness();
    getConsent.mockResolvedValue({ consent: consent() });
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    await controller.checkAgain();
    expect(controller.snapshot.phase).toBe("timed_out");
    getConsent.mockClear();
    getConsent.mockResolvedValueOnce({ consent: consent({
      providerStatus: "AUTHORISED",
      executionStatus: "PARTIAL_SUCCESS",
      resourcesReady: true,
    }) });
    await controller.checkAgain();
    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(getConsent).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("ready_to_complete");
  });
});

describe("Polp authorization lifecycle and boundary", () => {
  it("cancels polling on dispose and does not emit afterwards", async () => {
    const deferred = createDeferred<OpenFinanceGetConsentResponse>();
    const { controller, getConsent } = createHarness();
    getConsent.mockReturnValueOnce(deferred.promise);
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.start({
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpf: "12345678901",
    });
    const pending = controller.checkAgain();
    listener.mockClear();
    controller.dispose();
    deferred.resolve({ consent: consent({
      providerStatus: "AUTHORISED",
      resourcesReady: true,
      executionStatus: "SUCCESS",
    }) });
    await pending;
    expect(listener).not.toHaveBeenCalled();
  });

  it("never calls complete or sync and keeps secrets out of the source", () => {
    const { completeConnection, syncMonth } = createHarness();
    expect(completeConnection).not.toHaveBeenCalled();
    expect(syncMonth).not.toHaveBeenCalled();
    const files = [
      resolve(process.cwd(), "src/lib/open-finance-polp-authorization.ts"),
      resolve(process.cwd(), "src/hooks/useOpenFinancePolpAuthorization.ts"),
      resolve(process.cwd(), "app/(app)/open-finance-connect.tsx"),
    ];
    const forbidden = [
      "completeOpenFinanceConnection",
      "syncOpenFinanceMonth",
      "AsyncStorage",
      "SecureStore",
      "console.log",
      "console.error",
      ["POLP", "API", "SECRET"].join("_"),
      ["POLP", "API", "CLIENT"].join("_"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(forbidden.filter((name) => source.includes(name))).toEqual([]);
    }
  });
});
