import { describe, expect, it } from "vitest";
import { normalizeDreamTitle, resolveDreamIconKind } from "./dreamIconCatalog";

describe("dreamIconCatalog", () => {
  it("normalizes casing, accents and punctuation", () => {
    expect(normalizeDreamTitle("  Reserva de Emergência! ")).toBe("reserva de emergencia");
  });

  it.each([
    ["Reserva de emergência", "emergency"],
    ["Reformar a casa", "home"],
    ["Viajar", "travel"],
    ["Comprar um carro", "car"],
    ["Comprar uma moto", "motorcycle"],
    ["Casar", "wedding"],
    ["Fazer faculdade", "education"],
    ["Abrir um negócio", "business"],
    ["Liberdade financeira", "freedom"],
    ["Quitar dívidas", "debt"],
    ["Ter filhos", "family"],
    ["Mudar de cidade", "relocation"],
  ] as const)("maps the preset %s to %s", (title, kind) => {
    expect(resolveDreamIconKind(title)).toBe(kind);
  });

  it.each([
    ["Minha aposentadoria tranquila", "retirement"],
    ["Tratamento de saúde", "health"],
    ["Viagem para o Japão", "travel"],
    ["Curso de fotografia", "education"],
    ["Investimento para o futuro", "investment"],
  ] as const)("classifies the custom dream %s", (title, kind) => {
    expect(resolveDreamIconKind(title)).toBe(kind);
  });

  it.each([
    ["Estudos", "education"],
    ["Negócios", "business"],
    ["Carros", "car"],
    ["Casas", "home"],
    ["Viagens", "travel"],
  ] as const)("supports the natural plural %s", (title, kind) => {
    expect(resolveDreamIconKind(title)).toBe(kind);
  });

  it.each([
    ["Reserva para casamento", "wedding"],
    ["Reserva para aposentadoria", "retirement"],
    ["Reserva para viajar", "travel"],
  ] as const)("prefers the destination in the compound title %s", (title, kind) => {
    expect(resolveDreamIconKind(title)).toBe(kind);
  });

  it("does not mistake unrelated words for a vehicle", () => {
    expect(resolveDreamIconKind("Construir uma carreira internacional")).toBe("other");
  });

  it("uses the branded fallback for an unknown dream", () => {
    expect(resolveDreamIconKind("Ver a aurora boreal")).toBe("other");
  });
});
