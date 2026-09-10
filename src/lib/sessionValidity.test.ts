import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { getPostAuthHref } from "./postAuthHref";
import {
  isMissingAuthUserError,
  restoreValidatedSession,
  shouldApplyAuthStateSession,
  type AuthSessionClient,
} from "./sessionValidity";

function sessionFixture(userOverrides: Record<string, unknown> = {}): Session {
  return {
    user: {
      id: "user-1",
      user_metadata: { new_onboarding_done: false },
      ...userOverrides,
    },
  } as unknown as Session;
}

function authClient(overrides: Partial<AuthSessionClient> = {}): AuthSessionClient {
  return {
    getSession: vi.fn(async () => ({ data: { session: sessionFixture() }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe("isMissingAuthUserError", () => {
  it("detects the deleted-user JWT error", () => {
    expect(isMissingAuthUserError({ message: "User from sub claim in JWT does not exist" })).toBe(true);
    expect(isMissingAuthUserError({ code: "user_not_found", message: "User not found" })).toBe(true);
    expect(isMissingAuthUserError({ message: "Failed to fetch" })).toBe(false);
  });
});

describe("restoreValidatedSession", () => {
  it("keeps a local session when getUser confirms the user", async () => {
    const session = sessionFixture();
    const auth = authClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
    });

    const result = await restoreValidatedSession(auth);

    expect(result).toEqual({ status: "authenticated", session });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(getPostAuthHref(session)).toBe("/(onboarding)/dreams");
  });

  it("clears a local session when the Auth user no longer exists", async () => {
    const session = sessionFixture();
    const auth = authClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getUser: vi.fn(async () => ({
        data: { user: null },
        error: { message: "User from sub claim in JWT does not exist" },
      })),
    });

    const result = await restoreValidatedSession(auth);

    expect(result).toEqual({ status: "cleared_invalid", reason: "missing_user" });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(getPostAuthHref(null)).toBe("/(auth)/login");
  });

  it("sends a device with no session to login", async () => {
    const auth = authClient({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(async () => {
        throw new Error("getUser should not run without a session");
      }),
    });

    await expect(restoreValidatedSession(auth)).resolves.toEqual({ status: "anonymous" });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(getPostAuthHref(null)).toBe("/(auth)/login");
  });

  it("does not treat password recovery as an invalid session", async () => {
    const session = sessionFixture({ user_metadata: { recovery: true } });
    const auth = authClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    });

    const result = await restoreValidatedSession(auth);

    expect(result.status).toBe("authenticated");
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("does not clear a Google SIGNED_IN session when getUser succeeds", async () => {
    const session = sessionFixture({
      id: "google-user",
      app_metadata: { provider: "google" },
      user_metadata: {},
    });
    const auth = authClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: "google-user" } }, error: null })),
    });

    const result = await restoreValidatedSession(auth);

    expect(result).toEqual({ status: "authenticated", session });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("keeps the local session on a transient network error", async () => {
    const session = sessionFixture();
    const auth = authClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getUser: vi.fn(async () => ({
        data: { user: null },
        error: { message: "Failed to fetch" },
      })),
    });

    const result = await restoreValidatedSession(auth);

    expect(result).toEqual({ status: "authenticated", session });
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe("shouldApplyAuthStateSession", () => {
  it("ignores INITIAL_SESSION so a stale local JWT is not trusted before getUser", () => {
    expect(shouldApplyAuthStateSession("INITIAL_SESSION")).toBe(false);
  });

  it("still applies PASSWORD_RECOVERY and Google SIGNED_IN", () => {
    expect(shouldApplyAuthStateSession("PASSWORD_RECOVERY")).toBe(true);
    expect(shouldApplyAuthStateSession("SIGNED_IN")).toBe(true);
    expect(shouldApplyAuthStateSession("SIGNED_OUT")).toBe(true);
    expect(shouldApplyAuthStateSession("TOKEN_REFRESHED")).toBe(true);
  });
});
