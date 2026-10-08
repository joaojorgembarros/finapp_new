import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listCategories } from "../../lib/categories";
import { ymd } from "../../lib/date";
import {
  FinancialOverview,
  FinancialOverviewCommitment,
  getCycleForOffset,
  getFinancialOverview,
  getFinancialSettings,
} from "../../lib/financialPlanning";
import {
  loadObservedSummaryTransactions,
  type FinancialObservedSummary,
} from "../../lib/financialObservedSummary";
import { loadObservedSummaryForUi } from "../../lib/observedSummaryLoad";
import { sortPendingCommitments } from "../../lib/financialOverviewPresentation";
import {
  buildObligationSurplus,
  groupCommittedMoney,
} from "../../lib/summaryPresentation";
import {
  buildObservedCategoryRows,
  buildObservedComparison,
  buildObservedMonthHero,
} from "../../lib/observedSummaryPresentation";
import {
  JOURNEY_HEADER_HEIGHT,
  getJourneyBottomContentInset,
} from "../../ui/journeyChrome";
import { OB } from "../../ui/OnboardingKit";
import { ObservedCategoryBreakdown } from "./ObservedCategoryBreakdown";
import { ObservedComparisonCard } from "./ObservedComparisonCard";
import { ObservedMonthHero } from "./ObservedMonthHero";
import { ObservedPlanningAccess } from "./ObservedPlanningAccess";

