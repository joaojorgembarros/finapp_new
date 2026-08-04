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
import { Category, listCategories } from "../../src/lib/categories";
import { addTransaction, listTransactionsByMonth, TxRow as DatabaseTx } from "../../src/lib/transactions";
import {
  BANK_OPTIONS,
  CASH_ACCOUNT,
  OTHER_BANK,
  findTransactionAccountById,
  TransactionAccountId,
  TransactionAccountOption,
} from "../../src/lib/banks";
import { GoalProgress, listGoalsWithProgress, syncGoalsFromDreams } from "../../src/lib/goals";
import { MountainHero } from "../../src/features/journey/MountainHero";

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
function SummaryCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryAccent, { backgroundColor: color }]} />
      <View style={[styles.summaryIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon as any} size={17} color={color} />
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{formatBRLFromCents(value)}</Text>
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

function AddModal({
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
  const scrollRef = useRef<ScrollView>(null);
  const descriptionFocused = useRef(false);
  const [descriptionY, setDescriptionY] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
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

  const scrollDescriptionIntoView = useCallback((delay = 80) => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(descriptionY - 18, 0), animated: true });
    }, delay);
  }, [descriptionY]);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const showSub = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      if (descriptionFocused.current) {
        scrollDescriptionIntoView(120);
      }
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
      descriptionFocused.current = false;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollDescriptionIntoView]);

  function scrollToDescription() {
    if (Platform.OS !== "android") return;

    descriptionFocused.current = true;
    if (keyboardHeight > 0) {
      scrollDescriptionIntoView();
      return;
    }

    scrollDescriptionIntoView(260);
  }

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
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" backgroundColor={OB.offWhite} translucent />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalShade}>
        <View style={styles.sheet}>
          <View pointerEvents="none" style={[styles.modalSafeTop, { height: topInset + 8 }]} />
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.sheetContent,
              {
                paddingTop: topInset + 16,
                paddingBottom: Math.max(insets.bottom, 18) + (keyboardHeight ? keyboardHeight + 52 : 28),
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
                    <View style={[styles.accountMark, { backgroundColor: active ? "rgba(255,255,255,0.18)" : `${account.color}18` }]}>
                      <Text style={[styles.accountMarkText, { color: active ? "#fff" : account.color }]}>{account.shortName}</Text>
                    </View>
                    <Text numberOfLines={1} style={[styles.accountOptionText, active && styles.accountOptionTextActive]}>{account.name}</Text>
                    {active ? <Ionicons name="checkmark-circle" size={17} color="#fff" /> : null}
                  </Pressable>
                );
              })}
            </View>
            {!accountId ? <Text style={styles.accountRequiredText}>Escolha uma conta para continuar.</Text> : null}

            <Text style={styles.fieldLabel}>Valor</Text>
            <View style={styles.inputBox}>
              <Text style={styles.currency}>R$</Text>
              <TextInput value={amount.replace("R$", "").trim()} onChangeText={(text) => setAmount(formatBRLInputFromDigits(text))} placeholder="0,00" placeholderTextColor={OB.support} keyboardType="number-pad" style={styles.input} />
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
              onLayout={(event) => setDescriptionY(event.nativeEvent.layout.y)}
            >
              <Text style={styles.fieldLabel}>Descrição</Text>
              <TextInput
                value={desc}
                onChangeText={setDesc}
                onFocus={scrollToDescription}
                onPressIn={scrollToDescription}
                onBlur={() => {
                  descriptionFocused.current = false;
                }}
                placeholder="Ex: compra mercado"
                placeholderTextColor={OB.support}
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

function mapDatabaseTx(row: DatabaseTx): Tx {
  return {
    id: row.id,
    type: row.type === "income" ? "Receita" : "Despesa",
    amount: Number(row.amount_cents || 0),
    description: row.note?.trim() || row.category?.name || "Lançamento",
    category: row.category?.name || "Sem categoria",
    categoryId: row.category_id,
    account: findTransactionAccountById(row.account_id)?.name ?? "Conta não informada",
    accountId: row.account_id,
    date: row.occurred_on,
  };
}

