import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import {
  allocationSuccessCopy,
  buildAllocatableCashView,
} from "../../lib/allocatableCashPresentation";
import { DisclosureSection } from "../../ui/DisclosureSection";
import { OB } from "../../ui/OnboardingKit";
import { AllocatableCashBreakdown } from "./AllocatableCashBreakdown";
import { AllocatableCashComposition } from "./AllocatableCashComposition";
import { PLANNING_CYCLE_ACTION_COPY } from "./planningCycleActions";
import { usePlanningActions } from "./PlanningActionsSection";
import {
  getAllocatableCashPosition,
  type AllocatableCashPosition,
  type KnownCashAllocationResult,
} from "../../lib/financialAllocatableCash";
import { AllocatableCashCard } from "./AllocatableCashCard";
import { GoalAllocationSheet } from "./GoalAllocationSheet";

export function AllocatableCashSection({
  householdId,
  refreshKey,
  reviewReturn = "financial-plan",
}: {
  householdId: string;
  refreshKey: number;
  reviewReturn?: "financial-plan" | "planejamento";
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [position, setPosition] = useState<AllocatableCashPosition | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getAllocatableCashPosition(householdId);
      setPosition(next);
      setStatus("ready");
      if (!next.canAllocate || (next.availableToOrganizeCents ?? 0) <= 0) {
        setSheetOpen(false);
      }
      return next;
    } catch {
      setStatus("error");
      return null;
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (refreshKey === 0) return;
    void load();
  }, [load, refreshKey]);

  async function handleSuccess(result: KnownCashAllocationResult, goalTitle: string) {
    setSheetOpen(false);
    setNotice(allocationSuccessCopy(result.amountCents, goalTitle));
    await load();
  }

  const presentation = buildAllocatableCashView({ status, position });
  const actions = usePlanningActions();
  const canOpenSheet = Boolean(
    position?.canAllocate && (position.availableToOrganizeCents ?? 0) > 0
  );
  const calculation = presentation.kind === "ready" || presentation.kind === "none"
    ? presentation
    : null;

  return (
    <>
      <AllocatableCashCard
        presentation={presentation}
        notice={notice}
        onRetry={() => {
          setStatus("loading");
          void load();
        }}
        onImport={() => router.push("/(app)/import-extract")}
        onReview={() => router.push({
          pathname: "/(app)/review-goal-contributions",
          params: reviewReturn === "planejamento" ? { returnTo: "planejamento" } : {},
        })}
        onDistribute={() => {
          if (!canOpenSheet) return;
          setNotice(null);
          setSheetOpen(true);
        }}
        onSaveForDream={actions?.canSaveForDream ? actions.openSurplus : null}
        saveForDreamLabel={PLANNING_CYCLE_ACTION_COPY.allocateDream}
      />
      {calculation && calculation.breakdown.length ? (
        <DisclosureSection title="Como chegamos nesse valor?" summary="Entenda o cálculo">
          <AllocatableCashComposition lines={calculation.breakdown} />
          <AllocatableCashBreakdown lines={calculation.breakdown} />
          {calculation.asOf ? <Text style={styles.note}>{calculation.asOf}</Text> : null}
          {calculation.kind === "ready" ? <Text style={styles.note}>{calculation.message}</Text> : null}
        </DisclosureSection>
      ) : null}
      {sheetOpen && position && canOpenSheet ? (
        <GoalAllocationSheet
          visible
          householdId={householdId}
          position={position}
          onClose={() => setSheetOpen(false)}
          onSuccess={(result, goalTitle) => void handleSuccess(result, goalTitle)}
          onRefresh={load}
          onNotice={setNotice}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  note: { color: OB.support, fontSize: 12, fontWeight: "700", lineHeight: 17 },
});
