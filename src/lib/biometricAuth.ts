import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

export type BiometricPlatform = "android" | "ios" | "web" | "other";

export type BiometricUnavailableReason =
  | "unsupported-platform"
  | "no-hardware"
  | "not-enrolled"
  | "insufficient-security"
  | "check-failed";

export type BiometricCapabilities = {
  available: boolean;
  reason: "available" | BiometricUnavailableReason;
  actionLabel: string;
  authenticationTypes: LocalAuthentication.AuthenticationType[];
  securityLevel: LocalAuthentication.SecurityLevel;
  message: string | null;
};

export type BiometricAuthStatus =
  | "success"
  | "cancelled"
  | "not-enrolled"
  | "unavailable"
  | "insufficient-security"
  | "locked-out"
  | "failed";

export type BiometricAuthResult = {
  success: boolean;
  status: BiometricAuthStatus;
  actionLabel: string;
  message: string | null;
};

export type BiometricPromptOptions = {
  promptMessage?: string;
  promptSubtitle?: string;
};

export type BiometricAuthDependencies = {
  platform: BiometricPlatform;
  hasHardwareAsync: typeof LocalAuthentication.hasHardwareAsync;
  isEnrolledAsync: typeof LocalAuthentication.isEnrolledAsync;
  supportedAuthenticationTypesAsync: typeof LocalAuthentication.supportedAuthenticationTypesAsync;
  getEnrolledLevelAsync: typeof LocalAuthentication.getEnrolledLevelAsync;
  authenticateAsync: typeof LocalAuthentication.authenticateAsync;
};

function currentPlatform(): BiometricPlatform {
  if (Platform.OS === "android" || Platform.OS === "ios" || Platform.OS === "web") {
    return Platform.OS;
  }
  return "other";
}

const defaultDependencies: BiometricAuthDependencies = {
  platform: currentPlatform(),
  hasHardwareAsync: LocalAuthentication.hasHardwareAsync,
  isEnrolledAsync: LocalAuthentication.isEnrolledAsync,
  supportedAuthenticationTypesAsync: LocalAuthentication.supportedAuthenticationTypesAsync,
  getEnrolledLevelAsync: LocalAuthentication.getEnrolledLevelAsync,
  authenticateAsync: LocalAuthentication.authenticateAsync,
};

function dependenciesWithDefaults(
  dependencies?: Partial<BiometricAuthDependencies>,
): BiometricAuthDependencies {
  return {
    ...defaultDependencies,
    ...dependencies,
  };
}

export function getBiometricActionLabel(
  authenticationTypes: readonly LocalAuthentication.AuthenticationType[],
  platform: BiometricPlatform,
): string {
  const uniqueTypes = [...new Set(authenticationTypes)];
  if (uniqueTypes.length !== 1) return "Usar biometria";

  const [type] = uniqueTypes;
  if (type === LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) {
    return platform === "ios" ? "Usar Face ID" : "Usar reconhecimento facial";
  }
  if (type === LocalAuthentication.AuthenticationType.FINGERPRINT) {
    return platform === "ios" ? "Usar Touch ID" : "Usar impressão digital";
  }
  if (type === LocalAuthentication.AuthenticationType.IRIS) {
    return "Usar reconhecimento de íris";
  }
  return "Usar biometria";
}

export async function getBiometricCapabilities(
  dependencies?: Partial<BiometricAuthDependencies>,
): Promise<BiometricCapabilities> {
  const deps = dependenciesWithDefaults(dependencies);
  if (deps.platform !== "android" && deps.platform !== "ios") {
    return {
      available: false,
      reason: "unsupported-platform",
      actionLabel: "Usar biometria",
      authenticationTypes: [],
      securityLevel: LocalAuthentication.SecurityLevel.NONE,
      message: "A biometria não está disponível nesta plataforma.",
    };
  }

  try {
    const [hasHardware, isEnrolled, authenticationTypes, securityLevel] = await Promise.all([
      deps.hasHardwareAsync(),
      deps.isEnrolledAsync(),
      deps.supportedAuthenticationTypesAsync(),
      deps.getEnrolledLevelAsync(),
    ]);
    const actionLabel = getBiometricActionLabel(authenticationTypes, deps.platform);

    if (!hasHardware) {
      return {
        available: false,
        reason: "no-hardware",
        actionLabel,
        authenticationTypes,
        securityLevel,
        message: "Este aparelho não possui biometria compatível.",
      };
    }
    if (!isEnrolled) {
      return {
        available: false,
        reason: "not-enrolled",
        actionLabel,
        authenticationTypes,
        securityLevel,
        message: "Nenhuma biometria está configurada neste dispositivo. Configure-a nas configurações do aparelho para utilizar este recurso.",
      };
    }
    if (securityLevel !== LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG) {
      return {
        available: false,
        reason: "insufficient-security",
        actionLabel,
        authenticationTypes,
        securityLevel,
        message: "A biometria configurada neste aparelho não atende ao nível de segurança necessário. Use seu PIN para continuar.",
      };
    }

    return {
      available: true,
      reason: "available",
      actionLabel,
      authenticationTypes,
      securityLevel,
      message: null,
    };
  } catch {
    return {
      available: false,
      reason: "check-failed",
      actionLabel: "Usar biometria",
      authenticationTypes: [],
      securityLevel: LocalAuthentication.SecurityLevel.NONE,
      message: "Não foi possível verificar a biometria deste aparelho.",
    };
  }
}

