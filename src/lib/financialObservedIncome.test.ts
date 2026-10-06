import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectObservedHabits,
  detectObservedIncome,
  type PatternDetectionTransaction,
} from "./financialPatternDetection";
import { buildFinancialPatternSuggestions } from "./financialPatternSuggestions";
import { selectVisibleRecurringIncome } from "../ui/observedIncomeCopy";

vi.mock("./supabase", () => ({
  supabase: { from: () => ({}), rpc: () => ({}) },
}));

const REFERENCE = "2026-10-05";
const CLOSED = ["2026-07", "2026-08", "2026-09"];

function income(
  partial: Partial<PatternDetectionTransaction> & Pick<PatternDetectionTransaction, "id" | "occurredOn" | "amountCents">,
): PatternDetectionTransaction {
  return {
    type: "income",
    accountId: "nubank",
    ...partial,
  };
}

function monthlyIncome(params: {
  note: string;
  amounts: number[];
  months?: string[];
  day?: string;
  accountId?: string;
  idPrefix?: string;
}) {
  const months = params.months ?? CLOSED;
  return months.map((month, index) => income({
    id: `${params.idPrefix ?? params.note}-${month}`,
    occurredOn: `${month}-${params.day ?? "05"}`,
    amountCents: params.amounts[index] ?? params.amounts[params.amounts.length - 1],
    note: params.note,
    accountId: params.accountId,
  }));
}

function observed(rows: PatternDetectionTransaction[], referenceDate = REFERENCE) {
  return detectObservedIncome(rows, { referenceDate });
}