export function SummaryTab({
  householdId,
  userId,
  householdLoading,
  postImportId,
  reconciledCommitments = 0,
  onPostImportHandled,
  onScroll,
}: {
  householdId: string | null;
  userId: string | null;
  householdLoading: boolean;
  cycleDate?: string;
  onCycleDateChange: (cycleDate: string) => void;
  postImportId?: string;
  reconciledCommitments?: number;
  onPostImportHandled: () => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<FinancialObservedSummary | null>(null);
  const [knownCategoryIds, setKnownCategoryIds] = useState<ReadonlySet<string>>(new Set());
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setupGuideDismissed, setSetupGuideDismissed] = useState(false);
  const loadTokenRef = useRef(0);

  const loadObserved = useCallback(async () => {
    const loadToken = ++loadTokenRef.current;
    if (!householdId) {
      setSummary(null);
      setKnownCategoryIds(new Set());
      setLoadError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadError(null);
      const referenceDate = ymd(new Date());
      const loaded = await loadObservedSummaryForUi({
        referenceDate,
        loadTransactions: () => loadObservedSummaryTransactions({ householdId, referenceDate }),
        loadCategories: async () => {
          const categories = await listCategories(householdId);
          return categories.map((category) => ({ id: category.id, name: category.name }));
        },
      });
      if (loadToken !== loadTokenRef.current) return;
      setKnownCategoryIds(new Set(loaded.knownCategoryIds));
      setSummary(loaded.summary);
    } catch (error: any) {
      if (loadToken !== loadTokenRef.current) return;
      const message = "Tente novamente em alguns instantes.";
      setSummary(null);
      setLoadError(message);
      if (Platform.OS !== "web") {
        Alert.alert("Não foi possível carregar seu resumo", error?.message ?? message);
      }
    } finally {
      if (loadToken === loadTokenRef.current) setLoading(false);
    }
  }, [householdId]);

  const loadPlanning = useCallback(async () => {
    if (!householdId || !userId) {
      setOverview(null);
      return;
    }
    try {
      const settings = await getFinancialSettings(householdId);
      const cycle = getCycleForOffset(settings, 0, new Date());
      const nextOverview = await getFinancialOverview({ householdId, userId, cycle });
      setOverview(nextOverview);
    } catch {
      setOverview(null);
    }
  }, [householdId, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadObserved();
      void loadPlanning();
    }, [loadObserved, loadPlanning])
  );

  useEffect(() => {
    setSetupGuideDismissed(false);
  }, [postImportId]);

  const pendingCommitments = useMemo(
    () => sortPendingCommitments(overview?.commitments ?? []),
    [overview]
  );
  const confirmedCommitments = useMemo(
    () => overview?.commitments.filter((item) => item.pending_cents <= 0) ?? [],
    [overview]
  );
  const surplus = useMemo(() => {
    if (!overview) return null;
    const committed = groupCommittedMoney({
      commitments: overview.commitments,
      reserveCents: overview.reserveCents ?? 0,
    });
    return buildObligationSurplus({
      expectedIncomeCents: overview.expectedIncomeCents ?? 0,
      commitmentsTotalCents: committed.commitmentsTotalCents,
      reserveCents: committed.reserveCents,
      dreamsAllocatedCents: overview.allocatedCents ?? 0,
    });
  }, [overview]);

  const hero = summary ? buildObservedMonthHero(summary) : null;
  const comparison = summary ? buildObservedComparison(summary) : null;
  const categoryRows = summary
    ? buildObservedCategoryRows(summary, { knownCategoryIds })
    : [];

  const busy = loading || householdLoading;
  const showPlanningGuide = Boolean(postImportId && !setupGuideDismissed);
  const needsPlanningFlow = Boolean(overview && overview.settings.updated_by === null);

  const openCommitmentPayment = useCallback(
    (commitment: FinancialOverviewCommitment) => {
      if (!overview) return;
      router.push({
        pathname: "/(app)/link-commitment",
        params: {
          commitmentId: commitment.id,
          cycleKey: overview.cycle.key,
          cycleStart: overview.cycle.start,
          cycleEnd: overview.cycle.end,
          cycleDate: overview.cycle.start,
        },
      });
    },
    [overview]
  );

  const openAllocation = useCallback(() => {
    if (!overview || !surplus || surplus.plannedFreeCents <= 0) return;
    router.push({
      pathname: "/(app)/allocate-surplus",
      params: {
        cycleKey: overview.cycle.key,
        cycleStart: overview.cycle.start,
        cycleEnd: overview.cycle.end,
        availableCents: String(overview.availableCents),
        cycleDate: overview.cycle.start,
      },
    });
  }, [overview, surplus]);

  const finishPostImportGuide = useCallback(() => {
    setSetupGuideDismissed(true);
    onPostImportHandled();
  }, [onPostImportHandled]);

  const continuePostImportGuide = useCallback(() => {
    if (needsPlanningFlow) {
      setSetupGuideDismissed(true);
      router.push({ pathname: "/(app)/financial-plan", params: { guided: "1" } });
      return;
    }
    const nextCommitment = pendingCommitments[0];
    if (nextCommitment) {
      openCommitmentPayment(nextCommitment);
      return;
    }
    finishPostImportGuide();
  }, [finishPostImportGuide, needsPlanningFlow, openCommitmentPayment, pendingCommitments]);

  return (
    <Animated.ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: getJourneyBottomContentInset(insets.bottom) }]}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScroll}
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Resumo</Text>
      </View>

      {loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Não foi possível atualizar</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={() => void loadObserved()} style={styles.errorButton}>
            <Text style={styles.errorButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : null}

      {busy && !summary ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={OB.primary} />
          <Text style={styles.loadingText}>Organizando seu mês...</Text>
        </View>
      ) : summary && hero && comparison ? (
        <>
          <ObservedMonthHero
            presentation={hero}
            onAddMovement={() => router.push("/(app)/new-transaction")}
            onImportStatement={() => router.push("/(app)/import-csv")}
          />
          <ObservedComparisonCard presentation={comparison} />
          {summary.dataQuality.isCurrentPeriodEmpty ? null : (
            <ObservedCategoryBreakdown
              rows={categoryRows}
              onOrganizeCategories={() => router.push("/(app)/categories")}
            />
          )}

          {showPlanningGuide ? (
            <View style={styles.guideCard}>
              <Text style={styles.guideTitle}>Extrato importado</Text>
              <Text style={styles.guideText}>Suas entradas e gastos já aparecem no resumo.</Text>
              {reconciledCommitments > 0 ? (
                <Text style={styles.guideNote}>
                  {reconciledCommitments} {reconciledCommitments === 1 ? "conta reconhecida" : "contas reconhecidas"} automaticamente.
                </Text>
              ) : null}
              <Pressable onPress={continuePostImportGuide} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>
                  {needsPlanningFlow ? "Preparar meu planejamento" : pendingCommitments.length ? "Registrar próximo pagamento" : "Ok, entendi"}
                </Text>
              </Pressable>
              <Pressable onPress={finishPostImportGuide} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Agora não</Text>
              </Pressable>
            </View>
          ) : null}

          <ObservedPlanningAccess
            overview={overview}
            pendingCommitments={pendingCommitments}
            confirmedCommitments={confirmedCommitments}
            canAllocate={Boolean(surplus && surplus.plannedFreeCents > 0)}
            onAllocate={openAllocation}
            onOpenCommitment={openCommitmentPayment}
          />
        </>
      ) : !householdId && !householdLoading ? (
        <Text style={styles.emptyText}>Conclua as primeiras etapas para criar sua estrutura financeira.</Text>
      ) : null}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: JOURNEY_HEADER_HEIGHT + 12,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 2,
  },
  title: { color: OB.primary, fontSize: 28, fontWeight: "900", flexShrink: 1 },
  loadingCard: {
    borderRadius: 22,
    padding: 28,
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  loadingText: { color: OB.support, fontSize: 13, fontWeight: "700" },
  errorCard: {
    borderRadius: 20,
    padding: 16,
    gap: 8,
    backgroundColor: "#FFF8F8",
    borderWidth: 1,
    borderColor: "rgba(163,63,63,0.22)",
  },
  errorTitle: { color: "#A33F3F", fontSize: 15, fontWeight: "900" },
  errorText: { color: OB.support, fontSize: 13, fontWeight: "700" },
  errorButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  errorButtonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  guideCard: {
    borderRadius: 22,
    padding: 18,
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  guideTitle: { color: OB.primary, fontSize: 20, fontWeight: "900" },
  guideText: { color: OB.support, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  guideNote: { color: "#168A59", fontSize: 13, fontWeight: "800" },
  primaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  primaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  secondaryButtonText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  emptyText: {
    color: OB.support,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 24,
  },
});
