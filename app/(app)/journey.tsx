import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, BackHandler, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, ToastAndroid, View } from "react-native";
import { BlurView } from "expo-blur";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { Category } from "../../src/lib/categories";
import { listTransactionsByMonth } from "../../src/lib/transactions";
import {
  findTransactionAccountById,
  TransactionAccountId,
  TransactionAccountOption,
} from "../../src/lib/banks";
import { GoalProgress, listGoalsWithProgress, syncGoalsFromDreams } from "../../src/lib/goals";
import { MountainHero } from "../../src/features/journey/MountainHero";
import { getAndroidBackAction } from "../../src/lib/androidBack";
import { BankLogo } from "../../src/ui/BankLogo";
import {
  FinancialOverview,
  FinancialOverviewCommitment,
  FinancialOverviewTransaction,
  getCycleForOffset,
  getFinancialOverview,
  getFinancialSettings,
  setCommitmentPaid,
} from "../../src/lib/financialPlanning";

type Tab = "controle" | "jornada" | "desafios";
type MenuIcon = keyof typeof Ionicons.glyphMap;
type TxType = "Receita" | "Despesa";
type Filter = "Todos" | TxType;
type Tx = { id: string; type: TxType; description: string; category: string; categoryId: string | null; account: string; accountId: TransactionAccountId | null; date: string; amount: number };
type TxDraft = { type: TxType; description: string; categoryId: string | null; accountId: TransactionAccountId; amount: number };

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

