import { formatBRLFromCents } from "./format";
import {
  ALLOCATABLE_CASH_BLOCK_REASONS,
  knownCashErrorCode,
  type AllocatableCashBlockReason,
  type AllocatableCashPosition,
} from "./financialAllocatableCash";

export const ALLOCATABLE_CASH_COPY = {
  title: "Dinheiro para organizar",
  readyDetail: "Esse é o valor que você pode destinar agora sem usar sua reserva nem o que já está comprometido.",
  readyGlance: "Já considera compromissos e reserva.",
  empty: "Não há dinheiro para organizar agora.",
  distribute: "Distribuir para um sonho",
  loading: "Consultando quanto você pode organizar...",
  error: "Não foi possível atualizar seu dinheiro para organizar.",
  retry: "Tentar novamente",
  importStatement: "Importar extrato",
  updateStatement: "Atualizar extrato",
  insufficient: "O valor disponível mudou. Atualizamos seu planejamento.",
  goalChanged: "Esse sonho já recebeu um valor e o limite mudou.",
  conflict: "Essa destinação já foi registrada com outro valor. Escolha o valor de novo.",
  allocateError: "Não foi possível destinar agora. Tente novamente.",
  reviewSaved: "Revisar valores guardados",
  noGoals: "Nenhum sonho em andamento para receber esse valor.",
  earmarkNotice: "Esse valor será marcado como destinado ao seu sonho. Isso não movimenta dinheiro entre contas.",
} as const;

const BLOCKER_COPY: Record<AllocatableCashBlockReason, {
  heading: string;
  glance: string;
  guide: "statement" | "review" | "caution";
  message: string;
  detail: string | null;
  ctaLabel: string | null;
}> = {
  no_snapshot: {
    heading: "Sem fotografia do caixa",
    glance: "Importe um extrato com saldo para continuar.",
    guide: "statement",
    message: "Precisamos de um extrato com saldo para calcular quanto você pode organizar.",
    detail: null,
    ctaLabel: ALLOCATABLE_CASH_COPY.importStatement,
  },
  stale_snapshot: {
    heading: "Saldo desatualizado",
    glance: "Atualize o extrato para continuar.",
    guide: "statement",
    message: "Seu saldo conhecido está desatualizado.",
    detail: "Importe um extrato mais recente para liberar a distribuição.",
    ctaLabel: ALLOCATABLE_CASH_COPY.updateStatement,
  },
  same_bank_risk: {
    heading: "Contas do mesmo banco",
    glance: "Não dá para confirmar todas as contas.",
    guide: "caution",
    message: "Não conseguimos confirmar todas as contas deste banco.",
    detail: null,
    ctaLabel: null,
  },
  missing_account_snapshot: {
    heading: "Falta o saldo de uma conta",
    glance: "Falta o saldo de uma conta no histórico.",
    guide: "caution",
    message: "Há uma conta no histórico sem saldo conhecido.",
    detail: null,
    ctaLabel: null,
  },
  dates_differ: {
    heading: "Datas diferentes",
    glance: "Atualize os extratos para continuar.",
    guide: "statement",
    message: "Seus saldos estão em datas diferentes.",
    detail: "Atualize os extratos para calcular um valor seguro.",
    ctaLabel: ALLOCATABLE_CASH_COPY.updateStatement,
  },
  ambiguous_goal_contributions: {
    heading: "Valores para revisar",
    glance: "Revise os valores guardados para continuar.",
    guide: "review",
    message: "Existem valores antigos guardados em sonhos que precisam ser revisados.",
    detail: "Por segurança, não vamos contar esse dinheiro duas vezes.",
    ctaLabel: ALLOCATABLE_CASH_COPY.reviewSaved,
  },
};

export type BreakdownLine = {
  key: "known" | "earmarked" | "pending" | "reserve" | "available";
  label: string;
  cents: number;
  tone: "base" | "minus" | "total";
};

export type AllocatableCashView =
  | { kind: "loading"; title: string; message: string }
  | { kind: "error"; title: string; message: string; retryLabel: string }
  | {
    kind: "blocked";
    title: string;
    heading: string;
    glance: string;
    guide: "statement" | "review" | "caution";
    message: string;
    detail: string | null;
    ctaLabel: string | null;
    ctaAction: "import" | "review" | null;
    reviewCtaLabel: string | null;
    asOf: string | null;
    extraReasons: string[];
  }
  | {
    kind: "none";
    title: string;
    message: string;
    asOf: string | null;
    breakdown: BreakdownLine[];
  }
  | {
    kind: "ready";
    title: string;
    amountCents: number;
    message: string;
    asOf: string | null;
    ctaLabel: string;
    breakdown: BreakdownLine[];
  };

