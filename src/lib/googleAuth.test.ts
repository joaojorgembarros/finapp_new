import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import {
  GoogleAuthAlreadyHandledError,
  GoogleAuthCancelledError,
  GoogleAuthPendingConfigurationError,
  beginGoogleAuthAttempt,
  completeGoogleOAuthCallback,
  endGoogleAuthAttempt,
  getGoogleAuthErrorMessage,
  getGoogleAuthFailureAlert,
  getGoogleAuthPendingError,
  getGoogleCallbackRedirect,
  googleOAuthRedirectUrl,
  GOOGLE_OAUTH_CALLBACK_PATH,
  isGoogleAuthAlreadyHandled,
  isGoogleAuthCancelled,
  parseGoogleOAuthCallbackUrl,
  reportGoogleOAuthCallback,
  signInWithGoogle,
  type GoogleAuthBrowserResult,
  type GoogleAuthClient,
  type GoogleAuthDependencies,
  type GoogleOAuthCallbackReport,
  type GoogleOAuthDedupeState,
} from "./googleAuth";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-linking", () => ({
  // Expo SDK 54 appends the path as-is for a standalone custom scheme.
  createURL: (path: string) => `sonhomais://${path}`,
}));
vi.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
  warmUpAsync: vi.fn(),
  coolDownAsync: vi.fn(),
}));

function sessionFixture(): Session {
  return {
    user: { id: "user-1", user_metadata: {} },
  } as Session;
}

function authClient(overrides: Partial<GoogleAuthClient> = {}): GoogleAuthClient {
  return {
    signInWithOAuth: vi.fn(async () => ({
      data: { url: "https://accounts.google.com/o/oauth2" },
      error: null,
    })),
    exchangeCodeForSession: vi.fn(async () => ({
      data: { session: sessionFixture() },
      error: null,
    })),
    getSession: vi.fn(async () => ({
      data: { session: sessionFixture() },
    })),
    ...overrides,
  };
}

function dependencies(overrides: Partial<GoogleAuthDependencies> = {}): GoogleAuthDependencies {
  return {
    platform: "ios",
    createRedirectUrl: googleOAuthRedirectUrl,
    fetchGoogleProviderEnabled: async () => true,
    auth: authClient(),
    maybeCompleteAuthSession: vi.fn(),
    warmUpAsync: vi.fn(async () => undefined),
    coolDownAsync: vi.fn(async () => undefined),
    openAuthSessionAsync: vi.fn(async (): Promise<GoogleAuthBrowserResult> => ({
      type: "success",
      url: "sonhomais://auth/callback?code=oauth-code",
    })),
    ...overrides,
  };
}

describe("parseGoogleOAuthCallbackUrl", () => {
  it("reads a PKCE code from the production scheme", () => {
    expect(parseGoogleOAuthCallbackUrl("sonhomais://auth/callback?code=abc123")).toEqual({
      kind: "code",
      code: "abc123",
    });
  });

  it("reads a PKCE code from an Expo Go deep link", () => {
    expect(parseGoogleOAuthCallbackUrl("exp://192.168.0.8:8081/--/auth/callback?code=expo-code")).toEqual({
      kind: "code",
      code: "expo-code",
    });
  });

  it("treats Google access_denied as cancellation", () => {
    expect(parseGoogleOAuthCallbackUrl("sonhomais://auth/callback?error=access_denied")).toEqual({
      kind: "cancelled",
    });
  });

  it("ignores password recovery and other app URLs", () => {
    expect(parseGoogleOAuthCallbackUrl("sonhomais://reset-password?code=abc")).toEqual({ kind: "unrelated" });
    expect(parseGoogleOAuthCallbackUrl("sonhomais://settings?code=abc")).toEqual({ kind: "unrelated" });
  });
});

