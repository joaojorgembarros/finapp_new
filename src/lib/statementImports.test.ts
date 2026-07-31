import { describe, expect, it, vi } from "vitest";
import { hashStatementContent, isDuplicateStatementError } from "./statementImports";

vi.mock("./supabase", () => ({
  supabase: {},
}));

describe("statement import identity", () => {
  it("creates a SHA-256 hexadecimal identity from the exact file content", async () => {
    await expect(hashStatementContent("conteúdo do extrato")).resolves.toBe(
      "9b1c9973f49edfbd9ee017d70923a053235d44cd728fc0d6f359e8d8f8bbab13"
    );
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
