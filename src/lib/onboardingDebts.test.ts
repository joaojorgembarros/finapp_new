import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveCommitment,
  createCommitment,
  listCommitments,
  updateCommitment,
} from "./financialPlanning";
import type { FinancialCommitment } from "./financialPlanning";
import {
  getOnboardingDebtValidationError,
  NO_DEBTS_OPTION,
  onboardingDebtsPendingCommitment,
  onboardingDebtTypeFromCommitmentName,
  ownedOnboardingDetailForCommitment,
  parseOnboardingDebtDetails,
  syncOnboardingDebtCommitments,
  upsertOnboardingDebtDetail,
} from "./onboardingDebts";

vi.mock("./financialPlanning", () => ({
  archiveCommitment: vi.fn(),
  createCommitment: vi.fn(),
  listCommitments: vi.fn(),
  updateCommitment: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: { user_metadata: {} } }, error: null })),
    },
  },
}));

const listCommitmentsMock = vi.mocked(listCommitments);
const createCommitmentMock = vi.mocked(createCommitment);
const updateCommitmentMock = vi.mocked(updateCommitment);
const archiveCommitmentMock = vi.mocked(archiveCommitment);

function commitment(overrides: Partial<FinancialCommitment> = {}): FinancialCommitment {
  return {
    id: "commitment-1",
    household_id: "household-1",
    created_by: "user-1",
    kind: "debt" as const,
    name: "Cartão de crédito",
    amount_cents: 50_000,
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

function baseDetail() {
  return {
    name: "Cartão de crédito",
    balanceCents: 450_000,
    amountCents: 50_000,
    dueDay: 10,
    installmentsRemaining: null as number | null,
    note: null as string | null,
    commitmentId: null as string | null,
  };
}

function detail(overrides: Partial<ReturnType<typeof baseDetail>> = {}) {
  return { ...baseDetail(), ...overrides };
}

describe("onboarding debt identity", () => {
  it("treats a note suffix as the same debt type for display only", () => {
    expect(onboardingDebtTypeFromCommitmentName("Cartão de crédito")).toBe("Cartão de crédito");
    expect(onboardingDebtTypeFromCommitmentName("Cartão de crédito (Nubank)")).toBe("Cartão de crédito");
  });
});

describe("onboarding debt validation", () => {
  it("accepts no debts without details", () => {
    expect(getOnboardingDebtValidationError([NO_DEBTS_OPTION], [])).toBeNull();
  });

  it("requires a balance for every selected debt", () => {
    expect(getOnboardingDebtValidationError(["Cartão de crédito"], [])).toContain("detalhes");
    expect(getOnboardingDebtValidationError(["Cartão de crédito"], [detail({
      balanceCents: 0,
      amountCents: 0,
    })])).toContain("saldo");
  });

  it("accepts a balance without a monthly installment", () => {
    expect(getOnboardingDebtValidationError(["Cartão de crédito"], [detail({
      amountCents: 0,
      dueDay: Number.NaN,
    })])).toBeNull();
  });

  it("reads stored details without treating note as identity", () => {
    const parsed = parseOnboardingDebtDetails([{
      name: "Cartão de crédito",
      balanceCents: 450_000,
      amountCents: 60_000,
      note: "Nubank",
      commitmentId: "commitment-1",
    }]);
    expect(parsed[0]?.name).toBe("Cartão de crédito");
    expect(parsed[0]?.note).toBe("Nubank");
    expect(parsed[0]?.commitmentId).toBe("commitment-1");
  });
});

describe("onboarding debt metadata helpers", () => {
  it("keeps one record per type when upserting details", () => {
    const next = upsertOnboardingDebtDetail(
      [detail({ note: "Nubank", commitmentId: "commitment-1" })],
      detail({ note: "Itaú", balanceCents: 300_000, commitmentId: "commitment-1" })
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.note).toBe("Itaú");
    expect(next[0]?.balanceCents).toBe(300_000);
    expect(next[0]?.commitmentId).toBe("commitment-1");
  });

  it("identifies an owned onboarding commitment by stored id, not by name", () => {
    const details = [detail({ commitmentId: "owned-1" })];
    expect(ownedOnboardingDetailForCommitment(details, "owned-1")?.name).toBe("Cartão de crédito");
    expect(ownedOnboardingDetailForCommitment(details, "manual-1")).toBeNull();
  });

  it("keeps a balance-only debt visible for later editing", () => {
    const pending = onboardingDebtsPendingCommitment(
      [detail({ amountCents: 0, commitmentId: null, balanceCents: 300_000 })],
      []
    );
    expect(pending).toHaveLength(1);
    expect(onboardingDebtsPendingCommitment(
      [detail({ commitmentId: "commitment-1", balanceCents: 300_000 })],
      ["commitment-1"]
    )).toEqual([]);
  });
});

describe("onboarding debt synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCommitmentsMock.mockResolvedValue([]);
    archiveCommitmentMock.mockResolvedValue();
  });

  it("does not create a commitment when only the balance is filled", async () => {
    const result = await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail({ amountCents: 0 })],
      previousDebtDetails: [],
    });

    expect(result.commitments).toEqual([]);
    expect(result.debtDetails[0]?.commitmentId).toBeNull();
    expect(createCommitmentMock).not.toHaveBeenCalled();
  });

  it("creates recurring debts using the type name, never the observation", async () => {
    createCommitmentMock.mockResolvedValueOnce(commitment());

    const result = await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail({ note: "Nubank" })],
      previousDebtDetails: [],
      now: new Date(2026, 7, 10, 12),
    });

    expect(createCommitmentMock).toHaveBeenCalledWith(expect.objectContaining({
      name: "Cartão de crédito",
      amountCents: 50_000,
    }));
    expect(result.debtDetails[0]?.commitmentId).toBe("commitment-1");
    expect(result.debtDetails[0]?.note).toBe("Nubank");
  });

  it("does not update or archive a manual commitment that only shares the type name", async () => {
    listCommitmentsMock.mockResolvedValue([commitment({
      id: "manual-1",
      amount_cents: 12_000,
    })]);
    createCommitmentMock.mockResolvedValueOnce(commitment({ id: "onboarding-1" }));

    await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail()],
      previousDebtDetails: [],
    });

    expect(createCommitmentMock).toHaveBeenCalledTimes(1);
    expect(updateCommitmentMock).not.toHaveBeenCalled();
    expect(archiveCommitmentMock).not.toHaveBeenCalled();
  });

  it("does not duplicate a commitment when only the observation changes", async () => {
    listCommitmentsMock.mockResolvedValue([commitment()]);

    const result = await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail({ note: "Itaú", commitmentId: "commitment-1" })],
      previousDebtDetails: [detail({ commitmentId: "commitment-1" })],
    });

    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(updateCommitmentMock).not.toHaveBeenCalled();
    expect(result.commitments).toHaveLength(1);
    expect(result.debtDetails[0]?.note).toBe("Itaú");
    expect(result.debtDetails[0]?.commitmentId).toBe("commitment-1");
  });

  it("updates the owned installment amount instead of creating another commitment", async () => {
    listCommitmentsMock.mockResolvedValue([commitment({ amount_cents: 50_000 })]);
    updateCommitmentMock.mockResolvedValue(commitment({ amount_cents: 70_000 }));

    await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail({ amountCents: 70_000, commitmentId: "commitment-1" })],
      previousDebtDetails: [detail({ commitmentId: "commitment-1" })],
    });

    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(updateCommitmentMock).toHaveBeenCalledWith(expect.objectContaining({
      commitmentId: "commitment-1",
      amountCents: 70_000,
    }));
    expect(archiveCommitmentMock).not.toHaveBeenCalled();
  });

  it("does not create or update again when a retry finds the owned commitment", async () => {
    listCommitmentsMock.mockResolvedValue([commitment()]);

    const result = await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail({ commitmentId: "commitment-1" })],
      previousDebtDetails: [detail({ commitmentId: "commitment-1" })],
    });

    expect(result.commitments).toHaveLength(1);
    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(updateCommitmentMock).not.toHaveBeenCalled();
  });

  it("archives only the owned onboarding commitment when the installment is cleared", async () => {
    listCommitmentsMock.mockResolvedValue([
      commitment(),
      commitment({ id: "manual-1", amount_cents: 12_000 }),
    ]);

    const result = await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail({ amountCents: 0, commitmentId: "commitment-1" })],
      previousDebtDetails: [detail({ commitmentId: "commitment-1" })],
    });

    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(archiveCommitmentMock).toHaveBeenCalledTimes(1);
    expect(archiveCommitmentMock).toHaveBeenCalledWith("household-1", "commitment-1");
    expect(result.debtDetails[0]?.commitmentId).toBeNull();
  });

  it("archives only the owned onboarding commitment when the debt type is removed", async () => {
    listCommitmentsMock.mockResolvedValue([
      commitment(),
      commitment({ id: "manual-1", amount_cents: 12_000 }),
    ]);

    await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: [NO_DEBTS_OPTION],
      debtDetails: [],
      previousDebtDetails: [detail({ commitmentId: "commitment-1" })],
    });

    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(archiveCommitmentMock).toHaveBeenCalledTimes(1);
    expect(archiveCommitmentMock).toHaveBeenCalledWith("household-1", "commitment-1");
  });

  it("does not archive a matching name when no owned commitment id exists", async () => {
    listCommitmentsMock.mockResolvedValue([commitment()]);

    await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: [NO_DEBTS_OPTION],
      debtDetails: [],
      previousDebtDetails: [],
    });

    expect(archiveCommitmentMock).not.toHaveBeenCalled();
  });

  it("updates metadata balance without creating a new commitment", async () => {
    listCommitmentsMock.mockResolvedValue([commitment()]);

    const result = await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: ["Cartão de crédito"],
      debtDetails: [detail({
        balanceCents: 999_000,
        commitmentId: "commitment-1",
      })],
      previousDebtDetails: [detail({ commitmentId: "commitment-1" })],
    });

    expect(createCommitmentMock).not.toHaveBeenCalled();
    expect(updateCommitmentMock).not.toHaveBeenCalled();
    expect(result.debtDetails[0]?.balanceCents).toBe(999_000);
    expect(result.debtDetails[0]?.commitmentId).toBe("commitment-1");
  });

  it("does not archive a manually created bill with another name", async () => {
    listCommitmentsMock.mockResolvedValue([commitment({
      id: "rent",
      kind: "fixed_bill",
      name: "Aluguel",
    })]);

    await syncOnboardingDebtCommitments({
      householdId: "household-1",
      userId: "user-1",
      selectedDebts: [NO_DEBTS_OPTION],
      debtDetails: [],
      previousDebtDetails: [],
    });

    expect(archiveCommitmentMock).not.toHaveBeenCalled();
  });
});
