import { describe, expect, it, vi } from "vitest";
import { canStartLogout, runAccountLogout } from "./accountLogout";

describe("runAccountLogout", () => {
  it("navigates to login after a successful sign-out", async () => {
    const signOut = vi.fn(async () => ({
      remoteSignOutCompleted: true,
      localSessionCleared: true,
      activeAccountChanged: false,
      errorMessage: null,
    }));
    const replaceLogin = vi.fn();
    const showFeedback = vi.fn();
    const setBusy = vi.fn();

    await runAccountLogout({
      busy: false,
      signOut,
      replaceLogin,
      showFeedback,
      setBusy,
    });

    expect(setBusy).toHaveBeenNthCalledWith(1, true);
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(replaceLogin).toHaveBeenCalledTimes(1);
    expect(showFeedback).not.toHaveBeenCalled();
  });

  it("shows visible feedback when sign-out fails after clearing the local session", async () => {
    const signOut = vi.fn(async () => ({
      remoteSignOutCompleted: false,
      localSessionCleared: true,
      activeAccountChanged: false,
      errorMessage: "Não foi possível confirmar a saída dos outros dispositivos. Tente novamente quando estiver conectado.",
    }));
    const replaceLogin = vi.fn();
    const showFeedback = vi.fn();

    await runAccountLogout({
      busy: false,
      signOut,
      replaceLogin,
      showFeedback,
      setBusy: vi.fn(),
    });

    expect(replaceLogin).toHaveBeenCalledTimes(1);
    expect(showFeedback).toHaveBeenCalledWith(
      "Sessão encerrada neste aparelho",
      "Não foi possível confirmar a saída dos outros dispositivos. Tente novamente quando estiver conectado.",
    );
  });

  it("does not start a second sign-out while the button is loading", async () => {
    const signOut = vi.fn(async () => ({
      remoteSignOutCompleted: true,
      localSessionCleared: true,
      activeAccountChanged: false,
      errorMessage: null,
    }));

    expect(canStartLogout(true)).toBe(false);
    await runAccountLogout({
      busy: true,
      signOut,
      replaceLogin: vi.fn(),
      showFeedback: vi.fn(),
      setBusy: vi.fn(),
    });

    expect(signOut).not.toHaveBeenCalled();
  });

  it("keeps the UI usable and shows an error when the session cannot be cleared", async () => {
    const setBusy = vi.fn();
    const replaceLogin = vi.fn();
    const showFeedback = vi.fn();
    await runAccountLogout({
      busy: false,
      signOut: async () => ({
        remoteSignOutCompleted: false,
        localSessionCleared: false,
        activeAccountChanged: false,
        errorMessage: "Sem conexão. Verifique sua internet e tente novamente.",
      }),
      replaceLogin,
      showFeedback,
      setBusy,
    });

    expect(replaceLogin).not.toHaveBeenCalled();
    expect(showFeedback).toHaveBeenCalledWith(
      "Não foi possível sair",
      "Sem conexão. Verifique sua internet e tente novamente.",
    );
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });

  it("never leaves an unhandled rejection when signOut throws", async () => {
    const showFeedback = vi.fn();
    const setBusy = vi.fn();

    await expect(runAccountLogout({
      busy: false,
      signOut: async () => {
        throw new Error("boom");
      },
      replaceLogin: vi.fn(),
      showFeedback,
      setBusy,
    })).resolves.toBeUndefined();

    expect(showFeedback).toHaveBeenCalledWith(
      "Não foi possível sair",
      "Não foi possível sair agora. Tente novamente.",
    );
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });
});
