import { describe, expect, it, vi } from "vitest";
import {
  AccountDeletionError,
  createAccountDeletionRunner,
  isAccountDeletionConfirmation,
  isExpiredAccountDeletionSessionError,
  shouldRequireAccountDeletionLocalIdentity,
  type AccountDeletionDependencies,
} from "./accountDeletionCore";

const SESSION = { userId: "user-a", accessToken: "token-a" };

function fixture(overrides: Partial<AccountDeletionDependencies> = {}) {
  const deps: AccountDeletionDependencies = {
    expectedUserId: "user-a",
    getSession: vi.fn(async () => SESSION),
    validateSession: vi.fn(async () => "valid" as const),
    invokeDeleteAccount: vi.fn(async () => ({
      data: { ok: true, deleted: true },
      error: null,
    })),
    getUserStateAfterFailure: vi.fn(async () => "exists" as const),
    finalizeDeletedAccountLocally: vi.fn(async () => "cleared" as const),
    ...overrides,
  };
  return { deps, run: createAccountDeletionRunner(deps) };
}

describe("account deletion confirmation", () => {
  it.each(["", "excluir", " EXCLUIR ", "EXCLUIR\n", "Excluir"])(
    "rejects %j",
    (value) => expect(isAccountDeletionConfirmation(value)).toBe(false),
  );

  it("accepts only the exact confirmation", () => {
    expect(isAccountDeletionConfirmation("EXCLUIR")).toBe(true);
  });
});

describe("account deletion local identity", () => {
  const base = {
    platform: "android",
    appLockSupported: true,
    appLockEnabled: true,
    hasPin: false,
    biometricEnabled: true,
    biometricAvailable: true,
  };

  it("requires configured native biometrics", () => {
    expect(shouldRequireAccountDeletionLocalIdentity(base)).toBe(true);
  });

  it("accepts PIN-only App Lock", () => {
    expect(shouldRequireAccountDeletionLocalIdentity({
      ...base,
      biometricEnabled: false,
      biometricAvailable: false,
      hasPin: true,
    })).toBe(true);
  });

  it("does not emulate App Lock on web or require it when disabled", () => {
    expect(shouldRequireAccountDeletionLocalIdentity({ ...base, platform: "web" })).toBe(false);
    expect(shouldRequireAccountDeletionLocalIdentity({ ...base, appLockEnabled: false })).toBe(false);
  });
});

describe("account deletion session errors", () => {
  it("recognizes Supabase 401/403 and explicit invalid-session codes", () => {
    expect(isExpiredAccountDeletionSessionError({ status: 401 })).toBe(true);
    expect(isExpiredAccountDeletionSessionError({ status: 403 })).toBe(true);
    expect(isExpiredAccountDeletionSessionError({ code: "bad_jwt" })).toBe(true);
    expect(isExpiredAccountDeletionSessionError({ code: "session_not_found" })).toBe(true);
    expect(isExpiredAccountDeletionSessionError({ status: 500 })).toBe(false);
  });
});

