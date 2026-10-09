import type { FinancialOverview, FinancialOverviewCommitment } from "../../lib/financialPlanning";
import { buildObligationSurplus, groupCommittedMoney } from "../../lib/summaryPresentation";

export const PLANNING_CYCLE_ACTION_COPY = {
  title: "Ações do planejamento",
  reviewPayments: "Revisar pagamentos",
  allocateDream: "Guardar para um sonho",
} as const;

type SurplusSource = {
  expectedIncomeCents: number | null;
  reserveCents: number | null;
  allocatedCents: number | null;
  commitments: {
    kind: "fixed_bill" | "debt" | "installment";
    amount_cents: number;
    paid_cents: number;
    pending_cents: number;
  }[];
};

export function canAllocateCycleSurplus(overview: SurplusSource | null) {
  if (!overview) return false;
  const committed = groupCommittedMoney({
    commitments: overview.commitments,
    reserveCents: overview.reserveCents ?? 0,
  });
  return buildObligationSurplus({
    expectedIncomeCents: overview.expectedIncomeCents ?? 0,
    commitmentsTotalCents: committed.commitmentsTotalCents,
    reserveCents: committed.reserveCents,
    dreamsAllocatedCents: overview.allocatedCents ?? 0,
  }).plannedFreeCents > 0;
}

export function commitmentPaymentParams(
  overview: Pick<FinancialOverview, "cycle">,
  commitment: Pick<FinancialOverviewCommitment, "id">,
  returnTo?: "planejamento",
) {
  return {
    commitmentId: commitment.id,
    cycleKey: overview.cycle.key,
    cycleStart: overview.cycle.start,
    cycleEnd: overview.cycle.end,
    cycleDate: overview.cycle.start,
    ...(returnTo ? { returnTo } : {}),
  };
}

export function surplusAllocationParams(
  overview: Pick<FinancialOverview, "cycle" | "availableCents">,
  returnTo?: "planejamento",
) {
  return {
    cycleKey: overview.cycle.key,
    cycleStart: overview.cycle.start,
    cycleEnd: overview.cycle.end,
    availableCents: String(overview.availableCents),
    cycleDate: overview.cycle.start,
    ...(returnTo ? { returnTo } : {}),
  };
}

export function journeyTabAfterPlanningAction(returnTo: string | undefined, cycleDate?: string) {
  if (returnTo === "planejamento") {
    return { pathname: "/(app)/journey" as const, params: { tab: "planejamento" as const } };
  }
  return {
    pathname: "/(app)/journey" as const,
    params: cycleDate ? { tab: "controle" as const, cycleDate } : { tab: "controle" as const },
  };
}

export function planningExitLabel(returnTo: string | undefined) {
  return returnTo === "planejamento" ? "Voltar ao planejamento" : "Voltar ao Resumo";
}