export type AllocationRequest = { key: string; id: string };

export type AllocationAmountIssue = "zero" | "over_available" | "over_goal";

export type AllocationFailure =
  | { kind: "insufficient"; message: string }
  | { kind: "goal_changed"; message: string }
  | { kind: "blocked"; reason: AllocatableCashBlockReason; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "unknown"; message: string };

const BLOCK_REASON_SET = new Set<string>(ALLOCATABLE_CASH_BLOCK_REASONS);

export function formatAllocatableCashDay(value: string) {
  const [, month, day] = value.split("-");
  if (!day || !month) return value;
  return `${day}/${month}`;
}

export function allocatableCashAsOfCaption(cashAsOfDate: string | null) {
  if (!cashAsOfDate) return null;
  return `Com base nos extratos até ${formatAllocatableCashDay(cashAsOfDate)}`;
}

export function buildAllocatableBreakdown(position: AllocatableCashPosition): BreakdownLine[] {
  if (!position.canAllocate || position.knownCashCents == null || position.availableToOrganizeCents == null) {
    return [];
  }
  return [
    { key: "known", label: "Saldo conhecido", cents: position.knownCashCents, tone: "base" },
    { key: "earmarked", label: "Já destinado", cents: position.earmarkedCents, tone: "minus" },
    { key: "pending", label: "Contas a vencer", cents: position.pendingDueCents, tone: "minus" },
    { key: "reserve", label: "Reserva protegida", cents: position.reservePolicyCents, tone: "minus" },
    { key: "available", label: "Para organizar", cents: position.availableToOrganizeCents, tone: "total" },
  ];
}

export type AllocatableCompositionSegment = {
  key: Exclude<BreakdownLine["key"], "known">;
  label: string;
  cents: number;
  /** Width inside the track. Visual only; cents stay the server amounts. */
  share: number;
};

const COMPOSITION_KEYS = ["earmarked", "pending", "reserve", "available"] as const;

export function buildAllocatableComposition(lines: BreakdownLine[]) {
  const byKey = new Map(lines.map((line) => [line.key, line]));
  const knownCents = Math.max(0, byKey.get("known")?.cents ?? 0);
  const parts = COMPOSITION_KEYS.map((key) => ({
    key,
    label: byKey.get(key)?.label ?? key,
    cents: Math.max(0, byKey.get(key)?.cents ?? 0),
  }));
  const rawScale = knownCents > 0 ? knownCents : parts.reduce((sum, part) => sum + part.cents, 0);
  const rawShares = parts.map((part) => (rawScale > 0 ? part.cents / rawScale : 0));
  const rawSum = rawShares.reduce((sum, share) => sum + share, 0);
  const fit = rawSum > 1 ? 1 / rawSum : 1;
  return {
    knownCents,
    segments: parts.flatMap((part, index) => (
      part.cents > 0
        ? [{ ...part, share: rawShares[index] * fit }]
        : []
    )),
  };
}

export function formatBreakdownAmount(line: BreakdownLine) {
  if (line.tone === "minus") return `- ${formatBRLFromCents(line.cents)}`;
  return formatBRLFromCents(line.cents);
}

