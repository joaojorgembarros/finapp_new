import { normalizeMerchant } from "../lib/merchantNormalize";

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function monthName(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return MONTH_NAMES[month - 1] ?? monthKey;
}

function joinMonths(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export const VISIBLE_RECURRING_INCOME_COUNT = 3;

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function observedIncomeTitle(normalizedMerchant: string) {
  if (normalizedMerchant === "salario") return "Salário";
  if (normalizedMerchant.startsWith("salario:")) {
    const payer = normalizedMerchant.slice("salario:".length).trim();
    return payer ? `Salário · ${titleCase(payer)}` : "Salário";
  }
  const named = normalizeMerchant(normalizedMerchant);
  return named.displayName || normalizedMerchant || "Entrada recorrente";
}

export function selectVisibleRecurringIncome<T extends { estimatedMonthlyCents: number; patternKey: string }>(
  items: T[],
) {
  return [...items]
    .sort((left, right) => (
      right.estimatedMonthlyCents - left.estimatedMonthlyCents
      || left.patternKey.localeCompare(right.patternKey)
    ))
    .slice(0, VISIBLE_RECURRING_INCOME_COUNT);
}

export function hiddenRecurringIncomeLabel(hiddenCount: number) {
  if (hiddenCount <= 0) return null;
  return hiddenCount === 1 ? "+ 1 fonte identificada" : `+ ${hiddenCount} fontes identificadas`;
}

export function observedIncomeDetectedLabel(monthKeys: string[]) {
  return `Detectado em ${joinMonths(monthKeys.map(monthName))}`;
}

export function observedIncomeDayLabel(day: number | null) {
  return day ? `Por volta do dia ${day}` : null;
}

export function observedIncomeVariationLabel(variable: boolean) {
  return variable ? "Valor varia mês a mês" : null;
}

export function observedOtherInflowsBasisLabel(monthKeys: string[]) {
  return `Baseado em ${joinMonths(monthKeys.map(monthName))}`;
}

export const OBSERVED_OTHER_INFLOWS_NOTE = "Entradas que não identificamos como renda recorrente.";
