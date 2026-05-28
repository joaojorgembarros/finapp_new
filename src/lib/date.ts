// src/lib/date.ts
export function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthStartYMD(ref = new Date()) {
  const d = new Date(ref);
  d.setDate(1);
  return ymd(d);
}

export function nextMonthStartYMD(ref = new Date()) {
  const d = new Date(ref);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return ymd(d);
}

export function addMonths(ref: Date, months: number) {
  const d = new Date(ref);
  d.setMonth(d.getMonth() + months);
  return d;
}
