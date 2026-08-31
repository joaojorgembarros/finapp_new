import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, BackHandler, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, ToastAndroid, useWindowDimensions, View } from "react-native";
import { BlurView } from "expo-blur";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { Category } from "../../src/lib/categories";
import { listTransactionsByMonth } from "../../src/lib/transactions";
import {
  TransactionAccountId,
  TransactionAccountOption,
} from "../../src/lib/banks";
import { GoalProgress, listGoalsWithProgress, syncGoalsFromDreams } from "../../src/lib/goals";
import { MountainHero } from "../../src/features/journey/MountainHero";
import { DreamIcon } from "../../src/features/journey/DreamIcon";
import { getAndroidBackAction } from "../../src/lib/androidBack";
import { BankLogo } from "../../src/ui/BankLogo";
import MovementsScreen from "./transaction-history";
import {
  FinancialOverview,
  FinancialOverviewCommitment,
  getCycleForOffset,
  getFinancialOverview,
  getFinancialSettings,
  setCommitmentPaid,
} from "../../src/lib/financialPlanning";

type Tab = "controle" | "jornada" | "movimentacoes" | "desafios";
type MenuIcon = keyof typeof Ionicons.glyphMap;
type TxType = "Receita" | "Despesa";
type TxDraft = { type: TxType; description: string; categoryId: string | null; accountId: TransactionAccountId; amount: number };

const MAIN_NAVIGATION_ITEMS: readonly { id: Tab; label: string; icon: MenuIcon }[] = [
  { id: "jornada", label: "Sonhos", icon: "compass-outline" },
  { id: "movimentacoes", label: "Movimentações", icon: "swap-vertical-outline" },
  { id: "controle", label: "Resumo", icon: "bar-chart-outline" },
  { id: "desafios", label: "Desafios", icon: "trophy-outline" },
];

const WEB_DRAWER_BLUR_STYLE =
  Platform.OS === "web"
    ? ({
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      } as any)
    : null;
