import { formatBRLFromCents } from "./format";
import { observedResultNarrative } from "./observedSummaryPresentation";
import type {
  FinancialObservedHistory,
  ObservedHistoryRange,
} from "./financialObservedHistory";

export const OBSERVED_HISTORY_COPY = {
  periodTitle: "Resultado do período",
  inflow: "Entrou",
  outflow: "Saiu",
  accumulatedResult: "Resultado acumulado",
  seriesTitle: "Mês a mês",
  noData: "Sem dados",
  emptyPeriod: "Você ainda não tem movimentações neste período.",
  gapNote: "Meses sem dados não significam que não houve movimentação.",
} as const;

export const OBSERVED_HISTORY_RANGE_OPTIONS: { id: ObservedHistoryRange; label: string }[] = [
  { id: "month", label: "Mês" },
  { id: "3months", label: "3 meses" },
  { id: "6months", label: "6 meses" },
  { id: "year", label: "Ano" },
];

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export type ObservedHistoryTone = "positive" | "negative" | "neutral" | "missing";

export type ObservedHistoryPeriodPresentation = {
  kind: "empty" | "ready";
  title: string;
  caption: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  inflowLabel: string;
  outflowLabel: string;
  resultLabel: string;
  narrative: string | null;
  message: string | null;
};

export type ObservedHistoryMonthRow = {
  key: string;
  label: string;
  shortLabel: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  netLabel: string | null;
  note: string | null;
  tone: ObservedHistoryTone;
};

export type ObservedHistoryTrendBar = {
  key: string;
  tone: ObservedHistoryTone;
  /** Visual height only. Zero means no counted result to draw. */
  share: number;
};

const SHORT_MONTHS_PT = [
  "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
  "JUL", "AGO", "SET", "OUT", "NOV", "DEZ",
];

export function observedHistoryMonthLabel(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return MONTHS_PT[month - 1] ?? monthKey;
}

export function observedHistoryShortMonthLabel(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return SHORT_MONTHS_PT[month - 1] ?? monthKey;
}

export function formatObservedHistoryNet(cents: number) {
  const amount = integerCents(cents);
  const formatted = formatBRLFromCents(Math.abs(amount));
  if (amount > 0) return `+ ${formatted}`;
  if (amount < 0) return `- ${formatted}`;
  return formatted;
}

export function observedHistoryPartialNote(referenceDate: string) {
  return `até dia ${Number(referenceDate.slice(8, 10))}`;
}

export function buildObservedHistoryPeriod(
  history: FinancialObservedHistory,
): ObservedHistoryPeriodPresentation {
  const caption = observedHistoryCaption(history);
  if (!history.dataQuality.hasAnyData) {
    return {
      kind: "empty",
      title: OBSERVED_HISTORY_COPY.periodTitle,
      caption,
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
      inflowLabel: OBSERVED_HISTORY_COPY.inflow,
      outflowLabel: OBSERVED_HISTORY_COPY.outflow,
      resultLabel: OBSERVED_HISTORY_COPY.accumulatedResult,
      narrative: null,
      message: OBSERVED_HISTORY_COPY.emptyPeriod,
    };
  }
  return {
    kind: "ready",
    title: OBSERVED_HISTORY_COPY.periodTitle,
    caption,
    inflowCents: history.inflowCents,
    outflowCents: history.outflowCents,
    netCents: history.netCents,
    inflowLabel: OBSERVED_HISTORY_COPY.inflow,
    outflowLabel: OBSERVED_HISTORY_COPY.outflow,
    resultLabel: OBSERVED_HISTORY_COPY.accumulatedResult,
    narrative: observedResultNarrative(history.netCents, "period"),
    message: null,
  };
}

export function buildObservedHistoryMonthRows(
  history: FinancialObservedHistory,
): ObservedHistoryMonthRow[] {
  return history.months.map((month) => {
    if (!month.hasData) {
      return {
        key: month.monthKey,
        label: observedHistoryMonthLabel(month.monthKey),
        shortLabel: observedHistoryShortMonthLabel(month.monthKey),
        inflowCents: month.inflowCents,
        outflowCents: month.outflowCents,
        netCents: month.netCents,
        netLabel: null,
        note: OBSERVED_HISTORY_COPY.noData,
        tone: "missing",
      };
    }
    return {
      key: month.monthKey,
      label: observedHistoryMonthLabel(month.monthKey),
      shortLabel: observedHistoryShortMonthLabel(month.monthKey),
      inflowCents: month.inflowCents,
      outflowCents: month.outflowCents,
      netCents: month.netCents,
      netLabel: formatObservedHistoryNet(month.netCents),
      note: month.isPartial ? observedHistoryPartialNote(history.referenceDate) : null,
      tone: historyTone(month.netCents),
    };
  });
}

export function buildObservedHistoryTrend(rows: ObservedHistoryMonthRow[]): ObservedHistoryTrendBar[] {
  const maxAbs = rows.reduce((max, row) => (
    row.tone === "missing" ? max : Math.max(max, Math.abs(row.netCents))
  ), 0);
  return rows.map((row) => ({
    key: row.key,
    tone: row.tone,
    share: row.tone === "missing" || maxAbs <= 0 ? 0 : Math.min(1, Math.abs(row.netCents) / maxAbs),
  }));
}

export function observedHistoryGapNote(history: FinancialObservedHistory) {
  return history.dataQuality.hasGaps ? OBSERVED_HISTORY_COPY.gapNote : null;
}

function observedHistoryCaption(history: FinancialObservedHistory) {
  const first = history.months[0];
  const last = history.months[history.months.length - 1];
  const startLabel = first ? observedHistoryMonthLabel(first.monthKey) : history.start;
  const endLabel = last ? observedHistoryMonthLabel(last.monthKey) : history.end;
  const span = startLabel === endLabel ? startLabel : `${startLabel} a ${endLabel}`;
  if (!history.dataQuality.currentMonthPartial) return span;
  return `${span} · ${observedHistoryPartialNote(history.referenceDate)}`;
}

function historyTone(cents: number): ObservedHistoryTone {
  if (cents > 0) return "positive";
  if (cents < 0) return "negative";
  return "neutral";
}

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}
