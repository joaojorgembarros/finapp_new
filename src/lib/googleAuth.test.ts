import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import {
  GoogleAuthCancelledError,
  GoogleAuthPendingConfigurationError,
  completeGoogleOAuthCallback,
  getGoogleAuthErrorMessage,
  isGoogleAuthCancelled,
  parseGoogleOAuthCallbackUrl,
  signInWithGoogle,
  type GoogleAuthBrowserResult,
  type GoogleAuthClient,
  type GoogleAuthDependencies,
  type GoogleOAuthDedupeState,
} from "./googleAuth";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-linking", () => ({
  createURL: (path: string) => `sonhomais://${path.replace(/^\//, "")}`,
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
    createRedirectUrl: () => "sonhomais://auth/callback",
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
    expect(parseGoogleOAuthCallbackUrl("sonhomais://open-finance?code=abc")).toEqual({ kind: "unrelated" });
  });
});

describe("completeGoogleOAuthCallback", () => {
  it("exchanges a code once and skips an immediate duplicate", async () => {
    const auth = authClient();
    const dedupe: GoogleOAuthDedupeState = {};
    const url = "sonhomais://auth/callback?code=once";

    const first = await completeGoogleOAuthCallback(url, auth, dedupe, { now: () => 1_000 });
    const second = await completeGoogleOAuthCallback(url, auth, dedupe, { now: () => 1_200 });

    expect(first.processed).toBe(true);
    expect(second).toMatchObject({ processed: false, reason: "duplicate" });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
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
    expect(deps.openAuthSessionAsync).toHaveBeenCalled();
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
  });
});
