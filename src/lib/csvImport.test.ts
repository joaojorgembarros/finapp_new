import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BankId } from "./banks";
import { parseCsv } from "./csvImport";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "bank-statements");

const fixtures = [
  { fileName: "nubank-conta.csv", bankId: "nubank", rows: 2 },
  { fileName: "inter-conta.csv", bankId: "inter", rows: 2 },
  { fileName: "itau-conta.csv", bankId: "itau", rows: 2, initialBalanceCents: 100000 },
  { fileName: "bradesco-conta.csv", bankId: "bradesco", rows: 2 },
  { fileName: "santander-conta.csv", bankId: "santander", rows: 2 },
  { fileName: "caixa-conta.csv", bankId: "caixa", rows: 2 },
  { fileName: "banco-do-brasil-conta.csv", bankId: "banco-do-brasil", rows: 2, ignoredRows: 1, initialBalanceCents: 200000 },
  { fileName: "c6-bank-conta.csv", bankId: "c6-bank", rows: 2 },
  { fileName: "mercado-pago-conta.csv", bankId: "mercado-pago", rows: 2 },
  { fileName: "mp-wallet.csv", bankId: "mercado-pago", rows: 2, initialBalanceCents: 10 },
  { fileName: "picpay-conta.csv", bankId: "picpay", rows: 2 },
] satisfies {
  fileName: string;
  bankId: BankId;
  rows: number;
  ignoredRows?: number;
  initialBalanceCents?: number;
}[];

function loadFixture(fileName: string) {
  return readFileSync(resolve(fixtureDirectory, fileName), "utf8");
}

describe("bank CSV fixtures", () => {
  it.each(fixtures)("reads $bankId synthetic statement", (fixture) => {
    const result = parseCsv(loadFixture(fixture.fileName), { fileName: fixture.fileName });

    expect(result.detectedBankId).toBe(fixture.bankId);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(fixture.rows);
    expect(result.rows.some((row) => row.type === "income")).toBe(true);
    expect(result.rows.some((row) => row.type === "expense")).toBe(true);
    expect(result.ignoredRows).toBe(fixture.ignoredRows ?? 0);
    expect(result.rejectedRows).toBe(0);

    if (fixture.initialBalanceCents !== undefined) {
      expect(result.initialBalanceCents).toBe(fixture.initialBalanceCents);
    }
  });

  it("uses the file name to identify the bank when the content has no signature", () => {
    const result = parseCsv("Data,Descrição,Valor\n2026-07-01,Teste,-10.00", {
      fileName: "extrato-nubank-julho.csv",
    });

    expect(result.detectedBankId).toBe("nubank");
  });

  it("uses Mercado Pago TRANSACTION_TYPE as the transaction description", () => {
    const result = parseCsv(loadFixture("mp-wallet.csv"), { fileName: "mp-wallet.csv" });

    expect(result.rows.map((row) => row.note)).toEqual([
      "Pix recebido CLIENTE EXEMPLO",
      "Pix enviado LOJA EXEMPLO",
    ]);
  });

  it("reports invalid transaction lines without mixing them with valid rows", () => {
    const result = parseCsv([
      "Data,Descrição,Valor",
      "2026-07-01,Compra válida,-10.50",
      "31/02/2026,Data impossível,-20.00",
      "2026-07-03,Valor ausente,",
      "2026-07-04,Valor zero,0",
      "2026-02-31,Data ISO impossível,-30.00",
    ].join("\n"));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.note).toBe("Compra válida");
    expect(result.rejectedRows).toBe(4);
    expect(result.errors).toEqual([
      "Linha 3: data ausente, inválida ou não reconhecida.",
      "Linha 4: valor ausente, zero ou inválido.",
      "Linha 5: valor ausente, zero ou inválido.",
      "Linha 6: data ausente, inválida ou não reconhecida.",
    ]);
  });
});
