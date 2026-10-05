import { describe, expect, it, vi } from "vitest";
import {
  detectFinancialPatterns,
  isActionablePattern,
  type PatternDetectionTransaction,
} from "./financialPatternDetection";
import {
  buildFinancialPatternSuggestions,
  financialPatternDecisionKey,
  findSimilarCommitments,
  PATTERN_DECISION_KEY_VERSION,
  requirePatternReferenceDate,
  similarAmountToleranceFor,
  similarMatchFor,
} from "./financialPatternSuggestions";

vi.mock("./supabase", () => ({
  supabase: { from: () => ({}), rpc: () => ({}) },
}));

function tx(
  partial: Partial<PatternDetectionTransaction> & Pick<PatternDetectionTransaction, "id" | "occurredOn" | "amountCents">,
): PatternDetectionTransaction {
  return { type: "expense", ...partial };
}

const REFERENCE_DATE = "2026-10-05";

function netflixRows(amountCents = 4490): PatternDetectionTransaction[] {
  return [
    tx({ id: "n1", occurredOn: "2026-08-05", amountCents, originalNote: "PG *NETFLIX", accountId: "nubank" }),
    tx({ id: "n2", occurredOn: "2026-09-05", amountCents, originalNote: "NETFLIX.COM", accountId: "nubank" }),
    tx({ id: "n3", occurredOn: "2026-10-05", amountCents, originalNote: "NETFLIX SERVICOS", accountId: "nubank" }),
  ];
}

function cemigRows(): PatternDetectionTransaction[] {
  return [
    tx({ id: "c1", occurredOn: "2026-08-10", amountCents: 19800, note: "CEMIG", accountId: "inter" }),
    tx({ id: "c2", occurredOn: "2026-09-11", amountCents: 22400, note: "CEMIG ENERGIA", accountId: "inter" }),
    tx({ id: "c3", occurredOn: "2026-10-09", amountCents: 21100, note: "CEMIG", accountId: "inter" }),
  ];
}

describe("financialPatternDecisionKey", () => {
  it("stays the same when amount, confidence, occurrence count and lastSeen change", () => {
    const original = detectFinancialPatterns(netflixRows(4490), { referenceDate: REFERENCE_DATE })
      .find((pattern) => pattern.normalizedMerchant === "netflix")!;
    const changed = detectFinancialPatterns([
      ...netflixRows(4590),
      tx({ id: "n4", occurredOn: "2026-07-05", amountCents: 4590, note: "NETFLIX", accountId: "nubank" }),
    ], { referenceDate: REFERENCE_DATE }).find((pattern) => pattern.normalizedMerchant === "netflix")!;

    expect(financialPatternDecisionKey(original)).toBe(`merchant:${PATTERN_DECISION_KEY_VERSION}:expense:nubank:netflix`);
    expect(financialPatternDecisionKey(changed)).toBe(financialPatternDecisionKey(original));
    expect(financialPatternDecisionKey(original)).not.toBe(original.key);
    expect(changed.estimatedAmountCents).not.toBe(original.estimatedAmountCents);
    expect(changed.occurrenceCount).toBeGreaterThan(original.occurrenceCount);
    expect(changed.transactionIds).not.toEqual(original.transactionIds);
  });

  it("keeps the same merchant in another account as a different decision key", () => {
    const nubank = financialPatternDecisionKey({ direction: "expense", normalizedMerchant: "netflix", accountId: "nubank" });
    const inter = financialPatternDecisionKey({ direction: "expense", normalizedMerchant: "netflix", accountId: "inter" });
    expect(nubank).toBe("merchant:v1:expense:nubank:netflix");
    expect(inter).toBe("merchant:v1:expense:inter:netflix");
    expect(nubank).not.toBe(inter);
  });
});

