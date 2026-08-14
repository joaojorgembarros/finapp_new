import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import {
  authenticateWithBiometrics,
  getBiometricCapabilities,
  type BiometricAuthResult,
  type BiometricCapabilities,
} from "../lib/biometricAuth";
import {
  getAppLockAppStateTransition,
  getAppLockAuthenticationCompletion,
} from "../lib/appLockLifecycle";
import {
  canAttemptPin,
  createDefaultAppLockConfig,
  createEmptyPinAttemptState,
  getColdStartLockDecision,
  getPinCooldownRemainingMs,
  isAppLockTimeoutMs,
  recordFailedPinAttempt,
  type AppLockConfig,
  type AppLockTimeoutMs,
  type PinAttemptState,
} from "../lib/appLockPolicy";
import { appLockStorage } from "../lib/appLockStorage";
import {
  createPinVerifier,
  isValidPin,
  verifyPin,
  type PinVerifierRecord,
} from "../lib/pinSecurity";
import { supabase } from "../lib/supabase";
import { useSession } from "./SessionProvider";

const APP_LOCK_SCREEN_CAPTURE_KEY = "sonharplus-app-lock";
const SENSITIVE_CONFIRMATION_WINDOW_MS = 90_000;

export type AppLockSensitiveAction =
  | "disable-lock"
  | "disable-biometric"
  | "configure-pin"
  | "replace-pin"
  | "remove-pin";

export type AppLockActionStatus =
  | BiometricAuthResult["status"]
  | "cooldown"
  | "invalid-pin"
  | "pin-incorrect"
  | "not-configured"
  | "not-ready"
  | "confirmation-required"
  | "wrong-password";

export type AppLockActionResult = {
  success: boolean;
  status: AppLockActionStatus;
  message: string | null;
  cooldownRemainingMs?: number;
};

export type LocalAuthenticationOptions = {
  unlock?: boolean;
};

export type AppLockContextValue = {
  supported: boolean;
  readyForUser: boolean;
  locked: boolean;
  privacyCovered: boolean;
  recoveryRequired: boolean;
  config: AppLockConfig;
  hasPin: boolean;
  attempts: PinAttemptState;
  cooldownRemainingMs: number;
  busy: boolean;
  biometricCapabilities: BiometricCapabilities;
  refreshBiometricCapabilities: () => Promise<BiometricCapabilities>;
  unlockWithBiometrics: (options?: LocalAuthenticationOptions) => Promise<AppLockActionResult>;
  confirmWithBiometrics: (action: AppLockSensitiveAction) => Promise<AppLockActionResult>;
  verifyIdentityWithBiometrics: () => Promise<AppLockActionResult>;
  unlockWithPin: (pin: string, options?: LocalAuthenticationOptions) => Promise<AppLockActionResult>;
  confirmWithPin: (pin: string, action: AppLockSensitiveAction) => Promise<AppLockActionResult>;
  verifyIdentityWithPin: (pin: string) => Promise<AppLockActionResult>;
  setPin: (pin: string) => Promise<void>;
  removePin: () => Promise<void>;
  enableBiometrics: () => Promise<AppLockActionResult>;
  disableBiometrics: () => Promise<void>;
  setLockEnabled: (enabled: boolean) => Promise<void>;
  setTimeout: (timeoutMs: AppLockTimeoutMs) => Promise<void>;
  reauthenticateWithPassword: (
    password: string,
    action: AppLockSensitiveAction,
  ) => Promise<AppLockActionResult>;
  lockNow: () => void;
};

const unsupportedBiometricCapabilities: BiometricCapabilities = {
  available: false,
  reason: "unsupported-platform",
  actionLabel: "Usar biometria",
  authenticationTypes: [],
  securityLevel: LocalAuthentication.SecurityLevel.NONE,
  message: "A biometria não está disponível nesta plataforma.",
};

const AppLockContext = createContext<AppLockContextValue | null>(null);

function friendlyNotReady(): AppLockActionResult {
  return {
    success: false,
    status: "not-ready",
    message: "A proteção do aplicativo ainda está sendo preparada. Tente novamente.",
  };
}

function friendlyAuthenticationAlreadyRunning(): AppLockActionResult {
  return {
    success: false,
    status: "cancelled",
    message: null,
  };
}

function friendlyStorageError(): Error {
  return new Error("Não foi possível atualizar a proteção do aplicativo. Tente novamente.");
}

function friendlyConfirmationError(): Error {
  return new Error("Confirme sua identidade antes de alterar esta configuração.");
}

function getPasswordErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code).toLowerCase()
    : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "Senha incorreta. Tente novamente.";
  }
  if (code.includes("rate_limit") || message.includes("too many") || message.includes("rate limit")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "Não foi possível conectar agora. Confira sua internet e tente novamente.";
  }
  return "Não foi possível confirmar sua conta. Tente novamente.";
}

function safeCooldownRemaining(attempts: PinAttemptState): number {
  try {
    return getPinCooldownRemainingMs(attempts, Date.now());
  } catch {
    return 0;
  }
}

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { session, userId, loading: sessionLoading } = useSession();
  const supported = Platform.OS === "android" || Platform.OS === "ios";

  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [config, setConfigState] = useState<AppLockConfig>(createDefaultAppLockConfig);
  const [pinRecord, setPinRecordState] = useState<PinVerifierRecord | null>(null);
  const [attempts, setAttemptsState] = useState<PinAttemptState>(createEmptyPinAttemptState);
  const [lockedState, setLockedState] = useState(false);
  const [privacyCovered, setPrivacyCovered] = useState(false);
  const [revealLockedSurface, setRevealLockedSurface] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [biometricCapabilities, setBiometricCapabilities] = useState<BiometricCapabilities>(
    unsupportedBiometricCapabilities,
  );

  const currentUserIdRef = useRef(userId);
  const loadedUserIdRef = useRef<string | null>(null);
  const configRef = useRef(config);
  const pinRecordRef = useRef(pinRecord);
  const attemptsRef = useRef(attempts);
  const recoveryRequiredRef = useRef(recoveryRequired);
  const loadGenerationRef = useRef(0);
  const operationTailRef = useRef<Promise<void>>(Promise.resolve());
  const authenticationPromptDepthRef = useRef(0);
  const promptReachedBackgroundRef = useRef(false);
  const ignoreNextActiveAfterPromptRef = useRef(false);
  const ignoreNextActiveUntilMsRef = useRef<number | null>(null);
  const backgroundedAtMsRef = useRef<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState ?? "active");
  const sensitiveConfirmationRef = useRef<{
    userId: string;
    action: AppLockSensitiveAction;
    untilMs: number;
  } | null>(null);
  const screenProtectionDesiredRef = useRef(false);
  const screenProtectionTailRef = useRef<Promise<void>>(Promise.resolve());
  const biometricRequestInFlightRef = useRef(false);

  currentUserIdRef.current = userId;

  const updateConfig = useCallback((nextConfig: AppLockConfig) => {
    configRef.current = nextConfig;
    setConfigState(nextConfig);
  }, []);

  const updatePinRecord = useCallback((nextPin: PinVerifierRecord | null) => {
    pinRecordRef.current = nextPin;
    setPinRecordState(nextPin);
  }, []);

  const updateAttempts = useCallback((nextAttempts: PinAttemptState) => {
    attemptsRef.current = nextAttempts;
    setAttemptsState(nextAttempts);
  }, []);

  const updateRecoveryRequired = useCallback((required: boolean) => {
    recoveryRequiredRef.current = required;
    setRecoveryRequired(required);
  }, []);

  const runExclusive = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const pending = operationTailRef.current.then(operation, operation);
    operationTailRef.current = pending.then(() => undefined, () => undefined);
    return pending;
  }, []);

  const withBusy = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusyCount((count) => count + 1);
    try {
      return await operation();
    } finally {
      setBusyCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const authorizeSensitiveAction = useCallback((
    expectedUserId: string,
    action: AppLockSensitiveAction,
  ) => {
    sensitiveConfirmationRef.current = {
      userId: expectedUserId,
      action,
      untilMs: Date.now() + SENSITIVE_CONFIRMATION_WINDOW_MS,
    };
  }, []);

  const consumeSensitiveConfirmation = useCallback((
    expectedUserId: string,
    action: AppLockSensitiveAction,
  ) => {
    const confirmation = sensitiveConfirmationRef.current;
    const valid = Boolean(
      confirmation &&
      confirmation.userId === expectedUserId &&
      confirmation.action === action &&
      confirmation.untilMs >= Date.now(),
    );
    if (valid) sensitiveConfirmationRef.current = null;
    return valid;
  }, []);

  const clearSensitiveConfirmation = useCallback(() => {
    sensitiveConfirmationRef.current = null;
  }, []);

  const requireReadyUser = useCallback((): string | null => {
    const activeUserId = currentUserIdRef.current;
    if (
      !supported ||
      !activeUserId ||
      loadedUserIdRef.current !== activeUserId
    ) {
      return null;
    }
    return activeUserId;
  }, [supported]);

  const isSameReadyUser = useCallback((expectedUserId: string): boolean => (
    currentUserIdRef.current === expectedUserId &&
    loadedUserIdRef.current === expectedUserId
  ), []);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    sensitiveConfirmationRef.current = null;
    authenticationPromptDepthRef.current = 0;
    promptReachedBackgroundRef.current = false;
    ignoreNextActiveAfterPromptRef.current = false;
    ignoreNextActiveUntilMsRef.current = null;
    backgroundedAtMsRef.current = null;
    setRevealLockedSurface(false);
    loadedUserIdRef.current = null;
    setLoadedUserId(null);

    if (sessionLoading) {
      if (supported && userId) {
        setLockedState(true);
        setPrivacyCovered(true);
      }
      return;
    }

    if (!userId) {
      updateConfig(createDefaultAppLockConfig());
      updatePinRecord(null);
      updateAttempts(createEmptyPinAttemptState());
      updateRecoveryRequired(false);
      setLockedState(false);
      setPrivacyCovered(false);
      setBiometricCapabilities(unsupportedBiometricCapabilities);
      return;
    }

    if (!supported) {
      updateConfig(createDefaultAppLockConfig());
      updatePinRecord(null);
      updateAttempts(createEmptyPinAttemptState());
      updateRecoveryRequired(false);
      loadedUserIdRef.current = userId;
      setLoadedUserId(userId);
      setLockedState(false);
      setPrivacyCovered(false);
      setBiometricCapabilities(unsupportedBiometricCapabilities);
      return;
    }

    setLockedState(true);
    setPrivacyCovered(true);

    void Promise.all([
      appLockStorage.load(userId),
      getBiometricCapabilities(),
    ]).then(([snapshot, capabilities]) => {
      if (
        loadGenerationRef.current !== generation ||
        currentUserIdRef.current !== userId
      ) return;

      updateConfig(snapshot.config);
      updatePinRecord(snapshot.pin);
      updateAttempts(snapshot.attempts);
      setBiometricCapabilities(capabilities);
      const decision = getColdStartLockDecision({ hasSession: true, config: snapshot.config });
      updateRecoveryRequired(decision === "recover");
      setLockedState(decision !== "allow");
      setPrivacyCovered(AppState.currentState !== "active" && snapshot.config.enabled);
      loadedUserIdRef.current = userId;
      setLoadedUserId(userId);
    }).catch(() => {
      if (
        loadGenerationRef.current !== generation ||
        currentUserIdRef.current !== userId
      ) return;

      updateConfig(createDefaultAppLockConfig());
      updatePinRecord(null);
      updateAttempts(createEmptyPinAttemptState());
      updateRecoveryRequired(true);
      setBiometricCapabilities(unsupportedBiometricCapabilities);
      setLockedState(true);
      setPrivacyCovered(AppState.currentState !== "active");
      loadedUserIdRef.current = userId;
      setLoadedUserId(userId);
    });
  }, [
    sessionLoading,
    supported,
    updateAttempts,
    updateConfig,
    updatePinRecord,
    updateRecoveryRequired,
    userId,
  ]);

  useEffect(() => {
    if (!supported) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const activeUserId = currentUserIdRef.current;
      const userReady = Boolean(
        activeUserId && loadedUserIdRef.current === activeUserId,
      );
      const protectionActive = userReady && (
        configRef.current.enabled || recoveryRequiredRef.current
      );
      const promptActive = authenticationPromptDepthRef.current > 0;
      const transition = getAppLockAppStateTransition({
        previousState,
        nextState,
        protectionActive,
        authenticationPromptActive: promptActive,
        recoveryRequired: recoveryRequiredRef.current,
        config: configRef.current,
        backgroundedAtMs: backgroundedAtMsRef.current,
        nowMs: Date.now(),
        promptReachedBackground: promptReachedBackgroundRef.current,
        ignoreNextActiveAfterPrompt: ignoreNextActiveAfterPromptRef.current,
        ignoreNextActiveUntilMs: ignoreNextActiveUntilMsRef.current,
      });
      backgroundedAtMsRef.current = transition.backgroundedAtMs;
      promptReachedBackgroundRef.current = transition.promptReachedBackground;
      ignoreNextActiveAfterPromptRef.current = transition.ignoreNextActive;
      ignoreNextActiveUntilMsRef.current = transition.ignoreNextActiveUntilMs;

      if (promptActive) {
        setPrivacyCovered(transition.privacyCovered);
        return;
      }

      if (nextState !== "active") {
        setRevealLockedSurface(false);
        setPrivacyCovered(transition.privacyCovered);
        if (protectionActive) clearSensitiveConfirmation();
        return;
      }

      if (transition.lockDecision && transition.lockDecision !== "allow") {
        // Keep the neutral shield for one committed render. It is removed only
        // after the locked surface is mounted, so content cannot flash between them.
        setPrivacyCovered(true);
        setLockedState(true);
        setRevealLockedSurface(true);
        if (transition.lockDecision === "recover") updateRecoveryRequired(true);
        return;
      }

      setRevealLockedSurface(false);
      setPrivacyCovered(transition.privacyCovered);
    });

    return () => subscription.remove();
  }, [clearSensitiveConfirmation, supported, updateRecoveryRequired]);

  useEffect(() => {
    if (!revealLockedSurface || !lockedState) return;
    if (AppState.currentState !== "active") return;
    setRevealLockedSurface(false);
    setPrivacyCovered(false);
  }, [lockedState, revealLockedSurface]);

  const applyScreenProtection = useCallback(() => {
    screenProtectionTailRef.current = screenProtectionTailRef.current
      .catch(() => undefined)
      .then(async () => {
        const shouldProtect = screenProtectionDesiredRef.current;
        try {
          if (Platform.OS === "ios") {
            if (shouldProtect) await ScreenCapture.enableAppSwitcherProtectionAsync(1);
            else await ScreenCapture.disableAppSwitcherProtectionAsync();
          } else if (Platform.OS === "android") {
            if (shouldProtect) await ScreenCapture.preventScreenCaptureAsync(APP_LOCK_SCREEN_CAPTURE_KEY);
            else await ScreenCapture.allowScreenCaptureAsync(APP_LOCK_SCREEN_CAPTURE_KEY);
          }
        } catch {
          // The opaque React cover remains the fallback if native privacy protection is unavailable.
        }
      });
  }, []);

  useEffect(() => {
    screenProtectionDesiredRef.current = Boolean(
      supported &&
      userId &&
      loadedUserId === userId &&
      (config.enabled || recoveryRequired),
    );
    applyScreenProtection();
  }, [applyScreenProtection, config.enabled, loadedUserId, recoveryRequired, supported, userId]);

  useEffect(() => () => {
    screenProtectionDesiredRef.current = false;
    applyScreenProtection();
  }, [applyScreenProtection]);

  const finishAuthenticationPrompt = useCallback((
    successfulUnlock: boolean,
    authenticationSucceeded: boolean,
    expectedUserId: string,
  ) => {
    if (!isSameReadyUser(expectedUserId)) return;

    authenticationPromptDepthRef.current = Math.max(
      0,
      authenticationPromptDepthRef.current - 1,
    );
    if (authenticationPromptDepthRef.current !== 0) return;

    const protectionActive = configRef.current.enabled || recoveryRequiredRef.current;
    const completion = getAppLockAuthenticationCompletion({
      currentState: AppState.currentState,
      protectionActive,
      authenticationSucceeded,
      successfulUnlock,
      promptReachedBackground: promptReachedBackgroundRef.current,
      nowMs: Date.now(),
    });
    promptReachedBackgroundRef.current = false;
    backgroundedAtMsRef.current = completion.backgroundedAtMs;
    ignoreNextActiveAfterPromptRef.current = completion.ignoreNextActive;
    ignoreNextActiveUntilMsRef.current = completion.ignoreNextActiveUntilMs;
    setRevealLockedSurface(false);
    setPrivacyCovered(completion.privacyCovered);
    if (completion.shouldUnlock) {
      setLockedState(false);
      updateRecoveryRequired(false);
    }
  }, [isSameReadyUser, updateRecoveryRequired]);

  const performBiometricAuthentication = useCallback((
    unlock: boolean,
    sensitiveAction?: AppLockSensitiveAction,
  ): Promise<AppLockActionResult> => {
    if (biometricRequestInFlightRef.current) {
      return Promise.resolve(friendlyAuthenticationAlreadyRunning());
    }
    biometricRequestInFlightRef.current = true;

    const pending = withBusy(() => runExclusive(async (): Promise<AppLockActionResult> => {
      const activeUserId = requireReadyUser();
      if (!activeUserId) return friendlyNotReady();

      authenticationPromptDepthRef.current += 1;
      promptReachedBackgroundRef.current = false;
      let result: BiometricAuthResult | null = null;
      let didAuthenticate = false;
      let didUnlock = false;
      try {
        result = await authenticateWithBiometrics();
        if (!isSameReadyUser(activeUserId)) return friendlyNotReady();

        if (result.success) {
          didAuthenticate = true;
          if (unlock) {
            setLockedState(false);
            updateRecoveryRequired(false);
            if (AppState.currentState === "active") setPrivacyCovered(false);
            didUnlock = true;
          } else if (sensitiveAction) {
            authorizeSensitiveAction(activeUserId, sensitiveAction);
          }
        }
        return result;
      } finally {
        finishAuthenticationPrompt(didUnlock, didAuthenticate, activeUserId);
      }
    }));

    return pending.finally(() => {
      biometricRequestInFlightRef.current = false;
    });
  }, [
      authorizeSensitiveAction,
      finishAuthenticationPrompt,
      isSameReadyUser,
      requireReadyUser,
      runExclusive,
      updateRecoveryRequired,
      withBusy,
    ]);

  const unlockWithBiometrics = useCallback(
    (options: LocalAuthenticationOptions = {}) =>
      performBiometricAuthentication(options.unlock ?? true),
    [performBiometricAuthentication],
  );

  const confirmWithBiometrics = useCallback(
    (action: AppLockSensitiveAction) => performBiometricAuthentication(false, action),
    [performBiometricAuthentication],
  );

  const verifyIdentityWithBiometrics = useCallback(
    () => performBiometricAuthentication(false),
    [performBiometricAuthentication],
  );

  const refreshBiometricCapabilities = useCallback(async () => {
    if (!supported) return unsupportedBiometricCapabilities;
    const capabilities = await getBiometricCapabilities();
    setBiometricCapabilities(capabilities);
    return capabilities;
  }, [supported]);

  const authenticateWithPin = useCallback((
    pin: string,
    unlock: boolean,
    sensitiveAction?: AppLockSensitiveAction,
  ) =>
    withBusy(() => runExclusive(async (): Promise<AppLockActionResult> => {
      const activeUserId = requireReadyUser();
      if (!activeUserId) return friendlyNotReady();
      const currentPin = pinRecordRef.current;
      if (!currentPin) {
        return {
          success: false,
          status: "not-configured",
          message: "Nenhum PIN está configurado neste aparelho.",
        };
      }

      const currentAttempts = attemptsRef.current;
      const cooldownRemainingMs = safeCooldownRemaining(currentAttempts);
      if (!canAttemptPin(currentAttempts, Date.now())) {
        return {
          success: false,
          status: "cooldown",
          message: "Muitas tentativas incorretas. Tente novamente em instantes.",
          cooldownRemainingMs,
        };
      }
      if (!isValidPin(pin)) {
        return {
          success: false,
          status: "invalid-pin",
          message: "Digite seu PIN de 6 dígitos.",
        };
      }

      const verified = await verifyPin(pin, currentPin);
      if (currentUserIdRef.current !== activeUserId) return friendlyNotReady();

      if (verified) {
        const emptyAttempts = createEmptyPinAttemptState();
        await appLockStorage.clearAttempts(activeUserId);
        if (!isSameReadyUser(activeUserId)) return friendlyNotReady();
        updateAttempts(emptyAttempts);
        if (unlock) {
          setLockedState(false);
          updateRecoveryRequired(false);
          if (AppState.currentState === "active") setPrivacyCovered(false);
        } else if (sensitiveAction) {
          authorizeSensitiveAction(activeUserId, sensitiveAction);
        }
        return { success: true, status: "success", message: null };
      }

      const nextAttempts = recordFailedPinAttempt(currentAttempts, Date.now());
      // Count in memory before persistence so a transient SecureStore failure
      // can never turn into unlimited rapid retries in the current process.
      updateAttempts(nextAttempts);
      try {
        await appLockStorage.saveAttempts(activeUserId, nextAttempts);
      } catch {
        const failClosedAttempts: PinAttemptState = {
          ...nextAttempts,
          cooldownUntilMs: Math.max(
            nextAttempts.cooldownUntilMs ?? 0,
            Date.now() + 30_000,
          ),
        };
        updateAttempts(failClosedAttempts);
        setLockedState(true);
        return {
          success: false,
          status: "cooldown",
          message: "Não foi possível registrar a tentativa com segurança. Aguarde e tente novamente.",
          cooldownRemainingMs: safeCooldownRemaining(failClosedAttempts),
        };
      }
      if (!isSameReadyUser(activeUserId)) return friendlyNotReady();
      const nextCooldownRemainingMs = safeCooldownRemaining(nextAttempts);
      return {
        success: false,
        status: nextCooldownRemainingMs > 0 ? "cooldown" : "pin-incorrect",
        message: nextCooldownRemainingMs > 0
          ? "Muitas tentativas incorretas. Tente novamente em instantes."
          : "PIN incorreto. Tente novamente.",
        cooldownRemainingMs: nextCooldownRemainingMs,
      };
    })), [
      authorizeSensitiveAction,
      isSameReadyUser,
      requireReadyUser,
      runExclusive,
      updateAttempts,
      updateRecoveryRequired,
      withBusy,
    ]);

  const unlockWithPin = useCallback(
    (pin: string, options: LocalAuthenticationOptions = {}) =>
      authenticateWithPin(pin, options.unlock ?? true),
    [authenticateWithPin],
  );

  const confirmWithPin = useCallback(
    (pin: string, action: AppLockSensitiveAction) => authenticateWithPin(pin, false, action),
    [authenticateWithPin],
  );

  const verifyIdentityWithPin = useCallback(
    (pin: string) => authenticateWithPin(pin, false),
    [authenticateWithPin],
  );

  const setPin = useCallback((pin: string) => withBusy(() => runExclusive(async () => {
    const activeUserId = requireReadyUser();
    if (!activeUserId) throw friendlyStorageError();
    const replacingPin = Boolean(pinRecordRef.current);
    const addingMethodToProtectedApp = !replacingPin && (
      configRef.current.enabled || configRef.current.biometricEnabled
    );
    const requiredAction: AppLockSensitiveAction | null = recoveryRequiredRef.current || replacingPin
      ? "replace-pin"
      : addingMethodToProtectedApp
        ? "configure-pin"
        : null;
    if (
      requiredAction &&
      !consumeSensitiveConfirmation(activeUserId, requiredAction)
    ) {
      throw friendlyConfirmationError();
    }
    if (!isValidPin(pin)) throw new Error("O PIN deve conter exatamente 6 dígitos.");

    try {
      const verifier = await createPinVerifier(pin);
      if (currentUserIdRef.current !== activeUserId) throw friendlyStorageError();
      const baseConfig = recoveryRequiredRef.current
        ? createDefaultAppLockConfig()
        : configRef.current;
      const nextConfig: AppLockConfig = {
        ...baseConfig,
        enabled: recoveryRequiredRef.current ? true : baseConfig.enabled,
        biometricEnabled: recoveryRequiredRef.current ? false : baseConfig.biometricEnabled,
        pinConfigured: true,
      };
      await appLockStorage.savePin(activeUserId, verifier);
      await appLockStorage.saveConfig(activeUserId, nextConfig);
      await appLockStorage.clearAttempts(activeUserId);
      if (!isSameReadyUser(activeUserId)) throw friendlyStorageError();
      updatePinRecord(verifier);
      updateConfig(nextConfig);
      updateAttempts(createEmptyPinAttemptState());
      updateRecoveryRequired(false);
      clearSensitiveConfirmation();
    } catch (error) {
      if (error instanceof Error && /6 dígitos/.test(error.message)) throw error;
      throw friendlyStorageError();
    }
  })), [
    clearSensitiveConfirmation,
    consumeSensitiveConfirmation,
    isSameReadyUser,
    requireReadyUser,
    runExclusive,
    updateAttempts,
    updateConfig,
    updatePinRecord,
    updateRecoveryRequired,
    withBusy,
  ]);

  const removePin = useCallback(() => withBusy(() => runExclusive(async () => {
    const activeUserId = requireReadyUser();
    if (!activeUserId) throw friendlyStorageError();
    if (!consumeSensitiveConfirmation(activeUserId, "remove-pin")) throw friendlyConfirmationError();
    const currentConfig = configRef.current;
    if (currentConfig.enabled && !currentConfig.biometricEnabled) {
      throw new Error("Ative a biometria ou desative o bloqueio antes de remover o PIN.");
    }

    const nextConfig: AppLockConfig = { ...currentConfig, pinConfigured: false };
    try {
      await appLockStorage.removePin(activeUserId);
      await appLockStorage.saveConfig(activeUserId, nextConfig);
      if (!isSameReadyUser(activeUserId)) throw friendlyStorageError();
      updatePinRecord(null);
      updateAttempts(createEmptyPinAttemptState());
      updateConfig(nextConfig);
      clearSensitiveConfirmation();
    } catch {
      throw friendlyStorageError();
    }
  })), [
    clearSensitiveConfirmation,
    consumeSensitiveConfirmation,
    isSameReadyUser,
    requireReadyUser,
    runExclusive,
    updateAttempts,
    updateConfig,
    updatePinRecord,
    withBusy,
  ]);

  const enableBiometrics = useCallback((): Promise<AppLockActionResult> => {
    if (biometricRequestInFlightRef.current) {
      return Promise.resolve(friendlyAuthenticationAlreadyRunning());
    }
    biometricRequestInFlightRef.current = true;

    const pending = withBusy(() => runExclusive(async (): Promise<AppLockActionResult> => {
      const activeUserId = requireReadyUser();
      if (!activeUserId) return friendlyNotReady();

      authenticationPromptDepthRef.current += 1;
      promptReachedBackgroundRef.current = false;
      let result: BiometricAuthResult | null = null;
      let didAuthenticate = false;
      let activated = false;
      try {
        result = await authenticateWithBiometrics({
          promptMessage: "Ativar proteção biométrica",
        });
        if (!isSameReadyUser(activeUserId)) return friendlyNotReady();
        if (!result.success) return result;
        didAuthenticate = true;

        const nextConfig: AppLockConfig = {
          ...configRef.current,
          enabled: true,
          biometricEnabled: true,
        };
        try {
          await appLockStorage.saveConfig(activeUserId, nextConfig);
          if (!isSameReadyUser(activeUserId)) return friendlyNotReady();
          updateConfig(nextConfig);
          updateRecoveryRequired(false);
          activated = true;
          return result;
        } catch {
          return {
            success: false,
            status: "failed",
            message: "Sua biometria foi confirmada, mas não foi possível salvar a configuração.",
          };
        }
      } finally {
        finishAuthenticationPrompt(activated, didAuthenticate, activeUserId);
      }
    }));

    return pending.finally(() => {
      biometricRequestInFlightRef.current = false;
    });
  }, [
    finishAuthenticationPrompt,
    isSameReadyUser,
    requireReadyUser,
    runExclusive,
    updateConfig,
    updateRecoveryRequired,
    withBusy,
  ]);

  const disableBiometrics = useCallback(() => withBusy(() => runExclusive(async () => {
    const activeUserId = requireReadyUser();
    if (!activeUserId) throw friendlyStorageError();
    if (!consumeSensitiveConfirmation(activeUserId, "disable-biometric")) {
      throw friendlyConfirmationError();
    }
    const currentConfig = configRef.current;
    if (currentConfig.enabled && !pinRecordRef.current) {
      throw new Error("Configure um PIN ou desative o bloqueio antes de remover a biometria.");
    }
    const nextConfig: AppLockConfig = { ...currentConfig, biometricEnabled: false };
    try {
      await appLockStorage.saveConfig(activeUserId, nextConfig);
      if (!isSameReadyUser(activeUserId)) throw friendlyStorageError();
      updateConfig(nextConfig);
      clearSensitiveConfirmation();
    } catch {
      throw friendlyStorageError();
    }
  })), [
    clearSensitiveConfirmation,
    consumeSensitiveConfirmation,
    isSameReadyUser,
    requireReadyUser,
    runExclusive,
    updateConfig,
    withBusy,
  ]);

  const setLockEnabled = useCallback((enabled: boolean) => withBusy(() => runExclusive(async () => {
    const activeUserId = requireReadyUser();
    if (!activeUserId) throw friendlyStorageError();
    if (!enabled && !consumeSensitiveConfirmation(activeUserId, "disable-lock")) {
      throw friendlyConfirmationError();
    }
    if (enabled && !pinRecordRef.current && !configRef.current.biometricEnabled) {
      throw new Error("Configure um PIN ou ative a biometria antes de ligar o bloqueio.");
    }

    const nextConfig: AppLockConfig = { ...configRef.current, enabled };
    try {
      await appLockStorage.saveConfig(activeUserId, nextConfig);
      if (!isSameReadyUser(activeUserId)) throw friendlyStorageError();
      updateConfig(nextConfig);
      if (!enabled) {
        setLockedState(false);
        setPrivacyCovered(false);
        backgroundedAtMsRef.current = null;
        clearSensitiveConfirmation();
      }
    } catch {
      throw friendlyStorageError();
    }
  })), [
    clearSensitiveConfirmation,
    consumeSensitiveConfirmation,
    isSameReadyUser,
    requireReadyUser,
    runExclusive,
    updateConfig,
    withBusy,
  ]);

  const setTimeout = useCallback((timeoutMs: AppLockTimeoutMs) => withBusy(() => runExclusive(async () => {
    const activeUserId = requireReadyUser();
    if (!activeUserId || !isAppLockTimeoutMs(timeoutMs)) throw friendlyStorageError();
    const nextConfig: AppLockConfig = { ...configRef.current, timeoutMs };
    try {
      await appLockStorage.saveConfig(activeUserId, nextConfig);
      if (!isSameReadyUser(activeUserId)) throw friendlyStorageError();
      updateConfig(nextConfig);
    } catch {
      throw friendlyStorageError();
    }
  })), [isSameReadyUser, requireReadyUser, runExclusive, updateConfig, withBusy]);

  const reauthenticateWithPassword = useCallback((
    password: string,
    action: AppLockSensitiveAction,
  ) =>
    withBusy(() => runExclusive(async (): Promise<AppLockActionResult> => {
      const activeUserId = requireReadyUser();
      const email = session?.user.email;
      if (!activeUserId || !email) return friendlyNotReady();
      if (!password) {
        return {
          success: false,
          status: "wrong-password",
          message: "Digite a senha da sua conta.",
        };
      }

      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          return {
            success: false,
            status: "wrong-password",
            message: getPasswordErrorMessage(error),
          };
        }
        if (
          data.user?.id !== activeUserId ||
          currentUserIdRef.current !== activeUserId
        ) {
          return friendlyNotReady();
        }
        authorizeSensitiveAction(activeUserId, action);
        return { success: true, status: "success", message: null };
      } catch (error) {
        return {
          success: false,
          status: "wrong-password",
          message: getPasswordErrorMessage(error),
        };
      }
    })), [authorizeSensitiveAction, requireReadyUser, runExclusive, session?.user.email, withBusy]);

  const lockNow = useCallback(() => {
    if (!supported || !currentUserIdRef.current) return;
    if (configRef.current.enabled || recoveryRequiredRef.current) {
      clearSensitiveConfirmation();
      setLockedState(true);
      setPrivacyCovered(AppState.currentState !== "active");
    }
  }, [clearSensitiveConfirmation, supported]);

  const readyForUser = !sessionLoading && (
    !userId ||
    !supported ||
    loadedUserId === userId
  );
  const locked = Boolean(
    supported &&
    userId &&
    (!readyForUser || lockedState || recoveryRequired),
  );
  const cooldownRemainingMs = safeCooldownRemaining(attempts);

  const value = useMemo<AppLockContextValue>(() => ({
    supported,
    readyForUser,
    locked,
    privacyCovered: supported && Boolean(userId) && privacyCovered,
    recoveryRequired,
    config,
    hasPin: Boolean(pinRecord),
    attempts,
    cooldownRemainingMs,
    busy: busyCount > 0,
    biometricCapabilities,
    refreshBiometricCapabilities,
    unlockWithBiometrics,
    confirmWithBiometrics,
    verifyIdentityWithBiometrics,
    unlockWithPin,
    confirmWithPin,
    verifyIdentityWithPin,
    setPin,
    removePin,
    enableBiometrics,
    disableBiometrics,
    setLockEnabled,
    setTimeout,
    reauthenticateWithPassword,
    lockNow,
  }), [
    attempts,
    biometricCapabilities,
    busyCount,
    config,
    confirmWithBiometrics,
    confirmWithPin,
    cooldownRemainingMs,
    disableBiometrics,
    enableBiometrics,
    lockNow,
    locked,
    pinRecord,
    privacyCovered,
    readyForUser,
    refreshBiometricCapabilities,
    reauthenticateWithPassword,
    recoveryRequired,
    removePin,
    setLockEnabled,
    setPin,
    setTimeout,
    supported,
    unlockWithBiometrics,
    unlockWithPin,
    verifyIdentityWithBiometrics,
    verifyIdentityWithPin,
    userId,
  ]);

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockContextValue {
  const context = useContext(AppLockContext);
  if (!context) throw new Error("useAppLock must be used inside AppLockProvider");
  return context;
}