describe("completeGoogleOAuthCallback", () => {
  it("exchanges a code once and skips an immediate duplicate", async () => {
    const auth = authClient();
    const dedupe: GoogleOAuthDedupeState = {};
    const url = "sonhomais://auth/callback?code=once";

    const first = await completeGoogleOAuthCallback(url, auth, dedupe);
    const second = await completeGoogleOAuthCallback(url, auth, dedupe);

    expect(first.processed).toBe(true);
    expect(second).toMatchObject({ processed: false, reason: "duplicate" });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });
});

describe("googleOAuthRedirectUrl", () => {
  it("keeps the Expo Router callback path and standalone scheme", () => {
    expect(GOOGLE_OAUTH_CALLBACK_PATH).toBe("auth/callback");
    expect(googleOAuthRedirectUrl()).toBe("sonhomais://auth/callback");
    expect(googleOAuthRedirectUrl()).not.toBe("sonhomais:///auth/callback");
  });
});

describe("signInWithGoogle", () => {
  it("opens the secure browser and establishes a session", async () => {
    const deps = dependencies();
    const session = await signInWithGoogle(deps);

    expect(deps.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "sonhomais://auth/callback",
        skipBrowserRedirect: true,
      },
    });
    expect(deps.openAuthSessionAsync).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2",
      "sonhomais://auth/callback",
    );
    expect(session.user.id).toBe("user-1");
  });

  it("does not fake a session when the provider is disabled", async () => {
    const deps = dependencies({
      fetchGoogleProviderEnabled: async () => false,
      openAuthSessionAsync: vi.fn(async () => {
        throw new Error("browser should not open");
      }),
    });

    await expect(signInWithGoogle(deps)).rejects.toBeInstanceOf(GoogleAuthPendingConfigurationError);
    expect(deps.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("maps a remote provider-disabled error without opening a fake session", async () => {
    const deps = dependencies({
      fetchGoogleProviderEnabled: async () => null,
      auth: authClient({
        signInWithOAuth: vi.fn(async () => ({
          data: { url: null },
          error: { message: "Unsupported provider: provider is not enabled" },
        })),
      }),
    });

    await expect(signInWithGoogle(deps)).rejects.toMatchObject({
      message: "Unsupported provider: provider is not enabled",
    });
  });

  it("treats closing the browser as cancellation", async () => {
    const deps = dependencies({
      openAuthSessionAsync: vi.fn(async (): Promise<GoogleAuthBrowserResult> => ({ type: "cancel" })),
    });

    await expect(signInWithGoogle(deps)).rejects.toBeInstanceOf(GoogleAuthCancelledError);
  });

  it("reuses a session already established by the app link", async () => {
    const session = sessionFixture();
    const auth = authClient({
      exchangeCodeForSession: vi.fn(async () => ({
        data: { session },
        error: null,
      })),
      getSession: vi.fn(async () => ({ data: { session } })),
    });
    const dedupe: GoogleOAuthDedupeState = {};
    await completeGoogleOAuthCallback("sonhomais://auth/callback?code=shared", auth, dedupe);

    const established = await signInWithGoogle(dependencies({
      auth,
      openAuthSessionAsync: vi.fn(async (): Promise<GoogleAuthBrowserResult> => ({
        type: "success",
        url: "sonhomais://auth/callback?code=shared",
      })),
    }), dedupe);

    expect(established.user.id).toBe("user-1");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });
});

describe("getGoogleAuthErrorMessage", () => {
  it("uses a pending-configuration message in development and hides it from cancelled flows", () => {
    expect(isGoogleAuthCancelled(new GoogleAuthCancelledError())).toBe(true);
    expect(getGoogleAuthErrorMessage(new GoogleAuthCancelledError(), true)).toBeNull();
    expect(getGoogleAuthErrorMessage(new GoogleAuthPendingConfigurationError(), true)).toContain("configuração");
    expect(getGoogleAuthErrorMessage(new GoogleAuthPendingConfigurationError(), false)).toContain("não está disponível");
    expect(getGoogleAuthErrorMessage({ message: "Unsupported provider: provider is not enabled" }, false)).not.toMatch(/supabase/i);
    expect(getGoogleAuthErrorMessage(new Error("Failed to fetch"))).toContain("internet");
    expect(getGoogleAuthErrorMessage(new Error("missing_code"))).toBe(
      "Não foi possível concluir o login com Google. Tente novamente.",
    );
    expect(getGoogleAuthErrorMessage(new Error("missing_session"))).toBe(
      "Não foi possível entrar com o Google. Tente novamente.",
    );
    expect(getGoogleAuthErrorMessage(new GoogleAuthAlreadyHandledError())).toBeNull();
    expect(isGoogleAuthAlreadyHandled(new GoogleAuthAlreadyHandledError())).toBe(true);
    expect(getGoogleAuthFailureAlert("Sem conexão. Verifique sua internet e tente novamente.")).toEqual({
      title: "Não foi possível entrar com o Google",
      message: "Sem conexão. Verifique sua internet e tente novamente.",
    });
    expect(getGoogleAuthFailureAlert(null)).toBeNull();
  });
});

describe("reportGoogleOAuthCallback", () => {
  it("reports a successful callback with a session", async () => {
    const report = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?code=ok",
      authClient(),
      {},
    );

    expect(report).toMatchObject({
      kind: "success",
      processed: true,
      errorMessage: null,
    });
    if (report.kind === "success") expect(report.session.user.id).toBe("user-1");
  });

  it("turns an invalid callback into visible user feedback", async () => {
    const report = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?error=server_error",
      authClient(),
      {},
    );

    expect(report.kind).toBe("error");
    expect(report.errorMessage).toBe("Não foi possível entrar com o Google. Tente novamente.");
    expect(getGoogleAuthFailureAlert(report.errorMessage)?.title).toBe(
      "Não foi possível entrar com o Google",
    );
  });

  it("turns a failed code exchange into visible user feedback", async () => {
    const report = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?code=bad",
      authClient({
        exchangeCodeForSession: vi.fn(async () => ({
          data: { session: null },
          error: { message: "Failed to fetch", code: "network" },
        })),
      }),
      {},
    );

    expect(report.kind).toBe("error");
    expect(report.errorMessage).toContain("internet");
  });

  it("does not surface cancellation as an error", async () => {
    const report = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?error=access_denied",
      authClient(),
      {},
    );

    expect(report).toEqual({ kind: "cancelled", processed: false, errorMessage: null });
    expect(getGoogleAuthFailureAlert(report.errorMessage)).toBeNull();
  });
});

