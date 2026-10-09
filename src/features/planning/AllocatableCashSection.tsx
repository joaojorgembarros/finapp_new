import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  allocationSuccessCopy,
  buildAllocatableCashView,
} from "../../lib/allocatableCashPresentation";
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
  const canOpenSheet = Boolean(
    position?.canAllocate && (position.availableToOrganizeCents ?? 0) > 0
  );

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
      />
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
