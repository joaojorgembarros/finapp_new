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
  loadFinancialKnownCashPosition,
  type FinancialKnownCashPosition,
} from "../../lib/financialCashPosition";
import { buildKnownCashCard } from "../../lib/knownCashPresentation";
import {
  FinancialOverview,
  FinancialOverviewCommitment,
  getCycleForOffset,
  getFinancialOverview,
  getFinancialSettings,
} from "../../lib/financialPlanning";
import {
  buildFinancialObservedHistory,
  coversObservedHistoryRange,
  loadObservedHistoryTransactions,
  observedHistoryFetchStart,
  type ObservedHistoryRange,
} from "../../lib/financialObservedHistory";
import {
  type FinancialObservedSummary,
  type ObservedSummaryTransaction,
} from "../../lib/financialObservedSummary";
import { loadObservedSummaryForUi } from "../../lib/observedSummaryLoad";
import { sortPendingCommitments } from "../../lib/financialOverviewPresentation";
import { commitmentPaymentParams } from "../planning/planningCycleActions";
import {
  buildObservedCategoryRows,
  buildObservedComparison,
  buildObservedMonthHero,
} from "../../lib/observedSummaryPresentation";
import {
  buildObservedHistoryMonthRows,
  buildObservedHistoryPeriod,
  observedHistoryGapNote,
} from "../../lib/observedHistoryPresentation";
import {
  JOURNEY_HEADER_HEIGHT,
  getJourneyBottomContentInset,
} from "../../ui/journeyChrome";
import { OB } from "../../ui/OnboardingKit";
import { ObservedCategoryBreakdown } from "./ObservedCategoryBreakdown";
import { ObservedComparisonCard } from "./ObservedComparisonCard";
import { ObservedHistoryHero } from "./ObservedHistoryHero";
import { ObservedKnownCashCard } from "./ObservedKnownCashCard";
import { ObservedHistoryRangeSelector } from "./ObservedHistoryRangeSelector";
import { ObservedMonthHero } from "./ObservedMonthHero";
import { ObservedMonthSeries } from "./ObservedMonthSeries";

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
  const [range, setRange] = useState<ObservedHistoryRange>("month");
  const [observedTransactions, setObservedTransactions] = useState<ObservedSummaryTransaction[]>([]);
  const [observedReferenceDate, setObservedReferenceDate] = useState<string | null>(null);
  const [coverageStart, setCoverageStart] = useState<string | null>(null);
  const [knownCategoryIds, setKnownCategoryIds] = useState<ReadonlySet<string>>(new Set());
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cashPosition, setCashPosition] = useState<FinancialKnownCashPosition | null>(null);
  const [cashStatus, setCashStatus] = useState<"loading" | "ready" | "error">("loading");
  const [setupGuideDismissed, setSetupGuideDismissed] = useState(false);
  const loadTokenRef = useRef(0);
  const cashTokenRef = useRef(0);
  const rangeRef = useRef(range);
  const appliedRangeRef = useRef(range);
  const observedReferenceDateRef = useRef<string | null>(null);
  rangeRef.current = range;

  const loadObserved = useCallback(async (reason: "focus" | "range") => {
    const loadToken = ++loadTokenRef.current;
    if (!householdId) {
      setSummary(null);
      setObservedTransactions([]);
      setObservedReferenceDate(null);
      setCoverageStart(null);
      observedReferenceDateRef.current = null;
      setKnownCategoryIds(new Set());
      setLoadError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadError(null);
      const selectedRange = rangeRef.current;
      const referenceDate = reason === "range" && observedReferenceDateRef.current
        ? observedReferenceDateRef.current
        : ymd(new Date());
      const fetchStart = observedHistoryFetchStart(referenceDate, selectedRange);
      const transactions = await loadObservedHistoryTransactions({
        householdId,
        referenceDate,
        range: selectedRange,
      });
      const loaded = await loadObservedSummaryForUi({
        referenceDate,
        loadTransactions: async () => transactions,
        loadCategories: async () => {
          const categories = await listCategories(householdId);
          return categories.map((category) => ({ id: category.id, name: category.name }));
        },
      });
      if (loadToken !== loadTokenRef.current) return;
      observedReferenceDateRef.current = referenceDate;
      setObservedReferenceDate(referenceDate);
      setCoverageStart(fetchStart);
      setObservedTransactions(transactions);
      setKnownCategoryIds(new Set(loaded.knownCategoryIds));
      setSummary(loaded.summary);
    } catch (error: any) {
      if (loadToken !== loadTokenRef.current) return;
      const message = "Tente novamente em alguns instantes.";
      if (reason === "focus") setSummary(null);
      setLoadError(message);
      if (Platform.OS !== "web") {
        Alert.alert("Não foi possível carregar seu resumo", error?.message ?? message);
      }
    } finally {
      if (loadToken === loadTokenRef.current) setLoading(false);
    }
  }, [householdId]);

  const loadKnownCash = useCallback(async () => {
    const cashToken = ++cashTokenRef.current;
    if (!householdId) {
      setCashPosition(null);
      setCashStatus("ready");
      return;
    }
    setCashStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const position = await loadFinancialKnownCashPosition({
        householdId,
        referenceDate: ymd(new Date()),
      });
      if (cashToken !== cashTokenRef.current) return;
      setCashPosition(position);
      setCashStatus("ready");
    } catch {
      if (cashToken !== cashTokenRef.current) return;
      setCashPosition(null);
      setCashStatus("error");
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
      void loadObserved("focus");
      void loadKnownCash();
      void loadPlanning();
    }, [loadKnownCash, loadObserved, loadPlanning])
  );

  useEffect(() => {
    if (appliedRangeRef.current === range) return;
    appliedRangeRef.current = range;
    if (
      observedReferenceDate
      && coverageStart
      && coversObservedHistoryRange(coverageStart, observedReferenceDate, range)
    ) {
      return;
    }
    void loadObserved("range");
  }, [coverageStart, loadObserved, observedReferenceDate, range]);

  useEffect(() => {
    setSetupGuideDismissed(false);
  }, [postImportId]);

  const pendingCommitments = useMemo(
    () => sortPendingCommitments(overview?.commitments ?? []),
    [overview]
  );

  const history = useMemo(() => {
    if (!observedReferenceDate || !coverageStart) return null;
    if (!coversObservedHistoryRange(coverageStart, observedReferenceDate, range)) return null;
    return buildFinancialObservedHistory({
      transactions: observedTransactions,
      referenceDate: observedReferenceDate,
      range,
    });
  }, [coverageStart, observedReferenceDate, observedTransactions, range]);
  const historyPeriod = history && range !== "month" ? buildObservedHistoryPeriod(history) : null;
  const historyRows = history && range !== "month" ? buildObservedHistoryMonthRows(history) : [];
  const historyGapNote = history && range !== "month" ? observedHistoryGapNote(history) : null;

  const cashCard = buildKnownCashCard({
    status: cashStatus,
    position: cashPosition,
  });

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
        params: commitmentPaymentParams(overview, commitment),
      });
    },
    [overview]
  );

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
          <Pressable onPress={() => void loadObserved("focus")} style={styles.errorButton}>
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
          <ObservedHistoryRangeSelector range={range} onChange={setRange} />
          {range === "month" ? (
            <ObservedMonthHero
              presentation={hero}
              onAddMovement={() => router.push("/(app)/new-transaction")}
              onImportStatement={() => router.push("/(app)/import-csv")}
            />
          ) : historyPeriod ? (
            <ObservedHistoryHero presentation={historyPeriod} />
          ) : loadError ? null : (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={OB.primary} />
              <Text style={styles.loadingText}>Organizando o período...</Text>
            </View>
          )}
          <ObservedKnownCashCard presentation={cashCard} onRetry={() => void loadKnownCash()} />
          {range === "month" ? (
            <>
              <ObservedComparisonCard presentation={comparison} />
              {summary.dataQuality.isCurrentPeriodEmpty ? null : (
                <ObservedCategoryBreakdown
                  rows={categoryRows}
                  onOrganizeCategories={() => router.push("/(app)/categories")}
                />
              )}
            </>
          ) : history?.dataQuality.hasAnyData ? (
            <ObservedMonthSeries rows={historyRows} gapNote={historyGapNote} />
          ) : null}

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
