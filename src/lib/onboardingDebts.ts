import {
  archiveCommitment,
  createCommitment,
  listCommitments,
  updateCommitment,
} from "./financialPlanning";
import type { FinancialCommitment } from "./financialPlanning";
import { supabase } from "./supabase";

export const NO_DEBTS_OPTION = "Não tenho dívidas";
export const DEFAULT_ONBOARDING_DEBT_DUE_DAY = 10;
export const MAX_ONBOARDING_DEBT_NOTE_LENGTH = 32;

export const ONBOARDING_DEBT_TYPES = [
  "Cartão de crédito",
  "Empréstimo pessoal",
  "Financiamento de veículo",
  "Financiamento imobiliário",
  "Financiamento estudantil",
  "Outros",
] as const;

export type OnboardingDebtType = (typeof ONBOARDING_DEBT_TYPES)[number];

export type OnboardingDebtDetail = {
  name: string;
  balanceCents: number;
  amountCents: number;
  dueDay: number;
  installmentsRemaining: number | null;
  note: string | null;
  commitmentId: string | null;
};

const ONBOARDING_DEBT_TYPES_BY_LENGTH = [...ONBOARDING_DEBT_TYPES].sort((a, b) => b.length - a.length);

export function onboardingDebtTypeFromCommitmentName(name: string): string | null {
  const trimmed = name.trim();
  for (const type of ONBOARDING_DEBT_TYPES_BY_LENGTH) {
    if (trimmed === type || trimmed.startsWith(`${type} (`)) return type;
  }
  return null;
}

export function parseOnboardingDebtDetails(raw: unknown): OnboardingDebtDetail[] {
  if (!Array.isArray(raw)) return [];
  const details: OnboardingDebtDetail[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const balanceCents = Number(record.balanceCents);
    const amountCents = Number(record.amountCents);
    const dueDay = Number(record.dueDay);
    const installmentsRemaining = record.installmentsRemaining == null
      ? null
      : Number(record.installmentsRemaining);
    details.push({
      name,
      balanceCents: Number.isSafeInteger(balanceCents) && balanceCents > 0 ? balanceCents : 0,
      amountCents: Number.isSafeInteger(amountCents) && amountCents > 0 ? amountCents : 0,
      dueDay: Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 28
        ? dueDay
        : DEFAULT_ONBOARDING_DEBT_DUE_DAY,
      installmentsRemaining: Number.isInteger(installmentsRemaining) && Number(installmentsRemaining) > 0
        ? Number(installmentsRemaining)
        : null,
      note: typeof record.note === "string" && record.note.trim()
        ? record.note.trim().slice(0, MAX_ONBOARDING_DEBT_NOTE_LENGTH)
        : null,
      commitmentId: typeof record.commitmentId === "string" && record.commitmentId.trim()
        ? record.commitmentId.trim()
        : null,
    });
  }
  return details;
}

export function getOnboardingDebtValidationError(
  selectedDebts: string[],
  debtDetails: OnboardingDebtDetail[]
) {
  const selectedWithDebt = selectedDebts.filter((name) => name !== NO_DEBTS_OPTION);
  if (!selectedWithDebt.length) return null;

  const detailsByName = new Map(debtDetails.map((detail) => [detail.name, detail]));
  for (const name of selectedWithDebt) {
    const detail = detailsByName.get(name);
    if (!detail) return `Preencha os detalhes de ${name}.`;
    if (!Number.isSafeInteger(detail.balanceCents) || detail.balanceCents <= 0) {
      return `Informe o saldo de ${name}.`;
    }
    if (detail.amountCents < 0 || (detail.amountCents > 0 && !Number.isSafeInteger(detail.amountCents))) {
      return `Informe um valor de parcela válido para ${name}.`;
    }
    if (
      detail.amountCents > 0
      && (!Number.isInteger(detail.dueDay) || detail.dueDay < 1 || detail.dueDay > 28)
    ) {
      return `Informe um dia de vencimento entre 1 e 28 para ${name}.`;
    }
    if (
      detail.installmentsRemaining !== null
      && (
        !Number.isInteger(detail.installmentsRemaining)
        || detail.installmentsRemaining < 1
        || detail.installmentsRemaining > 600
      )
    ) {
      return `Informe entre 1 e 600 parcelas restantes para ${name}, ou deixe o campo vazio.`;
    }
    if (detail.note && detail.note.trim().length > MAX_ONBOARDING_DEBT_NOTE_LENGTH) {
      return `A observação de ${name} deve ter no máximo ${MAX_ONBOARDING_DEBT_NOTE_LENGTH} caracteres.`;
    }
  }
  return null;
}

