import { dateFromYmd, ymd } from "./date";

export const FUTURE_OCCURRED_ON_MESSAGE =
  "A data não pode ser futura. Escolha hoje ou um dia que já aconteceu.";

export type ObservedDateMode = "income" | "expense" | "transfer" | "payment";

export function todayOccurredOn(now = new Date()) {
  return ymd(now);
}

export function pickerDateFromOccurredOn(value: string) {
  return dateFromYmd(value);
}

/** Financial date from the local calendar day, month and year. */
export function occurredOnFromPickerDate(date: Date) {
  return ymd(date);
}

export function isSelectableOccurredOn(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return occurredOnFromPickerDate(pickerDateFromOccurredOn(value)) === value;
}

/**
 * Income and expense are observed facts, so their date cannot be in the future.
 * Payment keeps the date already chosen by that flow. Transfer is unchanged.
 */
export function resolveObservedOccurredOn(input: {
  selected: string;
  mode: ObservedDateMode;
  now?: Date;
}): { ok: true; occurredOn: string } | { ok: false; message: string } {
  const selected = input.selected.trim();
  if (!isSelectableOccurredOn(selected)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  const today = todayOccurredOn(input.now ?? new Date());
  if ((input.mode === "income" || input.mode === "expense") && selected > today) {
    return { ok: false, message: FUTURE_OCCURRED_ON_MESSAGE };
  }
  return { ok: true, occurredOn: selected };
}
