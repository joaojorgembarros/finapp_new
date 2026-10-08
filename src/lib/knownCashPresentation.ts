import type { FinancialKnownCashPosition } from "./financialCashPosition";

export const KNOWN_CASH_COPY = {
  title: "Saldo conhecido",
  unavailableTitle: "Saldo conhecido indisponível",
  unavailableDetail: "Importe um extrato com saldo para acompanhar quanto há nas contas.",
  errorMessage: "Não foi possível consultar o saldo conhecido.",
  retry: "Tentar de novo",
  loading: "Consultando extratos...",
  staleNote: "Anterior ao mês atual.",
  mixedDatesNote: "As contas fecham em datas diferentes.",
  sameBankNote: "Pode não incluir todas as contas desse banco.",
} as const;

export type KnownCashCardPresentation =
  | {
    kind: "loading";
    title: string;
    message: string;
  }
  | {
    kind: "error";
    title: string;
    message: string;
    retryLabel: string;
  }
  | {
    kind: "unavailable";
    title: string;
    detail: string;
  }
  | {
    kind: "ready";
    title: string;
    amountCents: number;
    caption: string;
    notes: string[];
  };

export function formatKnownCashDay(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

export function buildKnownCashCard(input: {
  status: "loading" | "ready" | "error";
  position: FinancialKnownCashPosition | null;
}): KnownCashCardPresentation {
  if (input.status === "loading") {
    return {
      kind: "loading",
      title: KNOWN_CASH_COPY.title,
      message: KNOWN_CASH_COPY.loading,
    };
  }
  if (input.status === "error" || !input.position) {
    return {
      kind: "error",
      title: KNOWN_CASH_COPY.title,
      message: KNOWN_CASH_COPY.errorMessage,
      retryLabel: KNOWN_CASH_COPY.retry,
    };
  }
  if (!input.position.dataQuality.hasSnapshot || input.position.knownCashCents == null || !input.position.asOfDate) {
    return {
      kind: "unavailable",
      title: KNOWN_CASH_COPY.unavailableTitle,
      detail: KNOWN_CASH_COPY.unavailableDetail,
    };
  }

  const caption = input.position.dataQuality.datesDiffer
    ? `Dados mais recentes até ${formatKnownCashDay(input.position.asOfDate)}`
    : `Em ${formatKnownCashDay(input.position.asOfDate)}`;
  const notes: string[] = [];
  if (input.position.dataQuality.datesDiffer) notes.push(KNOWN_CASH_COPY.mixedDatesNote);
  if (input.position.dataQuality.isStale) notes.push(KNOWN_CASH_COPY.staleNote);
  if (input.position.dataQuality.sameBankRisk) notes.push(KNOWN_CASH_COPY.sameBankNote);

  return {
    kind: "ready",
    title: KNOWN_CASH_COPY.title,
    amountCents: input.position.knownCashCents,
    caption,
    notes,
  };
}
