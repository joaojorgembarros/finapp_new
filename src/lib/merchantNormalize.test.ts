import { describe, expect, it } from "vitest";
import { incomeCounterpartyKey, incomeSalaryCounterpartyKey, normalizeMerchant } from "./merchantNormalize";

describe("normalizeMerchant", () => {
  it("maps PG *NETFLIX, NETFLIX.COM and NETFLIX SERVICOS to the same strong merchant", () => {
    const variants = [
      normalizeMerchant("PG *NETFLIX"),
      normalizeMerchant("NETFLIX.COM"),
      normalizeMerchant("NETFLIX SERVICOS"),
      normalizeMerchant("netflix.com 12345"),
    ];

    expect(new Set(variants.map((item) => item.key))).toEqual(new Set(["netflix"]));
    expect(variants.every((item) => item.confidence === "strong")).toBe(true);
    expect(variants.every((item) => item.displayName === "Netflix")).toBe(true);
  });

  it("keeps Spotify and Cemig as explicit canonical merchants", () => {
    expect(normalizeMerchant("SPOTIFY PREMIUM")).toMatchObject({
      key: "spotify",
      displayName: "Spotify",
      confidence: "strong",
    });
    expect(normalizeMerchant("CEMIG ENERGIA")).toMatchObject({
      key: "cemig",
      displayName: "Cemig",
      confidence: "strong",
    });
  });

  it("does not turn PIX payee names into a strong merchant", () => {
    expect(normalizeMerchant("PIX JOÃO")).toMatchObject({
      key: "joao",
      confidence: "weak",
    });
    expect(normalizeMerchant("PIX MARIA")).toMatchObject({
      key: "maria",
      confidence: "weak",
    });
  });

  it("keeps generic payment descriptions weak", () => {
    expect(normalizeMerchant("TED RECEBIDA").confidence).toBe("weak");
    expect(normalizeMerchant("PAGAMENTO").confidence).toBe("weak");
    expect(normalizeMerchant("TRANSFERENCIA").confidence).toBe("weak");
    expect(normalizeMerchant("   ").key).toBe("");
  });

  it("keeps the expense canonical salary key unchanged", () => {
    expect(normalizeMerchant("SALARIO EMPRESA ALPHA LTDA")).toMatchObject({
      key: "salario",
      confidence: "strong",
    });
  });
});

describe("incomeSalaryCounterpartyKey", () => {
  it("keeps the employer after a salary word", () => {
    expect(incomeSalaryCounterpartyKey("SALARIO EMPRESA ALPHA LTDA")).toBe("salario:empresa alpha");
    expect(incomeSalaryCounterpartyKey("FOLHA EMPRESA ALPHA")).toBe("salario:empresa alpha");
    expect(incomeSalaryCounterpartyKey("PROVENTO EMPRESA BETA")).toBe("salario:empresa beta");
  });

  it("drops Portuguese connectors without merging different payers", () => {
    expect(incomeSalaryCounterpartyKey("SALARIO DE EMPRESA ALPHA")).toBe("salario:empresa alpha");
    expect(incomeSalaryCounterpartyKey("SALARIO DA EMPRESA ALPHA")).toBe("salario:empresa alpha");
    expect(incomeSalaryCounterpartyKey("FOLHA DA EMPRESA ALPHA")).toBe("salario:empresa alpha");
    expect(incomeSalaryCounterpartyKey("SALARIO DO BANCO ALPHA SA")).toBe("salario:banco alpha");
    expect(incomeSalaryCounterpartyKey("FOLHA BANCO ALPHA")).toBe("salario:banco alpha");
    expect(incomeSalaryCounterpartyKey("SALARIO DAS EMPRESA ALPHA")).toBe("salario:empresa alpha");
    expect(incomeSalaryCounterpartyKey("SALARIO DOS BANCO ALPHA")).toBe("salario:banco alpha");
    expect(incomeSalaryCounterpartyKey("SALARIO DA EMPRESA BETA")).toBe("salario:empresa beta");
  });

  it("keeps the expense merchant path free of connector stripping", () => {
    expect(normalizeMerchant("EMPRESA DA ALPHA LTDA").key).toBe("empresa da alpha ltda");
  });

  it("keeps expense descriptions on the literal merchant key", () => {
    expect(normalizeMerchant("EMPRESA BETA LTDA").key).toBe("empresa beta ltda");
    expect(normalizeMerchant("EMPRESA GAMA").key).toBe("empresa gama");
    expect(normalizeMerchant("PIX EMPRESA BETA LTDA").key).toBe("empresa beta ltda");
    expect(normalizeMerchant("PIX JOAO")).toMatchObject({ key: "joao", confidence: "weak" });
    expect(normalizeMerchant("TED RECEBIDA").confidence).toBe("weak");
  });

  it("falls back to salario when no payer remains", () => {
    expect(incomeSalaryCounterpartyKey("SALARIO")).toBe("salario");
    expect(incomeSalaryCounterpartyKey("FOLHA PAGAMENTO")).toBe("salario");
    expect(incomeSalaryCounterpartyKey("EMPRESA ALPHA LTDA")).toBeNull();
  });
});

describe("incomeCounterpartyKey", () => {
  it("shares one payer key after wrappers and legal suffixes", () => {
    const beta = [
      "EMPRESA BETA LTDA",
      "EMPRESA BETA",
      "PAGAMENTO EMPRESA BETA",
      "PIX EMPRESA BETA LTDA",
      "TED EMPRESA BETA",
    ].map((note) => incomeCounterpartyKey(note));

    expect(new Set(beta)).toEqual(new Set(["empresa beta"]));
    expect(incomeCounterpartyKey("EMPRESA GAMA LTDA")).toBe("empresa gama");
    expect(incomeCounterpartyKey("EMPRESA GAMA")).toBe("empresa gama");
  });

  it("leaves a generic or one-word payee without an income counterparty", () => {
    expect(incomeCounterpartyKey("PIX JOAO")).toBeNull();
    expect(incomeCounterpartyKey("TED RECEBIDA")).toBeNull();
    expect(incomeCounterpartyKey("PIX RECEBIDO")).toBeNull();
    expect(incomeCounterpartyKey("TRANSFERENCIA")).toBeNull();
    expect(incomeCounterpartyKey("SALARIO DA EMPRESA ALPHA")).toBeNull();
  });
});
