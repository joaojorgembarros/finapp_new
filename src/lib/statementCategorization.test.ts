import { describe, expect, it } from "vitest";
import type { Category } from "./categories";
import type { ParsedCsvTx } from "./csvImport";
import { statementSimilarityKey, suggestStatementCategory } from "./statementCategorization";
import type { StatementCategoryRule } from "./statementCategoryRules";

const categories = [
  { id: "food", household_id: "house", flow: "expense", kind: "variable", name: "Alimentação", icon: null, sort: 1 },
  { id: "transport", household_id: "house", flow: "expense", kind: "variable", name: "Transporte", icon: null, sort: 2 },
  { id: "salary", household_id: "house", flow: "income", kind: "fixed", name: "Salário", icon: null, sort: 3 },
  { id: "pets", household_id: "house", flow: "expense", kind: "variable", name: "Pets", icon: null, sort: 4 },
  { id: "internet", household_id: "house", flow: "expense", kind: "fixed", name: "Internet / Celular", icon: null, sort: 5 },
] satisfies Category[];

function row(note: string, type: ParsedCsvTx["type"] = "expense"): ParsedCsvTx {
  return {
    key: note,
    note,
    type,
    amount_cents: 1000,
    occurred_on: "2026-07-01",
    rawLine: 2,
  };
}

describe("statement category suggestions", () => {
  it("suggests a default category from a known merchant keyword", () => {
    expect(suggestStatementCategory(row("Compra SUPERMERCADO EXEMPLO"), categories)).toMatchObject({
      categoryId: "food",
      categoryName: "Alimentação",
    });
  });

  it("never suggests a category from the opposite flow", () => {
    expect(suggestStatementCategory(row("Pagamento de salário"), categories)).toBeNull();
    expect(suggestStatementCategory(row("Pagamento de salário", "income"), categories)).toMatchObject({
      categoryId: "salary",
    });
  });

  it("recognizes a custom category by its name", () => {
    expect(suggestStatementCategory(row("Petshop Amigo dos Pets"), categories)).toMatchObject({
      categoryId: "pets",
    });
  });

  it("does not match short keywords inside unrelated words", () => {
    expect(suggestStatementCategory(row("Pagamento estimativa mensal"), categories)).toBeNull();
  });

  it("groups similar descriptions after removing banking boilerplate", () => {
    expect(statementSimilarityKey("PIX ENVIADO SUPERMERCADO ABC 123")).toBe("supermercado abc");
    expect(statementSimilarityKey("Pagamento supermercado ABC")).toBe("supermercado abc");
  });

  it("prioritizes a learned household rule", () => {
    const learnedRules = [{
      id: "rule",
      flow: "expense",
      match_key: "loja exemplo",
      category_id: "pets",
    }] satisfies StatementCategoryRule[];

    expect(
      suggestStatementCategory(row("PIX ENVIADO LOJA EXEMPLO"), categories, learnedRules)
    ).toMatchObject({
      categoryId: "pets",
      learned: true,
      confidence: "high",
    });
  });
});
