import { describe, expect, it } from "vitest";
import {
  APP_LOCK_CONFIG_VERSION,
  APP_LOCK_TIMEOUT_OPTIONS,
  DEFAULT_APP_LOCK_TIMEOUT_MS,
  PIN_ATTEMPT_STATE_VERSION,
  canAttemptPin,
  createDefaultAppLockConfig,
  createEmptyPinAttemptState,
  getBackgroundLockDecision,
  getColdStartLockDecision,
  getPinCooldownDurationMs,
  getPinCooldownRemainingMs,
  isAppLockConfig,
  isAppLockTimeoutMs,
  isPinAttemptState,
  recordFailedPinAttempt,
  resetPinAttemptState,
  shouldLockAfterBackground,
  shouldLockOnColdStart,
  type AppLockConfig,
} from "./appLockPolicy";

function enabledConfig(timeoutMs: AppLockConfig["timeoutMs"] = DEFAULT_APP_LOCK_TIMEOUT_MS): AppLockConfig {
  return {
    version: APP_LOCK_CONFIG_VERSION,
    enabled: true,
    biometricEnabled: false,
    pinConfigured: true,
    timeoutMs,
  };
}

describe("App Lock configuration", () => {
  it("uses one minute as the default", () => {
    expect(createDefaultAppLockConfig()).toEqual({
      version: 1,
      enabled: false,
      biometricEnabled: false,
      pinConfigured: false,
      timeoutMs: 60_000,
    });
  });

  it("accepts only the four supported timeout values", () => {
    expect(APP_LOCK_TIMEOUT_OPTIONS.map(({ value }) => value)).toEqual([
      0,
      60_000,
      300_000,
      900_000,
    ]);
    for (const { value } of APP_LOCK_TIMEOUT_OPTIONS) {
      expect(isAppLockTimeoutMs(value)).toBe(true);
    }
    expect(isAppLockTimeoutMs(30_000)).toBe(false);
    expect(isAppLockTimeoutMs("60000")).toBe(false);
  });

  it("requires a supported version, timeout and unlock method when enabled", () => {
    expect(isAppLockConfig(createDefaultAppLockConfig())).toBe(true);
    expect(isAppLockConfig(enabledConfig())).toBe(true);
    expect(isAppLockConfig({ ...enabledConfig(), pinConfigured: false, biometricEnabled: true })).toBe(true);
    expect(isAppLockConfig({ ...enabledConfig(), pinConfigured: false })).toBe(false);
    expect(isAppLockConfig({ ...enabledConfig(), timeoutMs: 30_000 })).toBe(false);
    expect(isAppLockConfig({ ...enabledConfig(), version: 2 })).toBe(false);
  });
});

describe("cold-start decisions", () => {
  it("always locks an enabled configuration when a session is restored", () => {
    expect(getColdStartLockDecision({ hasSession: true, config: enabledConfig() })).toBe("lock");
    expect(shouldLockOnColdStart({ hasSession: true, config: enabledConfig() })).toBe(true);
  });

  it("allows unauthenticated, absent or disabled configurations", () => {
    expect(getColdStartLockDecision({ hasSession: false, config: { corrupt: true } })).toBe("allow");
    expect(getColdStartLockDecision({ hasSession: true, config: null })).toBe("allow");
    expect(getColdStartLockDecision({ hasSession: true, config: undefined })).toBe("allow");
    expect(getColdStartLockDecision({ hasSession: true, config: createDefaultAppLockConfig() })).toBe("allow");
  });

  it("fails closed into recovery for a stored malformed configuration", () => {
    expect(getColdStartLockDecision({ hasSession: true, config: { enabled: true } })).toBe("recover");
    expect(shouldLockOnColdStart({ hasSession: true, config: { enabled: true } })).toBe(true);
  });
});

