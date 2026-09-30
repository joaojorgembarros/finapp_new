import { describe, expect, it, vi } from "vitest";
import type { AuthSessionClient } from "./sessionValidity";
import {
  createSignOutGate,
  getSignOutFeedback,
  performSignOut,
  shouldLeaveAuthenticatedApp,
} from "./signOutSession";

function authClient(signOut: AuthSessionClient["signOut"]): Pick<AuthSessionClient, "signOut"> {
  return { signOut };
}

describe("performSignOut", () => {
  it("clears the session on a successful remote sign-out", async () => {
    const signOut: AuthSessionClient["signOut"] = vi.fn(async () => ({ error: null }));
    const result = await performSignOut(authClient(signOut));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      remoteSignOutCompleted: true,
      localSessionCleared: true,
      activeAccountChanged: false,
      errorMessage: null,
    });
    expect(shouldLeaveAuthenticatedApp(result)).toBe(true);
    expect(getSignOutFeedback(result)).toBeNull();
  });

  it("does not throw when remote sign-out fails and still clears the local session", async () => {
    const signOut: AuthSessionClient["signOut"] = vi.fn(async (options) => {
      if (options?.scope === "local") return { error: null };
      return { error: { message: "Failed to fetch", code: "network" } };
    });

    const result = await performSignOut(authClient(signOut));

    expect(signOut).toHaveBeenCalledTimes(2);
    expect(result.remoteSignOutCompleted).toBe(false);
    expect(result.localSessionCleared).toBe(true);
    expect(result.errorMessage).toContain("outros dispositivos");
    expect(shouldLeaveAuthenticatedApp(result)).toBe(true);
    expect(getSignOutFeedback(result)).toEqual({
      title: "Sessão encerrada neste aparelho",
      message: result.errorMessage,
    });
  });

  it("keeps the user in the app when even local sign-out fails", async () => {
    const signOut: AuthSessionClient["signOut"] = vi.fn(async () => ({
      error: { message: "Failed to fetch", code: "network" },
    }));

    const result = await performSignOut(authClient(signOut));

    expect(result.localSessionCleared).toBe(false);
    expect(shouldLeaveAuthenticatedApp(result)).toBe(false);
    expect(getSignOutFeedback(result)?.title).toBe("Não foi possível sair");
    expect(getSignOutFeedback(result)?.message).toContain("internet");
  });

  it("treats an already-invalid session as a quiet local logout", async () => {
    const signOut: AuthSessionClient["signOut"] = vi.fn(async () => ({
      error: { message: "User from sub claim in JWT does not exist", code: "user_not_found" },
    }));

    const result = await performSignOut(authClient(signOut));

    expect(result.localSessionCleared).toBe(true);
    expect(result.errorMessage).toBeNull();
    expect(shouldLeaveAuthenticatedApp(result)).toBe(true);
  });
});

describe("createSignOutGate", () => {
  it("reuses the in-flight sign-out instead of starting a second one", async () => {
    let resolveSignOut: ((value: { error: null }) => void) | undefined;
    const perform = vi.fn(() => new Promise<{
      remoteSignOutCompleted: boolean;
      localSessionCleared: boolean;
      activeAccountChanged: boolean;
      errorMessage: string | null;
    }>((resolve) => {
      resolveSignOut = () =>
        resolve({
          remoteSignOutCompleted: true,
          localSessionCleared: true,
          activeAccountChanged: false,
          errorMessage: null,
        });
    }));

    const signOut = createSignOutGate(perform);
    const first = signOut();
    const second = signOut();

    expect(first).toBe(second);
    expect(perform).toHaveBeenCalledTimes(1);
    resolveSignOut?.({ error: null });
    await first;
  });
});
