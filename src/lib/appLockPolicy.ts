export const APP_LOCK_CONFIG_VERSION = 1 as const;
export const PIN_ATTEMPT_STATE_VERSION = 1 as const;

export const APP_LOCK_TIMEOUT_OPTIONS = [
  { value: 0, label: "Imediatamente" },
  { value: 60_000, label: "Após 1 minuto" },
  { value: 5 * 60_000, label: "Após 5 minutos" },
  { value: 15 * 60_000, label: "Após 15 minutos" },
] as const;

export type AppLockTimeoutMs = typeof APP_LOCK_TIMEOUT_OPTIONS[number]["value"];
export const DEFAULT_APP_LOCK_TIMEOUT_MS: AppLockTimeoutMs = 60_000;

export type AppLockConfig = {
  version: typeof APP_LOCK_CONFIG_VERSION;
  enabled: boolean;
  biometricEnabled: boolean;
  pinConfigured: boolean;
  timeoutMs: AppLockTimeoutMs;
};

export type AppLockDecision = "allow" | "lock" | "recover";

export type PinAttemptState = {
  version: typeof PIN_ATTEMPT_STATE_VERSION;
  failedAttempts: number;
  cooldownUntilMs: number | null;
};

export const PIN_COOLDOWN_STEPS = [
  { attempts: 5, durationMs: 30_000 },
  { attempts: 8, durationMs: 60_000 },
  { attempts: 10, durationMs: 5 * 60_000 },
  { attempts: 12, durationMs: 15 * 60_000 },
] as const;

const MAX_TRACKED_PIN_FAILURES = 1_000;

function isSafeTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function isAppLockTimeoutMs(value: unknown): value is AppLockTimeoutMs {
  return APP_LOCK_TIMEOUT_OPTIONS.some((option) => option.value === value);
}

export function createDefaultAppLockConfig(): AppLockConfig {
  return {
    version: APP_LOCK_CONFIG_VERSION,
    enabled: false,
    biometricEnabled: false,
    pinConfigured: false,
    timeoutMs: DEFAULT_APP_LOCK_TIMEOUT_MS,
  };
}

export function isAppLockConfig(value: unknown): value is AppLockConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  if (
    config.version !== APP_LOCK_CONFIG_VERSION ||
    typeof config.enabled !== "boolean" ||
    typeof config.biometricEnabled !== "boolean" ||
    typeof config.pinConfigured !== "boolean" ||
    !isAppLockTimeoutMs(config.timeoutMs)
  ) {
    return false;
  }

  return !config.enabled || config.pinConfigured || config.biometricEnabled;
}

export function getColdStartLockDecision({
  hasSession,
  config,
}: {
  hasSession: boolean;
  config: unknown;
}): AppLockDecision {
  if (!hasSession) return "allow";
  if (config === null || config === undefined) return "allow";
  if (!isAppLockConfig(config)) return "recover";
  return config.enabled ? "lock" : "allow";
}

export function shouldLockOnColdStart(input: {
  hasSession: boolean;
  config: unknown;
}): boolean {
  return getColdStartLockDecision(input) !== "allow";
}

export function getBackgroundLockDecision({
  config,
  backgroundedAtMs,
  nowMs,
}: {
  config: unknown;
  backgroundedAtMs: number | null;
  nowMs: number;
}): AppLockDecision {
  if (config === null || config === undefined) return "allow";
  if (!isAppLockConfig(config)) return "recover";
  if (!config.enabled) return "allow";

  if (
    !isSafeTimestamp(backgroundedAtMs) ||
    !isSafeTimestamp(nowMs) ||
    backgroundedAtMs > nowMs
  ) {
    return "lock";
  }

  return nowMs - backgroundedAtMs >= config.timeoutMs ? "lock" : "allow";
}

export function shouldLockAfterBackground(input: {
  config: unknown;
  backgroundedAtMs: number | null;
  nowMs: number;
}): boolean {
  return getBackgroundLockDecision(input) !== "allow";
}

export function createEmptyPinAttemptState(): PinAttemptState {
  return {
    version: PIN_ATTEMPT_STATE_VERSION,
    failedAttempts: 0,
    cooldownUntilMs: null,
  };
}

export function isPinAttemptState(value: unknown): value is PinAttemptState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === PIN_ATTEMPT_STATE_VERSION &&
    typeof state.failedAttempts === "number" &&
    Number.isSafeInteger(state.failedAttempts) &&
    state.failedAttempts >= 0 &&
    state.failedAttempts <= MAX_TRACKED_PIN_FAILURES &&
    (state.cooldownUntilMs === null || isSafeTimestamp(state.cooldownUntilMs))
  );
}

export function getPinCooldownDurationMs(failedAttempts: number): number {
  if (!Number.isSafeInteger(failedAttempts) || failedAttempts < 0) {
    throw new Error("Contagem de tentativas de PIN inválida.");
  }

  let durationMs = 0;
  for (const step of PIN_COOLDOWN_STEPS) {
    if (failedAttempts < step.attempts) break;
    durationMs = step.durationMs;
  }
  return durationMs;
}

export function getPinCooldownRemainingMs(
  state: PinAttemptState,
  nowMs: number,
): number {
  if (!isPinAttemptState(state) || !isSafeTimestamp(nowMs)) {
    throw new Error("Estado de bloqueio do PIN inválido.");
  }
  if (state.cooldownUntilMs === null) return 0;
  return Math.max(0, state.cooldownUntilMs - nowMs);
}

export function canAttemptPin(state: PinAttemptState, nowMs: number): boolean {
  return getPinCooldownRemainingMs(state, nowMs) === 0;
}

export function recordFailedPinAttempt(
  currentState: PinAttemptState | null | undefined,
  nowMs: number,
): PinAttemptState {
  const state = currentState ?? createEmptyPinAttemptState();
  if (!isPinAttemptState(state) || !isSafeTimestamp(nowMs)) {
    throw new Error("Estado de bloqueio do PIN inválido.");
  }

  if (!canAttemptPin(state, nowMs)) return { ...state };

  const failedAttempts = Math.min(
    state.failedAttempts + 1,
    MAX_TRACKED_PIN_FAILURES,
  );
  const cooldownDurationMs = getPinCooldownDurationMs(failedAttempts);
  const cooldownUntilMs = cooldownDurationMs > 0
    ? Math.min(nowMs + cooldownDurationMs, Number.MAX_SAFE_INTEGER)
    : null;

  return {
    version: PIN_ATTEMPT_STATE_VERSION,
    failedAttempts,
    cooldownUntilMs,
  };
}

export function resetPinAttemptState(): PinAttemptState {
  return createEmptyPinAttemptState();
}
