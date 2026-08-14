import { describe, expect, it } from "vitest";
import {
  APP_LOCK_PROMPT_RESUME_GRACE_MS,
  getAppLockAuthenticationCompletion,
  getAppLockAppStateTransition,
  getNextMountedProtectedUserId,
  type AppLifecycleStatus,
  type AppLockAppStateTransition,
} from "./appLockLifecycle";
import {
  APP_LOCK_CONFIG_VERSION,
  type AppLockConfig,
  type AppLockTimeoutMs,
} from "./appLockPolicy";

function enabledConfig(timeoutMs: AppLockTimeoutMs): AppLockConfig {
  return {
    version: APP_LOCK_CONFIG_VERSION,
    enabled: true,
    biometricEnabled: true,
    pinConfigured: true,
    timeoutMs,
  };
}

function transition({
  previousState,
  nextState,
  nowMs,
  backgroundedAtMs = null,
  timeoutMs = 60_000,
  authenticationPromptActive = false,
}: {
  previousState: AppLifecycleStatus;
  nextState: AppLifecycleStatus;
  nowMs: number;
  backgroundedAtMs?: number | null;
  timeoutMs?: AppLockTimeoutMs;
  authenticationPromptActive?: boolean;
}): AppLockAppStateTransition {
  return getAppLockAppStateTransition({
    previousState,
    nextState,
    protectionActive: true,
    authenticationPromptActive,
    recoveryRequired: false,
    config: enabledConfig(timeoutMs),
    backgroundedAtMs,
    nowMs,
  });
}

