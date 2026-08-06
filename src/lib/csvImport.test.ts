import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BankId } from "./banks";
import { parseCsv } from "./csvImport";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "bank-statements");

const fixtures = [
  { fileName: "nubank-conta.csv", bankId: "nubank", rows: 2, finalBalanceCents: null, finalBalanceConfidence: "unavailable" },
  { fileName: "inter-conta.csv", bankId: "inter", rows: 2, initialBalanceCents: 100000, finalBalanceCents: 132450, finalBalanceConfidence: "derived" },
  { fileName: "itau-conta.csv", bankId: "itau", rows: 2, initialBalanceCents: 100000, finalBalanceCents: 122500, finalBalanceConfidence: "derived" },
  { fileName: "bradesco-conta.csv", bankId: "bradesco", rows: 2, initialBalanceCents: 100000, finalBalanceCents: 138000, finalBalanceConfidence: "derived" },
  { fileName: "santander-conta.csv", bankId: "santander", rows: 2, initialBalanceCents: 100000, finalBalanceCents: 123510, finalBalanceConfidence: "derived" },
  { fileName: "caixa-conta.csv", bankId: "caixa", rows: 2, initialBalanceCents: 100000, finalBalanceCents: 292000, finalBalanceConfidence: "derived" },
  { fileName: "banco-do-brasil-conta.csv", bankId: "banco-do-brasil", rows: 2, ignoredRows: 1, initialBalanceCents: 200000, finalBalanceCents: 118000, finalBalanceConfidence: "derived" },
  { fileName: "c6-bank-conta.csv", bankId: "c6-bank", rows: 2, finalBalanceCents: null, finalBalanceConfidence: "unavailable" },
  { fileName: "mercado-pago-conta.csv", bankId: "mercado-pago", rows: 2, finalBalanceCents: null, finalBalanceConfidence: "unavailable" },
  { fileName: "mp-wallet.csv", bankId: "mercado-pago", rows: 2, initialBalanceCents: 10, finalBalanceCents: 15551, finalBalanceConfidence: "confirmed" },
  { fileName: "picpay-conta.csv", bankId: "picpay", rows: 2, initialBalanceCents: 0, finalBalanceCents: 13410, finalBalanceConfidence: "derived" },
] satisfies {
  fileName: string;
  bankId: BankId;
  rows: number;
  ignoredRows?: number;
  initialBalanceCents?: number;
  finalBalanceCents: number | null;
  finalBalanceConfidence: "confirmed" | "derived" | "unavailable";
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
    expect(result.finalBalanceCents).toBe(fixture.finalBalanceCents);
    expect(result.finalBalanceConfidence).toBe(fixture.finalBalanceConfidence);
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

  it("uses an explicitly named final balance as confirmed evidence", () => {
    const result = parseCsv([
      "INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE",
      "1.000,00;500,00;-200,00;1.300,00",
      "Data;Descrição;Valor",
      "01/07/2026;Receita;500,00",
      "02/07/2026;Despesa;-200,00",
    ].join("\n"));

    expect(result.initialBalanceCents).toBe(100000);
    expect(result.finalBalanceCents).toBe(130000);
    expect(result.finalBalanceConfidence).toBe("confirmed");
  });

  it("uses the chronologically latest running balance without calling it confirmed", () => {
    const result = parseCsv([
      "Data;Descrição;Valor;Saldo",
      "03/07/2026;Receita;100,00;1.200,00",
      "02/07/2026;Despesa;-50,00;1.100,00",
    ].join("\n"));

    expect(result.finalBalanceCents).toBe(120000);
    expect(result.finalBalanceConfidence).toBe("derived");
  });

  it("does not confirm a FINAL_BALANCE column when it belongs to each transaction row", () => {
    const result = parseCsv([
      "Data;Descrição;Valor;FINAL_BALANCE",
      "01/07/2026;Receita;100,00;1.100,00",
      "02/07/2026;Despesa;-50,00;1.050,00",
    ].join("\n"));

    expect(result.finalBalanceCents).toBe(105000);
    expect(result.finalBalanceConfidence).toBe("derived");
  });

  it("derives a final balance from the opening balance only when no ending balance is present", () => {
    const result = parseCsv([
      "Data;Descrição;Valor",
      "01/07/2026;Saldo anterior;1.000,00",
      "02/07/2026;Compra;-200,00",
    ].join("\n"));

    expect(result.initialBalanceCents).toBe(100000);
    expect(result.finalBalanceCents).toBe(80000);
    expect(result.finalBalanceConfidence).toBe("derived");
  });

  it("keeps a generic balance line derived and only confirms an explicit final label", () => {
    const generic = parseCsv([
      "Data;Descrição;Valor",
      "01/07/2026;Receita;100,00",
      "02/07/2026;Saldo;250,00",
    ].join("\n"));
    const explicit = parseCsv([
      "Data;Descrição;Valor",
      "01/07/2026;Receita;100,00",
      "02/07/2026;Saldo final;250,00",
    ].join("\n"));

    expect(generic.finalBalanceCents).toBe(25000);
    expect(generic.finalBalanceConfidence).toBe("derived");
    expect(explicit.finalBalanceCents).toBe(25000);
    expect(explicit.finalBalanceConfidence).toBe("confirmed");
  });
});
