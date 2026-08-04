export const BANK_CATALOG = [
  {
    id: "nubank",
    name: "Nubank",
    shortName: "Nu",
    color: "#6D28D9",
    statementAliases: ["nubank", "nu pagamentos"],
  },
  {
    id: "inter",
    name: "Inter",
    shortName: "in",
    color: "#F97316",
    statementAliases: ["banco inter", "bancointer", "intermedium"],
  },
  {
    id: "itau",
    name: "Itaú",
    shortName: "it",
    color: "#0754A3",
    statementAliases: ["itau", "banco itau"],
  },
  {
    id: "bradesco",
    name: "Bradesco",
    shortName: "br",
    color: "#CC163F",
    statementAliases: ["bradesco", "banco bradesco"],
  },
  {
    id: "santander",
    name: "Santander",
    shortName: "st",
    color: "#EC1C24",
    statementAliases: ["santander", "banco santander"],
  },
  {
    id: "caixa",
    name: "Caixa",
    shortName: "cx",
    color: "#0877BE",
    statementAliases: ["caixa economica federal", "banco caixa"],
  },
  {
    id: "banco-do-brasil",
    name: "Banco do Brasil",
    shortName: "bb",
    color: "#E6B800",
    statementAliases: ["banco do brasil", "bb rende facil", "bb-rende-facil"],
  },
  {
    id: "c6-bank",
    name: "C6 Bank",
    shortName: "C6",
    color: "#242424",
    statementAliases: ["c6 bank", "banco c6"],
  },
  {
    id: "mercado-pago",
    name: "Mercado Pago",
    shortName: "mp",
    color: "#159BD7",
    statementAliases: ["mercado pago", "mercadopago", "mp-wallet"],
  },
  {
    id: "picpay",
    name: "PicPay",
    shortName: "P",
    color: "#21C25E",
    statementAliases: ["picpay", "pic pay"],
  },
] as const;

export const OTHER_BANK = {
  id: "outro-banco",
  name: "Outro banco",
  shortName: "+",
  color: "#64748B",
} as const;

export const CASH_ACCOUNT = {
  id: "dinheiro",
  name: "Dinheiro / Carteira",
  shortName: "R$",
  color: "#169B62",
} as const;

export const BANK_OPTIONS = [...BANK_CATALOG, OTHER_BANK] as const;
export const TRANSACTION_ACCOUNT_OPTIONS = [...BANK_OPTIONS, CASH_ACCOUNT] as const;

export type BankId = (typeof BANK_OPTIONS)[number]["id"];
export type BankOption = (typeof BANK_OPTIONS)[number];
export type TransactionAccountId = (typeof TRANSACTION_ACCOUNT_OPTIONS)[number]["id"];
export type TransactionAccountOption = (typeof TRANSACTION_ACCOUNT_OPTIONS)[number];

function normalizeBankText(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function findBankById(id: BankId | null | undefined) {
  return id ? BANK_OPTIONS.find((bank) => bank.id === id) ?? null : null;
}

export function findTransactionAccountById(id: string | null | undefined) {
  return id ? TRANSACTION_ACCOUNT_OPTIONS.find((account) => account.id === id) ?? null : null;
}

export function detectStatementBank(content: string, fileName = ""): BankId | null {
  const normalizedFileName = normalizeBankText(fileName.replace(/\.[^.]+$/, ""));
  const normalizedSample = normalizeBankText(content.slice(0, 4000));

  for (const bank of BANK_CATALOG) {
    const aliases = [bank.id, bank.name, ...bank.statementAliases].map(normalizeBankText);
    if (aliases.some((alias) => normalizedFileName.includes(alias))) return bank.id;
    if (aliases.some((alias) => alias.length >= 6 && normalizedSample.includes(alias))) return bank.id;
  }

  return null;
}
