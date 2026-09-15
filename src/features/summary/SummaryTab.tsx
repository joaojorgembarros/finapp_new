import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../lib/format";
import {
  FinancialCommitment,
  FinancialOverview,
  FinancialOverviewCommitment,
  getCycleForOffset,
  getFinancialOverview,
  getFinancialSettings,
  listCommitments,
} from "../../lib/financialPlanning";
import {
  formatShortDateFromYmd,
  getCommitmentPaymentProgress,
  sortPendingCommitments,
} from "../../lib/financialOverviewPresentation";
import {
  buildFutureMonthCards,
  buildIncomeBreakdown,
  buildObligationSurplus,
  detectSummarySetupGaps,
  groupCommittedMoney,
  shortCycleMonthLabel,
} from "../../lib/summaryPresentation";
import {
  JOURNEY_HEADER_HEIGHT,
  getJourneyBottomContentInset,
} from "../../ui/journeyChrome";
import { OB } from "../../ui/OnboardingKit";

const BAR_COLORS = {
  fixed: "#7BA0C8",
  debts: "#9A6B73",
  reserve: "#A8895A",
  free: "#5B8F7A",
} as const;

function previousDate(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const value = new Date(year, month - 1, day - 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function localDateYmd(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function routeCycleReference(cycleDate?: string) {
  if (!cycleDate) return new Date();
  const [year, month, day] = cycleDate.split("-").map(Number);
  const value = new Date(year, (month || 1) - 1, day || 1, 12);
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function SummaryTab({
  householdId,
  userId,
  householdLoading,
  cycleDate,
  onCycleDateChange,
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
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const paymentsSheetTopInset = Math.max(
    insets.top,
    Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0
  );
  const compactPaymentsSheet = viewportWidth < 360;
  const paymentsSheetHeight = Math.max(
    0,
    Math.min(viewportHeight * 0.9, viewportHeight - paymentsSheetTopInset - 12)
  );

  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [allCommitments, setAllCommitments] = useState<FinancialCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cycleOffset, setCycleOffset] = useState(0);
  const [reference, setReference] = useState(() => routeCycleReference(cycleDate));
  const [setupGuideDismissed, setSetupGuideDismissed] = useState(false);
  const [planningGuideStarted, setPlanningGuideStarted] = useState(false);
  const [paymentsModalOpen, setPaymentsModalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const loadTokenRef = useRef(0);
  const cycleDateRef = useRef(cycleDate);

  useEffect(() => {
    if (cycleDateRef.current === cycleDate) return;
    cycleDateRef.current = cycleDate;
    setReference(routeCycleReference(cycleDate));
    setCycleOffset(0);
  }, [cycleDate]);

  const load = useCallback(async () => {
    const loadToken = ++loadTokenRef.current;
    if (!householdId || !userId) {
      setOverview(null);
      setAllCommitments([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadError(null);
      const settings = await getFinancialSettings(householdId);
      const cycle = getCycleForOffset(settings, cycleOffset, reference);
      const [nextOverview, commitments] = await Promise.all([
        getFinancialOverview({ householdId, userId, cycle }),
        listCommitments(householdId, { includeArchived: true }),
      ]);
      if (loadToken === loadTokenRef.current) {
        setOverview(nextOverview);
        setAllCommitments(commitments);
        if (!postImportId) onCycleDateChange(nextOverview.cycle.start);
      }
    } catch (error: any) {
      if (loadToken === loadTokenRef.current) {
        const message = "Tente novamente em alguns instantes.";
        setLoadError(message);
        if (Platform.OS !== "web") {
          Alert.alert("Não foi possível carregar seus valores", error?.message ?? message);
        }
      }
    } finally {
      if (loadToken === loadTokenRef.current) setLoading(false);
    }
  }, [cycleOffset, householdId, onCycleDateChange, postImportId, reference, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const pendingCommitments = useMemo(
    () => sortPendingCommitments(overview?.commitments ?? []),
    [overview]
  );
  const confirmedCommitments = useMemo(
    () => overview?.commitments.filter((item) => item.pending_cents <= 0) ?? [],
    [overview]
  );

  const income = useMemo(
    () =>
      buildIncomeBreakdown({
        incomeFixedCents: overview?.expectedIncomeFixedCents,
        incomeVariableAvgCents: overview?.expectedIncomeVariableCents,
      }),
    [overview]
  );

  const committed = useMemo(
    () =>
      groupCommittedMoney({
        commitments: overview?.commitments ?? [],
        reserveCents: overview?.reserveCents ?? 0,
      }),
    [overview]
  );

  const surplus = useMemo(
    () =>
      buildObligationSurplus({
        expectedIncomeCents: overview?.expectedIncomeCents ?? 0,
        commitmentsTotalCents: committed.commitmentsTotalCents,
        reserveCents: committed.reserveCents,
        dreamsAllocatedCents: overview?.allocatedCents ?? 0,
      }),
    [committed, overview]
  );

  const futureMonths = useMemo(() => {
    if (!overview) return [];
    return buildFutureMonthCards({
      cycles: [0, 1, 2].map((offset) => ({
        ...getCycleForOffset(overview.settings, offset, reference),
        offset,
      })),
      commitments: allCommitments,
      expectedIncomeCents: overview.expectedIncomeCents,
      reserveCents: overview.reserveCents,
    });
  }, [allCommitments, overview, reference]);

  const gaps = useMemo(() => {
    if (!overview) {
      return detectSummarySetupGaps({
        income: { fixedCents: 0, variableCents: 0, totalCents: 0 },
        committed: {
          fixedBillsCents: 0,
          debtsAndInstallmentsCents: 0,
          reserveCents: 0,
          commitmentsTotalCents: 0,
          destinedTotalCents: 0,
          paidCommitmentsCents: 0,
          pendingCommitmentsCents: 0,
        },
        settingsUpdatedBy: null,
        cycleMode: "calendar",
        hasGoals: false,
      });
    }
    return detectSummarySetupGaps({
      income,
      committed,
      settingsUpdatedBy: overview.settings.updated_by,
      cycleMode: overview.settings.cycle_mode,
      hasGoals: overview.goals.length > 0,
    });
  }, [committed, income, overview]);

  const distribution = useMemo(() => {
    const segments = [
      { key: "fixed", label: "Contas", cents: committed.fixedBillsCents, color: BAR_COLORS.fixed },
      { key: "debts", label: "Dívidas", cents: committed.debtsAndInstallmentsCents, color: BAR_COLORS.debts },
      { key: "reserve", label: "Reserva", cents: committed.reserveCents, color: BAR_COLORS.reserve },
      { key: "free", label: "Livre", cents: surplus.plannedFreeCents, color: BAR_COLORS.free },
    ];
    const total = segments.reduce((sum, item) => sum + item.cents, 0);
    return {
      total,
      segments: segments
        .filter((item) => item.cents > 0 || total === 0)
        .map((item) => ({
          ...item,
          flex: total > 0 ? Math.max(item.cents / total, item.cents > 0 ? 0.08 : 0) : 1,
        })),
    };
  }, [committed, surplus.plannedFreeCents]);

  const postImportMatchesCycle = Boolean(
    overview
      && postImportId
      && overview.transactions.some((transaction) => transaction.statement_import_id === postImportId)
  );
  const needsPlanningSetup = Boolean(overview && overview.settings.updated_by === null);
  const needsPlanningFlow = needsPlanningSetup || planningGuideStarted;
  const showPlanningGuide = postImportMatchesCycle && !setupGuideDismissed;
  const postImportModeActive = Boolean(postImportId && !setupGuideDismissed);
  const busy = loading || householdLoading;
  const todayYmd = localDateYmd();
  const viewingCurrentCycle = overview
    ? overview.cycle.start <= todayYmd && overview.cycle.end > todayYmd
    : cycleOffset === 0;
  const primaryGap = gaps.missingIncome
    ? { label: "Cadastre sua renda", href: "/(app)/profile" as const }
    : gaps.missingFixedBills
      ? { label: "Adicione suas contas fixas", href: "/(app)/financial-plan" as const }
      : gaps.missingPaydayConfig
        ? { label: "Defina seu dia de recebimento", href: "/(app)/financial-plan" as const }
        : gaps.missingReserve
          ? { label: "Defina uma reserva mínima", href: "/(app)/financial-plan" as const }
          : null;

  useEffect(() => {
    setSetupGuideDismissed(false);
    setDetailsOpen(false);
  }, [overview?.cycle.key]);

  useEffect(() => {
    setPlanningGuideStarted(false);
  }, [postImportId]);

  useEffect(() => {
    if (overview && postImportId && !postImportMatchesCycle) onPostImportHandled();
  }, [onPostImportHandled, overview, postImportId, postImportMatchesCycle]);

  const changeCycle = useCallback((offset: number) => {
    loadTokenRef.current += 1;
    setLoading(true);
    setOverview(null);
    setLoadError(null);
    setCycleOffset((value) => value + offset);
  }, []);

  const showToday = useCallback(() => {
    const today = new Date();
    loadTokenRef.current += 1;
    setLoading(true);
    setOverview(null);
    setLoadError(null);
    setReference(today);
    setCycleOffset(0);
    onCycleDateChange(localDateYmd(today));
  }, [onCycleDateChange]);

  const openCommitmentPayment = useCallback(
    (commitment: FinancialOverviewCommitment) => {
      if (!overview) return;
      setPaymentsModalOpen(false);
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
    if (!overview || surplus.plannedFreeCents <= 0) return;
    router.push({
      pathname: "/(app)/allocate-surplus",
      params: {
        cycleKey: overview.cycle.key,
        cycleStart: overview.cycle.start,
        cycleEnd: overview.cycle.end,
        availableCents: String(Math.max(overview.availableCents, surplus.dayToDayCents)),
        cycleDate: overview.cycle.start,
      },
    });
  }, [overview, surplus]);

  const finishPostImportGuide = useCallback(() => {
    setSetupGuideDismissed(true);
    onPostImportHandled();
  }, [onPostImportHandled]);

  const continuePostImportGuide = useCallback(() => {
    if (busy) return;
    if (needsPlanningFlow) {
      setPlanningGuideStarted(true);
      router.push({ pathname: "/(app)/financial-plan", params: { guided: "1" } });
      return;
    }
    const nextCommitment = pendingCommitments[0];
    if (nextCommitment) {
      openCommitmentPayment(nextCommitment);
      return;
    }
    finishPostImportGuide();
  }, [busy, finishPostImportGuide, needsPlanningFlow, openCommitmentPayment, pendingCommitments]);

  function renderPaymentRow(commitment: FinancialOverviewCommitment) {
    const progress = getCommitmentPaymentProgress(commitment.amount_cents, commitment.paid_cents);
    const isPaid = progress.status === "Pago";
    const hasPartialPayment = progress.status === "Pago parcialmente";
    const actionLabel = isPaid || hasPartialPayment ? "Ver pagamento" : "Registrar pagamento";
    return (
      <View key={commitment.id} style={styles.paymentRow}>
        <Pressable
          onPress={() => openCommitmentPayment(commitment)}
          style={({ pressed }) => [styles.paymentMain, pressed && styles.pressed]}
        >
          <View style={[styles.paymentCheck, isPaid && styles.paymentCheckDone]}>
            <Ionicons name={isPaid ? "checkmark" : "receipt-outline"} size={17} color={isPaid ? "#fff" : OB.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.paymentName} numberOfLines={1}>{commitment.name}</Text>
            <Text style={styles.paymentMeta}>
              {commitment.installment_number && commitment.installments_total
                ? `Parcela ${commitment.installment_number}/${commitment.installments_total} · `
                : ""}
              Vence em {formatShortDateFromYmd(commitment.due_on)}
            </Text>
            <Text style={styles.paymentAmounts}>
              Total {formatBRLFromCents(progress.totalCents)} · Falta {formatBRLFromCents(progress.remainingCents)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={OB.support} />
        </Pressable>
        <Pressable
          onPress={() => openCommitmentPayment(commitment)}
          style={({ pressed }) => [styles.paymentAction, isPaid && styles.paymentActionDone, pressed && styles.pressed]}
        >
          <Text style={[styles.paymentActionText, isPaid && styles.paymentActionTextDone]}>{actionLabel}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Animated.ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: getJourneyBottomContentInset(insets.bottom) }]}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScroll}
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Resumo</Text>
        {!postImportModeActive ? (
          <View style={styles.cycleInline}>
            <Pressable onPress={() => changeCycle(-1)} hitSlop={10} accessibilityLabel="Período anterior">
              <Ionicons name="chevron-back" size={18} color={OB.primary} />
            </Pressable>
            <Text style={styles.cycleInlineLabel} numberOfLines={1}>
              {overview?.cycle.label ?? (loadError ? "Indisponível" : "Carregando...")}
            </Text>
            <Pressable onPress={() => changeCycle(1)} hitSlop={10} accessibilityLabel="Próximo período">
              <Ionicons name="chevron-forward" size={18} color={OB.primary} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {!postImportModeActive && !viewingCurrentCycle ? (
        <Pressable onPress={showToday} style={styles.todayButton}>
          <Text style={styles.todayButtonText}>Voltar ao ciclo atual</Text>
        </Pressable>
      ) : null}

      {loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Não foi possível atualizar</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={() => void load()} style={styles.errorButton}>
            <Text style={styles.errorButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : null}

      {busy && !overview ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={OB.primary} />
          <Text style={styles.loadingText}>Organizando seu ciclo...</Text>
        </View>
      ) : overview ? (
        showPlanningGuide ? (
          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>Extrato importado</Text>
            <Text style={styles.guideText}>Suas entradas e gastos estão no app.</Text>
            {reconciledCommitments > 0 ? (
              <Text style={styles.guideNote}>
                {reconciledCommitments} {reconciledCommitments === 1 ? "conta reconhecida" : "contas reconhecidas"} automaticamente.
              </Text>
            ) : null}
            <Pressable onPress={continuePostImportGuide} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>
                {needsPlanningFlow ? "Preparar meu resumo" : pendingCommitments.length ? "Registrar próximo pagamento" : "Ver meu resumo"}
              </Text>
            </Pressable>
            <Pressable onPress={finishPostImportGuide} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Agora não</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>Livre para você</Text>
              <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
                {formatBRLFromCents(surplus.plannedFreeCents)}
              </Text>
              <View style={styles.heroMeta}>
                <Text style={styles.heroMetaText}>Entra: {formatBRLFromCents(income.totalCents)}</Text>
                <Text style={styles.heroMetaDot}>·</Text>
                <Text style={styles.heroMetaText}>Comprometido: {formatBRLFromCents(committed.destinedTotalCents)}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Como seu dinheiro se distribui</Text>
              <View style={styles.barTrack}>
                {distribution.segments.map((segment) => (
                  <View
                    key={segment.key}
                    style={[styles.barSegment, { flex: segment.flex, backgroundColor: segment.color }]}
                  />
                ))}
              </View>
              <View style={styles.legend}>
                {distribution.segments.map((segment) => (
                  <View key={segment.key} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
                    <Text style={styles.legendText}>
                      {segment.label} {formatBRLFromCents(segment.cents)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Da sua parte livre</Text>
              <View style={styles.splitRow}>
                <View style={styles.splitCard}>
                  <Text style={styles.splitLabel}>Sonhos</Text>
                  <Text style={styles.splitValue}>{formatBRLFromCents(surplus.dreamsAllocatedCents)}</Text>
                  <Text style={styles.splitHint}>já guardado</Text>
                </View>
                <View style={styles.splitCard}>
                  <Text style={styles.splitLabel}>Seu mês</Text>
                  <Text style={styles.splitValue}>{formatBRLFromCents(surplus.dayToDayCents)}</Text>
                  <Text style={styles.splitHint}>para o dia a dia</Text>
                </View>
              </View>
            </View>

            <Pressable
              onPress={() => setDetailsOpen((open) => !open)}
              style={({ pressed }) => [styles.detailsToggle, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOpen }}
            >
              <Text style={styles.detailsToggleText}>{detailsOpen ? "Ocultar detalhes" : "Ver detalhes"}</Text>
              <Ionicons name={detailsOpen ? "chevron-up" : "chevron-down"} size={18} color={OB.primary} />
            </Pressable>

            {detailsOpen ? (
              <View style={styles.card}>
                <Text style={styles.detailsSectionTitle}>Renda</Text>
                <DetailRow label="Renda fixa" value={formatBRLFromCents(income.fixedCents)} />
                <DetailRow label="Variável estimada" value={formatBRLFromCents(income.variableCents)} />
                <DetailRow label="Já entrou" value={formatBRLFromCents(overview.realizedIncomeCents)} />
                <DetailRow label="Ainda esperado" value={formatBRLFromCents(overview.remainingExpectedIncomeCents)} />

                <Text style={[styles.detailsSectionTitle, styles.detailsSectionSpaced]}>Compromissos</Text>
                <DetailRow label="Já pago" value={formatBRLFromCents(committed.paidCommitmentsCents)} />
                <DetailRow label="Ainda precisa sair" value={formatBRLFromCents(committed.pendingCommitmentsCents)} />
                <DetailRow
                  label="Previsão do ciclo"
                  value={formatBRLFromCents(overview.periodEndForecastCents)}
                />

                <Text style={[styles.detailsSectionTitle, styles.detailsSectionSpaced]}>Próximos meses</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthsRow}>
                  {futureMonths.map((month) => (
                    <View key={month.cycle.key} style={[styles.monthCard, month.offset === 0 && styles.monthCardActive]}>
                      <Text style={styles.monthEyebrow}>
                        {month.offset === 0 ? "Agora" : shortCycleMonthLabel(month.cycle.start)}
                      </Text>
                      <Text style={styles.monthFree}>{formatBRLFromCents(month.plannedFreeCents)}</Text>
                      <Text style={styles.monthLine}>entra {formatBRLFromCents(month.expectedIncomeCents)}</Text>
                      <Text style={styles.monthLine}>sai {formatBRLFromCents(month.destinedTotalCents)}</Text>
                    </View>
                  ))}
                </ScrollView>
                {overview ? (
                  <Text style={styles.cycleRange}>
                    Ciclo atual: {formatDateBRFromYMD(overview.cycle.start)} a {formatDateBRFromYMD(previousDate(overview.cycle.end))}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable onPress={() => setPaymentsModalOpen(true)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Revisar pagamentos</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/(app)/financial-plan")} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Planejar meu dinheiro</Text>
              </Pressable>
              {surplus.plannedFreeCents > 0 ? (
                <Pressable onPress={openAllocation} style={styles.textAction}>
                  <Text style={styles.textActionText}>Guardar para um sonho</Text>
                </Pressable>
              ) : null}
              {primaryGap ? (
                <Pressable onPress={() => router.push(primaryGap.href)} style={styles.textAction}>
                  <Text style={styles.textActionText}>{primaryGap.label}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )
      ) : !householdId && !householdLoading ? (
        <Text style={styles.emptyText}>Conclua as primeiras etapas para criar sua estrutura financeira.</Text>
      ) : null}

      <Modal
        visible={paymentsModalOpen}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent={Platform.OS === "android"}
        navigationBarTranslucent={Platform.OS === "android"}
        onRequestClose={() => setPaymentsModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable onPress={() => setPaymentsModalOpen(false)} style={StyleSheet.absoluteFill} accessible={false} />
          <View style={[styles.modalSheet, { height: paymentsSheetHeight, marginTop: paymentsSheetTopInset + 12 }]}>
            <View style={[styles.modalHeader, compactPaymentsSheet && styles.modalHeaderCompact]}>
              <Text style={styles.modalTitle}>Revisar pagamentos</Text>
              <Pressable onPress={() => setPaymentsModalOpen(false)} style={styles.modalClose}>
                <Ionicons name="close" size={20} color={OB.primary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              {pendingCommitments.length ? (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Pendentes</Text>
                  {pendingCommitments.map(renderPaymentRow)}
                </View>
              ) : null}
              {confirmedCommitments.length ? (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Já pagos</Text>
                  {confirmedCommitments.map(renderPaymentRow)}
                </View>
              ) : null}
              {!pendingCommitments.length && !confirmedCommitments.length ? (
                <Text style={styles.emptyText}>Não há pagamentos para revisar neste período.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  cycleInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "58%",
  },
  cycleInlineLabel: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    flexShrink: 1,
  },
  todayButton: {
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  todayButtonText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
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
  heroCard: {
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 22,
    gap: 10,
    backgroundColor: OB.primary,
  },
  heroEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  heroValue: { color: "#fff", fontSize: 44, fontWeight: "900" },
  heroMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  heroMetaText: { color: OB.textOnDarkMid, fontSize: 13, fontWeight: "700" },
  heroMetaDot: { color: OB.textOnDarkMid, fontSize: 13, fontWeight: "700" },
  card: {
    borderRadius: 22,
    padding: 16,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  cardTitle: { color: OB.primary, fontSize: 16, fontWeight: "900" },
  barTrack: {
    height: 14,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: OB.offWhite,
  },
  barSegment: { height: "100%" },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
  legendText: { color: OB.primary, fontSize: 12, fontWeight: "700" },
  splitRow: { flexDirection: "row", gap: 10 },
  splitCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    gap: 4,
    backgroundColor: OB.offWhite,
  },
  splitLabel: { color: OB.support, fontSize: 12, fontWeight: "800" },
  splitValue: { color: OB.primary, fontSize: 20, fontWeight: "900" },
  splitHint: { color: OB.support, fontSize: 11, fontWeight: "700" },
  detailsToggle: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  detailsToggleText: { color: OB.primary, fontSize: 14, fontWeight: "800" },
  detailsSectionTitle: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  detailsSectionSpaced: { marginTop: 8 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  detailLabel: { color: OB.support, fontSize: 13, fontWeight: "700" },
  detailValue: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  monthsRow: { gap: 8, paddingVertical: 2 },
  monthCard: {
    width: 118,
    borderRadius: 14,
    padding: 10,
    gap: 2,
    backgroundColor: OB.offWhite,
  },
  monthCardActive: {
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  monthEyebrow: { color: OB.support, fontSize: 10, fontWeight: "900" },
  monthFree: { color: OB.primary, fontSize: 15, fontWeight: "900", marginTop: 2 },
  monthLine: { color: OB.support, fontSize: 11, fontWeight: "700" },
  cycleRange: { color: OB.support, fontSize: 11, fontWeight: "700", marginTop: 4 },
  actions: { gap: 8, paddingBottom: 8 },
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
  textAction: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  textActionText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  emptyText: {
    color: OB.support,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 24,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: OB.modalScrim,
  },
  modalSheet: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  modalHeaderCompact: { paddingHorizontal: 12 },
  modalTitle: { flex: 1, color: OB.primary, fontSize: 20, fontWeight: "900" },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  modalContent: { padding: 16, gap: 16, paddingBottom: 28 },
  modalSection: { gap: 10 },
  modalSectionTitle: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  paymentRow: {
    borderRadius: 16,
    padding: 12,
    gap: 10,
    backgroundColor: OB.offWhite,
  },
  paymentMain: { flexDirection: "row", alignItems: "center", gap: 10 },
  paymentCheck: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  paymentCheckDone: { backgroundColor: "#168A59" },
  paymentName: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  paymentMeta: { color: OB.support, fontSize: 12, fontWeight: "700", marginTop: 2 },
  paymentAmounts: { color: OB.primary, fontSize: 12, fontWeight: "800", marginTop: 4 },
  paymentAction: {
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  paymentActionDone: { backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  paymentActionText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  paymentActionTextDone: { color: OB.primary },
  pressed: { opacity: 0.82 },
});
