import { formatBRLFromCents } from "./format";

const SHORT_MONTHS = [
  "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
  "JUL", "AGO", "SET", "OUT", "NOV", "DEZ",
];

function civilParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Inclusive end of a cycle whose stored end is exclusive. */
export function cycleInclusiveEnd(endExclusive: string) {
  const parts = civilParts(endExclusive);
  if (!parts) return null;
  const date = new Date(parts.year, parts.month - 1, parts.day - 1);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatCycleDay(value: string) {
  const parts = civilParts(value);
  if (!parts) return null;
  const month = SHORT_MONTHS[parts.month - 1];
  if (!month) return null;
  return `${pad(parts.day)} ${month}`;
}

export function formatCycleSpan(start: string, endExclusive: string) {
  const end = cycleInclusiveEnd(endExclusive);
  const startLabel = formatCycleDay(start);
  const endLabel = end ? formatCycleDay(end) : null;
  if (!startLabel || !endLabel) return null;
  return `${startLabel} → ${endLabel}`;
}

/**
 * How far the reference day sits inside the cycle.
 * This is calendar progress, not a money forecast.
 */
export function cycleTimeProgress(input: {
  start: string;
  end: string;
  referenceDate: string;
}) {
  const start = civilParts(input.start);
  const end = civilParts(input.end);
  const reference = civilParts(input.referenceDate);
  if (!start || !end || !reference) return null;
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  const referenceMs = Date.UTC(reference.year, reference.month - 1, reference.day);
  if (![startMs, endMs, referenceMs].every(Number.isFinite) || endMs <= startMs) return null;
  const ratio = Math.min(1, Math.max(0, (referenceMs - startMs) / (endMs - startMs)));
  return {
    ratio,
    caption: "Andamento do período",
  };
}

export function planningPlanSummary(input: {
  span: string | null;
  reserveCents: number | null;
}) {
  const reserve = input.reserveCents == null ? null : `Reserva ${formatBRLFromCents(input.reserveCents)}`;
  const summary = [input.span, reserve].filter((part) => part).join(" · ");
  return summary || "Ciclo, renda e reserva";
}

export function planningCommitmentSummary(count: number, totalCents: number) {
  const items = Math.max(0, Math.trunc(count));
  if (items <= 0) return "Nenhum item";
  const label = items === 1 ? "1 item" : `${items} itens`;
  return `${label} · ${formatBRLFromCents(totalCents)}`;
}

export const OBSERVED_INSIGHT_SUMMARY = "Hábitos e padrões encontrados";