function firstDayOfMonth(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function ownedOnboardingDetailForCommitment(
  details: OnboardingDebtDetail[],
  commitmentId: string
) {
  return details.find((detail) => detail.commitmentId === commitmentId) ?? null;
}

export function onboardingDebtsPendingCommitment(
  details: OnboardingDebtDetail[],
  activeCommitmentIds: Iterable<string>
) {
  const activeIds = new Set(activeCommitmentIds);
  return details.filter((detail) => (
    detail.balanceCents > 0
    && (!detail.commitmentId || !activeIds.has(detail.commitmentId))
  ));
}

export function upsertOnboardingDebtDetail(
  current: OnboardingDebtDetail[],
  next: OnboardingDebtDetail
) {
  return [...current.filter((detail) => detail.name !== next.name), next];
}

function ownedCommitmentId(
  typeName: string,
  incoming: OnboardingDebtDetail | undefined,
  previous: OnboardingDebtDetail[]
) {
  if (incoming?.commitmentId) return incoming.commitmentId;
  return previous.find((detail) => detail.name === typeName)?.commitmentId ?? null;
}

async function loadStoredOnboardingDebtDetails() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return parseOnboardingDebtDetails(data.user?.user_metadata?.finapp_debt_details);
}

export async function saveOnboardingDebtMetadata(params: {
  debts: string[];
  debtDetails: OnboardingDebtDetail[];
}) {
  const { error } = await supabase.auth.updateUser({
    data: {
      finapp_debts: params.debts,
      finapp_debt_details: params.debtDetails,
    },
  });
  if (error) throw error;
}

export async function syncOnboardingDebtCommitments(params: {
  householdId: string;
  userId: string;
  selectedDebts: string[];
  debtDetails: OnboardingDebtDetail[];
  previousDebtDetails?: OnboardingDebtDetail[];
  now?: Date;
}) {
  const validationError = getOnboardingDebtValidationError(
    params.selectedDebts,
    params.debtDetails
  );
  if (validationError) throw new Error(validationError);

  const selectedNames = new Set(
    params.selectedDebts.filter((name) => name !== NO_DEBTS_OPTION)
  );
  const detailsByName = new Map(params.debtDetails.map((detail) => [detail.name, detail]));
  const previousDetails = params.previousDebtDetails
    ?? await loadStoredOnboardingDebtDetails();
  const commitments = await listCommitments(params.householdId, { includeArchived: true });
  const byId = new Map(commitments.map((commitment) => [commitment.id, commitment]));
  const synced: FinancialCommitment[] = [];
  const usedIds = new Set<string>();
  const nextDetails: OnboardingDebtDetail[] = [];

  for (const typeName of selectedNames) {
    const detail = detailsByName.get(typeName);
    if (!detail) continue;
    const ownedId = ownedCommitmentId(typeName, detail, previousDetails);
    const existing = ownedId ? byId.get(ownedId) ?? null : null;
    const existingActive = existing?.active ? existing : null;

    if (detail.amountCents <= 0) {
      if (existingActive) {
        await archiveCommitment(params.householdId, existingActive.id);
        existingActive.active = false;
      }
      nextDetails.push({ ...detail, name: typeName, commitmentId: null });
      continue;
    }

    const kind = detail.installmentsRemaining === null ? "debt" : "installment";
    const dueDay = Number.isInteger(detail.dueDay) && detail.dueDay >= 1 && detail.dueDay <= 28
      ? detail.dueDay
      : DEFAULT_ONBOARDING_DEBT_DUE_DAY;

    if (existingActive) {
      usedIds.add(existingActive.id);
      const unchanged = existingActive.kind === kind
        && existingActive.name === typeName
        && existingActive.amount_cents === detail.amountCents
        && existingActive.due_day === dueDay
        && existingActive.installments_total === detail.installmentsRemaining;
      if (unchanged) {
        synced.push(existingActive);
        nextDetails.push({ ...detail, name: typeName, commitmentId: existingActive.id });
        continue;
      }

      const updated = await updateCommitment({
        householdId: params.householdId,
        commitmentId: existingActive.id,
        kind,
        name: typeName,
        amountCents: detail.amountCents,
        dueDay,
        startsOn: existingActive.starts_on,
        endsOn: null,
        installmentsTotal: detail.installmentsRemaining,
      });
      byId.set(updated.id, updated);
      synced.push(updated);
      nextDetails.push({ ...detail, name: typeName, commitmentId: updated.id });
      continue;
    }

    const created = await createCommitment({
      householdId: params.householdId,
      userId: params.userId,
      kind,
      name: typeName,
      amountCents: detail.amountCents,
      dueDay,
      startsOn: firstDayOfMonth(params.now ?? new Date()),
      endsOn: null,
      installmentsTotal: detail.installmentsRemaining,
    });
    byId.set(created.id, created);
    usedIds.add(created.id);
    synced.push(created);
    nextDetails.push({ ...detail, name: typeName, commitmentId: created.id });
  }

  for (const previous of previousDetails) {
    if (!previous.commitmentId || usedIds.has(previous.commitmentId)) continue;
    if (selectedNames.has(previous.name)) continue;
    const row = byId.get(previous.commitmentId);
    if (!row?.active) continue;
    await archiveCommitment(params.householdId, row.id);
  }

  await saveOnboardingDebtMetadata({
    debts: params.selectedDebts,
    debtDetails: nextDetails,
  });

  return { commitments: synced, debtDetails: nextDetails };
}