describe("observed recurring income", () => {
  it("identifies a fixed salary across three consecutive months", () => {
    const result = observed(monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] }));

    expect(result.recurring).toHaveLength(1);
    expect(result.recurring[0]).toMatchObject({
      behaviorType: "fixed_recurring_income",
      normalizedMerchant: "salario:empresa xyz",
      estimatedMonthlyCents: 480000,
      approximateDay: 5,
      occurrenceCount: 3,
      monthsDetected: CLOSED,
    });
  });

  it("classifies a salary that moves beyond the fixed band as variable recurring income", () => {
    // R$ 4.700 / 4.800 / 4.900 fica dentro da faixa fixa de 5% já existente.
    // Esta variação passa de 5% e permanece abaixo de 35%.
    const result = observed(monthlyIncome({
      note: "SALARIO EMPRESA XYZ",
      amounts: [400000, 520000, 460000],
    }));

    expect(result.recurring[0]).toMatchObject({
      behaviorType: "variable_recurring_income",
      estimatedMonthlyCents: 460000,
      approximateDay: 5,
    });
  });

  it("does not treat one large deposit as recurring income", () => {
    expect(observed([
      income({ id: "once", occurredOn: "2026-09-05", amountCents: 500000, note: "SALARIO EMPRESA XYZ" }),
    ]).recurring).toEqual([]);
  });

  it("does not publish income seen in only two months", () => {
    expect(observed(monthlyIncome({
      note: "SALARIO EMPRESA XYZ",
      amounts: [480000, 480000],
      months: ["2026-08", "2026-09"],
    })).recurring).toEqual([]);
  });

  it("does not publish a stale salary", () => {
    expect(observed(monthlyIncome({
      note: "SALARIO EMPRESA XYZ",
      amounts: [480000, 480000, 480000],
      months: ["2026-01", "2026-02", "2026-03"],
    }), "2026-06-15").recurring).toEqual([]);
  });

  it("publishes a salary that is still recent on 05/10", () => {
    const result = observed(monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] }));
    expect(result.recurring[0]?.lastSeen).toBe("2026-09-05");
    expect(result.recurring).toHaveLength(1);
  });

  it("keeps two strong payers as separate income patterns", () => {
    const result = observed([
      ...monthlyIncome({ note: "EMPRESA ALPHA LTDA", amounts: [480000, 480000, 480000], idPrefix: "alpha" }),
      ...monthlyIncome({ note: "EMPRESA BETA LTDA", amounts: [150000, 150000, 150000], idPrefix: "beta" }),
    ]);

    expect(result.recurring.map((item) => item.normalizedMerchant)).toEqual([
      "empresa alpha",
      "empresa beta",
    ]);
    expect(result.recurring.map((item) => item.estimatedMonthlyCents)).toEqual([480000, 150000]);
  });

  it("does not publish a repeated PIX from a person as recurring income", () => {
    const result = observed(monthlyIncome({
      note: "PIX JOAO",
      amounts: [80000, 80000, 80000],
      day: "10",
    }));

    expect(result.recurring).toEqual([]);
    expect(result.otherInflows?.estimatedMonthlyCents).toBe(80000);
  });

  it("does not publish a repeated generic TED as recurring income", () => {
    const result = observed(monthlyIncome({
      note: "TED RECEBIDA",
      amounts: [50000, 50000, 50000],
    }));

    expect(result.recurring).toEqual([]);
    expect(result.otherInflows?.estimatedMonthlyCents).toBe(50000);
  });

  it("excludes internal transfers from income", () => {
    const rows = monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] })
      .map((row) => ({ ...row, transferGroupId: "group-1" }));

    expect(observed(rows).recurring).toEqual([]);
  });

  it("excludes ignored income", () => {
    const rows = monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] })
      .map((row) => ({ ...row, ignoredAt: "2026-09-06T00:00:00Z" }));

    expect(observed(rows).recurring).toEqual([]);
  });

  it("ignores an income transaction after the reference date", () => {
    const result = observed([
      ...monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] }),
      income({ id: "future", occurredOn: "2026-11-05", amountCents: 900000, note: "SALARIO EMPRESA XYZ" }),
    ]);

    expect(result.recurring[0]?.transactionIds).not.toContain("future");
    expect(result.recurring[0]?.occurrenceCount).toBe(3);
    expect(result.recurring[0]?.estimatedMonthlyCents).toBe(480000);
  });

  it("returns the same income when the input is out of order", () => {
    const rows = [
      ...monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] }),
      ...monthlyIncome({ note: "EMPRESA BETA LTDA", amounts: [150000, 150000, 150000], idPrefix: "beta" }),
    ];

    expect(observed([...rows].reverse())).toEqual(observed(rows));
  });

  it("keeps the same payer in two accounts as two income patterns", () => {
    const result = observed([
      ...monthlyIncome({ note: "EMPRESA ALPHA LTDA", amounts: [480000, 480000, 480000], accountId: "nubank", idPrefix: "nu" }),
      ...monthlyIncome({ note: "EMPRESA ALPHA LTDA", amounts: [480000, 480000, 480000], accountId: "inter", idPrefix: "inter" }),
    ]);

    expect(result.recurring).toHaveLength(2);
    expect(result.recurring.map((item) => item.accountId).sort()).toEqual(["inter", "nubank"]);
    expect(new Set(result.recurring.map((item) => item.patternKey)).size).toBe(2);
  });

  it("distinguishes fixed income from variable income", () => {
    const narrow = observed(monthlyIncome({
      note: "SALARIO EMPRESA XYZ",
      amounts: [470000, 490000, 480000],
    }));
    const wider = observed(monthlyIncome({
      note: "CLIENTE PROJETO ESPECIAL",
      amounts: [400000, 520000, 460000],
      idPrefix: "projeto",
    }));

    expect(narrow.recurring[0]?.behaviorType).toBe("fixed_recurring_income");
    expect(wider.recurring[0]?.behaviorType).toBe("variable_recurring_income");
  });

  it("uses the cent median of the recurring amounts", () => {
    const result = observed(monthlyIncome({
      note: "CLIENTE PROJETO ESPECIAL",
      amounts: [400000, 520000, 460000],
      idPrefix: "projeto",
    }));

    expect(result.recurring[0]?.estimatedMonthlyCents).toBe(460000);
  });

  it("keeps the approximate day of the recurring income", () => {
    const result = observed(monthlyIncome({
      note: "SALARIO EMPRESA XYZ",
      amounts: [480000, 480000, 480000],
      day: "05",
    }));

    expect(result.recurring[0]?.approximateDay).toBe(5);
  });

  it("returns every recurring source and leaves the hidden fourth out of other inflows", () => {
    const result = observed([
      ...monthlyIncome({ note: "EMPRESA DELTA LTDA", amounts: [400000, 400000, 400000], idPrefix: "delta" }),
      ...monthlyIncome({ note: "EMPRESA GAMA LTDA", amounts: [300000, 300000, 300000], idPrefix: "gama" }),
      ...monthlyIncome({ note: "EMPRESA BETA LTDA", amounts: [200000, 200000, 200000], idPrefix: "beta" }),
      ...monthlyIncome({ note: "EMPRESA ALPHA LTDA", amounts: [100000, 100000, 100000], idPrefix: "alpha" }),
    ]);

    expect(result.recurring).toHaveLength(4);
    expect(selectVisibleRecurringIncome(result.recurring).map((item) => item.estimatedMonthlyCents)).toEqual([
      400000,
      300000,
      200000,
    ]);
    expect(result.otherInflows).toBeNull();
  });

  it("keeps a stale salary out of identified income and out of other inflows", () => {
    const result = observed(monthlyIncome({
      note: "SALARIO EMPRESA XYZ",
      amounts: [480000, 480000, 480000],
      months: ["2026-07", "2026-08", "2026-09"],
    }), "2026-10-30");

    expect(result.recurring).toEqual([]);
    expect(result.otherInflows).toBeNull();
  });

  it("keeps different salary payers as separate patterns", () => {
    const result = observed([
      ...monthlyIncome({ note: "SALARIO EMPRESA ALPHA LTDA", amounts: [480000, 480000, 480000], idPrefix: "alpha" }),
      ...monthlyIncome({ note: "SALARIO EMPRESA BETA", amounts: [150000, 150000, 150000], idPrefix: "beta" }),
    ]);

    expect(result.recurring.map((item) => item.normalizedMerchant)).toEqual([
      "salario:empresa alpha",
      "salario:empresa beta",
    ]);
  });

  it("groups textual variants of the same salary payer", () => {
    const result = observed([
      income({ id: "alpha-jul", occurredOn: "2026-07-05", amountCents: 480000, note: "SALARIO DA EMPRESA ALPHA" }),
      income({ id: "alpha-aug", occurredOn: "2026-08-05", amountCents: 480000, note: "FOLHA DA EMPRESA ALPHA" }),
      income({ id: "alpha-sep", occurredOn: "2026-09-05", amountCents: 480000, note: "PROVENTO EMPRESA ALPHA" }),
    ]);

    expect(result.recurring).toHaveLength(1);
    expect(result.recurring[0]?.normalizedMerchant).toBe("salario:empresa alpha");
  });

  it("keeps different employers separate after connector removal", () => {
    const result = observed([
      ...monthlyIncome({ note: "SALARIO DA EMPRESA ALPHA", amounts: [480000, 480000, 480000], idPrefix: "alpha" }),
      ...monthlyIncome({ note: "SALARIO DO BANCO BETA", amounts: [150000, 150000, 150000], idPrefix: "beta" }),
    ]);

    expect(result.recurring.map((item) => item.normalizedMerchant)).toEqual([
      "salario:empresa alpha",
      "salario:banco beta",
    ]);
  });

  it("groups company income that differs only by wrappers or a legal suffix", () => {
    const beta = observed([
      income({ id: "beta-jul", occurredOn: "2026-07-12", amountCents: 150000, note: "EMPRESA BETA LTDA" }),
      income({ id: "beta-aug", occurredOn: "2026-08-12", amountCents: 150000, note: "EMPRESA BETA" }),
      income({ id: "beta-sep", occurredOn: "2026-09-12", amountCents: 150000, note: "PAGAMENTO EMPRESA BETA" }),
    ]);
    const wrapped = observed([
      income({ id: "wrap-jul", occurredOn: "2026-07-12", amountCents: 150000, note: "PIX EMPRESA BETA LTDA" }),
      income({ id: "wrap-aug", occurredOn: "2026-08-12", amountCents: 150000, note: "TED EMPRESA BETA" }),
      income({ id: "wrap-sep", occurredOn: "2026-09-12", amountCents: 150000, note: "EMPRESA BETA" }),
    ]);
    const gama = observed([
      income({ id: "gama-jul", occurredOn: "2026-07-08", amountCents: 90000, note: "EMPRESA GAMA LTDA" }),
      income({ id: "gama-aug", occurredOn: "2026-08-08", amountCents: 90000, note: "EMPRESA GAMA" }),
      income({ id: "gama-sep", occurredOn: "2026-09-08", amountCents: 90000, note: "EMPRESA GAMA LTDA" }),
    ]);

    expect(beta.recurring).toHaveLength(1);
    expect(beta.recurring[0]?.normalizedMerchant).toBe("empresa beta");
    expect(wrapped.recurring).toHaveLength(1);
    expect(wrapped.recurring[0]?.normalizedMerchant).toBe("empresa beta");
    expect(gama.recurring[0]?.normalizedMerchant).toBe("empresa gama");
  });

  it("keeps Empresa Beta and Empresa Gama as separate income patterns", () => {
    const result = observed([
      ...monthlyIncome({ note: "EMPRESA BETA", amounts: [150000, 150000, 150000], idPrefix: "beta" }),
      ...monthlyIncome({ note: "EMPRESA GAMA LTDA", amounts: [90000, 90000, 90000], idPrefix: "gama" }),
    ]);

    expect(result.recurring.map((item) => item.normalizedMerchant)).toEqual([
      "empresa beta",
      "empresa gama",
    ]);
  });

  it("keeps a repeated person PIX and a generic TED out of recurring income", () => {
    expect(observed(monthlyIncome({
      note: "PIX JOAO",
      amounts: [80000, 80000, 80000],
      day: "11",
    })).recurring).toEqual([]);
    expect(observed(monthlyIncome({
      note: "TED RECEBIDA",
      amounts: [50000, 50000, 50000],
      day: "11",
    })).recurring).toEqual([]);
  });

  it("falls back to salario when the description has no payer", () => {
    expect(observed(monthlyIncome({
      note: "SALARIO",
      amounts: [480000, 480000, 480000],
    })).recurring[0]?.normalizedMerchant).toBe("salario");
    expect(observed(monthlyIncome({
      note: "FOLHA PAGAMENTO",
      amounts: [480000, 480000, 480000],
    })).recurring[0]?.normalizedMerchant).toBe("salario");
  });

  it("does not send income into the expense inbox or into spending habits", () => {
    const rows = monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] });
    const suggestions = buildFinancialPatternSuggestions({ transactions: rows, referenceDate: REFERENCE });

    expect(suggestions).toEqual([]);
    expect(detectObservedHabits(rows, { referenceDate: REFERENCE })).toEqual([]);
  });
});