function ProgressCard({ goal, icon, onOpen }: { goal: GoalProgress; icon: string; onOpen: () => void }) {
  const progress = clampProgress((goal.contributed_cents / Math.max(goal.target_cents, 1)) * 100);
  const completed = progress >= 100;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Abrir sonho ${goal.title}`}
      style={({ pressed }) => [styles.goalCard, completed && styles.goalCardCompleted, pressed && styles.goalCardPressed]}
    >
      {goal.cover_photo_url ? (
        <View style={[styles.goalPolaroid, completed && styles.goalPolaroidCompleted]}>
          <Image source={{ uri: goal.cover_photo_url }} style={styles.goalPolaroidImage} resizeMode="contain" />
          <View style={[styles.goalPolaroidCaption, completed && styles.goalPolaroidCaptionCompleted]} />
        </View>
      ) : (
        <View style={[styles.goalBadge, completed && styles.goalBadgeCompleted]}>
          <Ionicons name={(completed ? "checkmark" : icon) as any} size={20} color={completed ? "#169B62" : OB.primary} />
        </View>
      )}
      <View style={styles.goalInfo}>
        <Text style={styles.goalTitle}>{goal.title}</Text>
        <Text style={[styles.goalValue, completed && styles.goalValueCompleted]}>{completed && goal.completed_on ? `Concluído em ${formatDate(goal.completed_on)}` : `${formatBRLFromCents(goal.contributed_cents)} de ${formatBRLFromCents(goal.target_cents)}`}</Text>
        <View style={[styles.smallTrack, completed && styles.smallTrackCompleted]}><View style={[styles.smallFill, completed && styles.smallFillCompleted, { width: `${progress}%` }]} /></View>
      </View>
      <View style={[styles.ring, completed && styles.ringCompleted]}>{completed ? <Ionicons name="checkmark" size={21} color="#169B62" /> : <Text style={styles.ringText}>{progressLabel(progress)}</Text>}</View>
    </Pressable>
  );
}
function SummaryCard({
  label,
  value,
  icon,
  color,
  wide = false,
}: {
  label: string;
  value: number;
  icon: string;
  color: string;
  wide?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, wide && styles.summaryCardWide]}>
      <View style={[styles.summaryAccent, { backgroundColor: color }]} />
      <View style={[styles.summaryIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon as any} size={17} color={color} />
      </View>
      <Text style={[styles.summaryLabel, wide && styles.summaryTextWide]}>{label}</Text>
      <Text
        style={[styles.summaryValue, wide && styles.summaryTextWide]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {formatBRLFromCents(value)}
      </Text>
    </View>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const color = tx.type === "Receita" ? "#22a96b" : "#e05252";
  const sign = tx.type === "Receita" ? "+" : "-";

  return (
    <View style={styles.txRow}>
      <View style={[styles.txDot, { backgroundColor: `${color}1A` }]}>
        <Text style={[styles.txDotText, { color }]}>{sign}</Text>
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={styles.txMeta}>{tx.category} · {tx.account} · {formatDate(tx.date)}</Text>
      </View>
      <View style={styles.txAmountWrap}>
        <Text style={[styles.txAmount, { color }]}>{sign}{formatBRLFromCents(tx.amount)}</Text>
        <Text style={[styles.txType, { color, backgroundColor: `${color}1A` }]}>{tx.type}</Text>
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
              <Pressable onPress={onClose} hitSlop={12} style={styles.sheetClose}>
                <Ionicons name="close" size={21} color="#fff" />
              </Pressable>
              <Text style={styles.sheetEyebrow}>Controle financeiro</Text>
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

function mapOverviewTx(row: FinancialOverviewTransaction): Tx {
  const accountId = row.account_id as TransactionAccountId | null;
  return {
    id: row.id,
    type: row.type === "income" ? "Receita" : "Despesa",
    amount: Number(row.amount_cents || 0),
    description: row.note?.trim() || "Lançamento",
    category: row.category?.name ?? "Sem categoria",
    categoryId: row.category_id,
    account: findTransactionAccountById(accountId)?.name ?? "Conta não informada",
    accountId,
    date: row.occurred_on,
  };
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

function PlanningMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.planningMetric}>
      <Text style={styles.planningMetricLabel}>{label}</Text>
      <Text style={styles.planningMetricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.74}>{value}</Text>
    </View>
  );
}

function ControlPanel({
  householdId,
  userId,
  householdLoading,
  cycleDate,
  onCycleDateChange,
}: {
  householdId: string | null;
  userId: string | null;
  householdLoading: boolean;
  cycleDate?: string;
  onCycleDateChange: (cycleDate: string) => void;
}) {
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("Todos");
  const [cycleOffset, setCycleOffset] = useState(0);
  const [reference, setReference] = useState(() => routeCycleReference(cycleDate));
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
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const settings = await getFinancialSettings(householdId);
      const cycle = getCycleForOffset(settings, cycleOffset, reference);
      const nextOverview = await getFinancialOverview({ householdId, userId, cycle });
      if (loadToken === loadTokenRef.current) {
        setOverview(nextOverview);
        onCycleDateChange(nextOverview.cycle.start);
      }
    } catch (error: any) {
      if (loadToken === loadTokenRef.current) {
        Alert.alert("Controle financeiro", error?.message ?? "Não foi possível carregar seu planejamento.");
      }
    } finally {
      if (loadToken === loadTokenRef.current) setLoading(false);
    }
  }, [cycleOffset, householdId, onCycleDateChange, reference, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const txs = useMemo(() => overview?.transactions.map(mapOverviewTx) ?? [], [overview]);
  const filtered = filter === "Todos" ? txs : txs.filter((tx) => tx.type === filter);
  const busy = loading || householdLoading;
  const emptyStyle = { color: OB.support, fontSize: 14, fontWeight: "700" as const, paddingVertical: 24, textAlign: "center" as const };

  const showToday = useCallback(() => {
    setReference(new Date());
    setCycleOffset(0);
  }, []);

  const toggleCommitment = useCallback(async (commitment: FinancialOverviewCommitment) => {
    if (!householdId || !userId || !overview) return;
    const isPaid = commitment.pending_cents <= 0;

    if (!isPaid) {
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
        Alert.alert("Compromisso", error?.message ?? "Não foi possível atualizar este compromisso.");
      } finally {
        setUpdatingCommitmentId(null);
      }
    };

    await persist();
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

  return (
    <>
      <ScrollView contentContainerStyle={styles.controlScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.controlHeader}>
          <Text style={styles.controlEyebrow}>Controle financeiro</Text>
          <Text style={styles.controlTitle}>Liberdade financeira</Text>
          <Text style={styles.controlSubtitle}>Veja o que aconteceu no ciclo, o que ainda está comprometido e quanto pode seguir para seus sonhos.</Text>
        </View>

        <View style={styles.cycleNavigator}>
          <Pressable onPress={() => setCycleOffset((value) => value - 1)} accessibilityLabel="Ciclo anterior" style={styles.cycleArrow}>
            <Ionicons name="chevron-back" size={20} color={OB.primary} />
          </Pressable>
          <View style={styles.cycleLabelWrap}>
            <Text style={styles.cycleEyebrow}>Ciclo selecionado</Text>
            <Text style={styles.cycleLabel}>{overview?.cycle.label ?? "Carregando..."}</Text>
            {overview ? <Text style={styles.cycleRange}>{formatDate(overview.cycle.start)} a {formatDate(previousDate(overview.cycle.end))}</Text> : null}
          </View>
          <Pressable onPress={() => setCycleOffset((value) => value + 1)} accessibilityLabel="Próximo ciclo" style={styles.cycleArrow}>
            <Ionicons name="chevron-forward" size={20} color={OB.primary} />
          </Pressable>
        </View>
        <Pressable onPress={showToday} style={styles.todayButton}>
          <Ionicons name="today-outline" size={15} color={OB.primary} />
          <Text style={styles.todayButtonText}>Ir para o ciclo de hoje</Text>
        </Pressable>

        {busy && !overview ? (
          <View style={styles.controlLoading}><ActivityIndicator color={OB.primary} /><Text style={styles.controlLoadingText}>Organizando seu ciclo...</Text></View>
        ) : overview ? (
          <>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryExpectedRow}>
                <SummaryCard label="Renda prevista" value={overview.expectedIncomeCents} color="#527BA7" icon="calendar-outline" />
              </View>
              <SummaryCard label="Receitas realizadas" value={overview.realizedIncomeCents} color="#22a96b" icon="trending-up-outline" />
              <SummaryCard label="Despesas realizadas" value={overview.realizedExpenseCents} color="#e05252" icon="trending-down-outline" />
              <SummaryCard label="Resultado do ciclo" value={overview.resultCents} color={overview.resultCents >= 0 ? OB.primary : "#e05252"} icon="analytics-outline" wide />
            </View>

            <View style={styles.planningCard}>
              <View style={styles.planningHeader}>
                <View style={styles.planningTitleWrap}>
                  <Text style={styles.planningEyebrow}>Planejamento</Text>
                  <Text style={styles.planningTitle}>Sua sobra possível</Text>
                </View>
                <Pressable onPress={() => router.push("/(app)/financial-plan")} style={styles.configureButton}>
                  <Ionicons name="options-outline" size={17} color={OB.primary} />
                  <Text style={styles.configureButtonText}>Configurar</Text>
                </Pressable>
              </View>

              <View style={styles.balanceSnapshot}>
                <View style={styles.balanceSnapshotIcon}><Ionicons name="business-outline" size={20} color={OB.primary} /></View>
                <View style={styles.balanceSnapshotCopy}>
                  <Text style={styles.balanceSnapshotLabel}>Saldo conhecido nos extratos</Text>
                  <Text style={styles.balanceSnapshotValue}>{overview.balance.total_cents === null ? "Indisponível" : formatBRLFromCents(overview.balance.total_cents)}</Text>
                  <Text style={styles.balanceSnapshotMeta}>
                    {overview.balance.total_cents === null
                      ? "Importe um extrato com saldo final para aumentar a precisão."
                      : `${overview.balance.status === "reliable" ? "Confirmado" : "Estimado"}${overview.balance.as_of ? ` até ${formatDate(overview.balance.as_of)}` : ""}.`}
                  </Text>
                </View>
              </View>

              <View style={styles.planningMetrics}>
                <PlanningMetric label="Compromissos pendentes" value={formatBRLFromCents(overview.pendingCommitmentsCents)} />
                <PlanningMetric label="Reserva mínima" value={formatBRLFromCents(overview.reserveCents)} />
                <PlanningMetric label="Já destinado neste ciclo" value={formatBRLFromCents(overview.allocatedCents)} />
              </View>

              <View style={styles.availableCard}>
                <Text style={styles.availableLabel}>Disponível para sonhos</Text>
                <Text style={styles.availableValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatBRLFromCents(overview.availableCents)}</Text>
                <Text style={styles.availableExplanation}>Estimativa conservadora: parte do resultado positivo, respeita o saldo conhecido e desconta compromissos, reserva e valores já destinados.</Text>
              </View>

              <Pressable
                onPress={openAllocation}
                disabled={overview.availableCents <= 0}
                style={({ pressed }) => [styles.allocateButton, overview.availableCents <= 0 && styles.allocateButtonDisabled, pressed && styles.newButtonPressed]}
              >
                <Ionicons name="sparkles-outline" size={18} color={overview.availableCents > 0 ? "#fff" : OB.support} />
                <Text style={[styles.allocateButtonText, overview.availableCents <= 0 && styles.allocateButtonTextDisabled]}>{overview.availableCents > 0 ? "Destinar sobra para um sonho" : "Sem sobra disponível neste ciclo"}</Text>
              </Pressable>
            </View>

            <View style={styles.commitmentsCard}>
              <View style={styles.commitmentsHeader}>
                <View>
                  <Text style={styles.commitmentsEyebrow}>Contas, dívidas e parcelas</Text>
                  <Text style={styles.commitmentsTitle}>Compromissos do ciclo</Text>
                </View>
                <Text style={styles.commitmentsCount}>{overview.commitments.length}</Text>
              </View>
              <Text style={styles.commitmentsHelper}>Marque quando a conta já aparecer nas despesas do ciclo; isso evita descontar o mesmo valor duas vezes.</Text>
              {overview.commitments.length ? overview.commitments.map((commitment) => {
                const isPaid = commitment.pending_cents <= 0;
                const updating = updatingCommitmentId === commitment.id;
                return (
                  <View key={commitment.id} style={styles.commitmentRow}>
                    <View style={[styles.commitmentCheck, isPaid && styles.commitmentCheckPaid]}>
                      <Ionicons name={isPaid ? "checkmark" : "receipt-outline"} size={17} color={isPaid ? "#fff" : OB.primary} />
                    </View>
                    <View style={styles.commitmentInfo}>
                      <Text style={[styles.commitmentName, isPaid && styles.commitmentNamePaid]} numberOfLines={1}>{commitment.name}</Text>
                      <Text style={styles.commitmentMeta}>
                        {commitment.installment_number && commitment.installments_total
                          ? `Parcela ${commitment.installment_number}/${commitment.installments_total} · `
                          : ""}
                        Vence em {formatDate(commitment.due_on)} · {formatBRLFromCents(commitment.amount_cents)}
                      </Text>
                    </View>
                    <Pressable onPress={() => void toggleCommitment(commitment)} disabled={updating} style={[styles.commitmentToggle, isPaid && styles.commitmentTogglePaid]}>
                      {updating ? <ActivityIndicator size="small" color={isPaid ? "#fff" : OB.primary} /> : <Text style={[styles.commitmentToggleText, isPaid && styles.commitmentToggleTextPaid]}>{isPaid ? "Contabilizado" : "Já apareceu?"}</Text>}
                    </Pressable>
                  </View>
                );
              }) : (
                <View style={styles.noCommitments}>
                  <Ionicons name="checkmark-circle-outline" size={22} color="#22a96b" />
                  <Text style={styles.noCommitmentsText}>Nenhum compromisso configurado para este ciclo.</Text>
                </View>
              )}
              <Pressable onPress={() => router.push("/(app)/financial-plan")} style={styles.manageCommitmentsButton}>
                <Text style={styles.manageCommitmentsText}>Configurar planejamento e compromissos</Text>
                <Ionicons name="chevron-forward" size={17} color={OB.primary} />
              </Pressable>
            </View>
          </>
        ) : !householdId ? (
          <Text style={emptyStyle}>Conclua o onboarding para criar sua estrutura financeira.</Text>
        ) : null}

        <View style={styles.controlActions}>
          <Pressable onPress={() => router.push("/(app)/new-transaction")} disabled={!householdId} accessibilityRole="button" accessibilityLabel="Criar novo lançamento" style={({ pressed }) => [styles.controlActionButton, !householdId && styles.newButtonUnavailable, pressed && styles.newButtonPressed]}>
            <View style={styles.controlActionIcon}><Ionicons name="add" size={19} color="#fff" /></View>
            <Text style={styles.controlActionText}>Novo lançamento</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(app)/import-csv")} disabled={!householdId} accessibilityRole="button" accessibilityLabel="Importar extrato" style={({ pressed }) => [styles.controlActionButtonSecondary, !householdId && styles.newButtonUnavailable, pressed && styles.newButtonPressed]}>
            <View style={styles.controlActionIconSecondary}><Ionicons name="document-text-outline" size={18} color={OB.primary} /></View>
            <Text style={styles.controlActionTextSecondary}>Importar extrato</Text>
          </Pressable>
        </View>

        <View style={styles.transactionsHeader}>
          <View>
            <Text style={styles.transactionsEyebrow}>Movimentações</Text>
            <Text style={styles.transactionsTitle}>Lançamentos do ciclo</Text>
          </View>
          {loading && overview ? <ActivityIndicator size="small" color={OB.primary} /> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {(["Todos", "Receita", "Despesa"] as Filter[]).map((item) => {
            const active = item === filter;
            return <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{item}</Text></Pressable>;
          })}
        </ScrollView>
        <View style={styles.txList}>
          {busy && !overview ? <ActivityIndicator color={OB.primary} /> : !householdId ? <Text style={emptyStyle}>Conclua o onboarding para criar sua estrutura financeira.</Text> : filtered.length ? filtered.map((tx) => <TxRow key={tx.id} tx={tx} />) : <Text style={emptyStyle}>Nenhum lançamento neste ciclo.</Text>}
        </View>
      </ScrollView>
    </>
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

  function goTransactionHistory() {
    onClose();
    router.push("/(app)/transaction-history");
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
          <Pressable onPress={onClose} style={styles.drawerClose} hitSlop={12}>
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
          <DrawerButton icon="wallet-outline" label="Controle financeiro" active={activeTab === "controle"} onPress={() => goTab("controle")} />
          <DrawerButton icon="time-outline" label="Histórico" onPress={goTransactionHistory} />
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
  const params = useLocalSearchParams<{ dreams?: string; values?: string; tab?: string; cycleDate?: string }>();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const requestedCycleDate = Array.isArray(params.cycleDate) ? params.cycleDate[0] : params.cycleDate;
  const [tab, setTab] = useState<Tab>(requestedTab === "controle" ? "controle" : "jornada");
  const [controlCycleDate, setControlCycleDate] = useState(requestedCycleDate);
  const [menuOpen, setMenuOpen] = useState(false);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [journeyLoading, setJourneyLoading] = useState(true);
  const [expenseToday, setExpenseToday] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(true);
  const lastBackPressRef = useRef(0);
  const logoutPromptOpenRef = useRef(false);

  const userMeta = session?.user?.user_metadata as Record<string, any> | undefined;
  const displayName = userMeta?.full_name || userMeta?.name || session?.user?.email?.split("@")[0] || "Usuário";
  const avatarUrl = userMeta?.avatar_url || userMeta?.picture || null;
  const savedDreams = Array.isArray(userMeta?.finapp_dreams) ? JSON.stringify(userMeta.finapp_dreams) : undefined;
  const savedValues = userMeta?.finapp_dream_values && typeof userMeta.finapp_dream_values === "object" ? JSON.stringify(userMeta.finapp_dream_values) : undefined;
  const dreams = useMemo(() => readJson<string[]>(params.dreams ?? savedDreams, []), [params.dreams, savedDreams]);
  const values = useMemo(() => readJson<Record<string, string>>(params.values ?? savedValues, {}), [params.values, savedValues]);

  useEffect(() => {
    if (requestedTab === "controle" || requestedTab === "jornada" || requestedTab === "desafios") {
      setTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    if (requestedCycleDate) setControlCycleDate(requestedCycleDate);
  }, [requestedCycleDate]);

  const rememberControlCycle = useCallback((nextCycleDate: string) => {
    setControlCycleDate(nextCycleDate);
  }, []);

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
      if (tab !== "controle") void loadJourney();
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
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }, []);

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
          setTab("jornada");
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
          "Deseja deslogar do FinApp?",
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
    }, [logout, menuOpen, tab])
  );

  const challengeCard = (
    <View style={styles.challenge}>
      <View style={{ flex: 1 }}>
        <Text style={styles.challengeEyebrow}>Desafio de hoje</Text>
        <Text style={styles.challengeTitle}>Registre uma despesa do dia</Text>
        <Text style={styles.challengeText}>{expenseToday ? "Concluído com um lançamento real de hoje." : "Adicione uma despesa na aba Controle para concluir."}</Text>
      </View>
      <View style={[styles.checkButton, expenseToday && styles.checkButtonDone]}><Ionicons name={expenseToday ? "checkmark" : "receipt-outline"} size={21} color={expenseToday ? "#fff" : OB.support} /></View>
    </View>
  );

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <View style={styles.content}>
          {tab === "controle" ? <ControlPanel householdId={householdId} userId={userId} householdLoading={householdLoading} cycleDate={controlCycleDate} onCycleDateChange={rememberControlCycle} /> : tab === "jornada" ? (
            <>
              <MountainHero progress={journeyProgress} />
              <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Sonhos em andamento</Text>{journeyLoading || householdLoading ? <ActivityIndicator size="small" color={OB.primary} /> : null}</View>
                {activeGoals.length ? activeGoals.map((goal, index) => <ProgressCard key={goal.id} goal={goal} icon={["home-outline", "trending-up-outline", "flag-outline"][index] ?? "sparkles-outline"} onOpen={() => openGoal(goal)} />) : !journeyLoading && !householdLoading && !goals.length ? (
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
                    {achievementsOpen ? <View style={styles.achievementsList}>{completedGoals.map((goal) => <ProgressCard key={goal.id} goal={goal} icon="checkmark" onOpen={() => openGoal(goal)} />)}</View> : null}
                  </View>
                ) : null}
              </ScrollView>
            </>
          ) : <ScrollView contentContainerStyle={styles.challengesPage}><Ionicons name="trophy-outline" size={42} color={OB.primary} /><Text style={styles.placeholderTitle}>Seus desafios</Text><Text style={styles.placeholderText}>As missões são concluídas automaticamente com seus dados reais.</Text>{challengeCard}</ScrollView>}
        </View>
        <View style={styles.nav}>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.navItem}><Ionicons name="menu-outline" size={23} color={menuOpen ? OB.primary : OB.support} /><Text style={[styles.navText, menuOpen && styles.navTextActive]}>Menu</Text>{menuOpen ? <View style={styles.navIndicator} /> : null}</Pressable>
          {[["jornada", "Sonhos", "compass-outline"], ["controle", "Controle", "bar-chart-outline"], ["desafios", "Desafios", "trophy-outline"]].map(([id, label, icon]) => {
            const active = tab === id;
            return <Pressable key={id} onPress={() => setTab(id as Tab)} style={styles.navItem}><Ionicons name={icon as any} size={21} color={active ? OB.primary : OB.support} /><Text style={[styles.navText, active && styles.navTextActive]}>{label}</Text>{active ? <View style={styles.navIndicator} /> : null}</Pressable>;
          })}
        </View>
        <JourneyDrawer open={menuOpen} activeTab={tab} displayName={displayName} avatarUrl={avatarUrl} onClose={() => setMenuOpen(false)} onTab={setTab} onLogout={logout} />
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
  scroll: {
    padding: 16,
    paddingTop: 8,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
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
    gap: 12,
    borderRadius: 20,
    padding: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  goalCardCompleted: { borderColor: "rgba(22,155,98,0.26)", backgroundColor: "#FBFFFD" },
  goalCardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  goalBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  goalBadgeCompleted: { backgroundColor: "#E5F7EE" },
  goalPolaroid: {
    width: 48,
    height: 52,
    borderRadius: 15,
    padding: 4,
    paddingBottom: 9,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(123,160,200,0.26)",
    shadowColor: OB.primary,
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    transform: [{ rotate: "-2deg" }],
  },
  goalPolaroidCompleted: { borderColor: "rgba(22,155,98,0.34)" },
  goalPolaroidImage: {
    width: "100%",
    flex: 1,
    borderRadius: 10,
    backgroundColor: OB.offWhite,
  },
  goalPolaroidCaption: {
    position: "absolute",
    left: 15,
    right: 15,
    bottom: 3,
    height: 2,
    borderRadius: 99,
    backgroundColor: "rgba(123,160,200,0.28)",
  },
  goalPolaroidCaptionCompleted: { backgroundColor: "rgba(22,155,98,0.3)" },
  goalInfo: {
    flex: 1,
  },
  goalTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  goalValue: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  goalValueCompleted: { color: "#169B62" },
  smallTrack: {
    height: 5,
    borderRadius: 99,
    backgroundColor: OB.supportSoft,
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
    borderWidth: 5,
    borderColor: OB.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ringCompleted: { borderColor: "#22A96B", backgroundColor: "#E5F7EE" },
  ringText: {
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
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
    color: "rgba(123,160,200,0.85)",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  monthTitle: {
    color: OB.offWhite,
    fontSize: 16,
    fontWeight: "900",
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
    paddingTop: 14,
    paddingBottom: 24,
    gap: 16,
  },
  controlHeader: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  controlEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  controlTitle: {
    color: OB.textOnDark,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  controlSubtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 6,
  },
  cycleNavigator: {
    minHeight: 82,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  cycleArrow: {
    width: 42,
    height: 42,
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
    color: OB.support,
    fontSize: 9,
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
    color: OB.support,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  todayButton: {
    alignSelf: "center",
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 99,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(123,160,200,0.13)",
  },
  todayButtonText: {
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
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
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  summaryExpectedRow: {
    width: "100%",
    alignItems: "center",
  },
  summaryCard: {
    width: "48.5%",
    minHeight: 112,
    borderRadius: 18,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    padding: 14,
    overflow: "hidden",
    shadowColor: OB.primary,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  summaryCardWide: {
    width: "100%",
    minHeight: 118,
    alignItems: "center",
  },
  summaryTextWide: {
    textAlign: "center",
  },
  summaryAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  summaryLabel: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
  },
  summaryValue: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  planningCard: {
    borderRadius: 22,
    padding: 16,
    gap: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  planningHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  planningTitleWrap: {
    flex: 1,
  },
  planningEyebrow: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  planningTitle: {
    color: OB.primary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 3,
  },
  configureButton: {
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  configureButtonText: {
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
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
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.18)",
  },
  balanceSnapshotCopy: {
    flex: 1,
  },
  balanceSnapshotLabel: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "800",
  },
  balanceSnapshotValue: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  balanceSnapshotMeta: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 13,
    marginTop: 3,
  },
  planningMetrics: {
    gap: 8,
  },
  planningMetric: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  planningMetricLabel: {
    flex: 1,
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
  },
  planningMetricValue: {
    maxWidth: "45%",
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  availableCard: {
    borderRadius: 19,
    padding: 17,
    alignItems: "center",
    backgroundColor: OB.primary,
  },
  availableLabel: {
    color: OB.textOnDarkMid,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  availableValue: {
    color: "#fff",
    fontSize: 27,
    fontWeight: "900",
    marginTop: 6,
  },
  availableExplanation: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 15,
    textAlign: "center",
    marginTop: 7,
  },
  allocateButton: {
    minHeight: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#22A96B",
  },
  allocateButtonDisabled: {
    backgroundColor: "rgba(123,160,200,0.18)",
  },
  allocateButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  allocateButtonTextDisabled: {
    color: OB.support,
  },
  commitmentsCard: {
    borderRadius: 22,
    padding: 16,
    gap: 5,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  commitmentsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  commitmentsHelper: {
    color: OB.support,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  commitmentsEyebrow: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  commitmentsTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  commitmentsCount: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    textAlign: "center",
    textAlignVertical: "center",
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: OB.offWhite,
  },
  commitmentRow: {
    minHeight: 65,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  commitmentCheck: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  commitmentCheckPaid: {
    backgroundColor: "#22A96B",
  },
  commitmentInfo: {
    flex: 1,
    minWidth: 0,
  },
  commitmentName: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  commitmentNamePaid: {
    color: OB.support,
    textDecorationLine: "line-through",
  },
  commitmentMeta: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 3,
  },
  commitmentToggle: {
    minHeight: 34,
    maxWidth: 92,
    paddingHorizontal: 9,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  commitmentTogglePaid: {
    backgroundColor: "#22A96B",
    borderColor: "#22A96B",
  },
  commitmentToggleText: {
    color: OB.primary,
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
  },
  commitmentToggleTextPaid: {
    color: "#fff",
  },
  noCommitments: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  noCommitmentsText: {
    flex: 1,
    color: OB.support,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  manageCommitmentsButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: OB.offWhite,
  },
  manageCommitmentsText: {
    flex: 1,
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  controlActions: {
    flexDirection: "row",
    gap: 10,
  },
  controlActionButton: {
    flex: 1,
    minHeight: 78,
    borderRadius: 18,
    padding: 12,
    justifyContent: "space-between",
    backgroundColor: OB.primary,
  },
  controlActionButtonSecondary: {
    flex: 1,
    minHeight: 78,
    borderRadius: 18,
    padding: 12,
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  controlActionIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  controlActionIconSecondary: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  controlActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  controlActionTextSecondary: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  transactionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  transactionsEyebrow: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  transactionsTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  newButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: OB.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  newButtonUnavailable: { opacity: 0.4 },
  newButtonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  newText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  filters: {
    gap: 8,
  },
  filter: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: "#fff",
  },
  filterActive: {
    backgroundColor: OB.primary,
  },
  filterText: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "900",
  },
  filterTextActive: {
    color: "#fff",
  },
  txList: {
    borderRadius: 20,
    paddingHorizontal: 16,
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
  },
  txDesc: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  txMeta: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  txAmountWrap: {
    alignItems: "flex-end",
  },
  txAmount: {
    fontSize: 13,
    fontWeight: "900",
  },
  txType: {
    fontSize: 10,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
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
    width: 42,
    height: 42,
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
    paddingBottom: 6,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingTop: 11,
    paddingBottom: 8,
  },
  navText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
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
    width: 30,
    height: 30,
    borderRadius: 10,
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
