export type SummaryCommitmentKind = "fixed_bill" | "debt" | "installment";

export type SummaryCycle = {
  key: string;
  start: string;
  end: string;
  label: string;
};

export type SummaryCommitment = {
  kind: SummaryCommitmentKind;
  amount_cents: number;
  due_day: number;
  starts_on: string;
  ends_on: string | null;
  installments_total: number | null;
  active: boolean;
  archived_at: string | null;
};

export type SummaryPaidCommitment = {
  kind: SummaryCommitmentKind;
  amount_cents: number;
  paid_cents: number;
  pending_cents: number;
};

export type IncomeBreakdown = {
  fixedCents: number;
  variableCents: number;
  totalCents: number;
};

export type CommittedMoneyBreakdown = {
  fixedBillsCents: number;
  debtsAndInstallmentsCents: number;
  reserveCents: number;
  commitmentsTotalCents: number;
  destinedTotalCents: number;
  paidCommitmentsCents: number;
  pendingCommitmentsCents: number;
};

export type ObligationSurplus = {
  plannedFreeCents: number;
  dreamsAllocatedCents: number;
  dayToDayCents: number;
};

export type FutureMonthCard = {
  cycle: SummaryCycle;
  expectedIncomeCents: number;
  destinedTotalCents: number;
  plannedFreeCents: number;
  offset: number;
};