describe("other observed inflows", () => {
  function irregular(amounts = [80000, 110000, 90000], months = CLOSED) {
    const days = ["02", "18", "07"];
    return months.map((month, index) => income({
      id: `extra-${month}`,
      occurredOn: `${month}-${days[index] ?? "02"}`,
      amountCents: amounts[index] ?? amounts[amounts.length - 1],
      note: "CLIENTE PROJETO ESPECIAL",
    }));
  }

  it("aggregates irregular strong inflows across three closed months", () => {
    const result = observed(irregular());

    expect(result.recurring).toEqual([]);
    expect(result.otherInflows).toMatchObject({
      estimatedMonthlyCents: 90000,
      monthsUsed: [
        { monthKey: "2026-07", observedCents: 80000 },
        { monthKey: "2026-08", observedCents: 110000 },
        { monthKey: "2026-09", observedCents: 90000 },
      ],
    });
  });

  it("keeps the current month out of the other-inflows baseline", () => {
    const result = observed([
      ...irregular(),
      income({ id: "oct", occurredOn: "2026-10-03", amountCents: 30000, note: "CLIENTE PROJETO ESPECIAL" }),
    ]);

    expect(result.otherInflows?.estimatedMonthlyCents).toBe(90000);
    expect(result.otherInflows?.monthsUsed.map((month) => month.monthKey)).toEqual(CLOSED);
  });

  it("reports current month inflows separately", () => {
    const result = observed([
      ...irregular(),
      income({ id: "oct", occurredOn: "2026-10-03", amountCents: 30000, note: "CLIENTE PROJETO ESPECIAL" }),
    ]);

    expect(result.otherInflows?.currentMonthObservedCents).toBe(30000);
  });

  it("removes recurring income from other observed inflows", () => {
    const result = observed([
      ...monthlyIncome({ note: "SALARIO EMPRESA XYZ", amounts: [480000, 480000, 480000] }),
      ...irregular(),
    ]);

    expect(result.recurring[0]?.estimatedMonthlyCents).toBe(480000);
    expect(result.otherInflows?.estimatedMonthlyCents).toBe(90000);
  });

  it("does not let internal transfers increase other inflows", () => {
    const result = observed([
      ...irregular(),
      income({
        id: "transfer",
        occurredOn: "2026-08-15",
        amountCents: 500000,
        note: "CLIENTE PROJETO ESPECIAL",
        transferGroupId: "group-1",
      }),
    ]);

    expect(result.otherInflows?.estimatedMonthlyCents).toBe(90000);
  });

  it("does not let ignored income increase other inflows", () => {
    const result = observed([
      ...irregular(),
      income({
        id: "ignored",
        occurredOn: "2026-08-16",
        amountCents: 500000,
        note: "CLIENTE PROJETO ESPECIAL",
        ignoredAt: "2026-08-17T00:00:00Z",
      }),
    ]);

    expect(result.otherInflows?.estimatedMonthlyCents).toBe(90000);
  });

  it("includes a weak PIX in the other-inflows median without calling it recurring income", () => {
    const result = observed(monthlyIncome({
      note: "PIX JOAO",
      amounts: [80000, 110000, 90000],
      day: "03",
    }));

    expect(result.recurring).toEqual([]);
    expect(result.otherInflows?.estimatedMonthlyCents).toBe(90000);
  });

  it("keeps a transfer group out of recurring income and other inflows", () => {
    const rows = monthlyIncome({ note: "PIX JOAO", amounts: [80000, 80000, 80000] })
      .map((row) => ({ ...row, transferGroupId: "group-1" }));

    expect(observed(rows)).toEqual({ recurring: [], otherInflows: null });
  });

  it("keeps ignored income out of recurring income and other inflows", () => {
    const rows = monthlyIncome({ note: "PIX JOAO", amounts: [80000, 80000, 80000] })
      .map((row) => ({ ...row, ignoredAt: "2026-09-06T00:00:00Z" }));

    expect(observed(rows)).toEqual({ recurring: [], otherInflows: null });
  });

  it("does not publish other inflows from a single closed month", () => {
    expect(observed(irregular([90000], ["2026-09"])).otherInflows).toBeNull();
  });

  it("does not publish other inflows below R$ 50 per month", () => {
    expect(observed(irregular([2000, 2400], ["2026-08", "2026-09"])).otherInflows).toBeNull();
    const exactFloor = observed(irregular([5000, 5000], ["2026-08", "2026-09"]));
    expect(exactFloor.otherInflows?.estimatedMonthlyCents).toBe(5000);
    expect(exactFloor.otherInflows?.monthsUsed.map((month) => month.monthKey)).toEqual(["2026-08", "2026-09"]);
  });

  it("uses the median so one high month does not set the baseline", () => {
    const result = observed(irregular([80000, 110000, 900000]));

    expect(result.otherInflows?.estimatedMonthlyCents).toBe(110000);
  });

  it("returns the same other inflows when the input is out of order", () => {
    const rows = [
      ...irregular(),
      income({ id: "oct", occurredOn: "2026-10-03", amountCents: 30000, note: "CLIENTE PROJETO ESPECIAL" }),
    ];

    expect(observed([...rows].reverse()).otherInflows).toEqual(observed(rows).otherInflows);
  });
});

describe("income observation stays out of planning totals", () => {
  it("does not write profile income or add a planning action", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const screen = readFileSync(join(root, "../../app/(app)/financial-plan.tsx"), "utf8");
    const section = readFileSync(join(root, "../ui/ObservedIncomeSection.tsx"), "utf8");

    expect(screen).not.toMatch(/upsertProfile|from\("profiles"\)|expectedMonthlyIncomeCents/);
    expect(section).toMatch(/Usar no planejamento/);
    expect(section).not.toMatch(/Outras entradas observadas[\s\S]*Usar no planejamento/);
    expect(section).not.toMatch(/Confirmar|Rejeitar/);
  });
});
