import {
  getBackgroundLockDecision,
  type AppLockDecision,
} from "./appLockPolicy";

export const APP_LOCK_PROMPT_RESUME_GRACE_MS = 5_000;

export type AppLifecycleStatus =
  | "active"
  | "inactive"
  | "background"
  | "unknown"
  | "extension";

export type AppLockAppStateTransition = {
  privacyCovered: boolean;
  backgroundedAtMs: number | null;
  lockDecision: AppLockDecision | null;
  ignoredForPrompt: boolean;
  promptReachedBackground: boolean;
  ignoreNextActive: boolean;
  ignoreNextActiveUntilMs: number | null;
};

export type AppLockAuthenticationCompletion = {
  privacyCovered: boolean;
  backgroundedAtMs: number | null;
  lockDecision: null;
  shouldUnlock: boolean;
  ignoreNextActive: boolean;
  ignoreNextActiveUntilMs: number | null;
};

/**
 * Latches the authenticated React tree only after a safe foreground entry.
 * Once mounted for that user, warm privacy covers and locks never unmount it.
 */
export function getNextMountedProtectedUserId({
  mountedUserId,
  userId,
  readyForUser,
  locked,
  privacyCovered,
}: {
  mountedUserId: string | null;
  userId: string | null;
  readyForUser: boolean;
  locked: boolean;
  privacyCovered: boolean;
}): string | null {
  if (!userId) return null;
  if (mountedUserId === userId) return userId;
  return readyForUser && !locked && !privacyCovered ? userId : null;
}

/**
 * Keeps the privacy response separate from the timeout response.
 * Native authentication transitions are still covered, but never start or
 * evaluate the background timeout while the prompt owns AppState.
 */
export function getAppLockAppStateTransition({
  previousState,
  nextState,
  protectionActive,
  authenticationPromptActive,
  recoveryRequired,
  config,
  backgroundedAtMs,
  nowMs,
  promptReachedBackground = false,
  ignoreNextActiveAfterPrompt = false,
  ignoreNextActiveUntilMs = null,
}: {
  previousState: AppLifecycleStatus;
  nextState: AppLifecycleStatus;
  protectionActive: boolean;
  authenticationPromptActive: boolean;
  recoveryRequired: boolean;
  config: unknown;
  backgroundedAtMs: number | null;
  nowMs: number;
  promptReachedBackground?: boolean;
  ignoreNextActiveAfterPrompt?: boolean;
  ignoreNextActiveUntilMs?: number | null;
}): AppLockAppStateTransition {
  const privacyCovered = protectionActive && nextState !== "active";

  if (!protectionActive) {
    return {
      privacyCovered: false,
      backgroundedAtMs: null,
      lockDecision: null,
      ignoredForPrompt: false,
      promptReachedBackground: false,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    };
  }

  if (authenticationPromptActive) {
    return {
      privacyCovered,
      backgroundedAtMs,
      lockDecision: null,
      ignoredForPrompt: true,
      promptReachedBackground: promptReachedBackground || nextState === "background",
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    };
  }

  if (
    ignoreNextActiveAfterPrompt &&
    nextState === "active" &&
    ignoreNextActiveUntilMs !== null &&
    (previousState === "inactive" || previousState === "background") &&
    nowMs <= ignoreNextActiveUntilMs
  ) {
    return {
      privacyCovered: false,
      backgroundedAtMs: null,
      lockDecision: null,
      ignoredForPrompt: true,
      promptReachedBackground: false,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    };
  }

  if (nextState !== "active") {
    return {
      privacyCovered: true,
      backgroundedAtMs: backgroundedAtMs ?? nowMs,
      lockDecision: null,
      ignoredForPrompt: false,
      promptReachedBackground: false,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    };
  }

  if (previousState === "active") {
    return {
      privacyCovered: false,
      backgroundedAtMs,
      lockDecision: null,
      ignoredForPrompt: false,
      promptReachedBackground: false,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    };
  }

  const lockDecision = recoveryRequired
    ? "recover"
    : getBackgroundLockDecision({ config, backgroundedAtMs, nowMs });

  return {
    // Keep the neutral surface in place until the caller has committed the
    // App Lock UI. An allowed return can reveal the existing tree immediately.
    privacyCovered: lockDecision !== "allow",
    backgroundedAtMs: null,
    lockDecision,
    ignoredForPrompt: false,
    promptReachedBackground: false,
    ignoreNextActive: false,
    ignoreNextActiveUntilMs: null,
  };
}

/**
 * Finishes a native authentication prompt without treating its own AppState
 * transitions as time spent away from the app.
 */
export function getAppLockAuthenticationCompletion({
  currentState,
  protectionActive,
  authenticationSucceeded,
  successfulUnlock,
  promptReachedBackground,
  nowMs,
}: {
  currentState: AppLifecycleStatus;
  protectionActive: boolean;
  authenticationSucceeded: boolean;
  successfulUnlock: boolean;
  promptReachedBackground: boolean;
  nowMs: number;
}): AppLockAuthenticationCompletion {
  if (!protectionActive) {
    return {
      privacyCovered: false,
      backgroundedAtMs: null,
      lockDecision: null,
      shouldUnlock: successfulUnlock,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    };
  }

  if (currentState === "active") {
    return {
      privacyCovered: false,
      backgroundedAtMs: null,
      lockDecision: null,
      shouldUnlock: successfulUnlock,
      ignoreNextActive: false,
      ignoreNextActiveUntilMs: null,
    };
  }

  const inactiveWithoutBackground = (
    currentState === "inactive" && !promptReachedBackground
  );

  return {
    privacyCovered: true,
    backgroundedAtMs: nowMs,
    lockDecision: null,
    shouldUnlock: successfulUnlock,
    ignoreNextActive: inactiveWithoutBackground || authenticationSucceeded,
    ignoreNextActiveUntilMs: inactiveWithoutBackground || authenticationSucceeded
      ? nowMs + APP_LOCK_PROMPT_RESUME_GRACE_MS
      : null,
  };
}