describe("buildFinancialPatternSuggestions", () => {
  it("requires an explicit reference date", () => {
    expect(() => buildFinancialPatternSuggestions({ transactions: netflixRows(), referenceDate: "" }))
      .toThrow("A data de referência do planejamento é obrigatória.");
    expect(requirePatternReferenceDate(REFERENCE_DATE)).toBe(REFERENCE_DATE);
  });

  it("shows Netflix as a fixed recurring suggestion", () => {
    const [suggestion] = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
    });
    expect(suggestion.title).toBe("Netflix");
    expect(suggestion.pattern.behaviorType).toBe("fixed_recurring_expense");
    expect(suggestion.estimatedAmount).toBe(false);
    expect(suggestion.amountLabel).toMatch(/R\$\s*44,90 \/ mês/);
    expect(suggestion.dayLabel).toBe("Por volta do dia 5");
    expect(suggestion.historyLabel).toBe("Detectado em 3 meses");
    expect(suggestion.similarMatch).toBe("none");
  });

  it("shows Cemig as a variable estimate", () => {
    const [suggestion] = buildFinancialPatternSuggestions({
      transactions: cemigRows(),
      referenceDate: REFERENCE_DATE,
    });
    expect(suggestion.title).toBe("Cemig");
    expect(suggestion.pattern.behaviorType).toBe("variable_recurring_expense");
    expect(suggestion.estimatedAmount).toBe(true);
    expect(suggestion.amountLabel).toMatch(/^aprox\. /);
    expect(suggestion.historyLabel).toBe("Valor estimado pelo seu histórico");
    expect(suggestion.pattern.estimatedAmountCents).toBe(21100);
  });

  it("hides a weak merchant such as PIX to a person", () => {
    const suggestions = buildFinancialPatternSuggestions({
      transactions: [
        tx({ id: "p1", occurredOn: "2026-08-05", amountCents: 15000, note: "PIX JOÃO", accountId: "nubank" }),
        tx({ id: "p2", occurredOn: "2026-09-05", amountCents: 15000, note: "PIX JOÃO", accountId: "nubank" }),
        tx({ id: "p3", occurredOn: "2026-10-05", amountCents: 15000, note: "PIX JOÃO", accountId: "nubank" }),
      ],
      referenceDate: REFERENCE_DATE,
    });
    expect(suggestions).toEqual([]);
  });

  it("hides a stale pattern when the explicit reference date is months later", () => {
    const suggestions = buildFinancialPatternSuggestions({
      transactions: [
        tx({ id: "n1", occurredOn: "2026-01-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
        tx({ id: "n2", occurredOn: "2026-02-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
        tx({ id: "n3", occurredOn: "2026-03-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      ],
      referenceDate: "2026-06-15",
    });
    expect(suggestions).toEqual([]);
  });

  it("hides patterns below the actionable confidence", () => {
    const pattern = detectFinancialPatterns(netflixRows(), { referenceDate: REFERENCE_DATE })
      .find((item) => item.normalizedMerchant === "netflix")!;
    expect(isActionablePattern({ ...pattern, confidence: 69 })).toBe(false);
    const suggestions = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
    }).filter((item) => item.pattern.confidence < 70);
    expect(suggestions).toEqual([]);
  });

  it("does not show a rejected pattern", () => {
    const [detected] = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
    });
    const suggestions = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
      decisions: [{ pattern_key: detected.decisionKey, decision: "rejected", linked_commitment_id: null }],
    });
    expect(suggestions).toEqual([]);
  });

  it("does not show a confirmed pattern", () => {
    const [detected] = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
    });
    const suggestions = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
      decisions: [{
        pattern_key: detected.decisionKey,
        decision: "confirmed",
        linked_commitment_id: "commitment-1",
      }],
      commitments: [{ id: "commitment-1", name: "Netflix", amount_cents: 4490, due_day: 5, active: true }],
    });
    expect(suggestions).toEqual([]);
  });

  it("does not show salary, habits or eventual spend in this phase", () => {
    const suggestions = buildFinancialPatternSuggestions({
      transactions: [
        tx({ id: "i1", type: "income", occurredOn: "2026-08-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
        tx({ id: "i2", type: "income", occurredOn: "2026-09-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
        tx({ id: "i3", type: "income", occurredOn: "2026-10-01", amountCents: 350000, note: "PAGAMENTO SALARIO", accountId: "nubank" }),
        tx({ id: "one", occurredOn: "2026-10-02", amountCents: 12900, note: "Magazine Luiza", accountId: "nubank" }),
        tx({ id: "s1", occurredOn: "2026-08-02", amountCents: 8200, note: "Supermercado Extra", categoryId: "alimentacao", accountId: "nubank" }),
        tx({ id: "s2", occurredOn: "2026-08-12", amountCents: 5400, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
        tx({ id: "s3", occurredOn: "2026-08-18", amountCents: 6100, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "nubank" }),
        tx({ id: "s4", occurredOn: "2026-09-14", amountCents: 7900, note: "Supermercado Extra", categoryId: "alimentacao", accountId: "nubank" }),
        tx({ id: "s5", occurredOn: "2026-09-16", amountCents: 4300, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
        tx({ id: "s6", occurredOn: "2026-09-20", amountCents: 6700, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "nubank" }),
        tx({ id: "s7", occurredOn: "2026-10-01", amountCents: 8800, note: "Carrefour", categoryId: "alimentacao", accountId: "nubank" }),
        tx({ id: "s8", occurredOn: "2026-10-08", amountCents: 5100, note: "Assai Atacadista", categoryId: "alimentacao", accountId: "nubank" }),
      ],
      referenceDate: REFERENCE_DATE,
    });
    expect(suggestions).toEqual([]);
  });

  it("keeps Netflix on another account as a separate suggestion", () => {
    const suggestions = buildFinancialPatternSuggestions({
      transactions: [
        ...netflixRows(),
        tx({ id: "b1", occurredOn: "2026-08-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
        tx({ id: "b2", occurredOn: "2026-09-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
        tx({ id: "b3", occurredOn: "2026-10-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
      ],
      referenceDate: REFERENCE_DATE,
    });
    expect(suggestions).toHaveLength(2);
    expect(new Set(suggestions.map((item) => item.pattern.accountId))).toEqual(new Set(["nubank", "inter"]));
    expect(suggestions[0].decisionKey).not.toBe(suggestions[1].decisionKey);
  });

  it("offers the existing Netflix commitment when the same bill later appears on another account", () => {
    const suggestions = buildFinancialPatternSuggestions({
      transactions: [
        tx({ id: "b1", occurredOn: "2026-08-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
        tx({ id: "b2", occurredOn: "2026-09-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
        tx({ id: "b3", occurredOn: "2026-10-06", amountCents: 4490, note: "NETFLIX", accountId: "inter" }),
      ],
      referenceDate: REFERENCE_DATE,
      commitments: [{ id: "netflix-nubank", name: "Netflix", amount_cents: 4490, due_day: 5, active: true }],
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].pattern.accountId).toBe("inter");
    expect(suggestions[0].similarMatch).toBe("single");
    expect(suggestions[0].similarCommitments.map((item) => item.id)).toEqual(["netflix-nubank"]);
  });

  it("hides the section when there is no history or fewer than three occurrences", () => {
    expect(buildFinancialPatternSuggestions({ transactions: [], referenceDate: REFERENCE_DATE })).toEqual([]);
    expect(buildFinancialPatternSuggestions({
      transactions: [
        tx({ id: "a", occurredOn: "2026-09-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
        tx({ id: "b", occurredOn: "2026-10-05", amountCents: 4490, note: "NETFLIX", accountId: "nubank" }),
      ],
      referenceDate: REFERENCE_DATE,
    })).toEqual([]);
  });

  it("lets a confirmed pattern reappear after the linked commitment is archived", () => {
    const [detected] = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
    });
    const suggestions = buildFinancialPatternSuggestions({
      transactions: netflixRows(),
      referenceDate: REFERENCE_DATE,
      decisions: [{
        pattern_key: detected.decisionKey,
        decision: "confirmed",
        linked_commitment_id: "archived-netflix",
      }],
      commitments: [{ id: "archived-netflix", name: "Netflix", amount_cents: 4490, due_day: 5, active: false }],
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].similarMatch).toBe("none");
  });
});

describe("findSimilarCommitments", () => {
  const netflixPattern = detectFinancialPatterns(netflixRows(), { referenceDate: REFERENCE_DATE })
    .find((pattern) => pattern.normalizedMerchant === "netflix")!;
  const cemigPattern = detectFinancialPatterns(cemigRows(), { referenceDate: REFERENCE_DATE })
    .find((pattern) => pattern.normalizedMerchant === "cemig")!;

  it("finds one similar active commitment", () => {
    const matches = findSimilarCommitments(netflixPattern, [
      { id: "netflix-bill", name: "Netflix", amount_cents: 4490, due_day: 5, active: true },
    ]);
    expect(matches.map((item) => item.id)).toEqual(["netflix-bill"]);
    expect(similarMatchFor(matches)).toBe("single");
  });

  it("does not confuse a different bill", () => {
    const matches = findSimilarCommitments(netflixPattern, [
      { id: "spotify", name: "Spotify", amount_cents: 4490, due_day: 5, active: true },
      { id: "netflix-far", name: "Netflix", amount_cents: 4490, due_day: 20, active: true },
      { id: "netflix-amount", name: "Netflix", amount_cents: 9000, due_day: 5, active: true },
    ]);
    expect(matches).toEqual([]);
    expect(similarMatchFor(matches)).toBe("none");
  });

  it("does not auto-pick when more than one commitment is similar", () => {
    const matches = findSimilarCommitments(netflixPattern, [
      { id: "a", name: "Netflix", amount_cents: 4490, due_day: 5, active: true },
      { id: "b", name: "NETFLIX.COM", amount_cents: 4400, due_day: 6, active: true },
    ]);
    expect(matches).toHaveLength(2);
    expect(similarMatchFor(matches)).toBe("multiple");
  });

  it("keeps fixed bills conservative at about 5% while variable bills tolerate detector variance", () => {
    expect(similarAmountToleranceFor("fixed_recurring_expense")).toBe(0.05);
    expect(similarAmountToleranceFor("variable_recurring_expense")).toBe(0.35);
    expect(findSimilarCommitments(netflixPattern, [
      { id: "netflix-moved", name: "Netflix", amount_cents: 18000, due_day: 5, active: true },
    ])).toEqual([]);
    expect(findSimilarCommitments(cemigPattern, [
      { id: "cemig-bill", name: "Cemig", amount_cents: 18000, due_day: 10, active: true },
    ]).map((item) => item.id)).toEqual(["cemig-bill"]);
  });

  it("does not match a generic bill name such as Conta de luz to Cemig", () => {
    expect(findSimilarCommitments(cemigPattern, [
      { id: "light", name: "Conta de luz", amount_cents: 21100, due_day: 10, active: true },
    ])).toEqual([]);
  });
});