function ControlPanel({
  userId,
  householdId,
  householdLoading,
  registeredBankNames,
}: {
  userId: string | null;
  householdId: string | null;
  householdLoading: boolean;
  registeredBankNames: string[];
}) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState<Filter>("Todos");
  const registeredAccounts = useMemo(
    () => BANK_OPTIONS.filter((account) => registeredBankNames.includes(account.name)),
    [registeredBankNames]
  );
  const accountOptions = useMemo<TransactionAccountOption[]>(() => {
    const options = [...registeredAccounts, CASH_ACCOUNT];
    if (!options.some((account) => account.id === OTHER_BANK.id)) options.push(OTHER_BANK);
    return options;
  }, [registeredAccounts]);
  const defaultAccountId = useMemo<TransactionAccountId | null>(() => {
    if (registeredAccounts.length === 1) return registeredAccounts[0].id;
    return registeredBankNames.includes("Não uso banco") ? CASH_ACCOUNT.id : null;
  }, [registeredAccounts, registeredBankNames]);

  const load = useCallback(async () => {
    if (!householdId) {
      setTxs([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [rows, categoryRows] = await Promise.all([listTransactionsByMonth(householdId), listCategories(householdId)]);
      setTxs(rows.map(mapDatabaseTx));
      setCategories(categoryRows);
    } catch (error: any) {
      Alert.alert("Controle financeiro", error?.message ?? "Não foi possível carregar seus lançamentos.");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const totals = useMemo(() => {
    const income = txs.filter((tx) => tx.type === "Receita").reduce((sum, tx) => sum + tx.amount, 0);
    const expense = txs.filter((tx) => tx.type === "Despesa").reduce((sum, tx) => sum + tx.amount, 0);
    return { income, expense, balance: income - expense };
  }, [txs]);
  const filtered = filter === "Todos" ? txs : txs.filter((tx) => tx.type === filter);

  async function saveTransaction(draft: TxDraft) {
    if (!householdId || !userId) {
      Alert.alert("Controle financeiro", "Sua estrutura financeira ainda não está disponível.");
      return false;
    }
    try {
      setSaving(true);
      await addTransaction({ householdId, userId, type: draft.type === "Receita" ? "income" : "expense", amount_cents: draft.amount, category_id: draft.categoryId, account_id: draft.accountId, note: draft.description });
      await load();
      return true;
    } catch (error: any) {
      Alert.alert("Controle financeiro", error?.message ?? "Não foi possível salvar o lançamento.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || householdLoading;
  const emptyStyle = { color: OB.support, fontSize: 14, fontWeight: "700" as const, paddingVertical: 24, textAlign: "center" as const };

  return (
    <>
      <ScrollView contentContainerStyle={styles.controlScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.controlHeader}>
          <Text style={styles.controlEyebrow}>Controle financeiro</Text>
          <Text style={styles.controlTitle}>Liberdade financeira</Text>
          <Text style={styles.controlSubtitle}>Organize seus lançamentos e acompanhe seu dinheiro com clareza.</Text>
        </View>
        <View style={styles.summaryGrid}>
          <SummaryCard label="Receitas do mês" value={totals.income} color="#22a96b" icon="trending-up-outline" />
          <SummaryCard label="Despesas do mês" value={totals.expense} color="#e05252" icon="trending-down-outline" />
          <SummaryCard label="Saldo atual" value={totals.balance} color={OB.primary} icon="wallet-outline" />
        </View>
        <Pressable
          onPress={() => setModal(true)}
          disabled={!householdId}
          accessibilityRole="button"
          accessibilityLabel="Criar novo lançamento"
          style={({ pressed }) => [styles.newButton, !householdId && styles.newButtonUnavailable, pressed && styles.newButtonPressed]}
        >
          <Ionicons name="add" size={19} color="#fff" />
          <Text style={styles.newText}>Novo lançamento</Text>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {(["Todos", "Receita", "Despesa"] as Filter[]).map((item) => {
            const active = item === filter;
            return <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{item}</Text></Pressable>;
          })}
        </ScrollView>
        <View style={styles.txList}>
          {busy ? <ActivityIndicator color={OB.primary} /> : !householdId ? <Text style={emptyStyle}>Conclua o onboarding para criar sua estrutura financeira.</Text> : filtered.length ? filtered.map((tx) => <TxRow key={tx.id} tx={tx} />) : <Text style={emptyStyle}>Nenhum lançamento neste mês.</Text>}
        </View>
      </ScrollView>
      <AddModal visible={modal} categories={categories} accountOptions={accountOptions} defaultAccountId={defaultAccountId} saving={saving} onClose={() => setModal(false)} onSave={saveTransaction} />
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
  const params = useLocalSearchParams<{ dreams?: string; values?: string }>();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [tab, setTab] = useState<Tab>("jornada");
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
  const registeredBankNames = useMemo(
    () => Array.isArray(userMeta?.finapp_banks) ? userMeta.finapp_banks.map(String) : [],
    [userMeta?.finapp_banks]
  );
  const savedDreams = Array.isArray(userMeta?.finapp_dreams) ? JSON.stringify(userMeta.finapp_dreams) : undefined;
  const savedValues = userMeta?.finapp_dream_values && typeof userMeta.finapp_dream_values === "object" ? JSON.stringify(userMeta.finapp_dream_values) : undefined;
  const dreams = useMemo(() => readJson<string[]>(params.dreams ?? savedDreams, []), [params.dreams, savedDreams]);
  const values = useMemo(() => readJson<Record<string, string>>(params.values ?? savedValues, {}), [params.values, savedValues]);

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
        if (menuOpen) {
          setMenuOpen(false);
          lastBackPressRef.current = 0;
          return true;
        }

        const now = Date.now();
        const isSecondPress = now - lastBackPressRef.current <= ANDROID_BACK_PRESS_WINDOW_MS;

        if (!isSecondPress) {
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
    }, [logout, menuOpen])
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
          {tab === "controle" ? <ControlPanel userId={userId} householdId={householdId} householdLoading={householdLoading} registeredBankNames={registeredBankNames} /> : tab === "jornada" ? (
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
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
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
  accountMark: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  accountMarkText: {
    fontSize: 10,
    fontWeight: "900",
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
