import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCommitment,
  listCommitments,
  updateCommitment,
} from "./financialPlanning";
import type { FinancialCommitment } from "./financialPlanning";
import {
  getOnboardingDebtValidationError,
  NO_DEBTS_OPTION,
  syncOnboardingDebtCommitments,
} from "./onboardingDebts";

vi.mock("./financialPlanning", () => ({
  createCommitment: vi.fn(),
  listCommitments: vi.fn(),
  updateCommitment: vi.fn(),
}));

const listCommitmentsMock = vi.mocked(listCommitments);
const createCommitmentMock = vi.mocked(createCommitment);
const updateCommitmentMock = vi.mocked(updateCommitment);

function commitment(overrides: Partial<FinancialCommitment> = {}): FinancialCommitment {
  return {
    id: "commitment-1",
    household_id: "household-1",
    created_by: "user-1",
    kind: "debt" as const,
    name: "Cartão de crédito",
    amount_cents: 45_000,
    due_day: 10,
    starts_on: "2026-08-01",
    ends_on: null,
    installments_total: null,
    active: true,
    archived_at: null,
    created_at: "2026-08-10T12:00:00.000Z",
    updated_at: "2026-08-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("onboarding debt validation", () => {
  it("accepts no debts without details", () => {
    expect(getOnboardingDebtValidationError([NO_DEBTS_OPTION], [])).toBeNull();
  });

  it("requires amount, due day and valid optional installments for every selected debt", () => {
    expect(getOnboardingDebtValidationError(["Cartão de crédito"], [])).toContain("detalhes");
    expect(getOnboardingDebtValidationError(["Cartão de crédito"], [{
      name: "Cartão de crédito",
      amountCents: 0,
      dueDay: 29,
      installmentsRemaining: 0,
    }])).toContain("valor mensal");
    expect(getOnboardingDebtValidationError(["Cartão de crédito"], [{
      name: "Cartão de crédito",
      amountCents: 45_000,
      dueDay: 10,
      installmentsRemaining: 601,
    }])).toContain("1 e 600");
  });
});

describe("onboarding debt synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCommitmentsMock.mockResolvedValue([]);
  });

  it("creates recurring debts and finite installments with the current month as their start", async () => {
    createCommitmentMock
      .mockResolvedValueOnce(commitment())
      .mockResolvedValueOnce(commitment({
        id: "commitment-2",
        name: "Empréstimo pessoal",
        kind: "installment",
        installments_total: 12,
      }));

    await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito", "Empréstimo pessoal"],
      debtDetails: [
        { name: "Cartão de crédito", amountCents: 45_000, dueDay: 10, installmentsRemaining: null },
        { name: "Empréstimo pessoal", amountCents: 30_000, dueDay: 20, installmentsRemaining: 12 },
      ],
      now: new Date(2026, 7, 10, 12),
    });

    expect(createCommitmentMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: "debt",
      startsOn: "2026-08-01",
      installmentsTotal: null,
    }));
    expect(createCommitmentMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: "installment",
      startsOn: "2026-08-01",
      installmentsTotal: 12,
    }));
  });

  it("does not create or update again when a retry finds the same commitment", async () => {
    listCommitmentsMock.mockResolvedValue([commitment()]);

    const result = await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [
        { name: "Cartão de crédito", amountCents: 45_000, dueDay: 10, installmentsRemaining: null },
      ],
    });

    expect(result).toHaveLength(1);
    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(updateCommitmentMock).not.toHaveBeenCalled();
  });

  it("updates the matching user commitment when entered details change", async () => {
    listCommitmentsMock.mockResolvedValue([commitment()]);
    updateCommitmentMock.mockResolvedValue(commitment({
      kind: "installment",
      amount_cents: 50_000,
      due_day: 12,
      installments_total: 8,
    }));

    await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [
        { name: "Cartão de crédito", amountCents: 50_000, dueDay: 12, installmentsRemaining: 8 },
      ],
    });

    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(updateCommitmentMock).toHaveBeenCalledWith(expect.objectContaining({
      commitmentId: "commitment-1",
      kind: "installment",
      amountCents: 50_000,
      dueDay: 12,
      startsOn: "2026-08-01",
      installmentsTotal: 8,
    }));
  });
});
