import {
  createCommitment,
  listCommitments,
  updateCommitment,
} from "./financialPlanning";
import type { FinancialCommitment } from "./financialPlanning";

export const NO_DEBTS_OPTION = "Não tenho dívidas";

export type OnboardingDebtDetail = {
  name: string;
  amountCents: number;
  dueDay: number;
  installmentsRemaining: number | null;
};

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
    if (!Number.isSafeInteger(detail.amountCents) || detail.amountCents <= 0) {
      return `Informe um valor mensal maior que zero para ${name}.`;
    }
    if (!Number.isInteger(detail.dueDay) || detail.dueDay < 1 || detail.dueDay > 28) {
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
  }
  return null;
}

function firstDayOfMonth(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function isMatchingOnboardingCommitment(
  commitment: FinancialCommitment,
  userId: string,
  name: string
) {
  return commitment.active
    && commitment.created_by === userId
    && commitment.name.trim() === name.trim()
    && (commitment.kind === "debt" || commitment.kind === "installment");
}

export async function syncOnboardingDebtCommitments(params: {
  householdId: string;
  userId: string;
  selectedDebts: string[];
  debtDetails: OnboardingDebtDetail[];
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
  const details = params.debtDetails.filter((detail) => selectedNames.has(detail.name));
  if (!details.length) return [];

  const commitments = await listCommitments(params.householdId, { includeArchived: true });
  const synced: FinancialCommitment[] = [];

  for (const detail of details) {
    const kind = detail.installmentsRemaining === null ? "debt" : "installment";
    const existing = commitments.find((commitment) =>
      isMatchingOnboardingCommitment(commitment, params.userId, detail.name)
    );

    if (existing) {
      const unchanged = existing.kind === kind
        && existing.amount_cents === detail.amountCents
        && existing.due_day === detail.dueDay
        && existing.installments_total === detail.installmentsRemaining;
      if (unchanged) {
        synced.push(existing);
        continue;
      }

      const updated = await updateCommitment({
        householdId: params.householdId,
        commitmentId: existing.id,
        kind,
        name: detail.name,
        amountCents: detail.amountCents,
        dueDay: detail.dueDay,
        startsOn: existing.starts_on,
        endsOn: null,
        installmentsTotal: detail.installmentsRemaining,
      });
      const existingIndex = commitments.findIndex((item) => item.id === existing.id);
      commitments[existingIndex] = updated;
      synced.push(updated);
      continue;
    }

    const created = await createCommitment({
      householdId: params.householdId,
      userId: params.userId,
      kind,
      name: detail.name,
      amountCents: detail.amountCents,
      dueDay: detail.dueDay,
      startsOn: firstDayOfMonth(params.now ?? new Date()),
      endsOn: null,
      installmentsTotal: detail.installmentsRemaining,
    });
    commitments.push(created);
    synced.push(created);
  }

  return synced;
}
