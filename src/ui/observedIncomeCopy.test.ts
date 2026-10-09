import { describe, expect, it } from "vitest";
import {
  OBSERVED_OTHER_INFLOWS_NOTE,
  hiddenRecurringIncomeLabel,
  observedIncomeDayLabel,
  observedIncomeDetectedLabel,
  observedIncomeTitle,
  observedIncomeVariationLabel,
  observedOtherInflowsBasisLabel,
  selectVisibleRecurringIncome,
} from "./observedIncomeCopy";

describe("observed income copy", () => {
  it("names a canonical salary without showing a confidence score", () => {
    expect(observedIncomeTitle("salario")).toBe("Salário");
    expect(observedIncomeDetectedLabel(["2026-07", "2026-08", "2026-09"])).toBe(
      "Detectado em julho, agosto e setembro",
    );
    expect(observedIncomeDayLabel(5)).toBe("Por volta do dia 5");
    expect(observedIncomeVariationLabel(false)).toBeNull();
  });

  it("describes variable income and other inflows in neutral language", () => {
    expect(observedIncomeVariationLabel(true)).toBe("Valor varia mês a mês");
    expect(observedOtherInflowsBasisLabel(["2026-07", "2026-08", "2026-09"])).toBe(
      "Baseado em julho, agosto e setembro",
    );
    expect(OBSERVED_OTHER_INFLOWS_NOTE).toBe("Entradas que não identificamos como renda recorrente.");
    expect(OBSERVED_OTHER_INFLOWS_NOTE).not.toMatch(/confiança|score/i);
    expect(observedOtherInflowsBasisLabel(["2026-08", "2026-09"])).toBe("Baseado em agosto e setembro");
  });

  it("names the salary payer and limits the visible list to three sources", () => {
    expect(observedIncomeTitle("salario:empresa alpha")).toBe("Salário · Empresa Alpha");
    expect(hiddenRecurringIncomeLabel(1)).toBe("+ 1 fonte identificada");
    const visible = selectVisibleRecurringIncome([
      { estimatedMonthlyCents: 100, patternKey: "d" },
      { estimatedMonthlyCents: 400, patternKey: "a" },
      { estimatedMonthlyCents: 300, patternKey: "b" },
      { estimatedMonthlyCents: 200, patternKey: "c" },
    ]);
    expect(visible.map((item) => item.patternKey)).toEqual(["a", "b", "c"]);
  });
});
