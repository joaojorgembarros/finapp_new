import {
  createDefaultAppLockConfig,
  createEmptyPinAttemptState,
  isAppLockConfig,
  isPinAttemptState,
  type AppLockConfig,
  type PinAttemptState,
} from "./appLockPolicy";
import { isPinVerifierRecord, type PinVerifierRecord } from "./pinSecurity";

export type AppLockSnapshot = {
  config: AppLockConfig;
  pin: PinVerifierRecord | null;
  attempts: PinAttemptState;
};

export type AppLockKeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

function safeUserId(userId: string) {
  const normalized = userId.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!normalized) throw new Error("A user id is required for App Lock storage.");
  return normalized;
}

export function appLockStorageKeys(userId: string) {
  const prefix = `sonharplus.app-lock.v1.${safeUserId(userId)}`;
  return {
    config: `${prefix}.config`,
    pin: `${prefix}.pin`,
    attempts: `${prefix}.attempts`,
  } as const;
}

function parseConfig(value: string | null): AppLockConfig {
  if (value === null) return createDefaultAppLockConfig();
  const parsed: unknown = JSON.parse(value);
  if (!isAppLockConfig(parsed)) throw new Error("Invalid App Lock settings.");
  return parsed;
}

function parsePin(value: string | null): PinVerifierRecord | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!isPinVerifierRecord(parsed)) throw new Error("Invalid PIN verifier.");
  return parsed;
}

function parseAttempts(value: string | null): PinAttemptState {
  if (value === null) return createEmptyPinAttemptState();
  const parsed: unknown = JSON.parse(value);
  if (!isPinAttemptState(parsed)) throw new Error("Invalid PIN attempt state.");
  return parsed;
}

export function createAppLockStorage(store: AppLockKeyValueStore) {
  return {
    async load(userId: string): Promise<AppLockSnapshot> {
      const keys = appLockStorageKeys(userId);
      const [configValue, pinValue, attemptsValue] = await Promise.all([
        store.getItem(keys.config),
        store.getItem(keys.pin),
        store.getItem(keys.attempts),
      ]);

      const config = parseConfig(configValue);
      const pin = parsePin(pinValue);
      const attempts = parseAttempts(attemptsValue);
      if (config.pinConfigured !== Boolean(pin)) {
        throw new Error("App Lock PIN configuration is inconsistent.");
      }
      if (config.enabled && !config.biometricEnabled && !pin) {
        throw new Error("App Lock is enabled without an authentication method.");
      }
      return { config, pin, attempts };
    },

    async saveConfig(userId: string, config: AppLockConfig) {
      if (!isAppLockConfig(config)) throw new Error("Invalid App Lock settings.");
      await store.setItem(appLockStorageKeys(userId).config, JSON.stringify(config));
    },

    async savePin(userId: string, pin: PinVerifierRecord) {
      if (!isPinVerifierRecord(pin)) throw new Error("A valid PIN verifier is required.");
      await store.setItem(appLockStorageKeys(userId).pin, JSON.stringify(pin));
    },

    async removePin(userId: string) {
      const keys = appLockStorageKeys(userId);
      await Promise.all([store.deleteItem(keys.pin), store.deleteItem(keys.attempts)]);
    },

    async saveAttempts(userId: string, attempts: PinAttemptState) {
      if (!isPinAttemptState(attempts)) throw new Error("Invalid PIN attempt state.");
      await store.setItem(appLockStorageKeys(userId).attempts, JSON.stringify(attempts));
    },

    async clearAttempts(userId: string) {
      await store.deleteItem(appLockStorageKeys(userId).attempts);
    },

    async clearUser(userId: string) {
      const keys = appLockStorageKeys(userId);
      await Promise.all(Object.values(keys).map((key) => store.deleteItem(key)));
    },
  };
}

