import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import {
  PASSWORD_RECOVERY_PATH,
  PasswordRecoveryLinkError,
  completePasswordRecoveryCallback,
  getPasswordRecoveryLinkErrorMessage,
  parsePasswordRecoveryUrl,
  passwordRecoveryUrlFromRouterParams,
  requireRecoverySession,
  shouldOpenPasswordRecoveryScreen,
  updatePasswordDuringRecovery,
  type PasswordRecoveryAuthClient,
  type PasswordRecoveryDedupeState,
} from "./passwordRecovery";

function sessionFixture(): Session {
  return {
    user: { id: "user-1", user_metadata: {} },
  } as Session;
}

function authClient(overrides: Partial<PasswordRecoveryAuthClient> = {}): PasswordRecoveryAuthClient {
  return {
    exchangeCodeForSession: vi.fn(async () => ({
      data: { session: sessionFixture() },
      error: null,
    })),
    setSession: vi.fn(async () => ({
      data: { session: sessionFixture() },
      error: null,
    })),
    updateUser: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe("password recovery routes", () => {
  it("keeps the Expo Router recovery path", () => {
    expect(PASSWORD_RECOVERY_PATH).toBe("reset-password");
  });
});

describe("parsePasswordRecoveryUrl", () => {
  it("reads a PKCE code from the standalone scheme", () => {
    expect(parsePasswordRecoveryUrl("sonhomais://reset-password?code=abc123")).toEqual({
      kind: "code",
      code: "abc123",
    });
  });

  it("reads a PKCE code when Expo appends a third slash", () => {
    expect(parsePasswordRecoveryUrl("sonhomais:///reset-password?code=abc123")).toEqual({
      kind: "code",
      code: "abc123",
    });
  });

  it("reads a PKCE code from an Expo Go deep link", () => {
    expect(parsePasswordRecoveryUrl("exp://192.168.0.8:8081/--/reset-password?code=expo-code")).toEqual({
      kind: "code",
      code: "expo-code",
    });
  });

  it("reads implicit recovery tokens from the URL hash", () => {
    expect(parsePasswordRecoveryUrl(
      "sonhomais://reset-password#access_token=tok_access&refresh_token=tok_refresh&type=recovery",
    )).toEqual({
      kind: "tokens",
      accessToken: "tok_access",
      refreshToken: "tok_refresh",
    });
  });

  it("treats an expired recovery OTP as an expired link", () => {
    expect(parsePasswordRecoveryUrl(
      "sonhomais://reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    )).toMatchObject({ kind: "error", reason: "expired" });
  });

  it("treats a recovery URL without a code as invalid", () => {
    expect(parsePasswordRecoveryUrl("sonhomais://reset-password")).toMatchObject({
      kind: "error",
      reason: "invalid",
    });
  });

  it("ignores Google OAuth callbacks", () => {
    expect(parsePasswordRecoveryUrl("sonhomais://auth/callback?code=abc")).toEqual({ kind: "unrelated" });
  });
});

describe("passwordRecoveryUrlFromRouterParams", () => {
  it("rebuilds a recovery URL from Expo Router search params", () => {
    expect(passwordRecoveryUrlFromRouterParams({ code: "router-code", type: "recovery" })).toBe(
      "reset-password?code=router-code&type=recovery",
    );
    expect(parsePasswordRecoveryUrl(passwordRecoveryUrlFromRouterParams({ code: "router-code" }))).toEqual({
      kind: "code",
      code: "router-code",
    });
  });
});

describe("completePasswordRecoveryCallback", () => {
  it("exchanges a PKCE code once and skips an immediate duplicate", async () => {
    const auth = authClient();
    const dedupe: PasswordRecoveryDedupeState = {};
    const url = "sonhomais://reset-password?code=once";

    const first = await completePasswordRecoveryCallback(url, auth, dedupe, { now: () => 1_000 });
    const second = await completePasswordRecoveryCallback(url, auth, dedupe, { now: () => 1_200 });

    expect(first.processed).toBe(true);
    expect(second).toMatchObject({ processed: false, reason: "duplicate" });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("once");
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("establishes a session from implicit recovery tokens", async () => {
    const auth = authClient();
    const result = await completePasswordRecoveryCallback(
      "sonhomais://reset-password#access_token=tok_access&refresh_token=tok_refresh&type=recovery",
      auth,
    );

    expect(result.processed).toBe(true);
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: "tok_access",
      refresh_token: "tok_refresh",
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects an expired recovery link without exchanging a session", async () => {
    const auth = authClient();
    await expect(completePasswordRecoveryCallback(
      "sonhomais://reset-password?error=access_denied&error_code=otp_expired",
      auth,
    )).rejects.toMatchObject({ reason: "expired" });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects a recovery URL without credentials", async () => {
    const auth = authClient();
    await expect(completePasswordRecoveryCallback("sonhomais://reset-password", auth))
      .rejects.toBeInstanceOf(PasswordRecoveryLinkError);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("updatePasswordDuringRecovery", () => {
  it("updates the password only after a recovery session exists", async () => {
    const auth = authClient();
    await updatePasswordDuringRecovery(sessionFixture(), auth, "NovaSenha@2026");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "NovaSenha@2026" });
  });

  it("does not update the password without a session", async () => {
    const auth = authClient();
    await expect(updatePasswordDuringRecovery(null, auth, "NovaSenha@2026")).rejects.toMatchObject({
      reason: "session",
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("recovery screen routing", () => {
  it("opens the recovery screen while the link is loading, ready, or failed", () => {
    expect(shouldOpenPasswordRecoveryScreen({ pending: true, active: false, error: null })).toBe(true);
    expect(shouldOpenPasswordRecoveryScreen({ pending: false, active: true, error: null })).toBe(true);
    expect(shouldOpenPasswordRecoveryScreen({ pending: false, active: false, error: "expired" })).toBe(true);
    expect(shouldOpenPasswordRecoveryScreen({ pending: false, active: false, error: null })).toBe(false);
  });

  it("requires a session before the password can be saved", () => {
    expect(() => requireRecoverySession(null)).toThrow(PasswordRecoveryLinkError);
    expect(requireRecoverySession(sessionFixture()).user.id).toBe("user-1");
  });

  it("maps expired and invalid links to user-facing messages without leaking codes", () => {
    expect(getPasswordRecoveryLinkErrorMessage(new PasswordRecoveryLinkError("expired", "otp_expired")))
      .toContain("expirou");
    expect(getPasswordRecoveryLinkErrorMessage(new PasswordRecoveryLinkError("invalid", "missing_code")))
      .toContain("não é mais válido");
    expect(getPasswordRecoveryLinkErrorMessage({ code: "otp_expired", message: "pkce_code_abc123" }))
      .toContain("expirou");
    expect(getPasswordRecoveryLinkErrorMessage({ message: "pkce_code_abc123" })).not.toContain("pkce_code");
  });
});
