import { describe, expect, it } from "vitest";
import {
  detectFinancialPatterns,
  detectObservedHabits,
  HABIT_OBSERVATION,
  type PatternDetectionTransaction,
} from "./financialPatternDetection";

const REFERENCE = "2026-10-05";
const CLOSED = ["2026-07", "2026-08", "2026-09"];

function tx(
  partial: Partial<PatternDetectionTransaction> & Pick<PatternDetectionTransaction, "id" | "occurredOn" | "amountCents">,
): PatternDetectionTransaction {
  return {
    type: "expense",
    accountId: "nubank",
    ...partial,
  };
}

function observedSpend(params: {
  categoryId: string;
  monthlyCents: number;
  months?: string[];
  chargesPerMonth?: number;
  noteFor?: (month: string, index: number) => string;
  accountId?: string;
}): PatternDetectionTransaction[] {
  const months = params.months ?? CLOSED;
  const charges = params.chargesPerMonth ?? 2;
  const base = Math.floor(params.monthlyCents / charges);
  const remainder = params.monthlyCents - base * charges;
  const rows: PatternDetectionTransaction[] = [];
  for (const month of months) {
    for (let index = 0; index < charges; index += 1) {
      const day = String(3 + index * 8).padStart(2, "0");
      rows.push(tx({
        id: `${params.categoryId}-${month}-${index}`,
        occurredOn: `${month}-${day}`,
        amountCents: base + (index === charges - 1 ? remainder : 0),
        note: params.noteFor?.(month, index) ?? `${params.categoryId} ${month} ${index}`,
        categoryId: params.categoryId,
        accountId: params.accountId,
      }));
    }
  }
  return rows;
}

function habitFor(rows: PatternDetectionTransaction[], categoryId: string) {
  return detectObservedHabits(rows, { referenceDate: REFERENCE }).find((habit) => habit.categoryId === categoryId);
}