describe("App Lock AppState lifecycle", () => {
  it("keeps cold-start data unmounted and preserves an entered tree across warm locks", () => {
    const coldLocked = getNextMountedProtectedUserId({
      mountedUserId: null,
      userId: "user-a",
      readyForUser: true,
      locked: true,
      privacyCovered: true,
    });
    const entered = getNextMountedProtectedUserId({
      mountedUserId: coldLocked,
      userId: "user-a",
      readyForUser: true,
      locked: false,
      privacyCovered: false,
    });
    const warmLocked = getNextMountedProtectedUserId({
      mountedUserId: entered,
      userId: "user-a",
      readyForUser: true,
      locked: true,
      privacyCovered: true,
    });

    expect(coldLocked).toBeNull();
    expect(entered).toBe("user-a");
    expect(warmLocked).toBe("user-a");
    expect(getNextMountedProtectedUserId({
      mountedUserId: warmLocked,
      userId: "user-b",
      readyForUser: true,
      locked: true,
      privacyCovered: true,
    })).toBeNull();
  });

  it("case A: allows a return before timeout without requesting an unlock", () => {
    const covered = transition({
      previousState: "active",
      nextState: "background",
      nowMs: 1_000,
      timeoutMs: 300_000,
    });
    const returned = transition({
      previousState: "background",
      nextState: "active",
      nowMs: 21_000,
      backgroundedAtMs: covered.backgroundedAtMs,
      timeoutMs: 300_000,
    });

    expect(covered).toMatchObject({
      privacyCovered: true,
      backgroundedAtMs: 1_000,
      lockDecision: null,
    });
    expect(returned).toMatchObject({
      privacyCovered: false,
      backgroundedAtMs: null,
      lockDecision: "allow",
    });
  });

  it("case B: keeps the app locked when returning after timeout", () => {
    const returned = transition({
      previousState: "background",
      nextState: "active",
      nowMs: 121_000,
      backgroundedAtMs: 1_000,
      timeoutMs: 60_000,
    });

    expect(returned.lockDecision).toBe("lock");
    expect(returned.privacyCovered).toBe(true);
    expect(returned.backgroundedAtMs).toBeNull();
  });

  it("case C: immediate mode locks on every relevant return", () => {
    const returned = transition({
      previousState: "inactive",
      nextState: "active",
      nowMs: 1_000,
      backgroundedAtMs: 1_000,
      timeoutMs: 0,
    });

    expect(returned.lockDecision).toBe("lock");
    expect(returned.privacyCovered).toBe(true);
  });

  it("case D: covers content immediately on inactive and keeps the first timestamp", () => {
    const inactive = transition({
      previousState: "active",
      nextState: "inactive",
      nowMs: 1_000,
    });
    const background = transition({
      previousState: "inactive",
      nextState: "background",
      nowMs: 2_000,
      backgroundedAtMs: inactive.backgroundedAtMs,
    });

    expect(inactive.privacyCovered).toBe(true);
    expect(background.privacyCovered).toBe(true);
    expect(background.backgroundedAtMs).toBe(1_000);
  });

  it("case E: biometric AppState changes are covered but ignored for timeout", () => {
    const promptStates: AppLifecycleStatus[] = ["inactive", "background", "active"];
    let previousState: AppLifecycleStatus = "active";
    let backgroundedAtMs: number | null = null;
    let promptReachedBackground = false;

    const results = promptStates.map((nextState, index) => {
      const result = getAppLockAppStateTransition({
        previousState,
        nextState,
        protectionActive: true,
        authenticationPromptActive: true,
        recoveryRequired: false,
        config: enabledConfig(60_000),
        backgroundedAtMs,
        nowMs: 1_000 + index * 120_000,
        promptReachedBackground,
      });
      previousState = nextState;
      backgroundedAtMs = result.backgroundedAtMs;
      promptReachedBackground = result.promptReachedBackground;
      return result;
    });

    expect(results.map(({ privacyCovered }) => privacyCovered)).toEqual([
      true,
      true,
      false,
    ]);
    expect(results.every(({ ignoredForPrompt }) => ignoredForPrompt)).toBe(true);
    expect(results.every(({ lockDecision }) => lockDecision === null)).toBe(true);
    expect(results.every((result) => result.backgroundedAtMs === null)).toBe(true);
    expect(promptReachedBackground).toBe(true);

    const completed = getAppLockAuthenticationCompletion({
      currentState: "active",
      protectionActive: true,
      authenticationSucceeded: true,
      successfulUnlock: true,
      promptReachedBackground,
      nowMs: 500_000,
    });

    expect(completed).toEqual({
      privacyCovered: false,
      backgroundedAtMs: null,
      lockDecision: null,
      shouldUnlock: true,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    });
  });

  it("starts the real background clock when a prompt finishes outside active", () => {
    const completed = getAppLockAuthenticationCompletion({
      currentState: "background",
      protectionActive: true,
      authenticationSucceeded: true,
      successfulUnlock: true,
      promptReachedBackground: true,
      nowMs: 500_000,
    });

    expect(completed).toEqual({
      privacyCovered: true,
      backgroundedAtMs: 500_000,
      lockDecision: null,
      shouldUnlock: true,
      ignoreNextActive: true,
      ignoreNextActiveUntilMs: 500_000 + APP_LOCK_PROMPT_RESUME_GRACE_MS,
    });
  });

  it("ignores the next active only when a prompt ends inactive without background", () => {
    const inactiveOnly = getAppLockAuthenticationCompletion({
      currentState: "inactive",
      protectionActive: true,
      authenticationSucceeded: false,
      successfulUnlock: false,
      promptReachedBackground: false,
      nowMs: 500_000,
    });
    const inactiveAfterBackground = getAppLockAuthenticationCompletion({
      currentState: "inactive",
      protectionActive: true,
      authenticationSucceeded: false,
      successfulUnlock: false,
      promptReachedBackground: true,
      nowMs: 500_000,
    });

    expect(inactiveOnly).toMatchObject({
      privacyCovered: true,
      backgroundedAtMs: 500_000,
      ignoreNextActive: true,
      ignoreNextActiveUntilMs: 500_000 + APP_LOCK_PROMPT_RESUME_GRACE_MS,
    });
    expect(inactiveAfterBackground).toMatchObject({
      privacyCovered: true,
      backgroundedAtMs: 500_000,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    });

    const directActive = getAppLockAppStateTransition({
      previousState: "inactive",
      nextState: "active",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: enabledConfig(0),
      backgroundedAtMs: inactiveOnly.backgroundedAtMs,
      nowMs: 500_001,
      ignoreNextActiveAfterPrompt: inactiveOnly.ignoreNextActive,
      ignoreNextActiveUntilMs: inactiveOnly.ignoreNextActiveUntilMs,
    });
    const realBackground = getAppLockAppStateTransition({
      previousState: "inactive",
      nextState: "background",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: enabledConfig(0),
      backgroundedAtMs: inactiveOnly.backgroundedAtMs,
      nowMs: 500_001,
      ignoreNextActiveAfterPrompt: inactiveOnly.ignoreNextActive,
      ignoreNextActiveUntilMs: inactiveOnly.ignoreNextActiveUntilMs,
    });
    const activeAfterBackground = getAppLockAppStateTransition({
      previousState: "background",
      nextState: "active",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: enabledConfig(0),
      backgroundedAtMs: realBackground.backgroundedAtMs,
      nowMs: 500_002,
      ignoreNextActiveAfterPrompt: realBackground.ignoreNextActive,
    });
    const failedPromptReturn = getAppLockAppStateTransition({
      previousState: "inactive",
      nextState: "active",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: enabledConfig(0),
      backgroundedAtMs: inactiveAfterBackground.backgroundedAtMs,
      nowMs: 500_001,
      ignoreNextActiveAfterPrompt: inactiveAfterBackground.ignoreNextActive,
      ignoreNextActiveUntilMs: inactiveAfterBackground.ignoreNextActiveUntilMs,
    });
    const delayedInactiveReturn = getAppLockAppStateTransition({
      previousState: "inactive",
      nextState: "active",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: enabledConfig(0),
      backgroundedAtMs: inactiveOnly.backgroundedAtMs,
      nowMs: 500_000 + APP_LOCK_PROMPT_RESUME_GRACE_MS + 1,
      ignoreNextActiveAfterPrompt: inactiveOnly.ignoreNextActive,
      ignoreNextActiveUntilMs: inactiveOnly.ignoreNextActiveUntilMs,
    });

    expect(directActive.lockDecision).toBeNull();
    expect(realBackground.ignoreNextActive).toBe(false);
    expect(activeAfterBackground.lockDecision).toBe("lock");
    expect(failedPromptReturn.lockDecision).toBe("lock");
    expect(delayedInactiveReturn.lockDecision).toBe("lock");
  });

  it("does not relock immediate mode during the direct return from a native prompt", () => {
    const completed = getAppLockAuthenticationCompletion({
      currentState: "background",
      protectionActive: true,
      authenticationSucceeded: true,
      successfulUnlock: true,
      promptReachedBackground: true,
      nowMs: 500_000,
    });
    const directReturn = getAppLockAppStateTransition({
      previousState: "background",
      nextState: "active",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: enabledConfig(0),
      backgroundedAtMs: completed.backgroundedAtMs,
      nowMs: 500_001,
      ignoreNextActiveAfterPrompt: completed.ignoreNextActive,
      ignoreNextActiveUntilMs: completed.ignoreNextActiveUntilMs,
    });
    const delayedReturn = getAppLockAppStateTransition({
      previousState: "background",
      nextState: "active",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: enabledConfig(0),
      backgroundedAtMs: completed.backgroundedAtMs,
      nowMs: 500_000 + APP_LOCK_PROMPT_RESUME_GRACE_MS + 1,
      ignoreNextActiveAfterPrompt: completed.ignoreNextActive,
      ignoreNextActiveUntilMs: completed.ignoreNextActiveUntilMs,
    });

    expect(directReturn.lockDecision).toBeNull();
    expect(directReturn.ignoredForPrompt).toBe(true);
    expect(delayedReturn.lockDecision).toBe("lock");
  });

  it("fails closed into recovery without using an elapsed-time decision", () => {
    const result = getAppLockAppStateTransition({
      previousState: "background",
      nextState: "active",
      protectionActive: true,
      authenticationPromptActive: false,
      recoveryRequired: true,
      config: null,
      backgroundedAtMs: 1_000,
      nowMs: 2_000,
    });

    expect(result.lockDecision).toBe("recover");
  });

  it("does not cover or accumulate timeout state when protection is disabled", () => {
    const result = getAppLockAppStateTransition({
      previousState: "active",
      nextState: "background",
      protectionActive: false,
      authenticationPromptActive: false,
      recoveryRequired: false,
      config: null,
      backgroundedAtMs: 1_000,
      nowMs: 2_000,
    });

    expect(result).toEqual({
      privacyCovered: false,
      backgroundedAtMs: null,
      lockDecision: null,
      ignoredForPrompt: false,
      promptReachedBackground: false,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    });
  });
});