describe("background timeout decisions", () => {
  it.each([
    [0, 0, true],
    [60_000, 59_999, false],
    [60_000, 60_000, true],
    [300_000, 299_999, false],
    [300_000, 300_000, true],
    [900_000, 899_999, false],
    [900_000, 900_000, true],
  ] as const)("handles timeout %i at elapsed %i", (timeoutMs, elapsedMs, expected) => {
    expect(shouldLockAfterBackground({
      config: enabledConfig(timeoutMs),
      backgroundedAtMs: 1_000,
      nowMs: 1_000 + elapsedMs,
    })).toBe(expected);
  });

  it("locks safely when the timestamp is missing, invalid or in the future", () => {
    const config = enabledConfig();
    expect(getBackgroundLockDecision({ config, backgroundedAtMs: null, nowMs: 10_000 })).toBe("lock");
    expect(getBackgroundLockDecision({ config, backgroundedAtMs: 20_000, nowMs: 10_000 })).toBe("lock");
    expect(getBackgroundLockDecision({ config, backgroundedAtMs: 1_000, nowMs: Number.NaN })).toBe("lock");
  });

  it("allows a disabled or absent configuration and recovers from a malformed one", () => {
    expect(getBackgroundLockDecision({
      config: createDefaultAppLockConfig(),
      backgroundedAtMs: null,
      nowMs: 1_000,
    })).toBe("allow");
    expect(getBackgroundLockDecision({ config: null, backgroundedAtMs: null, nowMs: 1_000 })).toBe("allow");
    expect(getBackgroundLockDecision({ config: { enabled: true }, backgroundedAtMs: 0, nowMs: 1_000 })).toBe("recover");
  });
});

describe("PIN attempt cooldown", () => {
  it("starts empty and remains JSON-persistable", () => {
    const state = createEmptyPinAttemptState();
    expect(state).toEqual({ version: 1, failedAttempts: 0, cooldownUntilMs: null });
    expect(isPinAttemptState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });

  it.each([
    [0, 0],
    [4, 0],
    [5, 30_000],
    [7, 30_000],
    [8, 60_000],
    [9, 60_000],
    [10, 300_000],
    [11, 300_000],
    [12, 900_000],
    [50, 900_000],
  ])("maps %i failures to %i ms", (failures, durationMs) => {
    expect(getPinCooldownDurationMs(failures)).toBe(durationMs);
  });

  it("applies the first cooldown on the fifth failure", () => {
    let state = createEmptyPinAttemptState();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      state = recordFailedPinAttempt(state, 1_000);
    }

    expect(state).toEqual({
      version: PIN_ATTEMPT_STATE_VERSION,
      failedAttempts: 5,
      cooldownUntilMs: 31_000,
    });
    expect(canAttemptPin(state, 30_999)).toBe(false);
    expect(getPinCooldownRemainingMs(state, 30_999)).toBe(1);
    expect(canAttemptPin(state, 31_000)).toBe(true);
  });

  it("does not count rapid submissions while a cooldown is active", () => {
    const blocked = {
      version: PIN_ATTEMPT_STATE_VERSION,
      failedAttempts: 5,
      cooldownUntilMs: 31_000,
    };
    expect(recordFailedPinAttempt(blocked, 2_000)).toEqual(blocked);
  });

  it("progresses through longer cooldown tiers after each period ends", () => {
    let state = createEmptyPinAttemptState();
    let nowMs = 1_000;

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      if (!canAttemptPin(state, nowMs)) nowMs = state.cooldownUntilMs ?? nowMs;
      state = recordFailedPinAttempt(state, nowMs);
    }

    expect(state.failedAttempts).toBe(12);
    expect(state.cooldownUntilMs).toBe(nowMs + 900_000);
  });

  it("preserves cooldown after serialization and resets only on success", () => {
    const persisted = JSON.parse(JSON.stringify({
      version: PIN_ATTEMPT_STATE_VERSION,
      failedAttempts: 8,
      cooldownUntilMs: 70_000,
    }));
    expect(isPinAttemptState(persisted)).toBe(true);
    expect(getPinCooldownRemainingMs(persisted, 10_000)).toBe(60_000);
    expect(resetPinAttemptState()).toEqual(createEmptyPinAttemptState());
  });

  it("rejects corrupted attempt state and invalid time values", () => {
    expect(isPinAttemptState({ version: 1, failedAttempts: -1, cooldownUntilMs: null })).toBe(false);
    expect(isPinAttemptState({ version: 2, failedAttempts: 0, cooldownUntilMs: null })).toBe(false);
    expect(() => recordFailedPinAttempt({
      version: PIN_ATTEMPT_STATE_VERSION,
      failedAttempts: -1,
      cooldownUntilMs: null,
    }, 1_000)).toThrow("inválido");
    expect(() => getPinCooldownDurationMs(-1)).toThrow("inválida");
  });
});
