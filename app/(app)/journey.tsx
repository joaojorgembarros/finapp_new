import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  Animated,
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingTabBar, FloatingTabItem } from "../../src/ui/FloatingTabBar";
import {
  JOURNEY_HEADER_HEIGHT,
  getJourneyBottomContentInset,
} from "../../src/ui/journeyChrome";
import { JourneyScrollHeader } from "../../src/ui/JourneyScrollHeader";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import {
  formatBRLInputFromDigits,
  parseBRLToCents,
} from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { Category } from "../../src/lib/categories";
import { listTransactionsByMonth } from "../../src/lib/transactions";
import {
  TransactionAccountId,
  TransactionAccountOption,
} from "../../src/lib/banks";
import {
  GoalProgress,
  listGoalsWithProgress,
  syncGoalsFromDreams,
} from "../../src/lib/goals";
import { DreamsTab } from "../../src/features/journey/DreamsTab";
import { SummaryTab } from "../../src/features/summary/SummaryTab";
import { getAndroidBackAction } from "../../src/lib/androidBack";
import { BankLogo } from "../../src/ui/BankLogo";
import MovementsScreen from "./transaction-history";

type Tab = "controle" | "jornada" | "movimentacoes" | "desafios";
type MenuIcon = keyof typeof Ionicons.glyphMap;
type TxType = "Receita" | "Despesa";
type TxDraft = {
  type: TxType;
  description: string;
  categoryId: string | null;
  accountId: TransactionAccountId;
  amount: number;
};

const SHOW_CONTROLE_TAB = true;

type NavigationItem = {
  id: Tab;
  label: string;
  icon: MenuIcon;
};

const ALL_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { id: "jornada", label: "Sonhos", icon: "compass-outline" },
  {
    id: "movimentacoes",
    label: "Movimentações",
    icon: "swap-vertical-outline",
  },
  { id: "controle", label: "Resumo", icon: "bar-chart-outline" },
  { id: "desafios", label: "Desafios", icon: "trophy-outline" },
];

const MAIN_NAVIGATION_ITEMS = ALL_NAVIGATION_ITEMS.filter(
  (item) => SHOW_CONTROLE_TAB || item.id !== "controle",
);

const FLOATING_NAVIGATION_ITEMS: readonly FloatingTabItem<Tab>[] =
  MAIN_NAVIGATION_ITEMS.map((item) =>
    item.id === "jornada"
      ? {
          id: item.id,
          image: require("../../assets/splash-brand-symbol.png"),
          accessibilityLabel: `Abrir ${item.label}`,
        }
      : {
          id: item.id,
          icon: item.icon,
          accessibilityLabel: `Abrir ${item.label}`,
        },
  );

const DEFAULT_TAB: Tab = SHOW_CONTROLE_TAB ? "controle" : "jornada";

function parseRequestedTab(raw: string | undefined): Tab {
  if (raw === "controle") return SHOW_CONTROLE_TAB ? "controle" : DEFAULT_TAB;
  const match = MAIN_NAVIGATION_ITEMS.find((item) => item.id === raw);
  return match?.id ?? DEFAULT_TAB;
}

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

