import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchantNormalize";

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
});
