import { describe, expect, it } from "vitest";
import { HOME_TAB, getAndroidBackAction } from "./androidBack";

describe("getAndroidBackAction", () => {
  it("fecha o menu antes de navegar", () => {
    expect(
      getAndroidBackAction({
        menuOpen: true,
        tab: "jornada",
        isSecondPress: false,
      }),
    ).toBe("close-menu");
  });

  it("volta de Resumo para Sonhos", () => {
    expect(
      getAndroidBackAction({
        menuOpen: false,
        tab: "controle",
        isSecondPress: false,
      }),
    ).toBe("go-home");
  });

  it("volta de Desafios para Sonhos", () => {
    expect(
      getAndroidBackAction({
        menuOpen: false,
        tab: "desafios",
        isSecondPress: false,
      }),
    ).toBe("go-home");
  });

  it("volta de Movimentações para Sonhos", () => {
    expect(
      getAndroidBackAction({
        menuOpen: false,
        tab: "movimentacoes",
        isSecondPress: false,
      }),
    ).toBe("go-home");
  });

  it("só inicia e confirma a saída quando já está em Sonhos", () => {
    expect(HOME_TAB).toBe("jornada");
    expect(
      getAndroidBackAction({
        menuOpen: false,
        tab: "jornada",
        isSecondPress: false,
      }),
    ).toBe("warn-exit");
    expect(
      getAndroidBackAction({
        menuOpen: false,
        tab: "jornada",
        isSecondPress: true,
      }),
    ).toBe("confirm-exit");
  });
});
