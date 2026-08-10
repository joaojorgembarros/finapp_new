import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/lib/csvImport";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));

const fixtures = [
  {
    fileName: "01-nubank-cenario-principal-agosto.csv",
    bankId: "nubank",
    dates: ["2026-08-05", "2026-08-08", "2026-08-14"],
    amounts: [400_000, 45_000, 12_000],
    types: ["income", "expense", "expense"],
  },
  {
    fileName: "02-inter-fora-da-janela-agosto.csv",
    bankId: "inter",
    dates: ["2026-08-18"],
    amounts: [46_000],
    types: ["expense"],
  },
  {
    fileName: "03-santander-ambiguidade-agosto.csv",
    bankId: "santander",
    dates: ["2026-08-08", "2026-08-12"],
    amounts: [10_000, 10_000],
    types: ["expense", "expense"],
  },
  {
    fileName: "04-itau-parcela-1-agosto.csv",
    bankId: "itau",
    dates: ["2026-08-15"],
    amounts: [34_780],
    types: ["expense"],
  },
  {
    fileName: "05-c6-parcela-2-setembro.csv",
    bankId: "c6-bank",
    dates: ["2026-09-15"],
    amounts: [34_780],
    types: ["expense"],
  },
  {
    fileName: "06-caixa-verificacao-termino-outubro.csv",
    bankId: "caixa",
    dates: ["2026-10-15"],
    amounts: [34_780],
    types: ["expense"],
  },
] as const;

describe("CSV fixtures for automatic financial reconciliation", () => {
  it.each(fixtures)("parses $fileName without rejecting rows", (fixture) => {
    const content = readFileSync(resolve(fixtureDirectory, fixture.fileName), "utf8");
    const result = parseCsv(content, { fileName: fixture.fileName });

    expect(result.errors).toEqual([]);
    expect(result.rejectedRows).toBe(0);
    expect(result.ignoredRows).toBe(0);
    expect(result.detectedBankId).toBe(fixture.bankId);
    expect(result.rows.map((row) => row.occurred_on)).toEqual(fixture.dates);
    expect(result.rows.map((row) => row.amount_cents)).toEqual(fixture.amounts);
    expect(result.rows.map((row) => row.type)).toEqual(fixture.types);
  });
});