function unavailableResult(capabilities: BiometricCapabilities): BiometricAuthResult {
  const status: BiometricAuthStatus = capabilities.reason === "not-enrolled"
    ? "not-enrolled"
    : capabilities.reason === "insufficient-security"
      ? "insufficient-security"
      : "unavailable";
  return {
    success: false,
    status,
    actionLabel: capabilities.actionLabel,
    message: capabilities.message,
  };
}

function failedAuthenticationResult(
  error: LocalAuthentication.LocalAuthenticationError,
  actionLabel: string,
): BiometricAuthResult {
  if (
    error === "user_cancel" ||
    error === "app_cancel" ||
    error === "system_cancel" ||
    error === "user_fallback"
  ) {
    return { success: false, status: "cancelled", actionLabel, message: null };
  }
  if (error === "not_enrolled") {
    return {
      success: false,
      status: "not-enrolled",
      actionLabel,
      message: "Nenhuma biometria está configurada neste dispositivo. Configure-a nas configurações do aparelho para utilizar este recurso.",
    };
  }
  if (error === "lockout") {
    return {
      success: false,
      status: "locked-out",
      actionLabel,
      message: "A biometria foi bloqueada temporariamente. Use seu PIN ou tente novamente mais tarde.",
    };
  }
  if (error === "not_available" || error === "passcode_not_set") {
    return {
      success: false,
      status: "unavailable",
      actionLabel,
      message: "Biometria indisponível. Use seu PIN para continuar.",
    };
  }
  return {
    success: false,
    status: "failed",
    actionLabel,
    message: "Não foi possível confirmar sua identidade. Tente novamente.",
  };
}

async function runBiometricAuthentication(
  options: BiometricPromptOptions,
  dependencies?: Partial<BiometricAuthDependencies>,
): Promise<BiometricAuthResult> {
  const deps = dependenciesWithDefaults(dependencies);
  const capabilities = await getBiometricCapabilities(deps);
  if (!capabilities.available) return unavailableResult(capabilities);

  const authenticationOptions: LocalAuthentication.LocalAuthenticationOptions = {
    promptMessage: options.promptMessage ?? "Desbloquear o Sonhar+",
    cancelLabel: "Cancelar",
    disableDeviceFallback: true,
  };

  if (deps.platform === "android") {
    authenticationOptions.promptSubtitle = options.promptSubtitle ?? "Confirme sua identidade para continuar.";
    authenticationOptions.biometricsSecurityLevel = "strong";
    authenticationOptions.requireConfirmation = true;
  } else {
    authenticationOptions.fallbackLabel = "";
  }

  try {
    const result = await deps.authenticateAsync(authenticationOptions);
    if (result.success) {
      return {
        success: true,
        status: "success",
        actionLabel: capabilities.actionLabel,
        message: null,
      };
    }
    return failedAuthenticationResult(result.error, capabilities.actionLabel);
  } catch {
    return {
      success: false,
      status: "failed",
      actionLabel: capabilities.actionLabel,
      message: "Não foi possível confirmar sua identidade. Tente novamente.",
    };
  }
}

let authenticationInFlight: Promise<BiometricAuthResult> | null = null;

export function authenticateWithBiometrics(
  options: BiometricPromptOptions = {},
  dependencies?: Partial<BiometricAuthDependencies>,
): Promise<BiometricAuthResult> {
  if (authenticationInFlight) return authenticationInFlight;

  const pending = runBiometricAuthentication(options, dependencies);
  const tracked = pending.finally(() => {
    if (authenticationInFlight === tracked) authenticationInFlight = null;
  });
  authenticationInFlight = tracked;
  return tracked;
}
