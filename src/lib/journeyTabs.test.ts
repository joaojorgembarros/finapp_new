import { describe, expect, it } from "vitest";
import { DEFAULT_JOURNEY_TAB, parseRequestedTab } from "./journeyTabs";

describe("parseRequestedTab", () => {
  it("keeps the known tabs and sends legacy challenges to Sonhos", () => {
    expect(parseRequestedTab(undefined)).toBe(DEFAULT_JOURNEY_TAB);
    expect(parseRequestedTab("jornada")).toBe("jornada");
    expect(parseRequestedTab("movimentacoes")).toBe("movimentacoes");
    expect(parseRequestedTab("controle")).toBe("controle");
    expect(parseRequestedTab("planejamento")).toBe("planejamento");
    expect(parseRequestedTab("desafios")).toBe("jornada");
    expect(parseRequestedTab("desconhecida")).toBe("jornada");
  });
});