describe("detectObservedHabits", () => {
  it("publishes food when the category was active in 3 of the last 4 closed months", () => {
    const habit = habitFor(observedSpend({ categoryId: "alimentacao", monthlyCents: 62000 }), "alimentacao");

    expect(habit?.estimatedMonthlyCents).toBe(62000);
    expect(habit?.monthsUsed.map((month) => month.monthKey)).toEqual(CLOSED);
    expect(habit?.transactionCount).toBe(6);
  });

  it("does not publish a category active in only 2 of the last 4 closed months", () => {
    const habits = detectObservedHabits(
      observedSpend({ categoryId: "alimentacao", monthlyCents: 62000, months: ["2026-08", "2026-09"] }),
      { referenceDate: REFERENCE },
    );

    expect(habits).toEqual([]);
  });

  it("publishes fuel bought only at the same station", () => {
    const habit = habitFor(observedSpend({
      categoryId: "transporte",
      monthlyCents: 60000,
      chargesPerMonth: 3,
      noteFor: () => "POSTO SHELL",
    }), "transporte");

    expect(habit?.estimatedMonthlyCents).toBe(60000);
    expect(habit?.distinctMerchantCount).toBe(1);
  });

  it("publishes several Uber trips in the same months as transport, not as a bill", () => {
    const rows = CLOSED.flatMap((month) => [2, 5, 14, 22].map((day, index) => tx({
      id: `uber-${month}-${index}`,
      occurredOn: `${month}-${String(day).padStart(2, "0")}`,
      amountCents: 3000,
      note: "UBER TRIP",
      categoryId: "transporte",
    })));

    expect(detectFinancialPatterns(rows, { referenceDate: REFERENCE }).some((pattern) => (
      pattern.behaviorType === "fixed_recurring_expense" || pattern.behaviorType === "variable_recurring_expense"
    ))).toBe(false);
    expect(habitFor(rows, "transporte")?.estimatedMonthlyCents).toBe(12000);
    expect(habitFor(rows, "transporte")?.distinctMerchantCount).toBe(1);
  });

  it("consolidates several supermarkets into one category habit", () => {
    const rows = [
      tx({ id: "e1", occurredOn: "2026-07-02", amountCents: 20000, note: "Supermercado Extra", categoryId: "alimentacao" }),
      tx({ id: "e2", occurredOn: "2026-08-18", amountCents: 21000, note: "Supermercado Extra", categoryId: "alimentacao" }),
      tx({ id: "e3", occurredOn: "2026-09-27", amountCents: 22000, note: "Supermercado Extra", categoryId: "alimentacao" }),
      tx({ id: "c1", occurredOn: "2026-07-09", amountCents: 18000, note: "Carrefour", categoryId: "alimentacao" }),
      tx({ id: "c2", occurredOn: "2026-08-04", amountCents: 19000, note: "Carrefour", categoryId: "alimentacao" }),
      tx({ id: "c3", occurredOn: "2026-09-22", amountCents: 20000, note: "Carrefour", categoryId: "alimentacao" }),
      tx({ id: "a1", occurredOn: "2026-07-16", amountCents: 15000, note: "Assai Atacadista", categoryId: "alimentacao" }),
      tx({ id: "a2", occurredOn: "2026-08-11", amountCents: 16000, note: "Assai Atacadista", categoryId: "alimentacao" }),
      tx({ id: "a3", occurredOn: "2026-09-03", amountCents: 17000, note: "Assai Atacadista", categoryId: "alimentacao" }),
    ];
    const habits = detectObservedHabits(rows, { referenceDate: REFERENCE });

    expect(habits).toHaveLength(1);
    expect(habits[0]).toMatchObject({
      categoryId: "alimentacao",
      estimatedMonthlyCents: 56000,
      distinctMerchantCount: 3,
      transactionCount: 9,
    });
  });

  it("excludes a recurring Netflix charge from habits", () => {
    const rows = [
      tx({ id: "n1", occurredOn: "2026-07-05", amountCents: 6000, note: "PG *NETFLIX", categoryId: "assinaturas" }),
      tx({ id: "n2", occurredOn: "2026-08-05", amountCents: 6000, note: "PG *NETFLIX", categoryId: "assinaturas" }),
      tx({ id: "n3", occurredOn: "2026-09-05", amountCents: 6000, note: "PG *NETFLIX", categoryId: "assinaturas" }),
      tx({ id: "n4", occurredOn: "2026-09-05", amountCents: 6000, note: "NETFLIX.COM", categoryId: "assinaturas" }),
    ];

    expect(detectFinancialPatterns(rows, { referenceDate: REFERENCE }).some((pattern) => (
      pattern.behaviorType === "fixed_recurring_expense" && pattern.transactionIds.includes("n1")
    ))).toBe(true);
    expect(detectObservedHabits(rows, { referenceDate: REFERENCE })).toEqual([]);
  });

  it("excludes a recurring Cemig charge from the energy habit", () => {
    const rows = [
      tx({ id: "c1", occurredOn: "2026-07-10", amountCents: 19800, note: "CEMIG", categoryId: "energia" }),
      tx({ id: "c2", occurredOn: "2026-08-10", amountCents: 22400, note: "CEMIG DISTRIBUICAO", categoryId: "energia" }),
      tx({ id: "c3", occurredOn: "2026-08-10", amountCents: 21100, note: "PAGTO CEMIG", categoryId: "energia" }),
      tx({ id: "c4", occurredOn: "2026-09-10", amountCents: 21100, note: "CEMIG", categoryId: "energia" }),
    ];

    expect(detectFinancialPatterns(rows, { referenceDate: REFERENCE }).some((pattern) => (
      pattern.behaviorType === "variable_recurring_expense" && pattern.transactionIds.includes("c1")
    ))).toBe(true);
    expect(detectObservedHabits(rows, { referenceDate: REFERENCE })).toEqual([]);
  });

  it("drops only the recurring transaction ids and keeps other spending in the category", () => {
    const cemig = [
      tx({ id: "c1", occurredOn: "2026-07-10", amountCents: 21100, note: "CEMIG", categoryId: "energia" }),
      tx({ id: "c2", occurredOn: "2026-08-10", amountCents: 21100, note: "CEMIG", categoryId: "energia" }),
      tx({ id: "c3", occurredOn: "2026-09-10", amountCents: 21100, note: "CEMIG", categoryId: "energia" }),
    ];
    const other = observedSpend({ categoryId: "energia", monthlyCents: 16000 });
    const habit = habitFor([...cemig, ...other], "energia");

    expect(habit).toMatchObject({
      estimatedMonthlyCents: 16000,
      transactionCount: 6,
      monthsUsed: [
        { monthKey: "2026-07", spentCents: 16000 },
        { monthKey: "2026-08", spentCents: 16000 },
        { monthKey: "2026-09", spentCents: 16000 },
      ],
    });
  });

  it("ignores internal transfers when building a habit", () => {
    const rows = observedSpend({ categoryId: "alimentacao", monthlyCents: 40000 });
    const withTransfer = [
      ...rows,
      tx({
        id: "transfer",
        occurredOn: "2026-07-15",
        amountCents: 10000,
        note: "Transferencia entre contas",
        categoryId: "alimentacao",
        transferGroupId: "group-1",
      }),
      tx({
        id: "transfer-2",
        occurredOn: "2026-08-15",
        amountCents: 10000,
        note: "Transferencia entre contas",
        categoryId: "alimentacao",
        transferGroupId: "group-1",
      }),
      tx({
        id: "transfer-3",
        occurredOn: "2026-09-15",
        amountCents: 10000,
        note: "Transferencia entre contas",
        categoryId: "alimentacao",
        transferGroupId: "group-1",
      }),
    ];

    expect(habitFor(withTransfer, "alimentacao")?.estimatedMonthlyCents).toBe(40000);
    expect(habitFor(withTransfer, "alimentacao")?.transactionCount).toBe(6);
  });

  it("ignores transactions marked ignored_at", () => {
    const rows = observedSpend({ categoryId: "alimentacao", monthlyCents: 40000 });
    const withIgnored = [
      ...rows,
      tx({
        id: "ignored",
        occurredOn: "2026-08-15",
        amountCents: 90000,
        note: "Compra ignorada",
        categoryId: "alimentacao",
        ignoredAt: "2026-08-16T00:00:00Z",
      }),
    ];

    expect(habitFor(withIgnored, "alimentacao")).toEqual(habitFor(rows, "alimentacao"));
  });

  it("does not create a habit without category_id", () => {
    const rows = observedSpend({ categoryId: "alimentacao", monthlyCents: 40000 }).map((row) => ({
      ...row,
      categoryId: null,
    }));

    expect(detectObservedHabits(rows, { referenceDate: REFERENCE })).toEqual([]);
  });

  it("does not turn one large purchase into a habit", () => {
    const habits = detectObservedHabits([
      tx({ id: "once", occurredOn: "2026-09-12", amountCents: 900000, note: "Geladeira", categoryId: "compras" }),
    ], { referenceDate: REFERENCE });

    expect(habits).toEqual([]);
  });

  it("keeps the partial current month out of the monthly baseline", () => {
    const habit = habitFor([
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 60000, months: ["2026-07"] }),
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 62000, months: ["2026-08"] }),
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 64000, months: ["2026-09"] }),
      tx({ id: "oct", occurredOn: "2026-10-03", amountCents: 15000, note: "Padaria outubro", categoryId: "alimentacao" }),
    ], "alimentacao");

    expect(habit?.estimatedMonthlyCents).toBe(62000);
    expect(habit?.monthsUsed.map((month) => month.monthKey)).toEqual(CLOSED);
  });

  it("reports current month spending separately", () => {
    const habit = habitFor([
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 62000 }),
      tx({ id: "oct", occurredOn: "2026-10-03", amountCents: 15000, note: "Padaria outubro", categoryId: "alimentacao" }),
    ], "alimentacao");

    expect(habit?.currentMonthSpentCents).toBe(15000);
    expect(habit?.transactionCount).toBe(6);
  });

  it("uses only closed months before 05/10 when that is the reference date", () => {
    const habit = habitFor([
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 50000, months: ["2026-06"] }),
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 60000, months: ["2026-07"] }),
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 62000, months: ["2026-08"] }),
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 64000, months: ["2026-09"] }),
      tx({ id: "oct", occurredOn: "2026-10-05", amountCents: 90000, note: "Padaria outubro", categoryId: "alimentacao" }),
    ], "alimentacao");

    expect(habit?.monthsUsed.map((month) => month.monthKey)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(habit?.estimatedMonthlyCents).toBe(62000);
    expect(habit?.currentMonthSpentCents).toBe(90000);
  });

  it("drops a closed month that is more than twice the median of the other estimate months", () => {
    // Regra: nos 3 meses fechados mais recentes com atividade, se um único mês
    // for estritamente maior que 2 × a mediana dos demais, ele sai do baseline.
    // 50000, 52000 e 180000 → mediana dos demais = 51000; 180000 > 102000,
    // então a estimativa fica 51000. A média dos três (~94000) não é usada.
    const habit = habitFor([
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 50000, months: ["2026-07"] }),
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 52000, months: ["2026-08"] }),
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 180000, months: ["2026-09"] }),
    ], "alimentacao");

    expect(HABIT_OBSERVATION.outlierMultiple).toBe(2);
    expect(habit?.estimatedMonthlyCents).toBe(51000);
    expect(habit?.outlierMonthDiscarded).toEqual({ monthKey: "2026-09", spentCents: 180000 });
    expect(habit?.monthsUsed).toEqual([
      { monthKey: "2026-07", spentCents: 50000 },
      { monthKey: "2026-08", spentCents: 52000 },
    ]);
    expect(habit?.monthsUsed.map((month) => month.monthKey)).not.toContain("2026-09");
  });

  it("stays recent on 30/10 when October still has eligible spending after a stale September", () => {
    // 14/09 até 30/10 são 46 dias. O mês corrente com gasto elegível mantém o hábito.
    const rows = [
      tx({ id: "j1", occurredOn: "2026-07-02", amountCents: 30000, note: "Padaria julho", categoryId: "alimentacao" }),
      tx({ id: "j2", occurredOn: "2026-07-14", amountCents: 30000, note: "Feira julho", categoryId: "alimentacao" }),
      tx({ id: "a1", occurredOn: "2026-08-02", amountCents: 31000, note: "Padaria agosto", categoryId: "alimentacao" }),
      tx({ id: "a2", occurredOn: "2026-08-14", amountCents: 31000, note: "Feira agosto", categoryId: "alimentacao" }),
      tx({ id: "s1", occurredOn: "2026-09-02", amountCents: 32000, note: "Padaria setembro", categoryId: "alimentacao" }),
      tx({ id: "s2", occurredOn: "2026-09-14", amountCents: 32000, note: "Feira setembro", categoryId: "alimentacao" }),
      tx({ id: "oct", occurredOn: "2026-10-12", amountCents: 8000, note: "Padaria outubro", categoryId: "alimentacao" }),
    ];
    const habit = detectObservedHabits(rows, { referenceDate: "2026-10-30" })
      .find((item) => item.categoryId === "alimentacao");

    expect(habit?.estimatedMonthlyCents).toBe(62000);
    expect(habit?.currentMonthSpentCents).toBe(8000);
    expect(habit?.monthsUsed.map((month) => month.monthKey)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("does not publish when the last closed activity is older than 45 days and this month has no eligible spending", () => {
    const rows = [
      tx({ id: "j1", occurredOn: "2026-07-02", amountCents: 30000, note: "Padaria julho", categoryId: "alimentacao" }),
      tx({ id: "j2", occurredOn: "2026-07-14", amountCents: 30000, note: "Feira julho", categoryId: "alimentacao" }),
      tx({ id: "a1", occurredOn: "2026-08-02", amountCents: 31000, note: "Padaria agosto", categoryId: "alimentacao" }),
      tx({ id: "a2", occurredOn: "2026-08-14", amountCents: 31000, note: "Feira agosto", categoryId: "alimentacao" }),
      tx({ id: "s1", occurredOn: "2026-09-02", amountCents: 32000, note: "Padaria setembro", categoryId: "alimentacao" }),
      tx({ id: "s2", occurredOn: "2026-09-14", amountCents: 32000, note: "Feira setembro", categoryId: "alimentacao" }),
    ];

    expect(detectObservedHabits(rows, { referenceDate: "2026-10-30" })).toEqual([]);
  });

  it("does not publish a habit below R$ 50 per month", () => {
    const below = detectObservedHabits(
      observedSpend({ categoryId: "lazer", monthlyCents: 4998 }),
      { referenceDate: REFERENCE },
    );
    const exact = detectObservedHabits(
      observedSpend({ categoryId: "lazer", monthlyCents: HABIT_OBSERVATION.minEstimatedMonthlyCents }),
      { referenceDate: REFERENCE },
    );

    expect(below).toEqual([]);
    expect(exact[0]?.estimatedMonthlyCents).toBe(5000);
  });

  it("returns at most the five habits with the highest estimate", () => {
    const rows = [6, 5, 4, 3, 2, 1].flatMap((rank) => observedSpend({
      categoryId: `cat-${rank}`,
      monthlyCents: rank * 10000,
    }));
    const habits = detectObservedHabits(rows, { referenceDate: REFERENCE });

    expect(habits.map((habit) => habit.categoryId)).toEqual([
      "cat-6",
      "cat-5",
      "cat-4",
      "cat-3",
      "cat-2",
    ]);
  });

  it("orders habits by estimate and then by category id", () => {
    const rows = [
      ...observedSpend({ categoryId: "z-habit", monthlyCents: 30000 }),
      ...observedSpend({ categoryId: "a-habit", monthlyCents: 10000 }),
      ...observedSpend({ categoryId: "m-habit", monthlyCents: 30000 }),
    ];

    expect(detectObservedHabits(rows, { referenceDate: REFERENCE }).map((habit) => habit.categoryId)).toEqual([
      "m-habit",
      "z-habit",
      "a-habit",
    ]);
    expect(detectObservedHabits([...rows].reverse(), { referenceDate: REFERENCE }).map((habit) => habit.categoryId)).toEqual([
      "m-habit",
      "z-habit",
      "a-habit",
    ]);
  });

  it("returns the same habits when the input is out of order", () => {
    const rows = [
      ...observedSpend({ categoryId: "alimentacao", monthlyCents: 62000 }),
      ...observedSpend({
        categoryId: "transporte",
        monthlyCents: 60000,
        chargesPerMonth: 3,
        noteFor: () => "POSTO SHELL",
      }),
      tx({ id: "oct", occurredOn: "2026-10-03", amountCents: 15000, note: "Padaria outubro", categoryId: "alimentacao" }),
      tx({ id: "n1", occurredOn: "2026-07-05", amountCents: 4490, note: "PG *NETFLIX", categoryId: "assinaturas" }),
      tx({ id: "n2", occurredOn: "2026-08-05", amountCents: 4490, note: "NETFLIX.COM", categoryId: "assinaturas" }),
      tx({ id: "n3", occurredOn: "2026-09-05", amountCents: 4490, note: "PG *NETFLIX", categoryId: "assinaturas" }),
    ];

    expect(detectObservedHabits([...rows].reverse(), { referenceDate: REFERENCE })).toEqual(
      detectObservedHabits(rows, { referenceDate: REFERENCE }),
    );
  });
});
