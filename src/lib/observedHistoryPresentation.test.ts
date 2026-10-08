import { describe, expect, it } from "vitest";
import { formatBRLFromCents } from "./format";
import type { FinancialObservedHistory, ObservedHistoryMonth, ObservedHistoryRange } from "./financialObservedHistory";
import {
  OBSERVED_HISTORY_COPY,
  OBSERVED_HISTORY_RANGE_OPTIONS,
  buildObservedHistoryMonthRows,
  buildObservedHistoryPeriod,
  formatObservedHistoryNet,
  observedHistoryGapNote,
} from "./observedHistoryPresentation";

function month(partial: Partial<ObservedHistoryMonth> & Pick<ObservedHistoryMonth, "monthKey">): ObservedHistoryMonth {
  return {
    start: `${partial.monthKey}-01`,
    end: "2026-11-01",
    inflowCents: 0,
    outflowCents: 0,
    netCents: 0,
    transactionCount: 0,
    isPartial: false,
    hasData: false,
    ...partial,
  };
}

function history(partial: {
  referenceDate?: string;
  range?: ObservedHistoryRange;
  months: ObservedHistoryMonth[];
  dataQuality?: Partial<FinancialObservedHistory["dataQuality"]>;
}): FinancialObservedHistory {
  const months = partial.months;
  const inflowCents = months.reduce((total, item) => total + item.inflowCents, 0);
  const outflowCents = months.reduce((total, item) => total + item.outflowCents, 0);
  const monthsWithData = months.filter((item) => item.hasData).length;
  return {
    referenceDate: partial.referenceDate ?? "2026-10-08",
    range: partial.range ?? "3months",
    start: months[0]?.start ?? "2026-08-01",
    end: "2026-10-09",
    inflowCents,
    outflowCents,
    netCents: inflowCents - outflowCents,
    transactionCount: months.reduce((total, item) => total + item.transactionCount, 0),
    months,
    dataQuality: {
      hasAnyData: monthsWithData > 0,
      monthsWithData,
      monthsRequested: months.length,
      currentMonthPartial: months.some((item) => item.isPartial),
      hasGaps: monthsWithData > 0 && monthsWithData < months.length,
      ...partial.dataQuality,
    },
  };
}

describe("observed history presentation", () => {
  it("offers Mês, 3 meses, 6 meses and Ano, with Mês first", () => {
    expect(OBSERVED_HISTORY_RANGE_OPTIONS.map((option) => option.label)).toEqual([
      "Mês", "3 meses", "6 meses", "Ano",
    ]);
    expect(OBSERVED_HISTORY_RANGE_OPTIONS[0]?.id).toBe("month" satisfies ObservedHistoryRange);
  });

  it("names the period result without calling it a balance or available money", () => {
    const periodHistory = history({
      months: [
        month({
          monthKey: "2026-08",
          inflowCents: 506284,
          outflowCents: 127686,
          netCents: 378598,
          transactionCount: 2,
          hasData: true,
        }),
        month({
          monthKey: "2026-09",
          inflowCents: 511420,
          outflowCents: 131675,
          netCents: 379745,
          transactionCount: 2,
          hasData: true,
        }),
        month({
          monthKey: "2026-10",
          end: "2026-10-09",
          inflowCents: 515000,
          outflowCents: 65350,
          netCents: 449650,
          transactionCount: 2,
          isPartial: true,
          hasData: true,
        }),
      ],
    });
    const period = buildObservedHistoryPeriod(periodHistory);
    const rows = buildObservedHistoryMonthRows(periodHistory);
    const copy = JSON.stringify({
      ...OBSERVED_HISTORY_COPY,
      period,
      rows,
      gap: observedHistoryGapNote(periodHistory),
    }).toLowerCase();

    expect(period).toMatchObject({
      kind: "ready",
      title: "Resultado do período",
      caption: "Agosto a Outubro · até dia 8",
      inflowCents: 1532704,
      outflowCents: 324711,
      netCents: 1207993,
      resultLabel: "Resultado acumulado",
    });
    expect(rows).toEqual([
      { key: "2026-08", label: "Agosto", netLabel: formatObservedHistoryNet(378598), note: null, tone: "positive" },
      { key: "2026-09", label: "Setembro", netLabel: formatObservedHistoryNet(379745), note: null, tone: "positive" },
      {
        key: "2026-10",
        label: "Outubro",
        netLabel: formatObservedHistoryNet(449650),
        note: "até dia 8",
        tone: "positive",
      },
    ]);
    expect(formatObservedHistoryNet(378598)).toBe(`+ ${formatBRLFromCents(378598)}`);
    expect(formatObservedHistoryNet(-100)).toBe(`- ${formatBRLFromCents(100)}`);
    expect(formatObservedHistoryNet(0)).toBe(formatBRLFromCents(0));
    expect(copy).not.toMatch(/saldo|disponível|dinheiro livre|quanto você tem/);
    expect(observedHistoryGapNote(periodHistory)).toBeNull();
  });

  it("shows missing months as sem dados and a real zero as zero", () => {
    const periodHistory = history({
      months: [
        month({ monthKey: "2026-08", hasData: true, transactionCount: 2, netCents: 0 }),
        month({ monthKey: "2026-09" }),
        month({
          monthKey: "2026-10",
          end: "2026-10-09",
          inflowCents: 50,
          netCents: 50,
          transactionCount: 1,
          isPartial: true,
          hasData: true,
        }),
      ],
    });
    const rows = buildObservedHistoryMonthRows(periodHistory);

    expect(rows[0]).toMatchObject({ label: "Agosto", tone: "neutral", netLabel: formatBRLFromCents(0), note: null });
    expect(rows[1]).toMatchObject({ label: "Setembro", tone: "missing", netLabel: null, note: "Sem dados" });
    expect(rows[2]).toMatchObject({ tone: "positive", note: "até dia 8" });
    expect(observedHistoryGapNote(periodHistory)).toBe(OBSERVED_HISTORY_COPY.gapNote);
    expect(buildObservedHistoryPeriod(periodHistory).kind).toBe("ready");
  });

  it("uses an empty period message when nothing was counted", () => {
    const periodHistory = history({
      range: "6months",
      months: [
        month({ monthKey: "2026-05" }),
        month({ monthKey: "2026-06" }),
        month({ monthKey: "2026-07" }),
        month({ monthKey: "2026-08" }),
        month({ monthKey: "2026-09" }),
        month({ monthKey: "2026-10", end: "2026-10-09", isPartial: true }),
      ],
    });
    const period = buildObservedHistoryPeriod(periodHistory);

    expect(period.kind).toBe("empty");
    expect(period.message).toBe(OBSERVED_HISTORY_COPY.emptyPeriod);
    expect(period.resultLabel).toBe("Resultado acumulado");
    expect(buildObservedHistoryMonthRows(periodHistory).every((row) => row.tone === "missing")).toBe(true);
    expect(observedHistoryGapNote(periodHistory)).toBeNull();
  });

  it("marks a negative month without relying on the label alone", () => {
    const periodHistory = history({
      referenceDate: "2026-09-30",
      range: "month",
      months: [
        month({
          monthKey: "2026-09",
          outflowCents: 250,
          netCents: -250,
          transactionCount: 1,
          hasData: true,
        }),
      ],
    });
    const row = buildObservedHistoryMonthRows(periodHistory)[0];

    expect(row).toMatchObject({
      label: "Setembro",
      tone: "negative",
      netLabel: `- ${formatBRLFromCents(250)}`,
      note: null,
    });
  });
});
