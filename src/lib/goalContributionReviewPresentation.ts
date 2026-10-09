import { formatBRLFromCents, formatDateBRFromYMD } from "./format";
import { goalContributionErrorCode } from "./goalContributionEffect";
import type { AllocatableCashPosition } from "./financialAllocatableCash";
import { buildAllocatableCashView } from "./allocatableCashPresentation";

export const REVIEW_COPY = {
  title: "Revisar valor guardado",
  question: "Onde esse dinheiro está hoje?",
  reducePrompt: "O valor guardado hoje é menor?",
  amountToConfirm: "Valor que será confirmado",
  zero: "Se nada continua guardado, escolha “Não está mais guardado”.",
  overOriginal: "O valor de hoje não pode passar do que foi registrado.",
  reversedWarning: "O histórico continuará registrado, mas esse valor sairá do progresso do sonho.",
  alreadyReviewed: "Esse valor já foi revisado.",
  conflict: "Não foi possível confirmar esta revisão. Tente de novo sem mudar a decisão.",
  retry: "Tentar novamente",
  error: "Não foi possível revisar este valor. Tente novamente.",
  emptyTitle: "Não há valores pendentes de revisão.",
  doneTitle: "Valores revisados",
  doneDetail: "Agora conseguimos calcular seu dinheiro para organizar com segurança.",
  backToPlan: "Voltar ao planejamento",
  loadError: "Não foi possível carregar os valores para revisar.",
} as const;

export const SAVE_MONEY_COPY = {
  title: "Guardar dinheiro",
  question: "De onde vem esse dinheiro?",
  trackedTitle: "Das contas que o Sonho+ acompanha",
  trackedDetail: "Esse valor será reservado dentro do dinheiro que o Sonho+ conhece.",
  outsideTitle: "Está guardado fora dessas contas",
  outsideDetail: "Esse valor vai contar no progresso do sonho, mas não faz parte do saldo das contas acompanhadas.",
  cancel: "Agora não",
  completed: "Este sonho já foi concluído.",
  outsideError: "Não foi possível guardar esse valor agora. Tente novamente.",
  outsideConflict: "Esse registro já foi feito com outros dados. Confira o valor e tente de novo.",
} as const;

export type ReviewDecision = "still_in_accounts" | "saved_outside" | "no_longer_saved";

export type ReviewAmountIssue = "zero" | "over_original" | null;

export type ReviewFailureKind = "already_reviewed" | "conflict" | "invalid" | "unknown";

const HISTORY_STATUS: Record<string, string> = {
  known_cash: "Destinado pelo planejamento",
  cycle_surplus: "Guardado da sobra do ciclo",
  account_reserved: "Guardado nas contas acompanhadas",
  saved_outside: "Guardado fora das contas acompanhadas",
  manual_unverified: "Precisa de revisão",
  reversed: "Não está mais guardado",
};

export function isPendingManualContribution(sourceKind: string | null | undefined) {
  return sourceKind === "manual_unverified";
}

export function pendingManualContributions<T extends { sourceKind: string | null | undefined }>(rows: T[]) {
  return rows.filter((row) => isPendingManualContribution(row.sourceKind));
}

export function reviewProgressLabel(index: number, total: number) {
  return `${index} de ${total}`;
}

export function reviewRegisteredCopy(amountCents: number, goalTitle: string) {
  return `Você registrou ${formatBRLFromCents(amountCents)} para ${goalTitle}.`;
}

export function reviewDateCaption(contributedOn: string | null | undefined) {
  if (!contributedOn || !/^\d{4}-\d{2}-\d{2}$/.test(contributedOn)) return null;
  const [, month, day] = contributedOn.split("-");
  return `Registrado em ${day}/${month}`;
}

export function reviewChoices() {
  return [
    {
      decision: "still_in_accounts" as const,
      title: "Ainda está nas minhas contas",
      detail: "Esse dinheiro continua em uma conta que o Sonho+ acompanha.",
    },
    {
      decision: "saved_outside" as const,
      title: "Está guardado fora dessas contas",
      detail: "Por exemplo: outra conta, investimento, poupança ou dinheiro físico.",
    },
    {
      decision: "no_longer_saved" as const,
      title: "Não está mais guardado",
      detail: "Esse valor não faz mais parte do que você tem separado para o sonho.",
    },
  ];
}

