import { describe, expect, it } from "vitest";
import {
  clampConfidence,
  detectFinancialPatterns,
  isActionablePattern,
  medianCents,
  PATTERN_DETECTION,
  type PatternDetectionTransaction,
} from "./financialPatternDetection";

function tx(partial: Partial<PatternDetectionTransaction> & Pick<PatternDetectionTransaction, "id" | "occurredOn" | "amountCents">): PatternDetectionTransaction {
  return {
    type: "expense",
    ...partial,
  };
}

describe("medianCents", () => {
  it("returns the middle value without using floats for money", () => {
    expect(medianCents([18000, 26000, 21000])).toBe(21000);
    expect(medianCents([200, 400])).toBe(300);
    expect(medianCents([])).toBe(0);
  });
});

describe("confidence helpers", () => {
  it("clamps scores to 0–100", () => {
    expect(clampConfidence(-20)).toBe(0);
    expect(clampConfidence(140)).toBe(100);
    expect(clampConfidence(70.4)).toBe(70);
  });

  it("treats confidence below 70 as not actionable", () => {
    expect(isActionablePattern({ confidence: 70 })).toBe(true);
    expect(isActionablePattern({ confidence: 69 })).toBe(false);
  });
});

describe("detectFinancialPatterns", () => {
  it("returns nothing for an empty input", () => {
    expect(detectFinancialPatterns([])).toEqual([]);
  });

  it("detects Netflix billed on the same day for three months as a fixed recurring expense", () => {
    const patterns = detectFinancialPatterns([
      tx({ id: "n3", occurredOn: "2026-10-05", amountCents: 4490, originalNote: "NETFLIX SERVICOS", accountId: "nubank" }),
      tx({ id: "n1", occurredOn: "2026-08-05", amountCents: 4490, originalNote: "PG *NETFLIX", accountId: "nubank" }),
      tx({ id: "n2", occurredOn: "2026-09-05", amountCents: 4490, originalNote: "NETFLIX.COM", accountId: "nubank" }),
    ]);

    const netflix = patterns.find((pattern) => pattern.behaviorType === "fixed_recurring_expense");
    expect(netflix).toMatchObject({
      direction: "expense",
      normalizedMerchant: "netflix",
      accountId: "nubank",
      cadence: "monthly",
      estimatedAmountCents: 4490,
      estimatedDay: 5,
      occurrenceCount: 3,
    });
    expect(netflix?.confidence).toBeGreaterThanOrEqual(PATTERN_DETECTION.actionableConfidence);
    expect(isActionablePattern(netflix!)).toBe(true);
    expect(netflix?.transactionIds).toEqual(["n1", "n2", "n3"]);
  });

  it("detects Cemig as a variable recurring expense and predicts the median amount", () => {
    const cemig = detectFinancialPatterns([
      tx({ id: "c1", occurredOn: "2026-08-10", amountCents: 19800, note: "CEMIG", accountId: "inter" }),
      tx({ id: "c2", occurredOn: "2026-09-11", amountCents: 22400, note: "CEMIG ENERGIA", accountId: "inter" }),
      tx({ id: "c3", occurredOn: "2026-10-09", amountCents: 21100, note: "CEMIG", accountId: "inter" }),
    ]).find((pattern) => pattern.normalizedMerchant === "cemig");

    expect(cemig).toMatchObject({
      behaviorType: "variable_recurring_expense",
      cadence: "monthly",
      estimatedAmountCents: 21100,
      estimatedDay: 10,
    });
    expect(isActionablePattern(cemig!)).toBe(true);
  });

  it("classifies supermarket spend across merchants as a category habit, not a bill", () => {
    const patterns = detectFinancialPatterns([
      tx({ id: "s1", occurredOn: "2026-08-02", amountCents: 8200, note: "Supermercado Extra", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s2", occurredOn: "2026-08-12", amountCents: 5400, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s3", occurredOn: "2026-08-18", amountCents: 6100, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s4", occurredOn: "2026-09-14", amountCents: 7900, note: "Supermercado Extra", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s5", occurredOn: "2026-09-16", amountCents: 4300, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s6", occurredOn: "2026-09-20", amountCents: 6700, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s7", occurredOn: "2026-10-01", amountCents: 8800, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s8", occurredOn: "2026-10-08", amountCents: 5100, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "nubank" }),
    ]);

    expect(patterns.some((pattern) => pattern.behaviorType === "habitual_category_spend")).toBe(true);
    expect(patterns.some((pattern) => (
      pattern.behaviorType === "fixed_recurring_expense" || pattern.behaviorType === "variable_recurring_expense"
    ))).toBe(false);
    const habit = patterns.find((pattern) => pattern.behaviorType === "habitual_category_spend");
    expect(habit?.categoryId).toBe("alimentacao");
    expect(isActionablePattern(habit!)).toBe(false);
  });

  it("marks a single purchase as eventual", () => {
    const [pattern] = detectFinancialPatterns([
      tx({ id: "one", occurredOn: "2026-10-02", amountCents: 12900, note: "Magazine Luiza", accountId: "nubank" }),
    ]);
    expect(pattern.behaviorType).toBe("eventual");
    expect(pattern.occurrenceCount).toBe(1);
    expect(isActionablePattern(pattern)).toBe(false);
  });

  it("keeps two occurrences as insufficient history", () => {
    const [pattern] = detectFinancialPatterns([
      tx({ id: "a", occurredOn: "2026-09-05", amountCents: 4490, note: "NETFLIX.COM", accountId: "nubank" }),
      tx({ id: "b", occurredOn: "2026-10-05", amountCents: 4490, note: "NETFLIX.COM", accountId: "nubank" }),
    ]);
    expect(pattern.behaviorType).toBe("unknown");
    expect(pattern.occurrenceCount).toBe(2);
    expect(isActionablePattern(pattern)).toBe(false);
  });

  it("ignores transactions marked as ignored", () => {
    const patterns = detectFinancialPatterns([
      tx({ id: "n1", occurredOn: "2026-08-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n2", occurredOn: "2026-09-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n3", occurredOn: "2026-10-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank", ignoredAt: "2026-10-06T12:00:00Z" }),
    ]);
    expect(patterns[0]?.occurrenceCount).toBe(2);
    expect(patterns[0]?.behaviorType).toBe("unknown");
  });

  it("ignores internal transfers", () => {
    const patterns = detectFinancialPatterns([
      tx({ id: "t1", occurredOn: "2026-08-05", amountCents: 10000, note: "Transferencia", accountId: "nubank", transferGroupId: "g1" }),
      tx({ id: "t2", occurredOn: "2026-09-05", amountCents: 10000, note: "Transferencia", accountId: "nubank", transferGroupId: "g1" }),
      tx({ id: "t3", occurredOn: "2026-10-05", amountCents: 10000, note: "Transferencia", accountId: "nubank", transferGroupId: "g1" }),
    ]);
    expect(patterns).toEqual([]);
  });

  it("keeps the same Netflix merchant in different accounts as separate groups", () => {
    const patterns = detectFinancialPatterns([
      tx({ id: "a1", occurredOn: "2026-08-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "a2", occurredOn: "2026-09-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "a3", occurredOn: "2026-10-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "b1", occurredOn: "2026-08-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
      tx({ id: "b2", occurredOn: "2026-09-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
      tx({ id: "b3", occurredOn: "2026-10-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
    ]).filter((pattern) => pattern.behaviorType === "fixed_recurring_expense");

    expect(patterns).toHaveLength(2);
    expect(new Set(patterns.map((pattern) => pattern.accountId))).toEqual(new Set(["nubank", "inter"]));
  });

  it("does not treat a repeated PIX to a person as a strong recurring bill", () => {
    const patterns = detectFinancialPatterns([
      tx({ id: "p1", occurredOn: "2026-08-10", amountCents: 15000, note: "PIX JOÃO", accountId: "nubank" }),
      tx({ id: "p2", occurredOn: "2026-09-10", amountCents: 15000, note: "PIX JOÃO", accountId: "nubank" }),
      tx({ id: "p3", occurredOn: "2026-10-10", amountCents: 15000, note: "PIX JOÃO", accountId: "nubank" }),
    ]);

    expect(patterns.some((pattern) => pattern.behaviorType === "fixed_recurring_expense")).toBe(false);
    expect(patterns.every((pattern) => !isActionablePattern(pattern))).toBe(true);
    expect(patterns[0]?.merchantConfidence).toBe("weak");
  });

  it("detects a stable monthly salary as fixed recurring income", () => {
    const salary = detectFinancialPatterns([
      tx({ id: "i1", type: "income", occurredOn: "2026-08-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
      tx({ id: "i2", type: "income", occurredOn: "2026-09-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
      tx({ id: "i3", type: "income", occurredOn: "2026-10-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
    ]).find((pattern) => pattern.direction === "income");

    expect(salary).toMatchObject({
      behaviorType: "fixed_recurring_income",
      cadence: "monthly",
      estimatedAmountCents: 350000,
      estimatedDay: 1,
      normalizedMerchant: "salario",
    });
    expect(isActionablePattern(salary!)).toBe(true);
  });

  it("detects monthly income whose amount varies as variable recurring income", () => {
    const income = detectFinancialPatterns([
      tx({ id: "v1", type: "income", occurredOn: "2026-08-05", amountCents: 150000, note: "SPOTIFY", accountId: "nubank" }),
      tx({ id: "v2", type: "income", occurredOn: "2026-09-05", amountCents: 180000, note: "SPOTIFY", accountId: "nubank" }),
      tx({ id: "v3", type: "income", occurredOn: "2026-10-05", amountCents: 165000, note: "SPOTIFY", accountId: "nubank" }),
    ]).find((pattern) => pattern.direction === "income");

    expect(income?.behaviorType).toBe("variable_recurring_income");
    expect(income?.estimatedAmountCents).toBe(165000);
  });

  it("does not change the result when transaction order changes", () => {
    const rows = [
      tx({ id: "n2", occurredOn: "2026-09-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n3", occurredOn: "2026-10-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n1", occurredOn: "2026-08-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
    ];
    const forward = detectFinancialPatterns(rows);
    const reversed = detectFinancialPatterns([...rows].reverse());
    expect(reversed).toEqual(forward);
  });

  it("uses an explicit referenceDate instead of the clock, so 2025 activity is not current in 2026", () => {
    const rows = [
      tx({ id: "n1", occurredOn: "2025-04-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n2", occurredOn: "2025-05-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n3", occurredOn: "2025-06-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
    ];
    const relativeToHistory = detectFinancialPatterns(rows).find((pattern) => pattern.normalizedMerchant === "netflix");
    const relativeTo2026 = detectFinancialPatterns(rows, { referenceDate: "2026-10-05" });

    expect(relativeToHistory?.behaviorType).toBe("fixed_recurring_expense");
    expect(relativeTo2026.some((pattern) => pattern.normalizedMerchant === "netflix")).toBe(false);
  });

  it("does not treat an abandoned monthly pattern as current", () => {
    const pattern = detectFinancialPatterns([
      tx({ id: "n1", occurredOn: "2026-01-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n2", occurredOn: "2026-02-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "n3", occurredOn: "2026-03-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
    ], { referenceDate: "2026-06-15" }).find((item) => item.normalizedMerchant === "netflix");

    expect(pattern?.behaviorType).not.toBe("fixed_recurring_expense");
    expect(isActionablePattern(pattern!)).toBe(false);
  });

  it("does not treat a perfectly timed PIX to a person as an actionable bill", () => {
    const pattern = detectFinancialPatterns([
      tx({ id: "p1", occurredOn: "2026-08-05", amountCents: 50000, note: "PIX JOÃO", accountId: "nubank" }),
      tx({ id: "p2", occurredOn: "2026-09-05", amountCents: 50000, note: "PIX JOÃO", accountId: "nubank" }),
      tx({ id: "p3", occurredOn: "2026-10-05", amountCents: 50000, note: "PIX JOÃO", accountId: "nubank" }),
    ])[0];

    expect(pattern.merchantConfidence).toBe("weak");
    expect(pattern.behaviorType).not.toBe("fixed_recurring_expense");
    expect(isActionablePattern(pattern)).toBe(false);
  });

  it("keeps generic PAGAMENTO, TRANSFERENCIA and TED RECEBIDA non-actionable", () => {
    for (const note of ["PAGAMENTO", "TRANSFERENCIA", "TED RECEBIDA"]) {
      const pattern = detectFinancialPatterns([
        tx({ id: `${note}-1`, occurredOn: "2026-08-05", amountCents: 10000, note, accountId: "nubank" }),
        tx({ id: `${note}-2`, occurredOn: "2026-09-05", amountCents: 10000, note, accountId: "nubank" }),
        tx({ id: `${note}-3`, occurredOn: "2026-10-05", amountCents: 10000, note, accountId: "nubank" }),
      ])[0];
      expect(pattern.merchantConfidence).toBe("weak");
      expect(isActionablePattern(pattern)).toBe(false);
    }
  });

  it("recognizes month-end billing across 29/30/31 and clamps the predicted day to 28", () => {
    const first = detectFinancialPatterns([
      tx({ id: "a1", occurredOn: "2026-01-31", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "a2", occurredOn: "2026-02-28", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "a3", occurredOn: "2026-03-31", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
    ]).find((pattern) => pattern.behaviorType === "fixed_recurring_expense");
    const second = detectFinancialPatterns([
      tx({ id: "b1", occurredOn: "2026-04-30", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "b2", occurredOn: "2026-05-31", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "b3", occurredOn: "2026-06-30", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
    ]).find((pattern) => pattern.behaviorType === "fixed_recurring_expense");

    expect(first?.cadence).toBe("monthly");
    expect(second?.cadence).toBe("monthly");
    expect(first?.estimatedDay).toBe(28);
    expect(second?.estimatedDay).toBe(28);
  });

  it("does not treat two charges on the same day as two months", () => {
    const [pattern] = detectFinancialPatterns([
      tx({ id: "a", occurredOn: "2026-10-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      tx({ id: "b", occurredOn: "2026-10-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
    ]);
    expect(pattern.occurrenceCount).toBe(2);
    expect(pattern.behaviorType).toBe("unknown");
    expect(isActionablePattern(pattern)).toBe(false);
  });

  it("does not turn many Uber trips in the same months into a monthly bill", () => {
    const rows: PatternDetectionTransaction[] = [];
    let id = 1;
    for (const [month, count] of [["08", 4], ["09", 5], ["10", 6]] as const) {
      for (let day = 1; day <= count; day += 1) {
        rows.push(tx({
          id: `u${id}`,
          occurredOn: `2026-${month}-${String(day * 4).padStart(2, "0")}`,
          amountCents: 1800 + day * 100,
          note: "UBER TRIP",
          accountId: "nubank",
        }));
        id += 1;
      }
    }
    const patterns = detectFinancialPatterns(rows);
    expect(patterns.some((pattern) => (
      pattern.behaviorType === "fixed_recurring_expense" || pattern.behaviorType === "variable_recurring_expense"
    ))).toBe(false);
  });

  it("classifies category habits across accounts as one household habit", () => {
    const habit = detectFinancialPatterns([
      tx({ id: "s1", occurredOn: "2026-08-02", amountCents: 8200, note: "Supermercado Extra", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s2", occurredOn: "2026-08-12", amountCents: 5400, note: "Carrefour", categoryId: "alimentacao", accountId: "inter" }),
      tx({ id: "s3", occurredOn: "2026-08-18", amountCents: 6100, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s4", occurredOn: "2026-09-14", amountCents: 7900, note: "Supermercado Extra", categoryId: "alimentacao", accountId: "inter" }),
      tx({ id: "s5", occurredOn: "2026-09-16", amountCents: 4300, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s6", occurredOn: "2026-09-20", amountCents: 6700, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "inter" }),
      tx({ id: "s7", occurredOn: "2026-10-01", amountCents: 8800, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
      tx({ id: "s8", occurredOn: "2026-10-08", amountCents: 5100, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "inter" }),
    ]).find((pattern) => pattern.behaviorType === "habitual_category_spend");

    expect(habit?.categoryId).toBe("alimentacao");
    expect(habit?.accountId).toBeUndefined();
  });

  it("allows a stable salary to be actionable but keeps a monthly PIX from a person conservative", () => {
    const salary = detectFinancialPatterns([
      tx({ id: "i1", type: "income", occurredOn: "2026-08-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
      tx({ id: "i2", type: "income", occurredOn: "2026-09-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
      tx({ id: "i3", type: "income", occurredOn: "2026-10-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
    ]).find((pattern) => pattern.normalizedMerchant === "salario");
    const pix = detectFinancialPatterns([
      tx({ id: "p1", type: "income", occurredOn: "2026-08-10", amountCents: 80000, note: "PIX MARIA", accountId: "nubank" }),
      tx({ id: "p2", type: "income", occurredOn: "2026-09-10", amountCents: 80000, note: "PIX MARIA", accountId: "nubank" }),
      tx({ id: "p3", type: "income", occurredOn: "2026-10-10", amountCents: 80000, note: "PIX MARIA", accountId: "nubank" }),
    ])[0];

    expect(salary?.behaviorType).toBe("fixed_recurring_income");
    expect(isActionablePattern(salary!)).toBe(true);
    expect(pix.merchantConfidence).toBe("weak");
    expect(isActionablePattern(pix)).toBe(false);
  });

  it("classifies amount variance from min/max versus median, independent of order", () => {
    const forward = detectFinancialPatterns([
      tx({ id: "c1", occurredOn: "2026-08-10", amountCents: 10000, note: "CEMIG", accountId: "inter" }),
      tx({ id: "c2", occurredOn: "2026-09-10", amountCents: 10000, note: "CEMIG", accountId: "inter" }),
      tx({ id: "c3", occurredOn: "2026-10-10", amountCents: 13500, note: "CEMIG", accountId: "inter" }),
    ]).find((pattern) => pattern.normalizedMerchant === "cemig");
    const shuffled = detectFinancialPatterns([
      tx({ id: "c1", occurredOn: "2026-08-10", amountCents: 10000, note: "CEMIG", accountId: "inter" }),
      tx({ id: "c2", occurredOn: "2026-09-10", amountCents: 13500, note: "CEMIG", accountId: "inter" }),
      tx({ id: "c3", occurredOn: "2026-10-10", amountCents: 10000, note: "CEMIG", accountId: "inter" }),
    ]).find((pattern) => pattern.normalizedMerchant === "cemig");

    expect(forward?.behaviorType).toBe("variable_recurring_expense");
    expect(shuffled?.behaviorType).toBe(forward?.behaviorType);
    expect(shuffled?.estimatedAmountCents).toBe(forward?.estimatedAmountCents);
  });
});
