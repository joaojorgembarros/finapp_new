import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FUTURE_OCCURRED_ON_MESSAGE,
  isSelectableOccurredOn,
  occurredOnFromPickerDate,
  pickerDateFromOccurredOn,
  resolveObservedOccurredOn,
  todayOccurredOn,
} from "./manualTransactionDate";

const now = new Date(2026, 9, 9, 15, 30);

describe("retroactive observed dates", () => {
  it("creates an expense on a previous occurred_on", () => {
    expect(resolveObservedOccurredOn({
      selected: "2026-09-28",
      mode: "expense",
      now,
    })).toEqual({ ok: true, occurredOn: "2026-09-28" });
  });

  it("creates income on a previous occurred_on", () => {
    expect(resolveObservedOccurredOn({
      selected: "2026-09-28",
      mode: "income",
      now,
    })).toEqual({ ok: true, occurredOn: "2026-09-28" });
  });

  it("keeps the chosen YYYY-MM-DD as the payload date", () => {
    const resolved = resolveObservedOccurredOn({
      selected: "2026-09-28",
      mode: "expense",
      now,
    });
    expect(resolved.ok && resolved.occurredOn).toBe("2026-09-28");
  });

  it("keeps 28/09 on 28/09 through the local picker", () => {
    expect(occurredOnFromPickerDate(pickerDateFromOccurredOn("2026-09-28"))).toBe("2026-09-28");
    expect(isSelectableOccurredOn("2026-09-28")).toBe(true);
  });

  it("does not derive the financial date from toISOString", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "manualTransactionDate.ts"), "utf8");
    const screen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/new-transaction.tsx"), "utf8");
    expect(source).not.toMatch(/toISOString/);
    expect(screen).not.toMatch(/toISOString/);
    expect(occurredOnFromPickerDate(pickerDateFromOccurredOn("2026-09-28"))).toBe("2026-09-28");
  });

  it("rejects a future date for a new income or expense", () => {
    expect(resolveObservedOccurredOn({ selected: "2026-10-10", mode: "expense", now })).toEqual({
      ok: false,
      message: FUTURE_OCCURRED_ON_MESSAGE,
    });
    expect(resolveObservedOccurredOn({ selected: "2026-10-10", mode: "income", now }).ok).toBe(false);
  });

  it("defaults to today and still allows today", () => {
    expect(todayOccurredOn(now)).toBe("2026-10-09");
    expect(resolveObservedOccurredOn({
      selected: todayOccurredOn(now),
      mode: "expense",
      now,
    })).toEqual({ ok: true, occurredOn: "2026-10-09" });
  });

  it("leaves the payment date untouched, including when it differs from the picker", () => {
    expect(resolveObservedOccurredOn({
      selected: "2026-09-15",
      mode: "payment",
      now,
    })).toEqual({ ok: true, occurredOn: "2026-09-15" });
  });

  it("does not cap a transfer date in this phase", () => {
    expect(resolveObservedOccurredOn({
      selected: "2026-11-02",
      mode: "transfer",
      now,
    })).toEqual({ ok: true, occurredOn: "2026-11-02" });
  });
});

describe("new transaction date wiring", () => {
  const screen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/new-transaction.tsx"), "utf8");
  const editor = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../ui/TransactionEditorModal.tsx"), "utf8");

  it("sends the selected occurred_on and caps the income and expense picker at today", () => {
    expect(screen).toMatch(/useState\(todayOccurredOn\(\)\)/);
    expect(screen).toMatch(/occurred_on: resolvedDate\.occurredOn/);
    expect(screen).toMatch(/maximumDate=\{transferMode \? undefined : endOfLocalDay\(\)\}/);
    expect(screen).toMatch(/mode: paymentFlow \? "payment" : flow/);
  });

  it("caps a normal manual edit at today and keeps imported dates read-only", () => {
    expect(editor).toMatch(/occurredOnFromPickerDate\(date\)/);
    expect(editor).toMatch(/maximumDate=\{!imported && !linkedTransfer && occurredOn <= todayOccurredOn\(\) \? endOfLocalDay\(\) : undefined\}/);
    expect(editor).toMatch(/O valor e a data do extrato ficam preservados/);
  });
});