describe("account deletion runner", () => {
  it("uses the authenticated session and finalizes that same user", async () => {
    const { deps, run } = fixture();

    await expect(run()).resolves.toEqual({
      deleted: true,
      userId: "user-a",
      localCleanup: "cleared",
    });
    expect(deps.invokeDeleteAccount).toHaveBeenCalledWith("token-a");
    expect(deps.finalizeDeletedAccountLocally).toHaveBeenCalledWith("user-a");
  });

  it("has no client userId argument that could select another account", async () => {
    const { deps, run } = fixture();
    const manipulatedClientState = { userId: "user-b" };

    await run();

    expect(manipulatedClientState.userId).toBe("user-b");
    expect(deps.invokeDeleteAccount).toHaveBeenCalledWith("token-a");
    expect(deps.finalizeDeletedAccountLocally).toHaveBeenCalledWith("user-a");
  });

  it("rejects a missing session before invoking the backend", async () => {
    const { deps, run } = fixture({ getSession: vi.fn(async () => null) });

    await expect(run()).rejects.toMatchObject({ code: "session-expired" });
    expect(deps.invokeDeleteAccount).not.toHaveBeenCalled();
    expect(deps.finalizeDeletedAccountLocally).not.toHaveBeenCalled();
  });

  it("aborts before the backend when the active account changed", async () => {
    const { deps, run } = fixture({
      getSession: vi.fn(async () => ({ userId: "user-b", accessToken: "token-b" })),
    });

    await expect(run()).rejects.toMatchObject({ code: "account-changed" });
    expect(deps.validateSession).not.toHaveBeenCalled();
    expect(deps.invokeDeleteAccount).not.toHaveBeenCalled();
    expect(deps.finalizeDeletedAccountLocally).not.toHaveBeenCalled();
  });

  it("rejects an expired session before invoking the backend", async () => {
    const { deps, run } = fixture({ validateSession: vi.fn(async () => "expired" as const) });

    await expect(run()).rejects.toMatchObject({ code: "session-expired" });
    expect(deps.invokeDeleteAccount).not.toHaveBeenCalled();
  });

  it("keeps local state when the backend fails and the user still exists", async () => {
    const { deps, run } = fixture({
      invokeDeleteAccount: vi.fn(async () => ({ data: null, error: new Error("network") })),
    });

    await expect(run()).rejects.toMatchObject({ code: "failed" });
    expect(deps.finalizeDeletedAccountLocally).not.toHaveBeenCalled();
  });

  it("treats an explicit missing user after an ambiguous response as success", async () => {
    const { deps, run } = fixture({
      invokeDeleteAccount: vi.fn(async () => ({ data: null, error: new Error("response lost") })),
      getUserStateAfterFailure: vi.fn(async () => "missing" as const),
    });

    await expect(run()).resolves.toEqual({
      deleted: true,
      userId: "user-a",
      localCleanup: "cleared",
    });
    expect(deps.finalizeDeletedAccountLocally).toHaveBeenCalledTimes(1);
  });

  it("classifies a backend 401 as an expired session", async () => {
    const httpError = Object.assign(new Error("unauthorized"), { context: { status: 401 } });
    const { deps, run } = fixture({
      invokeDeleteAccount: vi.fn(async () => ({ data: null, error: httpError })),
    });

    await expect(run()).rejects.toMatchObject({ code: "session-expired" });
    expect(deps.getUserStateAfterFailure).not.toHaveBeenCalled();
    expect(deps.finalizeDeletedAccountLocally).not.toHaveBeenCalled();
  });

  it("classifies an expired session found after an ambiguous response", async () => {
    const { deps, run } = fixture({
      invokeDeleteAccount: vi.fn(async () => ({ data: null, error: new Error("network") })),
      getUserStateAfterFailure: vi.fn(async () => "expired" as const),
    });

    await expect(run()).rejects.toMatchObject({ code: "session-expired" });
    expect(deps.finalizeDeletedAccountLocally).not.toHaveBeenCalled();
  });

  it("deduplicates simultaneous requests and local cleanup", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const invoke = vi.fn(async () => {
      await waiting;
      return { data: { ok: true, deleted: true }, error: null };
    });
    const { deps, run } = fixture({ invokeDeleteAccount: invoke });

    const first = run();
    const second = run();
    expect(first).toBe(second);
    release();
    await Promise.all([first, second]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(deps.finalizeDeletedAccountLocally).toHaveBeenCalledTimes(1);
  });

  it("reports that another account became active without treating deletion as failed", async () => {
    const { run } = fixture({
      finalizeDeletedAccountLocally: vi.fn(async () => "different-user" as const),
    });

    await expect(run()).resolves.toEqual({
      deleted: true,
      userId: "user-a",
      localCleanup: "different-user",
    });
  });

  it("uses controlled error types", () => {
    expect(new AccountDeletionError("failed")).toMatchObject({
      name: "AccountDeletionError",
      code: "failed",
    });
  });
});