describe("getGoogleCallbackRedirect", () => {
  it("sends an authenticated session to the post-auth route", () => {
    expect(getGoogleCallbackRedirect({
      session: sessionFixture(),
      loading: false,
      callbackReady: true,
      authenticatedHref: "/(app)/journey",
    })).toEqual({ pending: false, href: "/(app)/journey" });
  });

  it("keeps the spinner until the callback finishes", () => {
    expect(getGoogleCallbackRedirect({
      session: null,
      loading: false,
      callbackReady: false,
      authenticatedHref: "/(app)/journey",
    })).toEqual({ pending: true, href: null });
  });

  it("falls back to login after a failed callback", () => {
    expect(getGoogleCallbackRedirect({
      session: null,
      loading: false,
      callbackReady: true,
      authenticatedHref: "/(app)/journey",
    })).toEqual({ pending: false, href: "/(auth)/login" });
  });
});

describe("Google OAuth visible result dedupe", () => {
  function visibleErrors(reports: GoogleOAuthCallbackReport[]) {
    return reports
      .filter((report) => report.kind === "error")
      .map((report) => report.errorMessage);
  }

  async function signInWithBrowserUrl(
    url: string,
    auth: GoogleAuthClient,
    dedupe: GoogleOAuthDedupeState,
  ) {
    return signInWithGoogle(dependencies({
      auth,
      openAuthSessionAsync: vi.fn(async (): Promise<GoogleAuthBrowserResult> => ({
        type: "success",
        url,
      })),
    }), dedupe);
  }

  it("publishes only one error when the deep link and WebBrowser report the same callback", async () => {
    const dedupe: GoogleOAuthDedupeState = {};
    const url = "sonhomais://auth/callback?error=server_error";
    const auth = authClient();
    beginGoogleAuthAttempt(dedupe);

    const [deepLink, parallel] = await Promise.all([
      reportGoogleOAuthCallback(url, auth, dedupe),
      reportGoogleOAuthCallback(url, auth, dedupe),
    ]);

    expect(visibleErrors([deepLink, parallel])).toHaveLength(1);
    expect(getGoogleAuthFailureAlert(deepLink.kind === "error" ? deepLink.errorMessage : parallel.errorMessage)).toEqual({
      title: "Não foi possível entrar com o Google",
      message: "Não foi possível entrar com o Google. Tente novamente.",
    });

    await expect(signInWithBrowserUrl(url, auth, dedupe)).rejects.toBeInstanceOf(GoogleAuthAlreadyHandledError);
    expect(getGoogleAuthErrorMessage(new GoogleAuthAlreadyHandledError())).toBeNull();
  });

  it("allows a later attempt to show a new error for the same callback identity", async () => {
    const dedupe: GoogleOAuthDedupeState = {};
    const url = "sonhomais://auth/callback?error=server_error";
    const auth = authClient();

    beginGoogleAuthAttempt(dedupe);
    const first = await reportGoogleOAuthCallback(url, auth, dedupe);
    endGoogleAuthAttempt(dedupe);

    beginGoogleAuthAttempt(dedupe);
    const second = await reportGoogleOAuthCallback(url, auth, dedupe);

    expect(first.kind).toBe("error");
    expect(second.kind).toBe("error");
    expect(visibleErrors([first, second])).toHaveLength(2);
  });

  it("still surfaces different errors from different attempts", async () => {
    const dedupe: GoogleOAuthDedupeState = {};
    const auth = authClient({
      exchangeCodeForSession: vi.fn(async () => ({
        data: { session: null },
        error: { message: "Failed to fetch", code: "network" },
      })),
    });

    beginGoogleAuthAttempt(dedupe);
    const first = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?error=server_error",
      auth,
      dedupe,
    );
    endGoogleAuthAttempt(dedupe);

    beginGoogleAuthAttempt(dedupe);
    const second = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?code=bad",
      auth,
      dedupe,
    );

    expect(first.kind).toBe("error");
    expect(second.kind).toBe("error");
    expect(first.errorMessage).toBe("Não foi possível entrar com o Google. Tente novamente.");
    expect(second.errorMessage).toContain("internet");
  });

  it("keeps cancellation silent across deep link and WebBrowser", async () => {
    const dedupe: GoogleOAuthDedupeState = {};
    const url = "sonhomais://auth/callback?error=access_denied";
    const auth = authClient();
    beginGoogleAuthAttempt(dedupe);

    const deepLink = await reportGoogleOAuthCallback(url, auth, dedupe);
    await expect(signInWithBrowserUrl(url, auth, dedupe)).rejects.toBeInstanceOf(GoogleAuthCancelledError);

    expect(deepLink.kind).toBe("cancelled");
    expect(getGoogleAuthFailureAlert(deepLink.errorMessage)).toBeNull();
    expect(getGoogleAuthErrorMessage(new GoogleAuthCancelledError())).toBeNull();
  });

  it("clears any pending error when a later callback succeeds", async () => {
    const dedupe: GoogleOAuthDedupeState = {};
    const auth = authClient();
    beginGoogleAuthAttempt(dedupe);

    const failed = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?error=server_error",
      auth,
      dedupe,
    );
    expect(failed.kind).toBe("error");
    expect(getGoogleAuthPendingError(dedupe)).toBe(
      "Não foi possível entrar com o Google. Tente novamente.",
    );

    const succeeded = await reportGoogleOAuthCallback(
      "sonhomais://auth/callback?code=ok",
      auth,
      dedupe,
    );
    expect(succeeded.kind).toBe("success");
    expect(getGoogleAuthPendingError(dedupe)).toBeNull();
  });
});