function readJson<T>(raw: string | string[] | undefined, fallback: T): T {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function initialsFrom(nameOrEmail: string) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  if (s.includes("@"))
    return (s.split("@")[0]?.slice(0, 2) || "U").toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return (parts[0].slice(0, 2) || "U").toUpperCase();
  return `${parts[0]?.[0] ?? "U"}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
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
  const androidStatusBar =
    Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const topInset = Math.max(insets.top, androidStatusBar, 18);
  const {
    scrollRef,
    keyboardInset,
    registerField,
    focusField,
    cancelPendingScroll,
  } = useKeyboardAwareScroll<"amount" | "description">(18);
  const [type, setType] = useState<TxType>("Receita");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<TransactionAccountId | null>(
    defaultAccountId,
  );
  const availableCategories = useMemo(
    () =>
      categories.filter(
        (item) => item.flow === (type === "Receita" ? "income" : "expense"),
      ),
    [categories, type],
  );

  useEffect(() => {
    if (!availableCategories.some((item) => item.id === categoryId)) {
      setCategoryId(availableCategories[0]?.id ?? null);
    }
  }, [availableCategories, categoryId]);

  useEffect(() => {
    if (accountId && accountOptions.some((account) => account.id === accountId))
      return;
    setAccountId(
      defaultAccountId &&
        accountOptions.some((account) => account.id === defaultAccountId)
        ? defaultAccountId
        : null,
    );
  }, [accountId, accountOptions, defaultAccountId]);

  function changeType(next: TxType) {
    setType(next);
    setCategoryId(null);
  }

  async function save() {
    const cents = parseBRLToCents(amount);
    if (!cents || !desc.trim() || !accountId || saving) return;
    const saved = await onSave({
      type,
      amount: cents,
      description: desc.trim(),
      categoryId,
      accountId,
    });
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
      <StatusBar
        barStyle="dark-content"
        backgroundColor={OB.offWhite}
        translucent
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalShade}
      >
        <View style={styles.sheet}>
          <View
            pointerEvents="none"
            style={[styles.modalSafeTop, { height: topInset + 8 }]}
          />
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
              <Pressable
                onPress={onClose}
                style={styles.sheetClose}
                accessibilityRole="button"
                accessibilityLabel="Fechar"
              >
                <Ionicons name="close" size={21} color="#fff" />
              </Pressable>
              <Text style={styles.sheetEyebrow}>Movimentações</Text>
              <Text style={styles.sheetTitle}>Novo lançamento</Text>
              <Text style={styles.sheetSubtitle}>
                Registre entradas e saídas com clareza.
              </Text>
            </View>

            <Pressable
              onPress={openImportStatement}
              style={styles.importStatementButton}
            >
              <View style={styles.importStatementIcon}>
                <Ionicons
                  name="cloud-upload-outline"
                  size={18}
                  color={OB.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.importStatementTitle}>
                  Importar extrato
                </Text>
                <Text style={styles.importStatementText}>
                  Carregue movimentações do banco por arquivo
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={OB.support} />
            </Pressable>

            <View style={styles.typeTabs}>
              {(["Receita", "Despesa"] as TxType[]).map((item) => {
                const active = item === type;
                return (
                  <Pressable
                    key={item}
                    onPress={() => changeType(item)}
                    style={[styles.typeTab, active && styles.typeTabActive]}
                  >
                    <Text
                      style={[
                        styles.typeTabText,
                        active && styles.typeTabTextActive,
                      ]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>
              {type === "Receita"
                ? "Onde o dinheiro entrou?"
                : "De onde o dinheiro saiu?"}
            </Text>
            <View style={styles.accountPanel}>
              {accountOptions.map((account) => {
                const active = account.id === accountId;
                return (
                  <Pressable
                    key={account.id}
                    onPress={() => setAccountId(account.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.accountOption,
                      active && styles.accountOptionActive,
                    ]}
                  >
                    <BankLogo
                      bankId={account.id}
                      size={34}
                      color={account.color}
                      shortName={account.shortName}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.accountOptionText,
                        active && styles.accountOptionTextActive,
                      ]}
                    >
                      {account.name}
                    </Text>
                    {active ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={17}
                        color="#fff"
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            {!accountId ? (
              <Text style={styles.accountRequiredText}>
                Escolha uma conta para continuar.
              </Text>
            ) : null}

            <View onLayout={registerField("amount")}>
              <Text style={styles.fieldLabel}>Valor</Text>
              <View style={styles.inputBox}>
                <Text style={styles.currency}>R$</Text>
                <TextInput
                  value={amount.replace("R$", "").trim()}
                  onChangeText={(text) =>
                    setAmount(formatBRLInputFromDigits(text))
                  }
                  placeholder="0,00"
                  placeholderTextColor={OB.support}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  onFocus={() => focusField("amount")}
                  onPressIn={() => focusField("amount")}
                  onSubmitEditing={Keyboard.dismiss}
                  style={styles.input}
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Categoria</Text>
            <View style={styles.categoryPanel}>
              {availableCategories.map((item) => {
                const active = item.id === categoryId;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setCategoryId(item.id)}
                    style={[styles.category, active && styles.categoryActive]}
                  >
                    {active ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={15}
                        color="#fff"
                      />
                    ) : null}
                    <Text
                      style={[
                        styles.categoryText,
                        active && styles.categoryTextActive,
                      ]}
                    >
                      {item.name}
                    </Text>
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

            <Pressable
              onPress={save}
              disabled={
                saving || !parseBRLToCents(amount) || !desc.trim() || !accountId
              }
              style={[
                styles.saveButton,
                (saving ||
                  !parseBRLToCents(amount) ||
                  !desc.trim() ||
                  !accountId) &&
                  styles.saveButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.saveButtonText,
                  (saving ||
                    !parseBRLToCents(amount) ||
                    !desc.trim() ||
                    !accountId) &&
                    styles.saveButtonTextDisabled,
                ]}
              >
                {saving ? "Salvando..." : "Salvar lançamento"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
    <Pressable
      onPress={onPress}
      style={[styles.drawerItem, active && styles.drawerItemActive]}
    >
      <Ionicons name={icon} size={20} color={active ? "#fff" : OB.support} />
      <Text
        style={[styles.drawerItemText, active && styles.drawerItemTextActive]}
      >
        {label}
      </Text>
      <Ionicons
        name="chevron-forward"
        size={15}
        color={active ? "rgba(255,255,255,0.74)" : OB.support}
      />
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
      <Pressable
        onPress={onClose}
        style={[styles.drawerScrim, WEB_DRAWER_BLUR_STYLE]}
      >
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
          <Pressable
            onPress={onClose}
            style={styles.drawerClose}
            accessibilityRole="button"
            accessibilityLabel="Fechar menu"
          >
            <Ionicons name="close" size={21} color="#fff" />
          </Pressable>
          <View style={styles.drawerProfile}>
            <Pressable
              onPress={goProfile}
              style={styles.drawerAvatar}
              accessibilityRole="button"
              accessibilityLabel="Editar perfil"
            >
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.drawerAvatarImage}
                  resizeMode="contain"
                />
              ) : (
                <Text style={styles.drawerAvatarText}>
                  {initialsFrom(displayName)}
                </Text>
              )}
              <View style={styles.drawerAvatarEdit}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </Pressable>
            <Text style={styles.drawerUserName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.drawerSubtitle}>Realize seus sonhos</Text>
          </View>
        </View>

        <View style={styles.drawerList}>
          {MAIN_NAVIGATION_ITEMS.map(({ id, label, icon }) => (
            <DrawerButton
              key={id}
              icon={icon}
              label={label}
              active={activeTab === id}
              onPress={() => goTab(id)}
            />
          ))}
          <DrawerButton
            icon="pricetags-outline"
            label="Categorias"
            onPress={goCategories}
          />
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
  const params = useLocalSearchParams<{
    dreams?: string;
    values?: string;
    tab?: string;
    cycleDate?: string;
    postImport?: string;
    importId?: string;
    reconciledCommitments?: string;
  }>();
  const { session, signOut } = useSession();
  const userId = session?.user?.id ?? null;
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const insets = useSafeAreaInsets();
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const requestedCycleDate = Array.isArray(params.cycleDate)
    ? params.cycleDate[0]
    : params.cycleDate;
  const requestedPostImport = Array.isArray(params.postImport)
    ? params.postImport[0]
    : params.postImport;
  const requestedImportId = Array.isArray(params.importId)
    ? params.importId[0]
    : params.importId;
  const requestedReconciledCommitments = Array.isArray(
    params.reconciledCommitments,
  )
    ? params.reconciledCommitments[0]
    : params.reconciledCommitments;
  const parsedReconciledCommitments = Number(requestedReconciledCommitments);
  const reconciledCommitments = Number.isFinite(parsedReconciledCommitments)
    ? Math.max(0, Math.trunc(parsedReconciledCommitments))
    : 0;
  const initialTab = parseRequestedTab(requestedTab);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [controlCycleDate, setControlCycleDate] = useState(requestedCycleDate);
  const [postImportId, setPostImportId] = useState(
    requestedPostImport === "1" ? requestedImportId : undefined,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [journeyLoading, setJourneyLoading] = useState(true);
  const [expenseToday, setExpenseToday] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(true);
  const lastBackPressRef = useRef(0);
  const logoutPromptOpenRef = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  const onContentScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
      }),
    [scrollY],
  );

  const selectTab = useCallback(
    (nextTab: Tab) => {
      scrollY.setValue(0);
      setTab(nextTab);
      router.setParams({ tab: nextTab });
    },
    [scrollY],
  );

  useLayoutEffect(() => {
    scrollY.setValue(0);
  }, [tab, scrollY]);

  const userMeta = session?.user?.user_metadata as
    | Record<string, any>
    | undefined;
  const displayName =
    userMeta?.full_name ||
    userMeta?.name ||
    session?.user?.email?.split("@")[0] ||
    "Usuário";
  const avatarUrl = userMeta?.avatar_url || userMeta?.picture || null;
  const savedDreams = Array.isArray(userMeta?.finapp_dreams)
    ? JSON.stringify(userMeta.finapp_dreams)
    : undefined;
  const savedValues =
    userMeta?.finapp_dream_values &&
    typeof userMeta.finapp_dream_values === "object"
      ? JSON.stringify(userMeta.finapp_dream_values)
      : undefined;
  const dreams = useMemo(
    () => readJson<string[]>(params.dreams ?? savedDreams, []),
    [params.dreams, savedDreams],
  );
  const values = useMemo(
    () => readJson<Record<string, string>>(params.values ?? savedValues, {}),
    [params.values, savedValues],
  );

  useLayoutEffect(() => {
    if (!requestedTab) return;
    scrollY.setValue(0);
    setTab(parseRequestedTab(requestedTab));
  }, [requestedTab, scrollY]);

  useEffect(() => {
    if (requestedCycleDate) setControlCycleDate(requestedCycleDate);
  }, [requestedCycleDate]);

  useEffect(() => {
    setPostImportId(
      requestedPostImport === "1" && requestedImportId
        ? requestedImportId
        : undefined,
    );
  }, [requestedImportId, requestedPostImport]);

  const rememberControlCycle = useCallback((nextCycleDate: string) => {
    setControlCycleDate(nextCycleDate);
  }, []);

  const finishPostImport = useCallback(() => {
    setPostImportId(undefined);
    router.setParams({
      postImport: undefined,
      importId: undefined,
      reconciledCommitments: undefined,
    });
  }, []);

  const activePostImportId =
    requestedPostImport === "1" && requestedImportId === postImportId
      ? postImportId
      : undefined;

  const loadJourney = useCallback(async () => {
    if (!householdId || !userId) {
      setGoals([]);
      setJourneyLoading(false);
      return;
    }
    try {
      setJourneyLoading(true);
      if (dreams.length)
        await syncGoalsFromDreams({ householdId, userId, dreams, values });
      const [goalRows, txRows] = await Promise.all([
        listGoalsWithProgress(householdId),
        listTransactionsByMonth(householdId),
      ]);
      setGoals(goalRows);
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      setExpenseToday(
        txRows.some((tx) => tx.type === "expense" && tx.occurred_on === today),
      );
    } catch (error: any) {
      Alert.alert(
        "Seus sonhos",
        error?.message ?? "Não foi possível carregar seus sonhos.",
      );
    } finally {
      setJourneyLoading(false);
    }
  }, [dreams, householdId, userId, values]);

  useFocusEffect(
    useCallback(() => {
      if (tab === "jornada" || tab === "desafios") void loadJourney();
    }, [loadJourney, tab]),
  );

  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.contributed_cents < goal.target_cents),
    [goals],
  );
  const completedGoals = useMemo(
    () => goals.filter((goal) => goal.contributed_cents >= goal.target_cents),
    [goals],
  );
  const progressGoals = activeGoals.length ? activeGoals : completedGoals;
  const targetTotal = progressGoals.reduce(
    (sum, goal) => sum + goal.target_cents,
    0,
  );
  const contributedTotal = progressGoals.reduce(
    (sum, goal) => sum + Math.min(goal.contributed_cents, goal.target_cents),
    0,
  );
  const monthTotal = goals.reduce(
    (sum, goal) => sum + goal.month_contributed_cents,
    0,
  );
  const journeyProgress = clampProgress(
    (contributedTotal / Math.max(targetTotal, 1)) * 100,
  );

  function openGoal(goal: GoalProgress) {
    router.push({
      pathname: "/(app)/dream/[goalId]",
      params: { goalId: goal.id },
    });
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

      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          const now = Date.now();
          const action = getAndroidBackAction({
            menuOpen,
            tab,
            isSecondPress:
              now - lastBackPressRef.current <= ANDROID_BACK_PRESS_WINDOW_MS,
          });

          if (action === "close-menu") {
            setMenuOpen(false);
            lastBackPressRef.current = 0;
            return true;
          }

          if (action === "go-home") {
            selectTab("controle");
            lastBackPressRef.current = 0;
            return true;
          }

          if (action === "warn-exit") {
            lastBackPressRef.current = now;
            ToastAndroid.show(
              "Pressione voltar novamente para sair da conta",
              ToastAndroid.SHORT,
            );
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
            },
          );
          return true;
        },
      );

      return () => {
        subscription.remove();
        lastBackPressRef.current = 0;
        logoutPromptOpenRef.current = false;
      };
    }, [logout, menuOpen, selectTab, tab]),
  );

  const challengeCard = (
    <View style={styles.challenge}>
      <View style={{ flex: 1 }}>
        <Text style={styles.challengeEyebrow}>Desafio de hoje</Text>
        <Text style={styles.challengeTitle}>Registre uma despesa do dia</Text>
        <Text style={styles.challengeText}>
          {expenseToday
            ? "Concluído com um lançamento real de hoje."
            : "Adicione uma despesa na aba Movimentações para concluir."}
        </Text>
      </View>
      <View
        style={[styles.checkButton, expenseToday && styles.checkButtonDone]}
      >
        <Ionicons
          name={expenseToday ? "checkmark" : "receipt-outline"}
          size={21}
          color={expenseToday ? "#fff" : OB.support}
        />
      </View>
    </View>
  );

  return (
    <OnboardingShell light edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.content}>
          <JourneyScrollHeader
            avatarUrl={avatarUrl}
            displayName={displayName}
            active={menuOpen}
            onPress={() => setMenuOpen(true)}
            scrollY={scrollY}
          />
          {tab === "controle" ? (
            <SummaryTab
              key={
                activePostImportId
                  ? `post-import:${activePostImportId}`
                  : "control"
              }
              householdId={householdId}
              userId={userId}
              householdLoading={householdLoading}
              cycleDate={controlCycleDate}
              onCycleDateChange={rememberControlCycle}
              postImportId={activePostImportId}
              reconciledCommitments={
                activePostImportId ? reconciledCommitments : 0
              }
              onPostImportHandled={finishPostImport}
              onScroll={onContentScroll}
            />
          ) : tab === "movimentacoes" ? (
            <MovementsScreen embedded onScroll={onContentScroll} />
          ) : tab === "jornada" ? (
            <DreamsTab
              goals={goals}
              activeGoals={activeGoals}
              completedGoals={completedGoals}
              monthTotal={monthTotal}
              journeyProgress={journeyProgress}
              loading={journeyLoading || householdLoading}
              achievementsOpen={achievementsOpen}
              onToggleAchievements={() => setAchievementsOpen((open) => !open)}
              onOpenGoal={openGoal}
              onCreateFirstDream={() => router.push("/(onboarding)/dreams")}
              onAddDream={() =>
                router.push({
                  pathname: "/(onboarding)/dreams",
                  params: {
                    maxDreams: String(3 - activeGoals.length),
                    returnToJourney: "1",
                    excludedDreams: JSON.stringify(
                      goals.map((goal) => goal.title),
                    ),
                  },
                })
              }
              canAddDream={activeGoals.length < 3}
              footer={challengeCard}
              onScroll={onContentScroll}
            />
          ) : (
            <Animated.ScrollView
              contentContainerStyle={[
                styles.challengesPage,
                { paddingBottom: getJourneyBottomContentInset(insets.bottom) },
              ]}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onContentScroll}
            >
              <Ionicons name="trophy-outline" size={42} color={OB.primary} />
              <Text style={styles.placeholderTitle} accessibilityRole="header">
                Seus desafios
              </Text>
              <Text style={styles.placeholderText}>
                As missões são concluídas automaticamente com seus dados reais.
              </Text>
              {challengeCard}
            </Animated.ScrollView>
          )}
        </View>
        <FloatingTabBar
          items={FLOATING_NAVIGATION_ITEMS}
          activeId={tab}
          onSelect={selectTab}
        />
        <JourneyDrawer
          open={menuOpen}
          activeTab={tab}
          displayName={displayName}
          avatarUrl={avatarUrl}
          onClose={() => setMenuOpen(false)}
          onTab={selectTab}
          onLogout={logout}
        />
      </View>
    </OnboardingShell>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
    overflow: "visible",
  },
  content: {
    flex: 1,
    position: "relative",
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
  goalCardCompleted: {
    borderColor: "rgba(22,155,98,0.26)",
    backgroundColor: "#FBFFFD",
  },
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
  allDreamsCompleted: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    paddingHorizontal: 2,
  },
  addGoalCard: {
    minHeight: 52,
    borderRadius: 17,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: OB.support,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  addGoalIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  addGoalText: { flex: 1, color: OB.primary, fontSize: 12, fontWeight: "900" },
  achievementsSection: { gap: 10, marginTop: 4 },
  achievementsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  achievementsTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  achievementsIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5F7EE",
  },
  achievementsTitle: { color: OB.primary, fontSize: 15, fontWeight: "900" },
  achievementsCount: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
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
    paddingTop: JOURNEY_HEADER_HEIGHT + 12,
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
  availableHero: {
    borderRadius: 24,
    padding: 22,
    gap: 9,
    backgroundColor: OB.primary,
    overflow: "hidden",
    shadowColor: OB.primary,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  availableLabel: {
    color: OB.textOnDark,
    fontSize: 15,
    fontWeight: "900",
  },
  availableValue: {
    color: "#fff",
    fontSize: 36,
    lineHeight: 44,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    marginTop: 1,
  },
  availableExplanation: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
  },
  calculationButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    marginTop: 2,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  calculationButtonPressed: {
    opacity: 0.72,
  },
  calculationButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  calculationDetails: {
    borderRadius: 15,
    paddingHorizontal: 13,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  calculationDetailsText: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
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
  sectionEyebrow: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  controlSectionTitle: {
    color: OB.primary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  sectionHelper: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 3,
  },
  summarySectionCard: {
    borderRadius: 21,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  summarySectionHeading: {
    minWidth: 0,
  },
  overviewMetricPair: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 14,
  },
  overviewMetric: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  overviewMetricDivided: {
    paddingRight: 0,
    paddingLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: OB.supportSoft,
  },
  overviewMetricLabel: {
    color: "#5E7591",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  overviewMetricValue: {
    marginTop: 5,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  summaryEmptyText: {
    color: "#5E7591",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 13,
  },
  plannedIncomeNote: {
    color: "#5E7591",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  upcomingPaymentsList: {
    marginTop: 10,
  },
  upcomingPaymentRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  upcomingPaymentRowPressed: {
    opacity: 0.7,
  },
  upcomingPaymentCopy: {
    flex: 1,
    minWidth: 0,
  },
  upcomingPaymentName: {
    color: OB.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  upcomingPaymentDate: {
    color: "#5E7591",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 2,
  },
  upcomingPaymentAction: {
    maxWidth: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  upcomingPaymentAmount: {
    flexShrink: 1,
    minWidth: 0,
    color: OB.primary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  viewAllPaymentsButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingTop: 8,
    paddingRight: 8,
  },
  viewAllPaymentsButtonPressed: {
    opacity: 0.7,
  },
  viewAllPaymentsText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  periodPlanCard: {
    borderRadius: 21,
    padding: 18,
    backgroundColor: "rgba(123,160,200,0.13)",
    borderWidth: 1,
    borderColor: "rgba(123,160,200,0.34)",
  },
  periodPlanTitle: {
    color: OB.primary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
  },
  periodPlanValue: {
    color: OB.primary,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    marginTop: 7,
  },
  periodPlanValueNegative: {
    color: "#A33F3F",
  },
  periodPlanStatus: {
    color: OB.primary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  quickActionsSection: {
    gap: 9,
  },
  quickActionsTitle: {
    color: OB.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    paddingHorizontal: 2,
  },
  quickActionsCard: {
    borderRadius: 19,
    paddingHorizontal: 13,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  summaryAction: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  summaryActionLast: {
    borderBottomWidth: 0,
  },
  summaryActionPressed: {
    opacity: 0.68,
  },
  summaryActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  summaryActionLabel: {
    flex: 1,
    minWidth: 0,
    color: OB.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  summarySecondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 2,
  },
  summarySecondaryAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  summarySecondaryActionPressed: {
    opacity: 0.65,
  },
  summarySecondaryActionText: {
    color: "#5E7591",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  paymentsModalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: OB.modalScrim,
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
    alignItems: "flex-start",
    gap: 9,
  },
  commitmentMainRowPressed: {
    opacity: 0.74,
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
  commitmentStatusPartial: {
    backgroundColor: "rgba(220,160,64,0.14)",
  },
  commitmentStatusText: {
    color: OB.primary,
    fontSize: 9,
    fontWeight: "900",
  },
  commitmentStatusTextPaid: {
    color: "#126B45",
  },
  commitmentStatusTextPartial: {
    color: "#8A5A12",
  },
  commitmentMeta: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 15,
    marginTop: 4,
  },
  commitmentFigures: {
    flexDirection: "row",
    marginTop: 9,
  },
  commitmentFiguresCompact: {
    flexDirection: "column",
    gap: 6,
  },
  commitmentFigure: {
    flex: 1,
    minWidth: 0,
    paddingRight: 7,
  },
  commitmentFigureDivided: {
    borderLeftWidth: 1,
    borderLeftColor: OB.supportSoft,
    paddingLeft: 7,
  },
  commitmentFigureCompact: {
    flex: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 0,
  },
  commitmentFigureDividedCompact: {
    borderLeftWidth: 0,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    paddingLeft: 0,
    paddingTop: 6,
  },
  commitmentFigureLabel: {
    color: "#5E7591",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  commitmentFigureValue: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 3,
  },
  commitmentOpenIcon: {
    alignSelf: "center",
    marginLeft: -3,
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
  challengesPage: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    paddingTop: JOURNEY_HEADER_HEIGHT + 28,
    gap: 8,
  },
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