export type SummarySetupGaps = {
  missingIncome: boolean;
  missingFixedBills: boolean;
  missingReserve: boolean;
  missingPaydayConfig: boolean;
  missingDreams: boolean;
};

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function parseYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toYmd(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Same due-date mapping used by getFinancialOverview. */
export function dueOnForCycle(dueDay: number, cycle: Pick<SummaryCycle, "start" | "end">) {
  const start = parseYmd(cycle.start);
  const safeDueDay = Math.min(28, Math.max(1, Math.trunc(dueDay) || 1));
  let due = new Date(start.getFullYear(), start.getMonth(), safeDueDay);
  if (toYmd(due) < cycle.start) {
    due = new Date(start.getFullYear(), start.getMonth() + 1, safeDueDay);
  }
  return toYmd(due);
}

export function commitmentAppliesToCycle(
  commitment: SummaryCommitment,
  cycle: Pick<SummaryCycle, "start" | "end">
) {
  const dueOn = dueOnForCycle(commitment.due_day, cycle);
  if (dueOn < commitment.starts_on || dueOn >= cycle.end) return null;
  if (commitment.ends_on && dueOn > commitment.ends_on) return null;
  if (!commitment.active && (!commitment.archived_at || commitment.archived_at.slice(0, 10) <= dueOn)) {
    return null;
  }

  const startsOn = parseYmd(commitment.starts_on);
  const dueDate = parseYmd(dueOn);
  const installmentNumber = commitment.kind === "installment"
    ? (dueDate.getFullYear() - startsOn.getFullYear()) * 12
      + dueDate.getMonth()
      - startsOn.getMonth()
      + 1
    : null;
  if (
    installmentNumber !== null
    && commitment.installments_total !== null
    && installmentNumber > commitment.installments_total
  ) {
    return null;
  }

  return {
    due_on: dueOn,
    installment_number: installmentNumber,
    amount_cents: Math.max(0, integerCents(commitment.amount_cents)),
    kind: commitment.kind,
  };
}

export function buildIncomeBreakdown(input: {
  incomeFixedCents?: number | null;
  incomeVariableAvgCents?: number | null;
  incomeCents?: number | null;
}): IncomeBreakdown {
  const fixed = Math.max(0, integerCents(input.incomeFixedCents));
  const variable = Math.max(0, integerCents(input.incomeVariableAvgCents));
  const legacy = Math.max(0, integerCents(input.incomeCents));
  if (fixed + variable > 0) {
    return { fixedCents: fixed, variableCents: variable, totalCents: fixed + variable };
  }
  return { fixedCents: legacy, variableCents: 0, totalCents: legacy };
}

export function groupCommittedMoney(input: {
  commitments: SummaryPaidCommitment[];
  reserveCents: number;
}): CommittedMoneyBreakdown {
  let fixedBillsCents = 0;
  let debtsAndInstallmentsCents = 0;
  let paidCommitmentsCents = 0;
  let pendingCommitmentsCents = 0;

  for (const commitment of input.commitments) {
    const amount = Math.max(0, integerCents(commitment.amount_cents));
    if (commitment.kind === "fixed_bill") fixedBillsCents += amount;
    else debtsAndInstallmentsCents += amount;
    paidCommitmentsCents += Math.max(0, integerCents(commitment.paid_cents));
    pendingCommitmentsCents += Math.max(0, integerCents(commitment.pending_cents));
  }

  const reserveCents = Math.max(0, integerCents(input.reserveCents));
  const commitmentsTotalCents = fixedBillsCents + debtsAndInstallmentsCents;

  return {
    fixedBillsCents,
    debtsAndInstallmentsCents,
    reserveCents,
    commitmentsTotalCents,
    destinedTotalCents: commitmentsTotalCents + reserveCents,
    paidCommitmentsCents,
    pendingCommitmentsCents,
  };
}

/**
 * Planned free cash after obligations, then split into dreams vs day-to-day.
 * Matches conservative-v1 projectedAvailableCents when realized amounts are ignored:
 * dayToDay === max(0, expected - commitments - reserve - allocated)
 */
export function buildObligationSurplus(input: {
  expectedIncomeCents: number;
  commitmentsTotalCents: number;
  reserveCents: number;
  dreamsAllocatedCents: number;
}): ObligationSurplus {
  const expectedIncomeCents = Math.max(0, integerCents(input.expectedIncomeCents));
  const commitmentsTotalCents = Math.max(0, integerCents(input.commitmentsTotalCents));
  const reserveCents = Math.max(0, integerCents(input.reserveCents));
  const dreamsAllocatedCents = Math.max(0, integerCents(input.dreamsAllocatedCents));
  const plannedFreeCents = Math.max(0, expectedIncomeCents - commitmentsTotalCents - reserveCents);

  return {
    plannedFreeCents,
    dreamsAllocatedCents,
    dayToDayCents: Math.max(0, plannedFreeCents - dreamsAllocatedCents),
  };
}

export function buildFutureMonthCards(input: {
  cycles: (SummaryCycle & { offset: number })[];
  commitments: SummaryCommitment[];
  expectedIncomeCents: number;
  reserveCents: number;
}): FutureMonthCard[] {
  const expectedIncomeCents = Math.max(0, integerCents(input.expectedIncomeCents));
  const reserveCents = Math.max(0, integerCents(input.reserveCents));

  return input.cycles.map((cycle) => {
    const due = input.commitments
      .map((commitment) => commitmentAppliesToCycle(commitment, cycle))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const commitmentsTotalCents = due.reduce((sum, item) => sum + item.amount_cents, 0);
    const destinedTotalCents = commitmentsTotalCents + reserveCents;
    const surplus = buildObligationSurplus({
      expectedIncomeCents,
      commitmentsTotalCents,
      reserveCents,
      dreamsAllocatedCents: 0,
    });

    return {
      cycle,
      expectedIncomeCents,
      destinedTotalCents,
      plannedFreeCents: surplus.plannedFreeCents,
      offset: cycle.offset,
    };
  });
}

export function detectSummarySetupGaps(input: {
  income: IncomeBreakdown;
  committed: CommittedMoneyBreakdown;
  settingsUpdatedBy: string | null;
  cycleMode: "calendar" | "payday";
  hasGoals: boolean;
}): SummarySetupGaps {
  return {
    missingIncome: input.income.totalCents <= 0,
    missingFixedBills: input.committed.fixedBillsCents <= 0,
    missingReserve: input.committed.reserveCents <= 0,
    missingPaydayConfig: input.settingsUpdatedBy === null,
    missingDreams: !input.hasGoals,
  };
}

export function shortCycleMonthLabel(cycleStart: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cycleStart);
  if (!match) return cycleStart;
  const months = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  return months[Number(match[2]) - 1] ?? cycleStart;
}
