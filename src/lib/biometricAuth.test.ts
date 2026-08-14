import { describe, expect, it, vi } from "vitest";
import * as LocalAuthentication from "expo-local-authentication";
import {
  authenticateWithBiometrics,
  getBiometricActionLabel,
  getBiometricCapabilities,
  type BiometricAuthDependencies,
} from "./biometricAuth";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-local-authentication", () => ({
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC_WEAK: 2,
    BIOMETRIC_STRONG: 3,
  },
  hasHardwareAsync: vi.fn(),
  isEnrolledAsync: vi.fn(),
  supportedAuthenticationTypesAsync: vi.fn(),
  getEnrolledLevelAsync: vi.fn(),
  authenticateAsync: vi.fn(),
}));

function strongDependencies(
  overrides: Partial<BiometricAuthDependencies> = {},
): BiometricAuthDependencies {
  return {
    platform: "android",
    hasHardwareAsync: vi.fn(async () => true),
    isEnrolledAsync: vi.fn(async () => true),
    supportedAuthenticationTypesAsync: vi.fn(async () => [
      LocalAuthentication.AuthenticationType.FINGERPRINT,
    ]),
    getEnrolledLevelAsync: vi.fn(async () => LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG),
    authenticateAsync: vi.fn(async () => ({ success: true as const })),
    ...overrides,
  };
}

describe("biometric labels", () => {
  it("uses platform-specific labels for a single known type", () => {
    expect(getBiometricActionLabel([LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION], "ios")).toBe("Usar Face ID");
    expect(getBiometricActionLabel([LocalAuthentication.AuthenticationType.FINGERPRINT], "ios")).toBe("Usar Touch ID");
    expect(getBiometricActionLabel([LocalAuthentication.AuthenticationType.FINGERPRINT], "android")).toBe("Usar impressão digital");
    expect(getBiometricActionLabel([LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION], "android")).toBe("Usar reconhecimento facial");
    expect(getBiometricActionLabel([LocalAuthentication.AuthenticationType.IRIS], "android")).toBe("Usar reconhecimento de íris");
  });

  it("uses a generic label for none or multiple biometric types", () => {
    expect(getBiometricActionLabel([], "android")).toBe("Usar biometria");
    expect(getBiometricActionLabel([
      LocalAuthentication.AuthenticationType.FINGERPRINT,
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ], "android")).toBe("Usar biometria");
  });
});

describe("biometric capabilities", () => {
  it("does not call native APIs on web", async () => {
    const deps = strongDependencies({ platform: "web" });
    const result = await getBiometricCapabilities(deps);

    expect(result.reason).toBe("unsupported-platform");
    expect(deps.hasHardwareAsync).not.toHaveBeenCalled();
    expect(deps.authenticateAsync).not.toHaveBeenCalled();
  });

  it("reports strong enrolled biometrics as available", async () => {
    const result = await getBiometricCapabilities(strongDependencies());
    expect(result).toMatchObject({
      available: true,
      reason: "available",
      actionLabel: "Usar impressão digital",
      securityLevel: LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG,
    });
  });

  it("distinguishes missing hardware, enrollment and insufficient security", async () => {
    expect((await getBiometricCapabilities(strongDependencies({
      hasHardwareAsync: vi.fn(async () => false),
    }))).reason).toBe("no-hardware");
    expect((await getBiometricCapabilities(strongDependencies({
      isEnrolledAsync: vi.fn(async () => false),
    }))).reason).toBe("not-enrolled");
    expect((await getBiometricCapabilities(strongDependencies({
      getEnrolledLevelAsync: vi.fn(async () => LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK),
    }))).reason).toBe("insufficient-security");
  });

  it("returns a friendly failure without exposing native errors", async () => {
    const result = await getBiometricCapabilities(strongDependencies({
      hasHardwareAsync: vi.fn(async () => { throw new Error("native secret details"); }),
    }));
    expect(result.reason).toBe("check-failed");
    expect(result.message).not.toContain("native secret details");
  });
});

describe("biometric authentication", () => {
  it("enforces strong biometrics and disables device fallback on Android", async () => {
    const deps = strongDependencies();
    const result = await authenticateWithBiometrics({}, deps);

    expect(result.status).toBe("success");
    expect(deps.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({
      promptMessage: "Desbloquear o Sonho+",
      disableDeviceFallback: true,
      biometricsSecurityLevel: "strong",
      requireConfirmation: true,
    }));
  });

  it("uses the iOS biometric-only fallback policy without Android options", async () => {
    const deps = strongDependencies({ platform: "ios" });
    await authenticateWithBiometrics({ promptMessage: "Confirmar alteração" }, deps);

    const options = vi.mocked(deps.authenticateAsync).mock.calls[0][0];
    expect(options).toMatchObject({
      promptMessage: "Confirmar alteração",
      disableDeviceFallback: true,
      fallbackLabel: "",
    });
    expect(options).not.toHaveProperty("biometricsSecurityLevel");
  });

  it.each([
    ["user_cancel", "cancelled", null],
    ["app_cancel", "cancelled", null],
    ["system_cancel", "cancelled", null],
    ["user_fallback", "cancelled", null],
    ["not_enrolled", "not-enrolled", "Nenhuma biometria"],
    ["lockout", "locked-out", "bloqueada temporariamente"],
    ["not_available", "unavailable", "indisponível"],
    ["passcode_not_set", "unavailable", "indisponível"],
    ["authentication_failed", "failed", "confirmar sua identidade"],
  ] as const)("maps native error %s", async (error, status, messagePart) => {
    const result = await authenticateWithBiometrics({}, strongDependencies({
      authenticateAsync: vi.fn(async () => ({ success: false as const, error })),
    }));
    expect(result.status).toBe(status);
    if (messagePart === null) expect(result.message).toBeNull();
    else expect(result.message).toContain(messagePart);
  });

  it("does not open a prompt when strong biometrics are unavailable", async () => {
    const deps = strongDependencies({
      getEnrolledLevelAsync: vi.fn(async () => LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK),
    });
    const result = await authenticateWithBiometrics({}, deps);
    expect(result.status).toBe("insufficient-security");
    expect(deps.authenticateAsync).not.toHaveBeenCalled();
  });

  it("deduplicates simultaneous authentication requests", async () => {
    let finishAuthentication: ((value: LocalAuthentication.LocalAuthenticationResult) => void) | undefined;
    const authenticateAsync = vi.fn(() => new Promise<LocalAuthentication.LocalAuthenticationResult>((resolve) => {
      finishAuthentication = resolve;
    }));
    const deps = strongDependencies({ authenticateAsync });

    const first = authenticateWithBiometrics({}, deps);
    const second = authenticateWithBiometrics({}, deps);
    expect(first).toBe(second);

    await vi.waitFor(() => expect(authenticateAsync).toHaveBeenCalledTimes(1));
    finishAuthentication?.({ success: true });
    await expect(first).resolves.toMatchObject({ success: true, status: "success" });
    await expect(second).resolves.toMatchObject({ success: true, status: "success" });
  });

  it("returns a friendly failure when the native prompt throws", async () => {
    const result = await authenticateWithBiometrics({}, strongDependencies({
      authenticateAsync: vi.fn(async () => { throw new Error("native stack trace"); }),
    }));
    expect(result).toMatchObject({ success: false, status: "failed" });
    expect(result.message).not.toContain("native stack trace");
  });
});
