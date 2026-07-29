import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashStatementContent, isDuplicateStatementError } from "./statementImports";

const { digestStringAsync } = vi.hoisted(() => ({
  digestStringAsync: vi.fn(),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { HEX: "hex" },
  digestStringAsync,
}));

vi.mock("./supabase", () => ({
  supabase: {},
}));

describe("statement import identity", () => {
  beforeEach(() => {
    digestStringAsync.mockReset();
  });

  it("creates a SHA-256 hexadecimal identity from the exact file content", async () => {
    const hash = "a".repeat(64);
    digestStringAsync.mockResolvedValue(hash);

    await expect(hashStatementContent("conteúdo do extrato")).resolves.toBe(hash);
    expect(digestStringAsync).toHaveBeenCalledWith("SHA-256", "conteúdo do extrato", { encoding: "hex" });
  });

  it.each([
    { code: "23505", message: "duplicate key" },
    { code: "P0001", message: "Este arquivo já foi importado." },
    { code: "P0001", message: "As movimentações deste arquivo já foram importadas." },
  ])("recognizes duplicate import errors", (error) => {
    expect(isDuplicateStatementError(error)).toBe(true);
  });

  it("does not classify unrelated database errors as duplicates", () => {
    expect(isDuplicateStatementError({ code: "42501", message: "Sem permissão." })).toBe(false);
  });
});