const ANDROID_BACK_PRESS_WINDOW_MS = 2500;

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function progressLabel(progress: number) {
  const pct = clampProgress(progress);
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

function readJson<T>(raw: string | string[] | undefined, fallback: T): T {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function initialsFrom(nameOrEmail: string) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  if (s.includes("@")) return (s.split("@")[0]?.slice(0, 2) || "U").toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return (parts[0].slice(0, 2) || "U").toUpperCase();
  return `${parts[0]?.[0] ?? "U"}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function ProgressCard({ goal, onOpen }: { goal: GoalProgress; onOpen: () => void }) {
  const progress = clampProgress((goal.contributed_cents / Math.max(goal.target_cents, 1)) * 100);
  const completed = progress >= 100;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Abrir sonho ${goal.title}`}
      style={({ pressed }) => [styles.goalCard, completed && styles.goalCardCompleted, pressed && styles.goalCardPressed]}
    >
      <DreamIcon
        title={goal.title}
        completed={completed}
        imageUri={goal.cover_photo_url}
      />
      <View style={styles.goalInfo}>
        <Text style={styles.goalTitle}>{goal.title}</Text>
        <Text style={[styles.goalValue, completed && styles.goalValueCompleted]}>{completed && goal.completed_on ? `Concluído em ${formatDate(goal.completed_on)}` : `${formatBRLFromCents(goal.contributed_cents)} de ${formatBRLFromCents(goal.target_cents)}`}</Text>
        <View style={[styles.smallTrack, completed && styles.smallTrackCompleted]}><View style={[styles.smallFill, completed && styles.smallFillCompleted, { width: `${progress}%` }]} /></View>
      </View>
      <View style={[styles.ring, completed && styles.ringCompleted]}>{completed ? <Ionicons name="checkmark" size={21} color="#169B62" /> : <Text style={styles.ringText}>{progressLabel(progress)}</Text>}</View>
    </Pressable>
  );
}
function MoneySummaryRow({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: MenuIcon;
  color: string;
}) {
  return (
    <View style={styles.moneySummaryRow}>
      <View style={[styles.moneySummaryIcon, { backgroundColor: `${color}16` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.moneySummaryCopy}>
        <Text style={styles.moneySummaryLabel}>{label}</Text>
        <Text
          style={[styles.moneySummaryValue, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {formatBRLFromCents(value)}
        </Text>
      </View>
    </View>
  );
}

export function AddModal({
  visible,
  categories,
  accountOptions,
  defaultAccountId,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  categories: Category[];
  accountOptions: TransactionAccountOption[];
  defaultAccountId: TransactionAccountId | null;
  saving: boolean;
  onClose: () => void;
  onSave: (tx: TxDraft) => Promise<boolean>;
}) {
  const insets = useSafeAreaInsets();
  const androidStatusBar = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
  const topInset = Math.max(insets.top, androidStatusBar, 18);
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<"amount" | "description">(18);
  const [type, setType] = useState<TxType>("Receita");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<TransactionAccountId | null>(defaultAccountId);
  const availableCategories = useMemo(() => categories.filter((item) => item.flow === (type === "Receita" ? "income" : "expense")), [categories, type]);

  useEffect(() => {
    if (!availableCategories.some((item) => item.id === categoryId)) {
      setCategoryId(availableCategories[0]?.id ?? null);
    }
  }, [availableCategories, categoryId]);

  useEffect(() => {
    if (accountId && accountOptions.some((account) => account.id === accountId)) return;
    setAccountId(defaultAccountId && accountOptions.some((account) => account.id === defaultAccountId) ? defaultAccountId : null);
  }, [accountId, accountOptions, defaultAccountId]);

  function changeType(next: TxType) {
    setType(next);
    setCategoryId(null);
  }

  async function save() {
    const cents = parseBRLToCents(amount);
    if (!cents || !desc.trim() || !accountId || saving) return;
    const saved = await onSave({ type, amount: cents, description: desc.trim(), categoryId, accountId });
    if (!saved) return;
    setAmount("");
    setDesc("");
    onClose();
  }
  function openImportStatement() {
    onClose();
    router.push("/(app)/import-extract");
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent={Platform.OS === "android"}
      navigationBarTranslucent={Platform.OS === "android"}
      onRequestClose={onClose}
    >
      <StatusBar barStyle="dark-content" backgroundColor={OB.offWhite} translucent />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalShade}>
        <View style={styles.sheet}>
          <View pointerEvents="none" style={[styles.modalSafeTop, { height: topInset + 8 }]} />
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            keyboardDismissMode="none"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={cancelPendingScroll}
            contentContainerStyle={[
              styles.sheetContent,
              {
                paddingTop: topInset + 16,
                paddingBottom: Math.max(insets.bottom, 18) + 28 + keyboardInset,
              },
            ]}
          >
            <View style={styles.sheetHero}>
              <Pressable onPress={onClose} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="Fechar">
                <Ionicons name="close" size={21} color="#fff" />
              </Pressable>
              <Text style={styles.sheetEyebrow}>Movimentações</Text>
              <Text style={styles.sheetTitle}>Novo lançamento</Text>
              <Text style={styles.sheetSubtitle}>Registre entradas e saídas com clareza.</Text>
            </View>

            <Pressable onPress={openImportStatement} style={styles.importStatementButton}>
              <View style={styles.importStatementIcon}>
                <Ionicons name="cloud-upload-outline" size={18} color={OB.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.importStatementTitle}>Importar extrato</Text>
                <Text style={styles.importStatementText}>Carregue movimentações do banco por arquivo</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={OB.support} />
            </Pressable>

            <View style={styles.typeTabs}>
              {(["Receita", "Despesa"] as TxType[]).map((item) => {
                const active = item === type;
                return (
                  <Pressable key={item} onPress={() => changeType(item)} style={[styles.typeTab, active && styles.typeTabActive]}>
                    <Text style={[styles.typeTabText, active && styles.typeTabTextActive]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>{type === "Receita" ? "Onde o dinheiro entrou?" : "De onde o dinheiro saiu?"}</Text>
            <View style={styles.accountPanel}>
              {accountOptions.map((account) => {
                const active = account.id === accountId;
                return (
                  <Pressable
                    key={account.id}
                    onPress={() => setAccountId(account.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[styles.accountOption, active && styles.accountOptionActive]}
                  >
                    <BankLogo bankId={account.id} size={34} color={account.color} shortName={account.shortName} />
                    <Text numberOfLines={1} style={[styles.accountOptionText, active && styles.accountOptionTextActive]}>{account.name}</Text>
                    {active ? <Ionicons name="checkmark-circle" size={17} color="#fff" /> : null}
                  </Pressable>
                );
              })}
            </View>
            {!accountId ? <Text style={styles.accountRequiredText}>Escolha uma conta para continuar.</Text> : null}

            <View onLayout={registerField("amount")}>
              <Text style={styles.fieldLabel}>Valor</Text>
              <View style={styles.inputBox}>
                <Text style={styles.currency}>R$</Text>
                <TextInput value={amount.replace("R$", "").trim()} onChangeText={(text) => setAmount(formatBRLInputFromDigits(text))} placeholder="0,00" placeholderTextColor={OB.support} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus onFocus={() => focusField("amount")} onPressIn={() => focusField("amount")} onSubmitEditing={Keyboard.dismiss} style={styles.input} />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Categoria</Text>
            <View style={styles.categoryPanel}>
              {availableCategories.map((item) => {
                const active = item.id === categoryId;
                return (
                  <Pressable key={item.id} onPress={() => setCategoryId(item.id)} style={[styles.category, active && styles.categoryActive]}>
                    {active ? <Ionicons name="checkmark-circle" size={15} color="#fff" /> : null}
                    <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{item.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={styles.descriptionField}
              onLayout={registerField("description")}
            >
              <Text style={styles.fieldLabel}>Descrição</Text>
              <TextInput
                value={desc}
                onChangeText={setDesc}
                onFocus={() => focusField("description")}
                onPressIn={() => focusField("description")}
                placeholder="Ex: compra mercado"
                placeholderTextColor={OB.support}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                style={styles.inputBoxText}
              />
            </View>

            <Pressable onPress={save} disabled={saving || !parseBRLToCents(amount) || !desc.trim() || !accountId} style={[styles.saveButton, (saving || !parseBRLToCents(amount) || !desc.trim() || !accountId) && styles.saveButtonDisabled]}>
              <Text style={[styles.saveButtonText, (saving || !parseBRLToCents(amount) || !desc.trim() || !accountId) && styles.saveButtonTextDisabled]}>{saving ? "Salvando..." : "Salvar lançamento"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function routeCycleReference(cycleDate?: string) {
  const match = cycleDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

function previousDate(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const value = new Date(year, month - 1, day - 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function localDateYmd(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ControlPanel({
  householdId,
  userId,
  householdLoading,
  cycleDate,
  onCycleDateChange,
  postImportId,
  reconciledCommitments = 0,
  onPostImportHandled,
}: {
  householdId: string | null;
  userId: string | null;
  householdLoading: boolean;
  cycleDate?: string;
  onCycleDateChange: (cycleDate: string) => void;
  postImportId?: string;
  reconciledCommitments?: number;
  onPostImportHandled: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const paymentsSheetTopInset = Math.max(
    insets.top,
    Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0
  );
  const compactPaymentsSheet = viewportWidth < 360;
  const widePaymentsSheet = viewportWidth >= 720;
  const paymentsSheetHeight = Math.max(
    0,
    Math.min(
      viewportHeight * (widePaymentsSheet ? 0.82 : 0.9),
      widePaymentsSheet ? 760 : viewportHeight,
      viewportHeight - paymentsSheetTopInset - 12
    )
  );
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cycleOffset, setCycleOffset] = useState(0);
  const [reference, setReference] = useState(() => routeCycleReference(cycleDate));
  const [setupGuideDismissed, setSetupGuideDismissed] = useState(false);
  const [planningGuideStarted, setPlanningGuideStarted] = useState(false);
  const [paymentsModalOpen, setPaymentsModalOpen] = useState(false);
  const [updatingCommitmentId, setUpdatingCommitmentId] = useState<string | null>(null);
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
      setLoadError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadError(null);
      const settings = await getFinancialSettings(householdId);
      const cycle = getCycleForOffset(settings, cycleOffset, reference);
      const nextOverview = await getFinancialOverview({ householdId, userId, cycle });
      if (loadToken === loadTokenRef.current) {
        setOverview(nextOverview);
        if (!postImportId) onCycleDateChange(nextOverview.cycle.start);
      }
    } catch (error: any) {
      if (loadToken === loadTokenRef.current) {
        const message = "Tente novamente em alguns instantes.";
        setLoadError(message);
        if (Platform.OS !== "web") Alert.alert("Não foi possível carregar seus valores", error?.message ?? message);
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

  const pendingCommitments = useMemo(() => overview?.commitments.filter((item) => item.pending_cents > 0) ?? [], [overview]);
  const confirmedCommitments = useMemo(() => overview?.commitments.filter((item) => item.pending_cents <= 0) ?? [], [overview]);
  const visiblePendingCommitments = pendingCommitments.slice(0, 3);
  const postImportMatchesCycle = Boolean(overview && postImportId && overview.transactions.some((transaction) => transaction.statement_import_id === postImportId));
  const needsPlanningSetup = Boolean(overview && overview.settings.updated_by === null);
  const needsPlanningFlow = needsPlanningSetup || planningGuideStarted;
  const showPlanningGuide = postImportMatchesCycle && !setupGuideDismissed;
  const postImportModeActive = Boolean(postImportId && !setupGuideDismissed);
  const busy = loading || householdLoading;
  const emptyStyle = { color: "#5E7591", fontSize: 14, fontWeight: "700" as const, paddingVertical: 24, textAlign: "center" as const };
  const todayYmd = localDateYmd();
  const viewingCurrentCycle = overview ? overview.cycle.start <= todayYmd && overview.cycle.end > todayYmd : cycleOffset === 0;

  useEffect(() => {
    setSetupGuideDismissed(false);
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

  const toggleCommitment = useCallback(async (commitment: FinancialOverviewCommitment) => {
    if (!householdId || !userId || !overview) return;
    const isPaid = commitment.pending_cents <= 0;

    if (!isPaid) {
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
      return;
    }

    const persist = async () => {
      try {
        setUpdatingCommitmentId(commitment.id);
        await setCommitmentPaid({
          householdId,
          userId,
          commitmentId: commitment.id,
          cycleKey: overview.cycle.key,
          paid: false,
          amountCents: commitment.amount_cents,
        });
        await load();
      } catch (error: any) {
        const message = error?.message ?? "Não foi possível atualizar este pagamento.";
        if (Platform.OS === "web") setLoadError(message);
        else Alert.alert("Pagamento", message);
      } finally {
        setUpdatingCommitmentId(null);
      }
    };

    if (Platform.OS === "web") {
      const confirmed = typeof globalThis.confirm === "function"
        ? globalThis.confirm("Desfazer pagamento? Esta conta voltará a aparecer como pendente neste período. A movimentação original será preservada.")
        : false;
      if (confirmed) await persist();
      return;
    }

    Alert.alert(
      "Desfazer pagamento?",
      "Esta conta voltará a aparecer como pendente neste período. A movimentação original continuará em Movimentações.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Desfazer", style: "destructive", onPress: () => void persist() },
      ]
    );
  }, [householdId, load, overview, userId]);

  const openAllocation = useCallback(() => {
    if (!overview || overview.availableCents <= 0) return;
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
  }, [overview]);

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
      void toggleCommitment(nextCommitment);
      return;
    }
    finishPostImportGuide();
  }, [busy, finishPostImportGuide, needsPlanningFlow, pendingCommitments, toggleCommitment]);

  const openImportedTransactions = useCallback(() => {
    if (!postImportId) return;
    router.setParams({ tab: "movimentacoes", importId: postImportId });
  }, [postImportId]);

  const availabilityMessage = !overview
    ? ""
    : overview.availableCents > 0
      ? "Depois das contas, do valor que você quer manter e do que já guardou."
      : overview.resultCents < 0
        ? `Neste período, saiu ${formatBRLFromCents(Math.abs(overview.resultCents))} a mais do que entrou.`
        : overview.pendingCommitmentsCents > 0
          ? `Há ${formatBRLFromCents(overview.pendingCommitmentsCents)} em contas que ainda não foram registradas como pagas.`
          : "Ainda não há uma sobra livre neste período.";

  const commitmentsDescription = !overview
    ? ""
    : !overview.commitments.length
      ? "Nenhuma conta cadastrada neste período"
      : pendingCommitments.length
        ? `${pendingCommitments.length} ${pendingCommitments.length === 1 ? "pagamento ainda não foi registrado" : "pagamentos ainda não foram registrados"} · ${formatBRLFromCents(overview.pendingCommitmentsCents)}`
        : "Todos os pagamentos do mês foram registrados";

  function renderPaymentRow(commitment: FinancialOverviewCommitment) {
    const isPaid = commitment.pending_cents <= 0;
    const hasPartialPayment = !isPaid && commitment.paid_cents > 0;
    const updating = updatingCommitmentId === commitment.id;
    return (
      <View key={commitment.id} style={styles.commitmentRow}>
        <View style={styles.commitmentMainRow}>
          <View style={[styles.commitmentCheck, isPaid && styles.commitmentCheckPaid]}>
            <Ionicons name={isPaid ? "checkmark" : "receipt-outline"} size={17} color={isPaid ? "#fff" : OB.primary} />
          </View>
          <View style={styles.commitmentInfo}>
            <View style={styles.commitmentTitleRow}>
              <Text style={[styles.commitmentName, isPaid && styles.commitmentNamePaid]} numberOfLines={1}>{commitment.name}</Text>
              <View style={[styles.commitmentStatus, isPaid && styles.commitmentStatusPaid]}>
                <Text style={[styles.commitmentStatusText, isPaid && styles.commitmentStatusTextPaid]}>{isPaid ? "Pago" : "Pendente"}</Text>
              </View>
            </View>
            <Text style={styles.commitmentMeta}>
              {commitment.installment_number && commitment.installments_total
                ? `Parcela ${commitment.installment_number}/${commitment.installments_total} · `
                : ""}
              Vence em {formatDate(commitment.due_on)}
            </Text>
            <Text style={styles.commitmentAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {hasPartialPayment
                ? `Faltam ${formatBRLFromCents(commitment.pending_cents)} de ${formatBRLFromCents(commitment.amount_cents)}`
                : formatBRLFromCents(commitment.amount_cents)}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => void toggleCommitment(commitment)}
          disabled={updating}
          accessibilityRole="button"
          accessibilityLabel={isPaid ? `Pagamento de ${commitment.name} registrado. Desfazer pagamento` : `Registrar pagamento de ${commitment.name}`}
          accessibilityState={{ disabled: updating }}
          style={({ pressed }) => [
            styles.commitmentToggle,
            isPaid && styles.commitmentTogglePaid,
            pressed && !updating && styles.commitmentTogglePressed,
            updating && styles.commitmentToggleDisabled,
          ]}
        >
          {updating ? (
            <ActivityIndicator size="small" color={isPaid ? OB.primary : "#fff"} />
          ) : (
            <>
              <Ionicons name={isPaid ? "arrow-undo-outline" : "checkmark-circle-outline"} size={18} color={isPaid ? OB.primary : "#fff"} />
              <Text style={[styles.commitmentToggleText, isPaid && styles.commitmentToggleTextPaid]}>{isPaid ? "Desfazer pagamento" : "Registrar pagamento"}</Text>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.controlScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.controlHeader}>
        <Text style={styles.controlTitle} accessibilityRole="header">Resumo financeiro</Text>
        <Text style={styles.controlSubtitle}>Como estou financeiramente neste período?</Text>
      </View>

      {!postImportModeActive ? (
        <View style={styles.cycleNavigator}>
          <Pressable onPress={() => changeCycle(-1)} accessibilityRole="button" accessibilityLabel="Período anterior" style={styles.cycleArrow}>
            <Ionicons name="chevron-back" size={20} color={OB.primary} />
          </Pressable>
          <View style={styles.cycleLabelWrap}>
            <Text style={styles.cycleEyebrow}>Período</Text>
            <Text style={styles.cycleLabel}>{overview?.cycle.label ?? (loadError ? "Valores indisponíveis" : "Carregando...")}</Text>
            {overview ? <Text style={styles.cycleRange}>{formatDate(overview.cycle.start)} a {formatDate(previousDate(overview.cycle.end))}</Text> : null}
          </View>
          <Pressable onPress={() => changeCycle(1)} accessibilityRole="button" accessibilityLabel="Próximo período" style={styles.cycleArrow}>
            <Ionicons name="chevron-forward" size={20} color={OB.primary} />
          </Pressable>
        </View>
      ) : null}

      {!postImportModeActive && !viewingCurrentCycle ? (
        <Pressable onPress={showToday} accessibilityRole="button" style={styles.todayButton}>
          <Ionicons name="today-outline" size={16} color={OB.primary} />
          <Text style={styles.todayButtonText}>Voltar para o período atual</Text>
        </Pressable>
      ) : null}

      {loading && overview ? (
        <View style={styles.refreshHint}>
          <ActivityIndicator size="small" color={OB.primary} />
          <Text style={styles.refreshHintText}>Atualizando os valores...</Text>
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.loadErrorCard} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={22} color="#A33F3F" />
          <View style={styles.loadErrorCopy}>
            <Text style={styles.loadErrorTitle}>Não foi possível atualizar os valores</Text>
            <Text style={styles.loadErrorText}>{loadError}</Text>
          </View>
          <Pressable onPress={() => void load()} accessibilityRole="button" style={styles.loadErrorButton}>
            <Text style={styles.loadErrorButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : null}

      {busy && !overview ? (
        <View style={styles.controlLoading}>
          <ActivityIndicator color={OB.primary} />
          <Text style={styles.controlLoadingText}>Organizando seu período...</Text>
        </View>
      ) : overview ? (
        <>
          {showPlanningGuide ? (
            <View style={styles.postImportCard}>
              <View style={styles.postImportSuccessIcon}>
                <Ionicons name="checkmark" size={25} color="#fff" />
              </View>
              <Text style={styles.postImportTitle}>Extrato importado</Text>
              <Text style={styles.postImportText}>Suas entradas e gastos estão no app.</Text>
              {reconciledCommitments > 0 ? (
                <View style={styles.postImportReconciledNotice}>
                  <Ionicons name="link-outline" size={17} color="#168A59" />
                  <Text style={styles.postImportReconciledText}>
                    {reconciledCommitments} {reconciledCommitments === 1 ? "conta foi reconhecida" : "contas foram reconhecidas"} automaticamente.
                  </Text>
                </View>
              ) : null}

              <View style={styles.postImportNextStep}>
                <Text style={styles.postImportNextEyebrow}>Próximo passo</Text>
                <Text style={styles.postImportNextTitle}>
                  {needsPlanningFlow
                    ? "Falta preparar seu resumo"
                    : pendingCommitments.length
                      ? `${pendingCommitments.length} ${pendingCommitments.length === 1 ? "pagamento precisa" : "pagamentos precisam"} ser registrado${pendingCommitments.length === 1 ? "" : "s"}`
                      : "Tudo pronto"}
                </Text>
                <Text style={styles.postImportNextText}>
                  {needsPlanningFlow
                    ? "Escolha seu período, quanto quer manter na conta e o que ainda precisa pagar."
                    : pendingCommitments.length
                      ? "Veja se essas contas já aparecem nos gastos importados."
                      : "Não há pagamentos pendentes para registrar."}
                </Text>
              </View>

              <Pressable
                onPress={continuePostImportGuide}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                style={({ pressed }) => [styles.postImportPrimaryButton, busy && styles.newButtonUnavailable, pressed && !busy && styles.newButtonPressed]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.postImportPrimaryButtonText}>Atualizando...</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.postImportPrimaryButtonText}>
                      {needsPlanningFlow
                        ? planningGuideStarted && !needsPlanningSetup ? "Continuar meu resumo" : "Preparar meu resumo"
                        : pendingCommitments.length ? "Registrar próximo pagamento" : "Ver meu resumo"}
                    </Text>
                    <Ionicons name="arrow-forward" size={19} color="#fff" />
                  </>
                )}
              </Pressable>

              <Pressable
                onPress={openImportedTransactions}
                accessibilityRole="button"
                style={styles.postImportSecondaryButton}
              >
                <Text style={styles.postImportLinkText}>Ver o que foi importado</Text>
              </Pressable>

              <Pressable
                onPress={finishPostImportGuide}
                accessibilityRole="button"
                style={styles.postImportSecondaryButton}
              >
                <Text style={styles.postImportSecondaryButtonText}>Agora não</Text>
              </Pressable>
            </View>
          ) : (
            <>
            <View style={styles.availableHero}>
              <View style={styles.availableHeroTop}>
                <View style={styles.availableHeroIcon}><Ionicons name="sparkles-outline" size={20} color="#fff" /></View>
                <Text style={styles.availableLabel}>Disponível para os sonhos</Text>
              </View>
              <Text style={styles.availableValue} maxFontSizeMultiplier={1.25} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58}>{formatBRLFromCents(overview.availableCents)}</Text>
              <Text style={styles.availableExplanation}>{availabilityMessage}</Text>

              {overview.confidence.status !== "reliable" ? (
                <View style={styles.estimateNotice}>
                  <Ionicons name="information-circle-outline" size={18} color="#fff" />
                  <Text style={styles.estimateNoticeText}>
                    {overview.balance.total_cents === null
                      ? "Estimativa sem saldo bancário atualizado."
                      : overview.balance.status !== "reliable"
                        ? "Estimativa baseada nos extratos disponíveis."
                        : "Revise renda, reserva e contas no planejamento."
                    }
                  </Text>
                </View>
              ) : null}

              {overview.availableCents > 0 ? (
                <Pressable onPress={openAllocation} accessibilityRole="button" style={({ pressed }) => [styles.allocateButton, pressed && styles.newButtonPressed]}>
                  <Ionicons name="heart-outline" size={19} color={OB.primary} />
                  <Text style={styles.allocateButtonText}>Guardar para um sonho</Text>
                </Pressable>
              ) : null}
            </View>

          <View style={styles.projectedPlanCard}>
            <View style={styles.projectedPlanIcon}>
              <Ionicons name="calendar-outline" size={21} color={OB.primary} />
            </View>
            <View style={styles.projectedPlanCopy}>
              <Text style={styles.projectedPlanEyebrow}>Projeção do período</Text>
              <Text style={styles.projectedPlanLabel}>Previsão ao final do período</Text>
              <Text style={styles.projectedPlanValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {formatBRLFromCents(overview.projectedAvailableCents)}
              </Text>
              <Text style={styles.projectedPlanHelper}>Considerando o que já entrou, saiu e ainda falta pagar.</Text>
            </View>
          </View>

          <View style={styles.simpleSummaryCard}>
            <Text style={styles.controlSectionTitle}>Visão rápida do período</Text>
            <View style={styles.moneySummaryList}>
              <MoneySummaryRow label="Entrou" value={overview.realizedIncomeCents} color="#168A59" icon="arrow-down-circle-outline" />
              <MoneySummaryRow label="Saiu" value={overview.realizedExpenseCents} color="#C94949" icon="arrow-up-circle-outline" />
              <MoneySummaryRow label="Falta pagar" value={overview.pendingCommitmentsCents} color={OB.primary} icon="receipt-outline" />
            </View>
          </View>

          <View style={styles.pendingPreviewCard}>
            <View style={styles.pendingPreviewHeader}>
              <View style={styles.pendingPreviewIcon}><Ionicons name="receipt-outline" size={20} color={OB.primary} /></View>
              <View style={styles.pendingPreviewHeading}>
                <Text style={styles.pendingPreviewTitle}>Próximas contas</Text>
                <Text style={styles.pendingPreviewDescription}>{commitmentsDescription}</Text>
              </View>
            </View>

            {visiblePendingCommitments.length ? (
              <View style={styles.pendingPreviewList}>
                {visiblePendingCommitments.map((commitment) => (
                  <Pressable
                    key={commitment.id}
                    onPress={() => void toggleCommitment(commitment)}
                    accessibilityRole="button"
                    accessibilityLabel={`Registrar pagamento de ${commitment.name}`}
                    style={({ pressed }) => [styles.pendingPreviewRow, pressed && styles.pendingPreviewRowPressed]}
                  >
                    <View style={styles.pendingPreviewCopy}>
                      <Text style={styles.pendingPreviewName} numberOfLines={1}>{commitment.name}</Text>
                      <Text style={styles.pendingPreviewMeta}>Vence em {formatDate(commitment.due_on)}</Text>
                    </View>
                    <View style={styles.pendingPreviewAction}>
                      <Text style={styles.pendingPreviewAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{formatBRLFromCents(commitment.pending_cents)}</Text>
                      <Text style={styles.pendingPreviewActionText}>Registrar</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={OB.support} />
                  </Pressable>
                ))}
                {pendingCommitments.length > visiblePendingCommitments.length ? (
                  <Pressable onPress={() => setPaymentsModalOpen(true)} accessibilityRole="button" accessibilityLabel={`Ver outras ${pendingCommitments.length - visiblePendingCommitments.length} contas pendentes`} style={styles.pendingPreviewMoreButton}>
                    <Text style={styles.pendingPreviewMore}>Ver outras {pendingCommitments.length - visiblePendingCommitments.length} contas</Text>
                    <Ionicons name="chevron-forward" size={15} color={OB.support} />
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.noPendingState}>
                <Ionicons name="checkmark-circle-outline" size={22} color="#168A59" />
                <Text style={styles.noPendingText}>{overview.commitments.length ? "Nenhuma conta pendente neste período." : "Nenhuma conta cadastrada neste período."}</Text>
              </View>
            )}

            <Pressable
              onPress={() => setPaymentsModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Revisar pagamentos do período selecionado"
              style={({ pressed }) => [styles.reviewPaymentsButton, pressed && styles.reviewPaymentsButtonPressed]}
            >
              <Ionicons name="checkmark-done-outline" size={17} color={OB.primary} />
              <Text style={styles.reviewPaymentsText}>Revisar pagamentos</Text>
              <Ionicons name="chevron-forward" size={16} color={OB.support} />
            </Pressable>

            <Pressable onPress={() => router.push("/(app)/financial-plan")} accessibilityRole="button" style={styles.manageCommitmentsButton}>
              <Text style={styles.manageCommitmentsText}>Ver planejamento</Text>
              <Ionicons name="chevron-forward" size={18} color={OB.primary} />
            </Pressable>
          </View>

            </>
          )}
        </>
      ) : !householdId ? (
        <Text style={emptyStyle}>Conclua as primeiras etapas para criar sua estrutura financeira.</Text>
      ) : (
        <Text style={emptyStyle}>Não foi possível mostrar o resumo deste período.</Text>
      )}

      <Modal
        visible={paymentsModalOpen}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent={Platform.OS === "android"}
        navigationBarTranslucent={Platform.OS === "android"}
        onRequestClose={() => setPaymentsModalOpen(false)}
      >
        <View style={styles.paymentsModalBackdrop} accessibilityViewIsModal>
          <View
            style={[
              styles.paymentsModalSheet,
              {
                height: paymentsSheetHeight,
                marginTop: paymentsSheetTopInset + 12,
              },
            ]}
          >
            <View style={[styles.paymentsModalHeader, compactPaymentsSheet && styles.paymentsModalHeaderCompact]}>
              <View pointerEvents="none" style={styles.paymentsModalActionSlot} />
              <View style={styles.paymentsModalHeaderCopy}>
                <Text style={styles.paymentsModalEyebrow}>Resumo financeiro</Text>
                <Text
                  style={[styles.paymentsModalTitle, compactPaymentsSheet && styles.paymentsModalTitleCompact]}
                  accessibilityRole="header"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  Revisar pagamentos
                </Text>
                <Text style={[styles.paymentsModalText, compactPaymentsSheet && styles.paymentsModalTextCompact]}>Confira o que já foi pago neste período.</Text>
              </View>
              <Pressable
                onPress={() => setPaymentsModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Fechar revisão de pagamentos"
                style={({ pressed }) => [styles.paymentsModalClose, pressed && styles.paymentsModalClosePressed]}
              >
                <Ionicons name="close" size={21} color="#fff" />
              </Pressable>
            </View>

            <ScrollView
              style={styles.paymentsModalScroll}
              contentContainerStyle={[
                styles.paymentsModalContent,
                { paddingBottom: Math.max(insets.bottom, 18) + 22 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {overview ? (
                <View style={styles.paymentsPeriodBar}>
                  <View style={styles.paymentsPeriodIcon}>
                    <Ionicons name="calendar-outline" size={18} color={OB.primary} />
                  </View>
                  <View style={styles.paymentsPeriodCopy}>
                    <Text style={styles.paymentsPeriodEyebrow}>Período selecionado</Text>
                    <Text style={styles.paymentsPeriodLabel}>{overview.cycle.label}</Text>
                    <Text style={styles.paymentsPeriodRange}>{formatDate(overview.cycle.start)} a {formatDate(previousDate(overview.cycle.end))}</Text>
                  </View>
                </View>
              ) : null}

              {loadError ? (
                <View style={styles.paymentsInlineError} accessibilityRole="alert">
                  <Ionicons name="alert-circle-outline" size={20} color="#A33F3F" />
                  <Text style={styles.paymentsInlineErrorText}>{loadError}</Text>
                </View>
              ) : null}

              {pendingCommitments.length ? (
                <View style={styles.paymentsModalSection}>
                  <View style={styles.paymentsModalSectionHeading}>
                    <Text style={styles.paymentsModalSectionTitle}>Pendentes</Text>
                    <View style={styles.paymentsModalSectionCount}>
                      <Text style={styles.paymentsModalSectionCountText}>{pendingCommitments.length}</Text>
                    </View>
                  </View>
                  {pendingCommitments.map(renderPaymentRow)}
                </View>
              ) : null}

              {confirmedCommitments.length ? (
                <View style={styles.paymentsModalSection}>
                  <View style={styles.paymentsModalSectionHeading}>
                    <Text style={styles.paymentsModalSectionTitle}>Pagas</Text>
                    <View style={[styles.paymentsModalSectionCount, styles.paymentsModalSectionCountPaid]}>
                      <Text style={[styles.paymentsModalSectionCountText, styles.paymentsModalSectionCountTextPaid]}>{confirmedCommitments.length}</Text>
                    </View>
                  </View>
                  {confirmedCommitments.map(renderPaymentRow)}
                </View>
              ) : null}

              {!overview?.commitments.length ? (
                <View style={styles.paymentsEmptyState}>
                  <View style={styles.paymentsEmptyIcon}>
                    <Ionicons name="checkmark-circle-outline" size={30} color="#168A59" />
                  </View>
                  <Text style={styles.paymentsEmptyTitle}>Tudo certo por aqui</Text>
                  <Text style={styles.paymentsEmptyText}>Não há pagamentos para revisar neste período.</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
          <Pressable
            onPress={() => setPaymentsModalOpen(false)}
            accessible={false}
            focusable={false}
            tabIndex={-1}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </Modal>
    </ScrollView>
  );
}
function DrawerButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: MenuIcon;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.drawerItem, active && styles.drawerItemActive]}>
      <Ionicons name={icon} size={20} color={active ? "#fff" : OB.support} />
      <Text style={[styles.drawerItemText, active && styles.drawerItemTextActive]}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={active ? "rgba(255,255,255,0.74)" : OB.support} />
    </Pressable>
  );
}

function JourneyDrawer({
  open,
  activeTab,
  displayName,
  avatarUrl,
  onClose,
  onTab,
  onLogout,
}: {
  open: boolean;
  activeTab: Tab;
  displayName: string;
  avatarUrl?: string | null;
  onClose: () => void;
  onTab: (tab: Tab) => void;
  onLogout: () => void;
}) {
  if (!open) return null;

  function goTab(tab: Tab) {
    onTab(tab);
    onClose();
  }

  function goProfile() {
    onClose();
    router.push("/(app)/profile");
  }

  function goCategories() {
    onClose();
    router.push("/(app)/categories");
  }

  return (
    <View style={styles.drawerLayer}>
      <Pressable onPress={onClose} style={[styles.drawerScrim, WEB_DRAWER_BLUR_STYLE]}>
        <BlurView
          intensity={24}
          tint="default"
          blurReductionFactor={3}
          experimentalBlurMethod="dimezisBlurView"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.drawerScrimTint} />
      </Pressable>
      <View style={styles.drawerPanel}>
        <View style={styles.drawerHero}>
          <Pressable onPress={onClose} style={styles.drawerClose} accessibilityRole="button" accessibilityLabel="Fechar menu">
            <Ionicons name="close" size={21} color="#fff" />
          </Pressable>
          <View style={styles.drawerProfile}>
            <Pressable onPress={goProfile} style={styles.drawerAvatar} accessibilityRole="button" accessibilityLabel="Editar perfil">
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.drawerAvatarImage} resizeMode="contain" />
              ) : (
                <Text style={styles.drawerAvatarText}>{initialsFrom(displayName)}</Text>
              )}
              <View style={styles.drawerAvatarEdit}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </Pressable>
            <Text style={styles.drawerUserName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.drawerSubtitle}>Realize seus sonhos</Text>
          </View>
        </View>

        <View style={styles.drawerList}>
          <DrawerButton icon="compass-outline" label="Sonhos" active={activeTab === "jornada"} onPress={() => goTab("jornada")} />
          <DrawerButton icon="swap-vertical-outline" label="Movimentações" active={activeTab === "movimentacoes"} onPress={() => goTab("movimentacoes")} />
          <DrawerButton icon="wallet-outline" label="Resumo" active={activeTab === "controle"} onPress={() => goTab("controle")} />
          <DrawerButton icon="pricetags-outline" label="Categorias" onPress={goCategories} />
          <DrawerButton icon="trophy-outline" label="Desafios" active={activeTab === "desafios"} onPress={() => goTab("desafios")} />
        </View>

        <View style={styles.drawerFooter}>
          <Pressable onPress={onLogout} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={20} color="#B94A4A" />
            <Text style={styles.logoutText}>Sair da conta</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function JourneyScreen() {
  const params = useLocalSearchParams<{ dreams?: string; values?: string; tab?: string; cycleDate?: string; postImport?: string; importId?: string; reconciledCommitments?: string }>();
  const { session, signOut } = useSession();
  const userId = session?.user?.id ?? null;
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const requestedCycleDate = Array.isArray(params.cycleDate) ? params.cycleDate[0] : params.cycleDate;
  const requestedPostImport = Array.isArray(params.postImport) ? params.postImport[0] : params.postImport;
  const requestedImportId = Array.isArray(params.importId) ? params.importId[0] : params.importId;
  const requestedReconciledCommitments = Array.isArray(params.reconciledCommitments) ? params.reconciledCommitments[0] : params.reconciledCommitments;
  const parsedReconciledCommitments = Number(requestedReconciledCommitments);
  const reconciledCommitments = Number.isFinite(parsedReconciledCommitments)
    ? Math.max(0, Math.trunc(parsedReconciledCommitments))
    : 0;
  const initialTab: Tab = requestedTab === "controle" || requestedTab === "jornada" || requestedTab === "movimentacoes" || requestedTab === "desafios"
    ? requestedTab
    : "jornada";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [controlCycleDate, setControlCycleDate] = useState(requestedCycleDate);
  const [postImportId, setPostImportId] = useState(requestedPostImport === "1" ? requestedImportId : undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [journeyLoading, setJourneyLoading] = useState(true);
  const [expenseToday, setExpenseToday] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(true);
  const lastBackPressRef = useRef(0);
  const logoutPromptOpenRef = useRef(false);

  const selectTab = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    router.setParams({ tab: nextTab });
  }, []);

  const userMeta = session?.user?.user_metadata as Record<string, any> | undefined;
  const displayName = userMeta?.full_name || userMeta?.name || session?.user?.email?.split("@")[0] || "Usuário";
  const avatarUrl = userMeta?.avatar_url || userMeta?.picture || null;
  const savedDreams = Array.isArray(userMeta?.finapp_dreams) ? JSON.stringify(userMeta.finapp_dreams) : undefined;
  const savedValues = userMeta?.finapp_dream_values && typeof userMeta.finapp_dream_values === "object" ? JSON.stringify(userMeta.finapp_dream_values) : undefined;
  const dreams = useMemo(() => readJson<string[]>(params.dreams ?? savedDreams, []), [params.dreams, savedDreams]);
  const values = useMemo(() => readJson<Record<string, string>>(params.values ?? savedValues, {}), [params.values, savedValues]);

  useEffect(() => {
    if (requestedTab === "controle" || requestedTab === "jornada" || requestedTab === "movimentacoes" || requestedTab === "desafios") {
      setTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    if (requestedCycleDate) setControlCycleDate(requestedCycleDate);
  }, [requestedCycleDate]);

  useEffect(() => {
    setPostImportId(requestedPostImport === "1" && requestedImportId ? requestedImportId : undefined);
  }, [requestedImportId, requestedPostImport]);

  const rememberControlCycle = useCallback((nextCycleDate: string) => {
    setControlCycleDate(nextCycleDate);
  }, []);

  const finishPostImport = useCallback(() => {
    setPostImportId(undefined);
    router.setParams({ postImport: undefined, importId: undefined, reconciledCommitments: undefined });
  }, []);

  const activePostImportId = requestedPostImport === "1" && requestedImportId === postImportId
    ? postImportId
    : undefined;

  const loadJourney = useCallback(async () => {
    if (!householdId || !userId) { setGoals([]); setJourneyLoading(false); return; }
    try {
      setJourneyLoading(true);
      if (dreams.length) await syncGoalsFromDreams({ householdId, userId, dreams, values });
      const [goalRows, txRows] = await Promise.all([listGoalsWithProgress(householdId), listTransactionsByMonth(householdId)]);
      setGoals(goalRows);
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      setExpenseToday(txRows.some((tx) => tx.type === "expense" && tx.occurred_on === today));
    } catch (error: any) {
      Alert.alert("Seus sonhos", error?.message ?? "Não foi possível carregar seus sonhos.");
    } finally {
      setJourneyLoading(false);
    }
  }, [dreams, householdId, userId, values]);

  useFocusEffect(
    useCallback(() => {
      if (tab === "jornada" || tab === "desafios") void loadJourney();
    }, [loadJourney, tab])
  );

  const activeGoals = useMemo(() => goals.filter((goal) => goal.contributed_cents < goal.target_cents), [goals]);
  const completedGoals = useMemo(() => goals.filter((goal) => goal.contributed_cents >= goal.target_cents), [goals]);
  const progressGoals = activeGoals.length ? activeGoals : completedGoals;
  const targetTotal = progressGoals.reduce((sum, goal) => sum + goal.target_cents, 0);
  const contributedTotal = progressGoals.reduce((sum, goal) => sum + Math.min(goal.contributed_cents, goal.target_cents), 0);
  const monthTotal = goals.reduce((sum, goal) => sum + goal.month_contributed_cents, 0);
  const journeyProgress = clampProgress((contributedTotal / Math.max(targetTotal, 1)) * 100);

  function openGoal(goal: GoalProgress) {
    router.push({ pathname: "/(app)/dream/[goalId]", params: { goalId: goal.id } });
  }

  const logout = useCallback(async () => {
    setMenuOpen(false);
    const result = await signOut();
    if (result.activeAccountChanged) return;
    router.replace("/(auth)/login");
    if (!result.remoteSignOutCompleted) {
      Alert.alert(
        "Sessão encerrada neste aparelho",
        "Não foi possível confirmar a saída dos outros dispositivos. Tente novamente quando estiver conectado.",
      );
    }
  }, [signOut]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;

      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        const now = Date.now();
        const action = getAndroidBackAction({
          menuOpen,
          tab,
          isSecondPress: now - lastBackPressRef.current <= ANDROID_BACK_PRESS_WINDOW_MS,
        });

        if (action === "close-menu") {
          setMenuOpen(false);
          lastBackPressRef.current = 0;
          return true;
        }

        if (action === "go-home") {
          selectTab("jornada");
          lastBackPressRef.current = 0;
          return true;
        }

        if (action === "warn-exit") {
          lastBackPressRef.current = now;
          ToastAndroid.show("Pressione voltar novamente para sair da conta", ToastAndroid.SHORT);
          return true;
        }

        lastBackPressRef.current = 0;
        if (logoutPromptOpenRef.current) return true;
        logoutPromptOpenRef.current = true;

        Alert.alert(
          "Sair da conta?",
          "Deseja deslogar do Sonho+?",
          [
            {
              text: "Cancelar",
              style: "cancel",
              onPress: () => {
                logoutPromptOpenRef.current = false;
              },
            },
            {
              text: "Deslogar",
              style: "destructive",
              onPress: () => {
                logoutPromptOpenRef.current = false;
                void logout();
              },
            },
          ],
          {
            cancelable: true,
            onDismiss: () => {
              logoutPromptOpenRef.current = false;
            },
          }
        );
        return true;
      });

      return () => {
        subscription.remove();
        lastBackPressRef.current = 0;
        logoutPromptOpenRef.current = false;
      };
    }, [logout, menuOpen, selectTab, tab])
  );

  const challengeCard = (
    <View style={styles.challenge}>
      <View style={{ flex: 1 }}>
        <Text style={styles.challengeEyebrow}>Desafio de hoje</Text>
        <Text style={styles.challengeTitle}>Registre uma despesa do dia</Text>
        <Text style={styles.challengeText}>{expenseToday ? "Concluído com um lançamento real de hoje." : "Adicione uma despesa na aba Movimentações para concluir."}</Text>
      </View>
      <View style={[styles.checkButton, expenseToday && styles.checkButtonDone]}><Ionicons name={expenseToday ? "checkmark" : "receipt-outline"} size={21} color={expenseToday ? "#fff" : OB.support} /></View>
    </View>
  );

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <View style={[styles.content, tab === "jornada" && styles.journeyContent]}>
          {tab === "controle" ? <ControlPanel key={activePostImportId ? `post-import:${activePostImportId}` : "control"} householdId={householdId} userId={userId} householdLoading={householdLoading} cycleDate={controlCycleDate} onCycleDateChange={rememberControlCycle} postImportId={activePostImportId} reconciledCommitments={activePostImportId ? reconciledCommitments : 0} onPostImportHandled={finishPostImport} /> : tab === "movimentacoes" ? <MovementsScreen embedded /> : tab === "jornada" ? (
            <>
              <MountainHero progress={journeyProgress} />
              <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Sonhos em andamento</Text>{journeyLoading || householdLoading ? <ActivityIndicator size="small" color={OB.primary} /> : null}</View>
                {activeGoals.length ? activeGoals.map((goal) => <ProgressCard key={goal.id} goal={goal} onOpen={() => openGoal(goal)} />) : !journeyLoading && !householdLoading && !goals.length ? (
                  <Pressable onPress={() => router.push("/(onboarding)/dreams")} style={styles.emptyDreamsCard}>
                    <Ionicons name="sparkles-outline" size={22} color={OB.primary} /><View style={{ flex: 1 }}><Text style={styles.emptyDreamsTitle}>Configure seus sonhos</Text><Text style={styles.emptyDreamsText}>Escolha seus objetivos para começar sua jornada financeira.</Text></View><Ionicons name="chevron-forward" size={19} color={OB.support} />
                  </Pressable>
                ) : !journeyLoading && !householdLoading ? <Text style={styles.allDreamsCompleted}>Você concluiu todos os sonhos atuais. Que tal começar um novo?</Text> : null}
                {!journeyLoading && activeGoals.length < 3 ? (
                  <Pressable
                    onPress={() => router.push({ pathname: "/(onboarding)/dreams", params: { maxDreams: String(3 - activeGoals.length), returnToJourney: "1", excludedDreams: JSON.stringify(goals.map((goal) => goal.title)) } })}
                    style={styles.addGoalCard}
                  >
                    <View style={styles.addGoalIcon}><Ionicons name="add" size={19} color={OB.primary} /></View>
                    <Text style={styles.addGoalText}>Cadastrar novo sonho</Text>
                    <Ionicons name="chevron-forward" size={17} color={OB.support} />
                  </Pressable>
                ) : null}
                <View style={styles.monthCard}><View style={styles.monthIcon}><Ionicons name="calendar-outline" size={21} color="#fff" /></View><View><Text style={styles.monthEyebrow}>Avanço deste mês</Text><Text style={styles.monthTitle}>{formatBRLFromCents(monthTotal)} guardados neste mês</Text></View></View>
                {challengeCard}
                {completedGoals.length ? (
                  <View style={styles.achievementsSection}>
                    <Pressable onPress={() => setAchievementsOpen((open) => !open)} style={styles.achievementsHeader}>
                      <View style={styles.achievementsTitleRow}>
                        <View style={styles.achievementsIcon}><Ionicons name="trophy" size={17} color="#169B62" /></View>
                        <View><Text style={styles.achievementsTitle}>Conquistas</Text><Text style={styles.achievementsCount}>{completedGoals.length} {completedGoals.length === 1 ? "sonho concluído" : "sonhos concluídos"}</Text></View>
                      </View>
                      <Ionicons name={achievementsOpen ? "chevron-up" : "chevron-down"} size={19} color={OB.support} />
                    </Pressable>
                    {achievementsOpen ? <View style={styles.achievementsList}>{completedGoals.map((goal) => <ProgressCard key={goal.id} goal={goal} onOpen={() => openGoal(goal)} />)}</View> : null}
                  </View>
                ) : null}
              </ScrollView>
            </>
          ) : <ScrollView contentContainerStyle={styles.challengesPage}><Ionicons name="trophy-outline" size={42} color={OB.primary} /><Text style={styles.placeholderTitle} accessibilityRole="header">Seus desafios</Text><Text style={styles.placeholderText}>As missões são concluídas automaticamente com seus dados reais.</Text>{challengeCard}</ScrollView>}
        </View>
        <View style={styles.nav}>
          <Pressable onPress={() => setMenuOpen(true)} style={[styles.navItem, styles.navMenuItem]} accessibilityRole="button" accessibilityLabel="Abrir menu"><Ionicons name="menu-outline" size={21} color={menuOpen ? OB.primary : OB.support} /><Text style={[styles.navText, menuOpen && styles.navTextActive]} numberOfLines={1}>Menu</Text>{menuOpen ? <View style={styles.navIndicator} /> : null}</Pressable>
          {MAIN_NAVIGATION_ITEMS.map(({ id, label, icon }) => {
            const active = tab === id;
            return <Pressable key={id} onPress={() => selectTab(id)} style={[styles.navItem, id === "movimentacoes" && styles.navMovementsItem]} accessibilityRole="button" accessibilityLabel={`Abrir ${label}`}><Ionicons name={icon} size={21} color={active ? OB.primary : OB.support} /><Text style={[styles.navText, active && styles.navTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>{label}</Text>{active ? <View style={styles.navIndicator} /> : null}</Pressable>;
          })}
        </View>
        <JourneyDrawer open={menuOpen} activeTab={tab} displayName={displayName} avatarUrl={avatarUrl} onClose={() => setMenuOpen(false)} onTab={selectTab} onLogout={logout} />
      </View>
    </OnboardingShell>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  content: {
    flex: 1,
  },
  journeyContent: {
    backgroundColor: "#F7F3EB",
  },
  scroll: {
    padding: 16,
    paddingTop: 18,
    gap: 14,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: OB.primary,
    fontFamily: "serif",
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "400",
  },
  emptyDreamsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 18,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
  },
  emptyDreamsTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  emptyDreamsText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  goalCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderRadius: 22,
    padding: 13,
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: "rgba(103,82,56,0.14)",
    shadowColor: "#6C563C",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  goalCardCompleted: { borderColor: "rgba(22,155,98,0.26)", backgroundColor: "#FBFFFD" },
  goalCardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  goalInfo: {
    flex: 1,
  },
  goalTitle: {
    color: OB.primary,
    fontFamily: "serif",
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "400",
  },
  goalValue: {
    color: "#837B70",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  goalValueCompleted: { color: "#169B62" },
  smallTrack: {
    height: 4,
    borderRadius: 99,
    backgroundColor: "#ECE6DC",
    marginTop: 8,
    overflow: "hidden",
  },
  smallTrackCompleted: { backgroundColor: "rgba(22,155,98,0.14)" },
  smallFill: {
    height: "100%",
    backgroundColor: OB.primary,
  },
  smallFillCompleted: { backgroundColor: "#22A96B" },
  ring: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 4,
    borderColor: "#DED8CF",
    alignItems: "center",
    justifyContent: "center",
  },
  ringCompleted: { borderColor: "#22A96B", backgroundColor: "#E5F7EE" },
  ringText: {
    color: OB.primary,
    fontFamily: "serif",
    fontSize: 15,
    fontWeight: "400",
  },
  allDreamsCompleted: { color: OB.support, fontSize: 12, fontWeight: "700", lineHeight: 18, paddingHorizontal: 2 },
  addGoalCard: { minHeight: 52, borderRadius: 17, borderWidth: 1, borderStyle: "dashed", borderColor: OB.support, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, backgroundColor: "rgba(255,255,255,0.55)" },
  addGoalIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(123,160,200,0.14)" },
  addGoalText: { flex: 1, color: OB.primary, fontSize: 12, fontWeight: "900" },
  achievementsSection: { gap: 10, marginTop: 4 },
  achievementsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 2 },
  achievementsTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  achievementsIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E5F7EE" },
  achievementsTitle: { color: OB.primary, fontSize: 15, fontWeight: "900" },
  achievementsCount: { color: OB.support, fontSize: 10, fontWeight: "700", marginTop: 2 },
  achievementsList: { gap: 10 },
  monthCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 16,
    backgroundColor: OB.primary,
  },
  monthIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  monthEyebrow: {
    color: "rgba(241,220,197,0.68)",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  monthTitle: {
    color: "#F5E6D4",
    fontFamily: "serif",
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "400",
    marginTop: 3,
  },
  challenge: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  challengeEyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  challengeTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 6,
  },
  challengeText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
  },
  checkButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  checkButtonDone: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  controlScroll: {
    padding: 16,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
  },
  controlHeader: {
    paddingHorizontal: 2,
    paddingTop: 2,
    alignItems: "center",
  },
  controlTitle: {
    color: OB.primary,
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
  },
  controlSubtitle: {
    color: "#5E7591",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 4,
    textAlign: "center",
  },
  cycleNavigator: {
    minHeight: 64,
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  cycleArrow: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  cycleLabelWrap: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  cycleEyebrow: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  cycleLabel: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 3,
  },
  cycleRange: {
    color: "#5E7591",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  todayButton: {
    alignSelf: "center",
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 99,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(123,160,200,0.13)",
  },
  todayButtonText: {
    flexShrink: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  refreshHint: {
    alignSelf: "center",
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  refreshHintText: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "800",
  },
  controlLoading: {
    minHeight: 150,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
  },
  controlLoadingText: {
    color: "#5E7591",
    fontSize: 13,
    fontWeight: "800",
  },
  loadErrorCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF5F5",
    borderWidth: 1,
    borderColor: "rgba(163,63,63,0.22)",
  },
  loadErrorCopy: {
    flex: 1,
    minWidth: 180,
  },
  loadErrorTitle: {
    color: "#7F3030",
    fontSize: 13,
    fontWeight: "900",
  },
  loadErrorText: {
    color: "#734C4C",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 2,
  },
  loadErrorButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(163,63,63,0.26)",
  },
  loadErrorButtonText: {
    color: "#7F3030",
    fontSize: 12,
    fontWeight: "900",
  },
  postImportCard: {
    borderRadius: 24,
    padding: 20,
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  postImportSuccessIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#168A59",
  },
  postImportTitle: {
    color: OB.primary,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 25,
    textAlign: "center",
    marginTop: 12,
  },
  postImportText: {
    color: "#5E7591",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "center",
    marginTop: 6,
  },
  postImportReconciledNotice: {
    alignSelf: "stretch",
    minHeight: 44,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(22,138,89,0.09)",
  },
  postImportReconciledText: {
    flexShrink: 1,
    color: "#116D47",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    textAlign: "center",
  },
  postImportNextStep: {
    alignSelf: "stretch",
    borderRadius: 18,
    padding: 15,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    marginTop: 18,
  },
  postImportNextEyebrow: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  postImportNextTitle: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 22,
    marginTop: 5,
  },
  postImportNextText: {
    color: "#5E7591",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 5,
  },
  postImportPrimaryButton: {
    alignSelf: "stretch",
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: OB.primary,
    marginTop: 14,
  },
  postImportPrimaryButtonText: {
    flexShrink: 1,
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  postImportSecondaryButton: {
    minHeight: 46,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  postImportSecondaryButtonText: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  postImportLinkText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyCycleCard: {
    borderRadius: 22,
    padding: 18,
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  emptyCycleIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.15)",
  },
  emptyCycleTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 12,
  },
  emptyCycleText: {
    color: "#5E7591",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "center",
    marginTop: 5,
  },
  emptyCyclePlanButton: {
    alignSelf: "center",
    minHeight: 44,
    marginTop: 14,
    paddingHorizontal: 13,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  emptyCyclePlanButtonText: {
    flexShrink: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  projectedPlanCard: {
    minHeight: 154,
    borderRadius: 22,
    padding: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "rgba(123,160,200,0.13)",
    borderWidth: 1,
    borderColor: "rgba(123,160,200,0.36)",
  },
  projectedPlanIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  projectedPlanCopy: {
    flex: 1,
    minWidth: 0,
  },
  projectedPlanEyebrow: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  projectedPlanLabel: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
  },
  projectedPlanValue: {
    color: OB.primary,
    fontSize: 26,
    fontWeight: "900",
    marginTop: 7,
  },
  projectionEquation: {
    gap: 7,
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  projectionLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  projectionLineLabel: {
    flex: 1,
    color: "#5E7591",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
  },
  projectionLineValue: {
    color: "#168A59",
    fontSize: 11,
    fontWeight: "900",
  },
  projectionLineValueSubtract: { color: "#C94949" },
  projectedPlanHelper: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 6,
  },
  availableHero: {
    borderRadius: 24,
    padding: 20,
    gap: 10,
    backgroundColor: OB.primary,
    overflow: "hidden",
    shadowColor: OB.primary,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  availableHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  availableHeroIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  availableLabel: {
    flex: 1,
    color: OB.textOnDark,
    fontSize: 13,
    fontWeight: "900",
  },
  availableValue: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 2,
  },
  availableExplanation: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
  },
  estimateNotice: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  estimateNoticeText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  allocateButton: {
    minHeight: 52,
    marginTop: 2,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  allocateButtonText: {
    flexShrink: 1,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  sectionEyebrow: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  controlSectionTitle: {
    color: OB.primary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 1,
  },
  sectionHelper: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 2,
  },
  simpleSummaryCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  moneySummaryList: {
    marginTop: 10,
  },
  moneySummaryRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  moneySummaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  moneySummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  moneySummaryLabel: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  moneySummaryValue: {
    fontSize: 15,
    fontWeight: "900",
    marginTop: 3,
  },
  pendingPreviewCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  pendingPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  pendingPreviewIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.15)",
  },
  pendingPreviewHeading: {
    flex: 1,
    minWidth: 0,
  },
  pendingPreviewTitle: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  pendingPreviewDescription: {
    color: "#5E7591",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: 3,
  },
  pendingPreviewList: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  pendingPreviewRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  pendingPreviewRowPressed: {
    opacity: 0.72,
  },
  pendingPreviewCopy: {
    flex: 1,
    minWidth: 0,
  },
  pendingPreviewName: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  pendingPreviewMeta: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  pendingPreviewAmount: {
    maxWidth: 108,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  pendingPreviewAction: {
    alignItems: "flex-end",
  },
  pendingPreviewActionText: {
    color: "#5E7591",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 3,
  },
  pendingPreviewMoreButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  pendingPreviewMore: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  noPendingState: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 10,
  },
  noPendingText: {
    flex: 1,
    color: "#5E7591",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 17,
  },
  reviewPaymentsButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  reviewPaymentsText: {
    flex: 1,
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  reviewPaymentsButtonPressed: {
    opacity: 0.72,
  },
  paymentsModalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(6,25,54,0.42)",
  },
  paymentsModalSheet: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    zIndex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    backgroundColor: OB.offWhite,
    shadowColor: "#061936",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 18,
  },
  paymentsModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 20,
    backgroundColor: OB.primary,
  },
  paymentsModalHeaderCompact: {
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 18,
  },
  paymentsModalActionSlot: {
    width: 44,
    height: 44,
    flexShrink: 0,
  },
  paymentsModalHeaderCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  paymentsModalEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    textAlign: "center",
  },
  paymentsModalTitle: {
    alignSelf: "stretch",
    color: OB.textOnDark,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    marginTop: 4,
    textAlign: "center",
  },
  paymentsModalTitleCompact: {
    fontSize: 20,
    lineHeight: 26,
  },
  paymentsModalText: {
    alignSelf: "stretch",
    color: OB.textOnDarkMid,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 4,
    textAlign: "center",
  },
  paymentsModalTextCompact: {
    fontSize: 10,
    lineHeight: 15,
  },
  paymentsModalClose: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.17)",
  },
  paymentsModalClosePressed: {
    opacity: 0.74,
    transform: [{ scale: 0.98 }],
  },
  paymentsModalScroll: {
    flex: 1,
  },
  paymentsModalContent: {
    flexGrow: 1,
    gap: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  paymentsPeriodBar: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 17,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  paymentsPeriodIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.15)",
  },
  paymentsPeriodCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentsPeriodEyebrow: {
    color: "#5E7591",
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  paymentsPeriodLabel: {
    color: OB.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  paymentsPeriodRange: {
    color: "#5E7591",
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 1,
  },
  paymentsInlineError: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(201,73,73,0.09)",
    borderWidth: 1,
    borderColor: "rgba(201,73,73,0.20)",
  },
  paymentsInlineErrorText: {
    flex: 1,
    color: "#8F3434",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  paymentsModalSection: {
    paddingTop: 2,
  },
  paymentsModalSectionHeading: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  paymentsModalSectionTitle: {
    flex: 1,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  paymentsModalSectionCount: {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: "rgba(55,110,165,0.11)",
  },
  paymentsModalSectionCountPaid: {
    backgroundColor: "rgba(22,138,89,0.11)",
  },
  paymentsModalSectionCountText: {
    color: OB.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  paymentsModalSectionCountTextPaid: {
    color: "#126B45",
  },
  paymentsEmptyState: {
    flex: 1,
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 34,
  },
  paymentsEmptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22,138,89,0.10)",
  },
  paymentsEmptyTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 14,
  },
  paymentsEmptyText: {
    maxWidth: 320,
    color: "#5E7591",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 5,
  },
  resultSummary: {
    minHeight: 70,
    marginTop: 12,
    borderRadius: 17,
    padding: 13,
    backgroundColor: "rgba(22,138,89,0.09)",
  },
  resultSummaryNegative: {
    backgroundColor: "rgba(201,73,73,0.09)",
  },
  resultSummaryNeutral: {
    backgroundColor: OB.offWhite,
  },
  resultSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultSummaryLabel: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  resultSummaryHelper: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 3,
  },
  resultSummaryValue: {
    color: "#168A59",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 7,
  },
  resultSummaryValueNegative: {
    color: "#C94949",
  },
  resultSummaryValueNeutral: {
    color: OB.primary,
  },
  disclosureCard: {
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    overflow: "hidden",
  },
  disclosureHeader: {
    minHeight: 82,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  disclosureHeaderPressed: {
    backgroundColor: OB.offWhite,
  },
  disclosureIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.15)",
  },
  disclosureCopy: {
    flex: 1,
    minWidth: 0,
  },
  disclosureTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  disclosureDescription: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 3,
  },
  disclosureChevron: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  disclosureBody: {
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  calculationHelper: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    padding: 12,
    borderRadius: 14,
    backgroundColor: OB.offWhite,
  },
  planningMetrics: {
    gap: 0,
  },
  planningMetric: {
    minHeight: 58,
    justifyContent: "center",
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  planningMetricLabel: {
    color: "#5E7591",
    fontSize: 13,
    fontWeight: "800",
  },
  planningMetricValue: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  balanceSnapshot: {
    borderRadius: 17,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: OB.offWhite,
  },
  balanceSnapshotIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.18)",
  },
  balanceSnapshotCopy: {
    flex: 1,
    minWidth: 0,
  },
  balanceSnapshotLabel: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "800",
  },
  balanceSnapshotValue: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  balanceSnapshotMeta: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 3,
  },
  commitmentsHelper: {
    color: "#5E7591",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    marginBottom: 2,
  },
  commitmentRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  commitmentMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  commitmentCheck: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  commitmentCheckPaid: {
    backgroundColor: "#168A59",
  },
  commitmentInfo: {
    flex: 1,
    minWidth: 0,
  },
  commitmentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  commitmentName: {
    flex: 1,
    minWidth: 0,
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  commitmentNamePaid: {
    color: OB.support,
  },
  commitmentStatus: {
    flexShrink: 0,
    minHeight: 23,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: "rgba(55,110,165,0.11)",
  },
  commitmentStatusPaid: {
    backgroundColor: "rgba(22,138,89,0.11)",
  },
  commitmentStatusText: {
    color: OB.primary,
    fontSize: 9,
    fontWeight: "900",
  },
  commitmentStatusTextPaid: {
    color: "#126B45",
  },
  commitmentMeta: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 15,
    marginTop: 4,
  },
  commitmentAmount: {
    color: OB.primary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    marginTop: 3,
  },
  commitmentToggle: {
    minHeight: 44,
    alignSelf: "stretch",
    marginTop: 8,
    paddingHorizontal: 12,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: OB.primary,
    borderWidth: 1,
    borderColor: OB.primary,
  },
  commitmentTogglePaid: {
    backgroundColor: "#fff",
    borderColor: OB.supportSoft,
  },
  commitmentTogglePressed: {
    opacity: 0.74,
    transform: [{ scale: 0.995 }],
  },
  commitmentToggleDisabled: {
    opacity: 0.58,
  },
  commitmentToggleText: {
    flexShrink: 1,
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  commitmentToggleTextPaid: {
    color: OB.primary,
  },
  noCommitments: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  noCommitmentsText: {
    flex: 1,
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  confirmedCommitments: {
    borderRadius: 15,
    backgroundColor: OB.offWhite,
    overflow: "hidden",
  },
  confirmedCommitmentsHeader: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  confirmedCommitmentsTitle: {
    flex: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  manageCommitmentsButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: OB.offWhite,
  },
  manageCommitmentsText: {
    flex: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  newButtonUnavailable: { opacity: 0.4 },
  newButtonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  filters: {
    gap: 8,
  },
  filter: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  filterActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  filterText: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "900",
  },
  filterTextActive: {
    color: "#fff",
  },
  txList: {
    backgroundColor: "#fff",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  txDot: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  txDotText: {
    fontSize: 15,
    fontWeight: "900",
  },
  txInfo: {
    flex: 1,
    minWidth: 0,
  },
  txDesc: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  txMeta: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 2,
  },
  txValueRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 7,
    marginTop: 6,
  },
  txAmount: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "900",
  },
  txType: {
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modalShade: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  sheet: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  modalSafeTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: OB.offWhite,
  },
  sheetHero: {
    borderRadius: 22,
    padding: 20,
    paddingRight: 62,
    alignItems: "flex-start",
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  sheetEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sheetTitle: {
    color: OB.textOnDark,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  sheetSubtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 6,
  },
  sheetClose: {
    position: "absolute",
    right: 14,
    top: 14,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  typeTabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  sheetContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  importStatementButton: {
    minHeight: 66,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  importStatementIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  importStatementTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  importStatementText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
    marginTop: 2,
  },
  typeTab: {
    flex: 1,
    minHeight: 52,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  typeTabActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  typeTabText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "900",
  },
  typeTabTextActive: {
    color: "#fff",
  },
  accountPanel: {
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
    padding: 10,
  },
  accountOption: {
    minHeight: 52,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: "transparent",
  },
  accountOptionActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  accountOptionText: {
    flex: 1,
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  accountOptionTextActive: { color: "#fff" },
  accountRequiredText: {
    color: "#B94A4A",
    fontSize: 10,
    fontWeight: "800",
    marginTop: -8,
    paddingHorizontal: 2,
  },
  fieldLabel: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
    marginBottom: 4,
  },
  inputBox: {
    minHeight: 58,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  currency: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginRight: 6,
  },
  input: {
    flex: 1,
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  descriptionField: {
    gap: 12,
  },
  inputBoxText: {
    minHeight: 58,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 15,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  categoryPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
    padding: 10,
  },
  category: {
    minHeight: 38,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: "transparent",
  },
  categoryActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  categoryText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "900",
  },
  categoryTextActive: {
    color: "#fff",
  },
  saveButton: {
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: OB.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveButtonDisabled: {
    backgroundColor: "rgba(123,160,200,0.32)",
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  saveButtonTextDisabled: {
    color: OB.support,
  },
  challengesPage: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 8 },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  placeholderTitle: {
    color: OB.primary,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 14,
    textAlign: "center",
  },
  placeholderText: {
    color: OB.support,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  nav: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 2,
    paddingBottom: 6,
  },
  navItem: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 1,
    paddingTop: 11,
    paddingBottom: 8,
  },
  navMenuItem: {
    flex: 0,
    width: 50,
  },
  navMovementsItem: {
    flex: 1.3,
  },
  navText: {
    width: "100%",
    flexShrink: 1,
    color: OB.support,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  navTextActive: {
    color: OB.primary,
    fontWeight: "900",
  },
  navIndicator: {
    position: "absolute",
    bottom: 0,
    width: 28,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: OB.primary,
  },
  drawerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
  },
  drawerScrim: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  drawerScrimTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,21,46,0.18)",
  },
  drawerPanel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "72%",
    maxWidth: 280,
    backgroundColor: OB.offWhite,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
    elevation: 35,
  },
  drawerHero: {
    minHeight: 154,
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 16,
    backgroundColor: OB.primary,
    justifyContent: "flex-end",
  },
  drawerClose: {
    position: "absolute",
    top: 14,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  drawerProfile: {
    alignItems: "flex-start",
  },
  drawerAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 11,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.28)",
    overflow: "visible",
  },
  drawerAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 29,
  },
  drawerAvatarText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  drawerAvatarEdit: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.support,
    borderWidth: 2,
    borderColor: OB.primary,
  },
  drawerUserName: {
    color: OB.offWhite,
    fontSize: 16,
    fontWeight: "900",
    maxWidth: "92%",
  },
  drawerSubtitle: {
    color: "rgba(160,200,235,0.86)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  drawerList: {
    padding: 10,
    gap: 6,
    flex: 1,
  },
  drawerItem: {
    minHeight: 46,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
  },
  drawerItemActive: {
    backgroundColor: OB.primary,
  },
  drawerItemText: {
    flex: 1,
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  drawerItemTextActive: {
    color: "#fff",
  },
  drawerFooter: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  logoutButton: {
    minHeight: 46,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FDE7E7",
    borderWidth: 1,
    borderColor: "#F5B9B9",
  },
  logoutText: {
    color: "#B94A4A",
    fontSize: 13,
    fontWeight: "900",
  },
});
