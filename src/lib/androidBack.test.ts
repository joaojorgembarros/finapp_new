import { describe, expect, it } from "vitest";
import { getAndroidBackAction } from "./androidBack";

describe("getAndroidBackAction", () => {
  it("fecha o menu antes de navegar", () => {
    expect(getAndroidBackAction({ menuOpen: true, tab: "controle", isSecondPress: false })).toBe("close-menu");
  });

  it("volta de Controle para a tela inicial de Sonhos", () => {
    expect(getAndroidBackAction({ menuOpen: false, tab: "controle", isSecondPress: false })).toBe("go-home");
  });

  it("volta de Desafios para a tela inicial de Sonhos", () => {
    expect(getAndroidBackAction({ menuOpen: false, tab: "desafios", isSecondPress: false })).toBe("go-home");
  });

  it("só inicia e confirma a saída quando já está em Sonhos", () => {
    expect(getAndroidBackAction({ menuOpen: false, tab: "jornada", isSecondPress: false })).toBe("warn-exit");
    expect(getAndroidBackAction({ menuOpen: false, tab: "jornada", isSecondPress: true })).toBe("confirm-exit");
  });
});