export type ReconciliationSubmission = {
  decision: ReviewDecision;
  effectiveAmountCents: number | null;
  issue: ReviewAmountIssue;
};

export function buildReconciliationSubmission(input: {
  decision: ReviewDecision;
  originalCents: number;
  correcting: boolean;
  editedCents: number;
}): ReconciliationSubmission {
  if (input.decision === "no_longer_saved") {
    return { decision: input.decision, effectiveAmountCents: null, issue: null };
  }
  const effectiveAmountCents = input.correcting ? input.editedCents : input.originalCents;
  if (effectiveAmountCents <= 0) {
    return { decision: input.decision, effectiveAmountCents, issue: "zero" };
  }
  if (effectiveAmountCents > input.originalCents) {
    return { decision: input.decision, effectiveAmountCents, issue: "over_original" };
  }
  return { decision: input.decision, effectiveAmountCents, issue: null };
}

export function reviewAmountIssue(input: {
  decision: ReviewDecision;
  amountCents: number;
  originalCents: number;
  reducing: boolean;
}): ReviewAmountIssue {
  return buildReconciliationSubmission({
    decision: input.decision,
    originalCents: input.originalCents,
    correcting: input.reducing,
    editedCents: input.amountCents,
  }).issue;
}

export function reviewAmountMessage(issue: ReviewAmountIssue) {
  if (issue === "zero") return REVIEW_COPY.zero;
  if (issue === "over_original") return REVIEW_COPY.overOriginal;
  return null;
}

export function reviewEffectiveCents(input: {
  decision: ReviewDecision;
  amountCents: number;
  originalCents: number;
  reducing: boolean;
}) {
  return buildReconciliationSubmission({
    decision: input.decision,
    originalCents: input.originalCents,
    correcting: input.reducing,
    editedCents: input.amountCents,
  }).effectiveAmountCents;
}

export function reviewConfirmation(input: {
  decision: ReviewDecision;
  amountCents: number;
  originalCents: number;
  goalTitle: string;
}) {
  if (input.decision === "no_longer_saved") {
    return {
      title: `Remover ${formatBRLFromCents(input.originalCents)} do progresso de ${input.goalTitle}?`,
      detail: `${REVIEW_COPY.reversedWarning} O registro continuará no histórico.`,
    };
  }
  const amount = formatBRLFromCents(input.amountCents);
  if (input.decision === "saved_outside") {
    return {
      title: `Confirmar ${amount} guardados fora das contas acompanhadas?`,
      detail: "Esse valor continuará no progresso do sonho, mas não será descontado do saldo conhecido.",
    };
  }
  return {
    title: `Confirmar ${amount} ainda guardados para ${input.goalTitle}?`,
    detail: "Esse valor continuará no progresso do sonho e deixará de fazer parte do dinheiro disponível para organizar.",
  };
}

export type ReviewRequest = { key: string; id: string };

export function resolveReviewRequestId(
  current: ReviewRequest | null,
  contributionId: string,
  decision: ReviewDecision,
  effectiveCents: number | null,
  createId: () => string,
) {
  const key = `${contributionId}:${decision}:${effectiveCents ?? "none"}`;
  if (current?.key === key) return current;
  return { key, id: createId() };
}

export function classifyReviewError(error: { message?: string } | null | undefined): ReviewFailureKind {
  const code = goalContributionErrorCode(error);
  if (code === "already_reconciled") return "already_reviewed";
  if (code === "request_conflict") return "conflict";
  if (code === "invalid_amount" || code === "amount_exceeds_original") return "invalid";
  return "unknown";
}

export function reviewFailureMessage(kind: ReviewFailureKind) {
  if (kind === "already_reviewed") return REVIEW_COPY.alreadyReviewed;
  if (kind === "conflict") return REVIEW_COPY.conflict;
  if (kind === "invalid") return REVIEW_COPY.overOriginal;
  return REVIEW_COPY.error;
}