export function buildAllocatableCashView(input: {
  status: "loading" | "ready" | "error";
  position: AllocatableCashPosition | null;
}): AllocatableCashView {
  if (input.status === "loading") {
    return {
      kind: "loading",
      title: ALLOCATABLE_CASH_COPY.title,
      message: ALLOCATABLE_CASH_COPY.loading,
    };
  }
  if (input.status === "error" || !input.position) {
    return {
      kind: "error",
      title: ALLOCATABLE_CASH_COPY.title,
      message: ALLOCATABLE_CASH_COPY.error,
      retryLabel: ALLOCATABLE_CASH_COPY.retry,
    };
  }

  const position = input.position;
  const asOf = allocatableCashAsOfCaption(position.cashAsOfDate);
  if (!position.canAllocate || position.availableToOrganizeCents == null) {
    const [primary, ...rest] = position.blockReasons;
    const copy = primary ? BLOCKER_COPY[primary] : null;
    const primaryIsReview = primary === "ambiguous_goal_contributions";
    const reviewAlsoPending = rest.includes("ambiguous_goal_contributions");
    return {
      kind: "blocked",
      title: ALLOCATABLE_CASH_COPY.title,
      heading: copy?.heading ?? "Ainda não dá para organizar",
      glance: copy?.glance ?? "Ainda não dá para organizar esse dinheiro com segurança.",
      guide: copy?.guide ?? "caution",
      message: copy?.message ?? "Ainda não dá para organizar esse dinheiro com segurança.",
      detail: copy?.detail ?? null,
      ctaLabel: copy?.ctaLabel ?? null,
      ctaAction: primaryIsReview ? "review" : copy?.ctaLabel ? "import" : null,
      reviewCtaLabel: reviewAlsoPending ? ALLOCATABLE_CASH_COPY.reviewSaved : null,
      asOf,
      extraReasons: rest.map((reason) => BLOCKER_COPY[reason].message),
    };
  }

  const breakdown = buildAllocatableBreakdown(position);
  if (position.availableToOrganizeCents <= 0) {
    return {
      kind: "none",
      title: ALLOCATABLE_CASH_COPY.title,
      message: ALLOCATABLE_CASH_COPY.empty,
      asOf,
      breakdown,
    };
  }

  return {
    kind: "ready",
    title: ALLOCATABLE_CASH_COPY.title,
    amountCents: position.availableToOrganizeCents,
    message: ALLOCATABLE_CASH_COPY.readyDetail,
    asOf,
    ctaLabel: ALLOCATABLE_CASH_COPY.distribute,
    breakdown,
  };
}

export function goalRemainingCents(goal: { target_cents: number; contributed_cents: number }) {
  return Math.max(goal.target_cents - goal.contributed_cents, 0);
}

export function isAllocatableGoal(goal: { target_cents: number; contributed_cents: number }) {
  return goalRemainingCents(goal) > 0;
}

export function goalProgressPercent(goal: { target_cents: number; contributed_cents: number }) {
  if (goal.target_cents <= 0) return 0;
  return Math.max(0, Math.min(100, (goal.contributed_cents / goal.target_cents) * 100));
}

export function allocationAmountIssue(input: {
  amountCents: number;
  typed: boolean;
  availableCents: number;
  goalRemainingCents: number;
}): AllocationAmountIssue | null {
  if (!input.typed) return null;
  if (input.amountCents <= 0) return "zero";
  if (input.amountCents > input.availableCents) return "over_available";
  if (input.amountCents > input.goalRemainingCents) return "over_goal";
  return null;
}

export function allocationAmountMessage(issue: AllocationAmountIssue | null) {
  if (issue === "zero") return "Informe um valor maior que zero.";
  if (issue === "over_available") return "O valor passa do que você pode organizar agora.";
  if (issue === "over_goal") return "O valor passa do que falta para este sonho.";
  return null;
}

export function canSubmitAllocation(input: {
  saving: boolean;
  goalSelected: boolean;
  issue: AllocationAmountIssue | null;
  amountCents: number;
}) {
  return !input.saving && input.goalSelected && input.issue == null && input.amountCents > 0;
}

export function allocationConfirmCopy(amountCents: number, goalTitle: string) {
  return {
    title: `Destinar ${formatBRLFromCents(amountCents)} para ${goalTitle}?`,
    detail: ALLOCATABLE_CASH_COPY.earmarkNotice,
  };
}

export function allocationSuccessCopy(amountCents: number, goalTitle: string) {
  return `${formatBRLFromCents(amountCents)} destinados para ${goalTitle}.`;
}

export function classifyAllocationError(error: { message?: string } | null | undefined): AllocationFailure {
  const code = knownCashErrorCode(error);
  if (code === "insufficient_available_cash") {
    return { kind: "insufficient", message: ALLOCATABLE_CASH_COPY.insufficient };
  }
  if (code === "amount_exceeds_goal_remaining" || code === "goal_completed") {
    return { kind: "goal_changed", message: ALLOCATABLE_CASH_COPY.goalChanged };
  }
  if (code && BLOCK_REASON_SET.has(code)) {
    const reason = code as AllocatableCashBlockReason;
    return { kind: "blocked", reason, message: BLOCKER_COPY[reason].message };
  }
  if (code === "request_conflict") {
    return { kind: "conflict", message: ALLOCATABLE_CASH_COPY.conflict };
  }
  return { kind: "unknown", message: ALLOCATABLE_CASH_COPY.allocateError };
}

export function resolveAllocationRequestId(
  current: AllocationRequest | null,
  goalId: string,
  amountCents: number,
  createId: () => string,
) {
  const key = `${goalId}:${amountCents}`;
  if (current?.key === key) return current;
  return { key, id: createId() };
}

export function createAllocationRequestId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
