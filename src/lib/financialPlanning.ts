import { supabase } from "./supabase";

const sb: any = supabase;

export type CycleMode = "calendar" | "payday";
export type CommitmentKind = "fixed_bill" | "debt" | "installment";
export type BalanceConfidence = "confirmed" | "derived" | "unavailable";
export type OverviewConfidence = "reliable" | "partial" | "unavailable";

export type FinancialSettings = {
  household_id: string;
  cycle_mode: CycleMode;
  payday_day: number;
  reserve_cents: number;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const DEFAULT_FINANCIAL_SETTINGS = {
  cycle_mode: "calendar" as CycleMode,
  payday_day: 5,
  reserve_cents: 0,
};

export type FinancialCycle = {
  key: string;
  start: string;
  end: string;
  label: string;
};

export type FinancialCommitment = {
  id: string;
  household_id: string;
  kind: CommitmentKind;
  name: string;
  amount_cents: number;
  due_day: number;
  starts_on: string;
  ends_on: string | null;
  installments_total: number | null;
  active: boolean;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type FinancialCommitmentPayment = {
  id: string;
  household_id: string;
  commitment_id: string;
  cycle_key: string;
  paid_cents: number;
  paid_on: string;
  transaction_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type FinancialOverviewTransaction = {
  id: string;
  type: "income" | "expense";
  amount_cents: number;
  note: string | null;
  category_id: string | null;
  account_id: string | null;
  statement_import_id: string | null;
  occurred_on: string;
  created_at: string;
  category?: { name: string } | null;
};

export type FinancialOverviewCommitment = FinancialCommitment & {
  due_on: string;
  installment_number: number | null;
  payment_id: string | null;
  paid_cents: number;
  pending_cents: number;
  paid_on: string | null;
};

export type FinancialOverviewGoal = {
  id: string;
  title: string;
  target_cents: number;
  priority: number;
  contributed_cents: number;
  cycle_contributed_cents: number;
};

export type BalanceSnapshot = {
  import_id: string;
  bank_id: string;
  balance_cents: number;
  period_end: string;
  created_at: string;
  confidence: Exclude<BalanceConfidence, "unavailable">;
};

export type FinancialSummaryInput = {
  expectedIncomeCents: number;
  realizedIncomeCents: number;
  realizedExpenseCents: number;
  pendingCommitmentsCents: number;
  reserveCents: number;
  allocatedCents: number;
  trustedBalanceCents?: number | null;
};

export type FinancialSummary = {
  expectedIncomeCents: number;
  realizedIncomeCents: number;
  realizedExpenseCents: number;
  resultCents: number;
  pendingCommitmentsCents: number;
  reserveCents: number;
  allocatedCents: number;
  availableCents: number;
  positiveResultCents: number;
  balanceCapCents: number | null;
  balanceCapApplied: boolean;
};

export type FinancialOverview = FinancialSummary & {
  cycle: FinancialCycle;
  settings: FinancialSettings;
  transactions: FinancialOverviewTransaction[];
  commitments: FinancialOverviewCommitment[];
  goals: FinancialOverviewGoal[];
  balance: {
    total_cents: number | null;
    status: OverviewConfidence;
    as_of: string | null;
    snapshots: BalanceSnapshot[];
  };
  confidence: {
    status: Exclude<OverviewConfidence, "unavailable">;
    formula: "conservative-v1";
    expected_income_is_projection: true;
    balance_cap_applied: boolean;
    reasons: string[];
  };
};

type SettingsLike = Pick<FinancialSettings, "cycle_mode" | "payday_day">;

function integerCents(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toYmd(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addLocalDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function cycleLabel(start: Date, end: Date, mode: CycleMode) {
  if (mode === "calendar") {
    const value = new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric",
    }).format(start);
    return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
  }

  const lastDay = addLocalDays(end, -1);
  return `${pad2(start.getDate())}/${pad2(start.getMonth() + 1)} a ${pad2(lastDay.getDate())}/${pad2(lastDay.getMonth() + 1)}`;
}

/** Returns the selected cycle with an inclusive start and an exclusive end. */
export function getCycleForOffset(
  settings: SettingsLike,
  offset: number,
  ref = new Date()
): FinancialCycle {
  const safeOffset = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  const mode: CycleMode = settings.cycle_mode === "payday" ? "payday" : "calendar";

  if (mode === "calendar") {
    const start = new Date(ref.getFullYear(), ref.getMonth() + safeOffset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const month = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`;
    return {
      key: `calendar:${month}`,
      start: toYmd(start),
      end: toYmd(end),
      label: cycleLabel(start, end, mode),
    };
  }

  const paydayDay = Math.min(28, Math.max(1, Math.trunc(Number(settings.payday_day) || 5)));
  const containingMonth = ref.getDate() >= paydayDay ? ref.getMonth() : ref.getMonth() - 1;
  const start = new Date(ref.getFullYear(), containingMonth + safeOffset, paydayDay);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, paydayDay);
  const startYmd = toYmd(start);
  return {
    key: `payday:${startYmd}`,
    start: startYmd,
    end: toYmd(end),
    label: cycleLabel(start, end, mode),
  };
}

export const cycleForOffset = getCycleForOffset;

export function calculateFinancialSummary(input: FinancialSummaryInput): FinancialSummary {
  const expectedIncomeCents = Math.max(0, integerCents(input.expectedIncomeCents));
  const realizedIncomeCents = Math.max(0, integerCents(input.realizedIncomeCents));
  const realizedExpenseCents = Math.max(0, integerCents(input.realizedExpenseCents));
  const pendingCommitmentsCents = Math.max(0, integerCents(input.pendingCommitmentsCents));
  const reserveCents = Math.max(0, integerCents(input.reserveCents));
  const allocatedCents = Math.max(0, integerCents(input.allocatedCents));
  const resultCents = realizedIncomeCents - realizedExpenseCents;
  const positiveResultCents = Math.max(0, resultCents);
  const hasBalanceCap = input.trustedBalanceCents !== null && input.trustedBalanceCents !== undefined;
  const balanceCapCents = hasBalanceCap
    ? Math.max(0, integerCents(input.trustedBalanceCents))
    : null;
  const safeBase = balanceCapCents === null
    ? positiveResultCents
    : Math.min(positiveResultCents, balanceCapCents);

  return {
    expectedIncomeCents,
    realizedIncomeCents,
    realizedExpenseCents,
    resultCents,
    pendingCommitmentsCents,
    reserveCents,
    allocatedCents,
    availableCents: Math.max(
      0,
      safeBase - pendingCommitmentsCents - reserveCents - allocatedCents
    ),
    positiveResultCents,
    balanceCapCents,
    balanceCapApplied: balanceCapCents !== null && balanceCapCents < positiveResultCents,
  };
}

function isPlanningSchemaMissing(error: any) {
  return ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code);
}

function planningSchemaError() {
  return new Error("A atualização do planejamento financeiro ainda não foi aplicada no banco de dados.");
}

function normalizeSettings(row: any, householdId: string): FinancialSettings {
  return {
    household_id: householdId,
    cycle_mode: row?.cycle_mode === "payday" ? "payday" : "calendar",
    payday_day: Math.min(28, Math.max(1, Number(row?.payday_day) || 5)),
    reserve_cents: Math.max(0, integerCents(row?.reserve_cents)),
    updated_by: row?.updated_by ?? null,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

export async function getFinancialSettings(householdId: string): Promise<FinancialSettings> {
  const { data, error } = await sb
    .from("financial_settings")
    .select("household_id,cycle_mode,payday_day,reserve_cents,updated_by,created_at,updated_at")
    .eq("household_id", householdId)
    .maybeSingle();

  if (error && !isPlanningSchemaMissing(error)) throw error;
  return normalizeSettings(data, householdId);
}

export async function saveFinancialSettings(params: {
  householdId: string;
  userId: string;
  cycleMode: CycleMode;
  paydayDay: number | null;
  reserveCents: number;
}) {
  const paydayDay = params.cycleMode === "payday"
    ? Math.trunc(Number(params.paydayDay))
    : DEFAULT_FINANCIAL_SETTINGS.payday_day;
  if (!Number.isInteger(paydayDay) || paydayDay < 1 || paydayDay > 28) {
    throw new Error("O dia de recebimento deve estar entre 1 e 28.");
  }
  const reserveCents = integerCents(params.reserveCents);
  if (reserveCents < 0) throw new Error("A reserva mínima não pode ser negativa.");

  const { data, error } = await sb
    .from("financial_settings")
    .upsert({
      household_id: params.householdId,
      cycle_mode: params.cycleMode,
      payday_day: paydayDay,
      reserve_cents: reserveCents,
      updated_by: params.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "household_id" })
    .select("household_id,cycle_mode,payday_day,reserve_cents,updated_by,created_at,updated_at")
    .single();

  if (error) {
    if (isPlanningSchemaMissing(error)) throw planningSchemaError();
    throw error;
  }
  return normalizeSettings(data, params.householdId);
}

function normalizeCommitment(row: any): FinancialCommitment {
  return {
    ...row,
    amount_cents: Math.max(0, integerCents(row.amount_cents)),
    due_day: Number(row.due_day),
    installments_total: row.installments_total === null ? null : Number(row.installments_total),
    active: Boolean(row.active),
    archived_at: row.archived_at ?? null,
  } as FinancialCommitment;
}

export async function listCommitments(
  householdId: string,
  options: { includeArchived?: boolean } = {}
): Promise<FinancialCommitment[]> {
  let query = sb
    .from("financial_commitments")
    .select("id,household_id,kind,name,amount_cents,due_day,starts_on,ends_on,installments_total,active,archived_at,created_by,created_at,updated_at")
    .eq("household_id", householdId)
    .order("due_day", { ascending: true })
    .order("created_at", { ascending: true });
  if (!options.includeArchived) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) {
    if (isPlanningSchemaMissing(error)) return [];
    throw error;
  }
  return (data ?? []).map(normalizeCommitment);
}

type CommitmentValues = {
  householdId: string;
  kind: CommitmentKind;
  name: string;
  amountCents: number;
  dueDay: number;
  startsOn: string;
  endsOn?: string | null;
  installmentsTotal?: number | null;
};

function commitmentPayload(params: CommitmentValues) {
  const name = params.name.trim();
  const amountCents = integerCents(params.amountCents);
  const dueDay = Math.trunc(Number(params.dueDay));
  let installmentsTotal = params.installmentsTotal == null
    ? null
    : Math.trunc(Number(params.installmentsTotal));
  if (!name) throw new Error("Informe o nome do compromisso.");
  if (amountCents <= 0) throw new Error("O valor do compromisso deve ser maior que zero.");
  if (dueDay < 1 || dueDay > 28) throw new Error("O vencimento deve estar entre os dias 1 e 28.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.startsOn)) throw new Error("A data inicial é inválida.");
  if (params.kind === "installment" && (installmentsTotal === null || installmentsTotal < 1 || installmentsTotal > 600)) {
    throw new Error("A quantidade de parcelas deve estar entre 1 e 600.");
  }
  if (params.kind !== "installment") installmentsTotal = null;
  return {
    household_id: params.householdId,
    kind: params.kind,
    name,
    amount_cents: amountCents,
    due_day: dueDay,
    starts_on: params.startsOn,
    ends_on: params.endsOn ?? null,
    installments_total: installmentsTotal,
  };
}

export async function createCommitment(params: CommitmentValues & { userId: string }) {
  const { data, error } = await sb
    .from("financial_commitments")
    .insert({ ...commitmentPayload(params), active: true, created_by: params.userId })
    .select("*")
    .single();
  if (error) {
    if (isPlanningSchemaMissing(error)) throw planningSchemaError();
    throw error;
  }
  return normalizeCommitment(data);
}

export async function updateCommitment(params: CommitmentValues & { commitmentId: string }) {
  const payload = commitmentPayload(params);
  const { data, error } = await sb
    .from("financial_commitments")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("household_id", params.householdId)
    .eq("id", params.commitmentId)
    .select("*")
    .maybeSingle();
  if (error) {
    if (isPlanningSchemaMissing(error)) throw planningSchemaError();
    throw error;
  }
  if (!data) throw new Error("Compromisso não encontrado.");
  return normalizeCommitment(data);
}

export async function archiveCommitment(householdId: string, commitmentId: string) {
  const { data, error } = await sb
    .from("financial_commitments")
    .update({ active: false, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .eq("id", commitmentId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isPlanningSchemaMissing(error)) throw planningSchemaError();
    throw error;
  }
  if (!data) throw new Error("Compromisso não encontrado.");
}

export async function listCommitmentPayments(householdId: string, cycleKey: string) {
  const { data, error } = await sb
    .from("financial_commitment_payments")
    .select("id,household_id,commitment_id,cycle_key,paid_cents,paid_on,transaction_id,created_by,created_at,updated_at")
    .eq("household_id", householdId)
    .eq("cycle_key", cycleKey);
  if (error) {
    if (isPlanningSchemaMissing(error)) return [];
    throw error;
  }
  return (data ?? []).map((row: any) => ({
    ...row,
    paid_cents: Math.max(0, integerCents(row.paid_cents)),
  })) as FinancialCommitmentPayment[];
}

export type SetCommitmentPaidParams = {
  householdId: string;
  userId: string;
  commitmentId: string;
  cycleKey: string;
  paid?: boolean;
  paidCents?: number;
  amountCents?: number;
  paidOn?: string;
  transactionId?: string | null;
};

export async function setCommitmentPaid(params: SetCommitmentPaidParams) {
  let paidCents = integerCents(params.paidCents ?? params.amountCents);

  if (params.paid === false) {
    const { error } = await sb
      .from("financial_commitment_payments")
      .delete()
      .eq("household_id", params.householdId)
      .eq("commitment_id", params.commitmentId)
      .eq("cycle_key", params.cycleKey);
    if (error) {
      if (isPlanningSchemaMissing(error)) throw planningSchemaError();
      throw error;
    }
    return null;
  }

  if (!params.transactionId) {
    throw new Error("Escolha a despesa correspondente antes de contabilizar este compromisso.");
  }

  const [commitmentResult, transactionResult] = await Promise.all([
    sb
      .from("financial_commitments")
      .select("amount_cents")
      .eq("household_id", params.householdId)
      .eq("id", params.commitmentId)
      .maybeSingle(),
    sb
      .from("transactions")
      .select("amount_cents,type,occurred_on,ignored_at")
      .eq("household_id", params.householdId)
      .eq("id", params.transactionId)
      .maybeSingle(),
  ]);
  if (commitmentResult.error || transactionResult.error) {
    const error = commitmentResult.error ?? transactionResult.error;
    if (isPlanningSchemaMissing(error)) throw planningSchemaError();
    throw error;
  }
  if (!commitmentResult.data || !transactionResult.data || transactionResult.data.type !== "expense" || transactionResult.data.ignored_at) {
    throw new Error("A despesa selecionada não está disponível neste ciclo.");
  }
  const commitmentAmount = integerCents(commitmentResult.data.amount_cents);
  const transactionAmount = integerCents(transactionResult.data.amount_cents);
  paidCents = Math.min(paidCents > 0 ? paidCents : commitmentAmount, commitmentAmount, transactionAmount);
  if (paidCents <= 0) throw new Error("O valor contabilizado é inválido.");

  const { data, error } = await sb
    .from("financial_commitment_payments")
    .upsert({
      household_id: params.householdId,
      commitment_id: params.commitmentId,
      cycle_key: params.cycleKey,
      paid_cents: paidCents,
      paid_on: params.paidOn ?? transactionResult.data.occurred_on,
      transaction_id: params.transactionId,
      created_by: params.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "commitment_id,cycle_key" })
    .select("*")
    .single();
  if (error) {
    if (isPlanningSchemaMissing(error)) throw planningSchemaError();
    throw error;
  }
  return { ...data, paid_cents: integerCents(data.paid_cents) } as FinancialCommitmentPayment;
}

export const setCommitmentPayment = setCommitmentPaid;

function parseYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dueOnForCycle(dueDay: number, cycle: FinancialCycle) {
  const start = parseYmd(cycle.start);
  let due = new Date(start.getFullYear(), start.getMonth(), dueDay);
  if (toYmd(due) < cycle.start) due = new Date(start.getFullYear(), start.getMonth() + 1, dueDay);
  return toYmd(due);
}

async function listCycleTransactions(householdId: string, cycle: FinancialCycle) {
  const columns = "id,type,amount_cents,note,category_id,account_id,statement_import_id,occurred_on,created_at,category:categories(name)";
  let result = await sb
    .from("transactions")
    .select(columns)
    .eq("household_id", householdId)
    .is("ignored_at", null)
    .gte("occurred_on", cycle.start)
    .lt("occurred_on", cycle.end)
    .order("occurred_on", { ascending: false });
  if (result.error?.code === "42703") {
    result = await sb
      .from("transactions")
      .select("id,type,amount_cents,note,category_id,statement_import_id,occurred_on,created_at,category:categories(name)")
      .eq("household_id", householdId)
      .gte("occurred_on", cycle.start)
      .lt("occurred_on", cycle.end)
      .order("occurred_on", { ascending: false });
  }
  if (result.error) throw result.error;
  return (result.data ?? []).map((row: any) => ({
    ...row,
    amount_cents: Math.max(0, integerCents(row.amount_cents)),
    account_id: row.account_id ?? null,
  })) as FinancialOverviewTransaction[];
}

async function getExpectedIncome(userId: string) {
  const { data, error } = await sb
    .from("profiles")
    .select("income_fixed_cents,income_variable_avg_cents,income_cents")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const fixed = integerCents(data?.income_fixed_cents);
  const variable = integerCents(data?.income_variable_avg_cents);
  return Math.max(0, fixed + variable || integerCents(data?.income_cents));
}

type ContributionRow = {
  goal_id: string;
  amount_cents: number;
  contributed_on: string;
  cycle_key: string | null;
};

async function listContributionRows(householdId: string): Promise<ContributionRow[]> {
  let result = await sb
    .from("goal_contribution_entries")
    .select("goal_id,amount_cents,contributed_on,cycle_key")
    .eq("household_id", householdId);
  if (result.error?.code === "42703") {
    result = await sb
      .from("goal_contribution_entries")
      .select("goal_id,amount_cents,contributed_on")
      .eq("household_id", householdId);
  }
  if (result.error) throw result.error;
  return (result.data ?? []).map((row: any): ContributionRow => ({
    ...row,
    amount_cents: Math.max(0, integerCents(row.amount_cents)),
    cycle_key: row.cycle_key ?? null,
  }));
}

async function listOverviewGoals(householdId: string) {
  const { data, error } = await sb
    .from("goals")
    .select("id,title,target_cents,priority")
    .eq("household_id", householdId)
    .order("priority", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function listBalanceSnapshots(householdId: string, cycle: FinancialCycle): Promise<BalanceSnapshot[]> {
  const { data, error } = await sb
    .from("statement_imports")
    .select("id,bank_id,final_balance_cents,period_end,created_at,balance_confidence")
    .eq("household_id", householdId)
    .in("balance_confidence", ["confirmed", "derived"])
    .not("bank_id", "is", null)
    .not("final_balance_cents", "is", null)
    .lt("period_end", cycle.end)
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isPlanningSchemaMissing(error)) return [];
    throw error;
  }

  const latestByBank = new Map<string, BalanceSnapshot>();
  for (const row of data ?? []) {
    const bankId = String(row.bank_id ?? "");
    if (!bankId || latestByBank.has(bankId)) continue;
    latestByBank.set(bankId, {
      import_id: row.id,
      bank_id: bankId,
      balance_cents: integerCents(row.final_balance_cents),
      period_end: row.period_end,
      created_at: row.created_at,
      confidence: row.balance_confidence,
    });
  }
  return [...latestByBank.values()];
}

export async function getFinancialOverview(params: {
  householdId: string;
  userId: string;
  cycle: FinancialCycle;
}): Promise<FinancialOverview> {
  const [settings, transactions, commitments, payments, contributionRows, goalRows, snapshots, expectedIncomeCents] = await Promise.all([
    getFinancialSettings(params.householdId),
    listCycleTransactions(params.householdId, params.cycle),
    listCommitments(params.householdId, { includeArchived: true }),
    listCommitmentPayments(params.householdId, params.cycle.key),
    listContributionRows(params.householdId),
    listOverviewGoals(params.householdId),
    listBalanceSnapshots(params.householdId, params.cycle),
    getExpectedIncome(params.userId),
  ]);

  const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const paymentsByCommitment = new Map(payments.map((payment) => [payment.commitment_id, payment]));
  const overviewCommitments = commitments.flatMap((commitment): FinancialOverviewCommitment[] => {
    const dueOn = dueOnForCycle(commitment.due_day, params.cycle);
    if (dueOn < commitment.starts_on || dueOn >= params.cycle.end) return [];
    if (commitment.ends_on && dueOn > commitment.ends_on) return [];
    if (!commitment.active && (!commitment.archived_at || commitment.archived_at.slice(0, 10) <= dueOn)) return [];
    const startsOn = parseYmd(commitment.starts_on);
    const dueDate = parseYmd(dueOn);
    const installmentNumber = commitment.kind === "installment"
      ? (dueDate.getFullYear() - startsOn.getFullYear()) * 12 + dueDate.getMonth() - startsOn.getMonth() + 1
      : null;
    if (installmentNumber !== null && commitment.installments_total !== null && installmentNumber > commitment.installments_total) return [];
    const candidatePayment = paymentsByCommitment.get(commitment.id);
    const paymentTransaction = candidatePayment?.transaction_id
      ? transactionsById.get(candidatePayment.transaction_id)
      : null;
    const payment = paymentTransaction?.type === "expense" ? candidatePayment : undefined;
    const paidCents = Math.max(0, integerCents(payment?.paid_cents));
    return [{
      ...commitment,
      due_on: dueOn,
      installment_number: installmentNumber,
      payment_id: payment?.id ?? null,
      paid_cents: paidCents,
      pending_cents: Math.max(0, commitment.amount_cents - paidCents),
      paid_on: payment?.paid_on ?? null,
    }];
  });

  const cycleRows = contributionRows.filter((row) =>
    row.cycle_key === params.cycle.key
      || (row.contributed_on >= params.cycle.start && row.contributed_on < params.cycle.end)
  );
  const goals: FinancialOverviewGoal[] = goalRows.map((goal: any) => ({
    id: goal.id,
    title: goal.title,
    target_cents: Math.max(0, integerCents(goal.target_cents)),
    priority: Number(goal.priority) || 1,
    contributed_cents: contributionRows
      .filter((row) => row.goal_id === goal.id)
      .reduce((sum, row) => sum + row.amount_cents, 0),
    cycle_contributed_cents: cycleRows
      .filter((row) => row.goal_id === goal.id)
      .reduce((sum, row) => sum + row.amount_cents, 0),
  }));

  const realizedIncomeCents = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount_cents, 0);
  const realizedExpenseCents = transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount_cents, 0);
  const pendingCommitmentsCents = overviewCommitments.reduce((sum, item) => sum + item.pending_cents, 0);
  const allocatedCents = cycleRows.reduce((sum, row) => sum + row.amount_cents, 0);
  const trustedBalanceCents = snapshots.length
    ? snapshots.reduce((sum, snapshot) => sum + snapshot.balance_cents, 0)
    : null;
  const summary = calculateFinancialSummary({
    expectedIncomeCents,
    realizedIncomeCents,
    realizedExpenseCents,
    pendingCommitmentsCents,
    reserveCents: settings.reserve_cents,
    allocatedCents,
    trustedBalanceCents,
  });

  const hasDerived = snapshots.some((snapshot) => snapshot.confidence === "derived");
  const hasStale = snapshots.some((snapshot) => snapshot.period_end < params.cycle.start);
  const balanceStatus: OverviewConfidence = snapshots.length === 0
    ? "unavailable"
    : hasDerived || hasStale ? "partial" : "reliable";
  const reasons: string[] = [];
  if (snapshots.length === 0) reasons.push("Nenhum saldo bancário confiável foi importado para este ciclo.");
  if (hasDerived) reasons.push("Parte do saldo foi derivada das movimentações do extrato.");
  if (hasStale) reasons.push("O saldo bancário mais recente é anterior ao início do ciclo.");
  if (settings.updated_by === null) reasons.push("O planejamento usa as configurações padrão.");

  return {
    ...summary,
    cycle: params.cycle,
    settings,
    transactions,
    commitments: overviewCommitments,
    goals,
    balance: {
      total_cents: trustedBalanceCents,
      status: balanceStatus,
      as_of: snapshots.length
        ? snapshots.reduce((latest, snapshot) => snapshot.period_end > latest ? snapshot.period_end : latest, snapshots[0].period_end)
        : null,
      snapshots,
    },
    confidence: {
      status: balanceStatus === "reliable" && settings.updated_by !== null ? "reliable" : "partial",
      formula: "conservative-v1",
      expected_income_is_projection: true,
      balance_cap_applied: summary.balanceCapApplied,
      reasons,
    },
  };
}

export type AllocateSurplusResult = {
  cycle_closure_id: string;
  contribution_id: string;
  net_cents: number;
  allocated_cents: number;
  remaining_cents: number;
};

export async function allocateSurplus(params: {
  householdId: string;
  goalId: string;
  cycle: FinancialCycle;
  amountCents: number;
  contributedOn?: string;
  note?: string;
}) {
  const amountCents = integerCents(params.amountCents);
  if (amountCents <= 0) throw new Error("Informe um valor maior que zero para o sonho.");
  const { data, error } = await sb.rpc("allocate_cycle_surplus", {
    p_household_id: params.householdId,
    p_goal_id: params.goalId,
    p_cycle_key: params.cycle.key,
    p_cycle_start: params.cycle.start,
    p_cycle_end: params.cycle.end,
    p_amount_cents: amountCents,
    p_contributed_on: params.contributedOn ?? null,
    p_note: params.note?.trim() || null,
  });
  if (error) {
    if (isPlanningSchemaMissing(error)) throw planningSchemaError();
    throw error;
  }
  return {
    ...data,
    net_cents: integerCents(data.net_cents),
    allocated_cents: integerCents(data.allocated_cents),
    remaining_cents: integerCents(data.remaining_cents),
  } as AllocateSurplusResult;
}