export function reviewFailureKeepsRequest(kind: ReviewFailureKind) {
  return kind === "unknown" || kind === "invalid";
}

export function nextPendingAfterResolve<T extends { id: string }>(items: T[], resolvedId: string) {
  return items.filter((item) => item.id !== resolvedId);
}

export function contributionHistoryPresentation(entry: {
  amountCents: number;
  effectiveCents: number;
  sourceKind: string | null | undefined;
}) {
  const status = HISTORY_STATUS[entry.sourceKind ?? ""] ?? "Precisa de revisão";
  if (entry.sourceKind === "reversed") {
    return {
      status,
      headline: `${formatBRLFromCents(entry.amountCents)} registrados anteriormente`,
      originalCaption: null as string | null,
    };
  }
  const partial = entry.effectiveCents !== entry.amountCents;
  return {
    status,
    headline: partial
      ? `${formatBRLFromCents(entry.effectiveCents)} guardados`
      : formatBRLFromCents(entry.effectiveCents),
    originalCaption: partial ? `Registro original: ${formatBRLFromCents(entry.amountCents)}` : null,
  };
}

export function contributionHistoryDate(contributedOn: string) {
  return formatDateBRFromYMD(contributedOn);
}

export function saveMoneyChoices() {
  return [
    { source: "tracked" as const, title: SAVE_MONEY_COPY.trackedTitle, detail: SAVE_MONEY_COPY.trackedDetail },
    { source: "outside" as const, title: SAVE_MONEY_COPY.outsideTitle, detail: SAVE_MONEY_COPY.outsideDetail },
  ];
}

export function trackedAccountSaveState(position: AllocatableCashPosition | null) {
  if (!position) return { kind: "unavailable" as const, message: SAVE_MONEY_COPY.outsideError };
  const view = buildAllocatableCashView({ status: "ready", position });
  if (view.kind === "blocked") {
    return {
      kind: "blocked" as const,
      message: view.message,
      detail: view.detail,
      review: position.blockReasons.includes("ambiguous_goal_contributions"),
      allowsManual: false as const,
    };
  }
  if (view.kind !== "ready") {
    return {
      kind: "unavailable" as const,
      message: view.kind === "none" ? view.message : SAVE_MONEY_COPY.outsideError,
      allowsManual: false as const,
    };
  }
  return {
    kind: "ready" as const,
    availableCents: view.amountCents,
    allowsManual: false as const,
  };
}

export type SavedOutsideAmountIssue = "zero" | "over_goal" | "completed" | null;

export function savedOutsideAmountIssue(input: {
  amountCents: number;
  typed: boolean;
  remainingCents: number;
}): SavedOutsideAmountIssue {
  if (input.remainingCents <= 0) return "completed";
  if (!input.typed) return null;
  if (input.amountCents <= 0) return "zero";
  if (input.amountCents > input.remainingCents) return "over_goal";
  return null;
}

export function savedOutsideAmountMessage(issue: SavedOutsideAmountIssue) {
  if (issue === "completed") return SAVE_MONEY_COPY.completed;
  if (issue === "zero") return "Informe um valor maior que zero.";
  if (issue === "over_goal") return "O valor passa do que falta para este sonho.";
  return null;
}

export function savedOutsideConfirmation(amountCents: number, goalTitle: string) {
  return {
    title: `Guardar ${formatBRLFromCents(amountCents)} fora das contas para ${goalTitle}?`,
    detail: SAVE_MONEY_COPY.outsideDetail,
  };
}

export function resolveSavedOutsideRequestId(
  current: ReviewRequest | null,
  goalId: string,
  amountCents: number,
  contributedOn: string,
  note: string,
  createId: () => string,
) {
  const key = `${goalId}:${amountCents}:${contributedOn}:${note.trim()}`;
  if (current?.key === key) return current;
  return { key, id: createId() };
}

export function classifySavedOutsideError(error: { message?: string } | null | undefined): ReviewFailureKind {
  const code = goalContributionErrorCode(error);
  if (code === "request_conflict") return "conflict";
  if (code === "goal_completed" || code === "amount_exceeds_goal_remaining" || code === "invalid_amount") return "invalid";
  return "unknown";
}
