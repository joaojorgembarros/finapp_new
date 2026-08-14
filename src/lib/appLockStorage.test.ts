import { describe, expect, it, vi } from "vitest";
import { createAppLockStorage, type AppLockKeyValueStore } from "./appLockStorageCore";
import {
  APP_LOCK_CONFIG_VERSION,
  createDefaultAppLockConfig,
  PIN_ATTEMPT_STATE_VERSION,
} from "./appLockPolicy";
import { PIN_SCRYPT_PARAMS, type PinVerifierRecord } from "./pinSecurity";

vi.mock("expo-crypto", () => ({ getRandomBytesAsync: vi.fn() }));

function memoryStore() {
  const data = new Map<string, string>();
  const store: AppLockKeyValueStore = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    deleteItem: async (key) => {
      data.delete(key);
    },
  };
  return { data, store };
}

const pinRecord: PinVerifierRecord = {
  version: 1,
  algorithm: "scrypt",
  saltHex: "00112233445566778899aabbccddeeff",
  verifierHex: "aa".repeat(32),
  params: { ...PIN_SCRYPT_PARAMS },
};

const emptyAttempts = {
  version: PIN_ATTEMPT_STATE_VERSION,
  failedAttempts: 0,
  cooldownUntilMs: null,
} as const;

describe("appLockStorage", () => {
  it("starts disabled for an account without stored settings", async () => {
    const memory = memoryStore();
    const storage = createAppLockStorage(memory.store);

    await expect(storage.load("user-a")).resolves.toEqual({
      config: createDefaultAppLockConfig(),
      pin: null,
      attempts: emptyAttempts,
    });
  });

  it("keeps PIN, settings and cooldown isolated by user", async () => {
    const memory = memoryStore();
    const storage = createAppLockStorage(memory.store);
    await storage.savePin("user-a", pinRecord);
    await storage.saveConfig("user-a", {
      version: APP_LOCK_CONFIG_VERSION,
      enabled: true,
      biometricEnabled: false,
      pinConfigured: true,
      timeoutMs: 300_000,
    });
    await storage.saveAttempts("user-a", {
      version: PIN_ATTEMPT_STATE_VERSION,
      failedAttempts: 5,
      cooldownUntilMs: 123_000,
    });

    expect((await storage.load("user-a")).pin).toEqual(pinRecord);
    await expect(storage.load("user-b")).resolves.toEqual({
      config: createDefaultAppLockConfig(),
      pin: null,
      attempts: emptyAttempts,
    });
  });

  it("removes only the account that signs out", async () => {
    const memory = memoryStore();
    const storage = createAppLockStorage(memory.store);
    await storage.savePin("user-a", pinRecord);
    await storage.savePin("user-b", pinRecord);
    const configured = {
      version: APP_LOCK_CONFIG_VERSION,
      enabled: true,
      biometricEnabled: false,
      pinConfigured: true,
      timeoutMs: 60_000,
    } as const;
    await storage.saveConfig("user-a", configured);
    await storage.saveConfig("user-b", configured);

    await storage.clearUser("user-a");

    expect((await storage.load("user-a")).pin).toBeNull();
    expect((await storage.load("user-b")).pin).toEqual(pinRecord);
  });

  it("rejects an invalid enabled configuration before storing it", async () => {
    const memory = memoryStore();
    const storage = createAppLockStorage(memory.store);

    await expect(storage.saveConfig("user-a", {
      version: APP_LOCK_CONFIG_VERSION,
      enabled: true,
      biometricEnabled: false,
      pinConfigured: false,
      timeoutMs: 60_000,
    })).rejects.toThrow("Invalid App Lock settings");
  });

  it("rejects corrupted records instead of silently disabling protection", async () => {
    const memory = memoryStore();
    const storage = createAppLockStorage(memory.store);
    memory.data.set("sonharplus.app-lock.v1.user-a.config", "{bad-json");

    await expect(storage.load("user-a")).rejects.toThrow();
  });

  it("never stores the plain PIN", async () => {
    const memory = memoryStore();
    const storage = createAppLockStorage(memory.store);
    await storage.savePin("user-a", pinRecord);

    expect([...memory.data.values()].join(" ")).not.toContain("123456");
  });
});
