import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  OB,
  OnboardingBackground,
  OnboardingShell,
  PrimaryButton,
  ScreenIntro,
} from "../../src/ui/OnboardingKit";
import { markNewOnboardingDone } from "../../src/lib/newOnboarding";
import { useSession } from "../../src/providers/SessionProvider";
import { BANK_OPTIONS } from "../../src/lib/banks";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { EmploymentType, expectedMonthlyIncomeCents, getProfile } from "../../src/lib/profile";
import { BankLogo } from "../../src/ui/BankLogo";

type Bank = {
  id: string;
  name: string;
  shortName: string;
  color: string;
};

const DEBT_OPTIONS = [
  "Cartão de crédito",
  "Empréstimo pessoal",
  "Financiamento de veículo",
  "Financiamento imobiliário",
  "Financiamento estudantil",
  "Não tenho dívidas",
] as const;

const NO_DEBTS = "Não tenho dívidas";
const NO_BANK = "Não uso banco";

const BANKS: Bank[] = [
  ...BANK_OPTIONS.map(({ id, name, shortName, color }) => ({ id, name, shortName, color })),
  { id: "no-bank", name: NO_BANK, shortName: "—", color: "#64748B" },
];

const EMPLOYMENT_TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];

function parseStringArray(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseValues(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]))
      : {};
  } catch {
    return {};
  }
}

function DebtChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.debtChip, selected && styles.debtChipSelected]}>
      {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      <Text style={[styles.debtChipText, selected && styles.debtChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function BankCard({
  bank,
  selected,
  onPress,
}: {
  bank: Bank;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={bank.name}
      onPress={onPress}
      style={[styles.bankCard, selected && styles.bankCardSelected]}
    >
      <BankLogo bankId={bank.id} size={42} color={bank.color} shortName={bank.shortName} />
      <Text numberOfLines={2} style={styles.bankName}>{bank.name}</Text>
      <View style={[styles.selectionMark, selected && styles.selectionMarkSelected]}>
        {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
      </View>
    </Pressable>
  );
}

export default function FinancialSituationScreen() {
  const params = useLocalSearchParams<{ dreams?: string; values?: string }>();
  const { session, userId } = useSession();
  const metadata = session?.user.user_metadata;
  const listRef = useRef<ScrollView>(null);
  const pendingScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualScrollRef = useRef(false);
  const focusedIncomeField = useRef<"fixed" | "variable" | null>(null);
  const incomeFieldY = useRef<Record<"fixed" | "variable", number>>({ fixed: 0, variable: 0 });

  const dreams = useMemo(
    () => {
      const fromParams = parseStringArray(params.dreams);
      return fromParams.length
        ? fromParams
        : Array.isArray(metadata?.finapp_dreams)
          ? metadata.finapp_dreams.map(String)
          : [];
    },
    [metadata?.finapp_dreams, params.dreams]
  );
  const values = useMemo(
    () => {
      const fromParams = parseValues(params.values);
      return Object.keys(fromParams).length
        ? fromParams
        : parseValues(JSON.stringify(metadata?.finapp_dream_values ?? {}));
    },
    [metadata?.finapp_dream_values, params.values]
  );

  const [selectedDebts, setSelectedDebts] = useState<Set<string>>(
    () => new Set(Array.isArray(metadata?.finapp_debts) ? metadata.finapp_debts.map(String) : [NO_DEBTS])
  );
  const [selectedBanks, setSelectedBanks] = useState<Set<string>>(
    () => new Set(Array.isArray(metadata?.finapp_banks) ? metadata.finapp_banks.map(String) : [])
  );
  const [fixedIncome, setFixedIncome] = useState("");
  const [variableIncome, setVariableIncome] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType | null>(null);
  const [section, setSection] = useState<"income" | "debts" | "banks">("income");
  const [saving, setSaving] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  const clearPendingScroll = useCallback(() => {
    if (pendingScrollRef.current === null) return;
    clearTimeout(pendingScrollRef.current);
    pendingScrollRef.current = null;
  }, []);

  const cancelPendingScroll = useCallback(() => {
    manualScrollRef.current = true;
    clearPendingScroll();
  }, [clearPendingScroll]);

  const scrollToIncomeField = useCallback((field: "fixed" | "variable", delay = 80) => {
    clearPendingScroll();
    if (manualScrollRef.current) return;
    pendingScrollRef.current = setTimeout(() => {
      pendingScrollRef.current = null;
      listRef.current?.scrollTo({
        y: Math.max(incomeFieldY.current[field] - 12, 0),
        animated: true,
      });
    }, delay);
  }, [clearPendingScroll]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);

      const applyInset = (inset: number) => {
        setKeyboardInset(inset);
        if (!manualScrollRef.current && focusedIncomeField.current) {
          scrollToIncomeField(focusedIncomeField.current, 100);
        }
      };

      if (Platform.OS === "ios") {
        applyInset(0);
        return;
      }

      const scrollView = listRef.current?.getNativeScrollRef();
      if (!scrollView) {
        applyInset(0);
        return;
      }

      scrollView.measureInWindow((_x, y, _width, height) => {
        const overlap = Math.max(
          0,
          Math.min(event.endCoordinates.height, y + height - event.endCoordinates.screenY)
        );
        applyInset(overlap);
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardInset(0);
      focusedIncomeField.current = null;
      manualScrollRef.current = false;
      clearPendingScroll();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      clearPendingScroll();
    };
  }, [clearPendingScroll, scrollToIncomeField]);

  function focusIncomeField(field: "fixed" | "variable") {
    manualScrollRef.current = false;
    focusedIncomeField.current = field;
    scrollToIncomeField(field, keyboardVisible ? 40 : 220);
  }

  useEffect(() => {
    let active = true;

    async function loadExistingIncome() {
      if (!userId) return;
      try {
        const profile = await getProfile(userId);
        if (!active || !profile) return;
        const fixed = Number(profile.income_fixed_cents || 0);
        const variable = Number(profile.income_variable_avg_cents || 0);
        if (fixed > 0 || variable > 0) {
          setFixedIncome(fixed > 0 ? formatBRLFromCents(fixed) : "");
          setVariableIncome(variable > 0 ? formatBRLFromCents(variable) : "");
          setEmploymentType(profile.employment_type || null);
        }
      } catch {
        // O preenchimento continua disponivel mesmo quando ainda nao existe perfil.
      }
    }

    loadExistingIncome();
    return () => {
      active = false;
    };
  }, [userId]);

  const fixedIncomeCents = useMemo(() => parseBRLToCents(fixedIncome), [fixedIncome]);
  const variableIncomeCents = useMemo(() => parseBRLToCents(variableIncome), [variableIncome]);
  const expectedIncomeCents = expectedMonthlyIncomeCents({
    income_fixed_cents: fixedIncomeCents,
    income_variable_avg_cents: variableIncomeCents,
  });
  const incomeAnswered = Boolean(fixedIncome.trim() || variableIncome.trim());

  function toggleDebt(label: string) {
    setSelectedDebts((current) => {
      if (label === NO_DEBTS) return new Set(current.has(NO_DEBTS) ? [] : [NO_DEBTS]);
      const next = new Set([...current].filter((item) => item !== NO_DEBTS));
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleBank(label: string) {
    setSelectedBanks((current) => {
      if (label === NO_BANK) return new Set(current.has(NO_BANK) ? [] : [NO_BANK]);
      const next = new Set([...current].filter((item) => item !== NO_BANK));
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function finish() {
    if (!userId) return Alert.alert("Sessão expirada", "Entre novamente para continuar.");
    if (!dreams.length) {
      return Alert.alert("Sonhos não encontrados", "Volte e selecione ao menos um sonho.");
    }
    if (!incomeAnswered || !employmentType) {
      return Alert.alert("Conte sobre sua renda", "Informe sua renda mensal e o tipo de trabalho.");
    }
    if (!selectedDebts.size) {
      return Alert.alert("Conte sobre suas dívidas", "Escolha uma opção para continuar.");
    }
    if (!selectedBanks.size) {
      return Alert.alert("Escolha seus bancos", "Selecione ao menos um banco ou marque que não usa banco.");
    }

    try {
      setSaving(true);
      await markNewOnboardingDone(userId, dreams, values, {
        banks: [...selectedBanks],
        debts: [...selectedDebts],
        incomeFixedCents: fixedIncomeCents,
        incomeVariableAvgCents: variableIncomeCents,
        employmentType,
      });
      router.replace({
        pathname: "/(app)/journey",
        params: {
          dreams: JSON.stringify(dreams),
          values: JSON.stringify(values),
        },
      });
    } catch (error: any) {
      Alert.alert(
        "Não foi possível concluir",
        error?.message ?? "Confira sua conexão e tente novamente."
      );
    } finally {
      setSaving(false);
    }
  }

  const canFinish = incomeAnswered && Boolean(employmentType) && selectedDebts.size > 0 && selectedBanks.size > 0 && !saving;

  function goBack() {
    router.replace({
      pathname: "/(onboarding)/dream-values",
      params: {
        dreams: JSON.stringify(dreams),
        values: JSON.stringify(values),
      },
    });
  }

  function handleBack() {
    if (section === "banks") {
      setSection("debts");
      return;
    }
    if (section === "debts") {
      setSection("income");
      return;
    }
    goBack();
  }

  function continueToDebts() {
    if (!incomeAnswered) {
      Alert.alert("Conte sobre sua renda", "Preencha ao menos um dos valores. Se não recebe renda, informe zero.");
      return;
    }
    if (!employmentType) {
      Alert.alert("Tipo de trabalho", "Selecione a opção que melhor representa sua situação atual.");
      return;
    }
    setSection("debts");
  }

  function continueToBanks() {
    if (!selectedDebts.size) {
      Alert.alert("Conte sobre suas dívidas", "Escolha uma opção para continuar.");
      return;
    }
    setSection("banks");
  }

  return (
    <OnboardingShell>
      <OnboardingBackground />
      <KeyboardAvoidingView
        enabled={Platform.OS === "ios"}
        behavior="padding"
        style={styles.root}
      >
        <ScreenIntro
          eyebrow="Seu ponto de partida"
          title="Vamos entender onde você está hoje"
          subtitle="Essas informações ajudam a organizar uma jornada que faça sentido para você."
          onBack={handleBack}
          currentStep={3}
          totalSteps={3}
        />

        <View style={styles.card}>
          <View style={styles.sectionProgress}>
            <View style={styles.sectionProgressCopy}>
              <Text style={styles.sectionProgressLabel}>
                PARTE {section === "income" ? "1" : section === "debts" ? "2" : "3"} DE 3
              </Text>
              <Text style={styles.sectionProgressTitle}>
                {section === "income" ? "Sua renda" : section === "debts" ? "Dívidas" : "Seus bancos"}
              </Text>
            </View>
            <View style={styles.sectionProgressBars}>
              <View style={styles.sectionProgressBarActive} />
              <View
                style={[
                  styles.sectionProgressBar,
                  section !== "income" && styles.sectionProgressBarActive,
                ]}
              />
              <View
                style={[
                  styles.sectionProgressBar,
                  section === "banks" && styles.sectionProgressBarActive,
                ]}
              />
            </View>
          </View>

          <ScrollView
            ref={listRef}
            key={section}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: 24 + keyboardInset },
            ]}
            showsVerticalScrollIndicator={section !== "debts"}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            onScrollBeginDrag={cancelPendingScroll}
          >
            {section === "income" ? (
              <View>
                <View style={styles.sectionHeading}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name="cash-outline" size={18} color={OB.primary} />
                  </View>
                  <View style={styles.sectionCopy}>
                    <Text style={styles.sectionTitle}>Quanto você recebe por mês?</Text>
                    <Text style={styles.sectionSubtitle}>Separe o que costuma entrar todo mês da renda que pode variar.</Text>
                  </View>
                </View>

                <View onLayout={(event) => { incomeFieldY.current.fixed = event.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>Renda fixa mensal</Text>
                  <TextInput
                    accessibilityLabel="Renda fixa mensal"
                    value={fixedIncome}
                    onChangeText={(text) => setFixedIncome(formatBRLInputFromDigits(text))}
                    placeholder="Ex.: R$ 2.400,00"
                    placeholderTextColor={OB.support}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    selectTextOnFocus
                    onFocus={() => focusIncomeField("fixed")}
                    onPressIn={() => focusIncomeField("fixed")}
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.moneyInput}
                  />
                  <Text style={styles.fieldHint}>Salário, aposentadoria ou outra entrada recorrente.</Text>
                </View>

                <View onLayout={(event) => { incomeFieldY.current.variable = event.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>Média de renda extra</Text>
                  <TextInput
                    accessibilityLabel="Média de renda extra mensal"
                    value={variableIncome}
                    onChangeText={(text) => setVariableIncome(formatBRLInputFromDigits(text))}
                    placeholder="Ex.: R$ 300,00"
                    placeholderTextColor={OB.support}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    selectTextOnFocus
                    onFocus={() => focusIncomeField("variable")}
                    onPressIn={() => focusIncomeField("variable")}
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.moneyInput}
                  />
                  <Text style={styles.fieldHint}>Freelas, comissões, bicos ou outras entradas variáveis.</Text>
                </View>

                <View style={styles.incomeTotalBox}>
                  <Ionicons name="trending-up-outline" size={22} color="#169B62" />
                  <View>
                    <Text style={styles.incomeTotalLabel}>Renda mensal estimada</Text>
                    <Text style={styles.incomeTotalValue}>{formatBRLFromCents(expectedIncomeCents)}</Text>
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Tipo de trabalho</Text>
                <View style={styles.employmentOptions}>
                  {EMPLOYMENT_TYPES.map((item) => {
                    const selected = employmentType === item;
                    return (
                      <Pressable
                        key={item}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setEmploymentType(item)}
                        style={[styles.employmentChip, selected && styles.employmentChipSelected]}
                      >
                        <Text style={[styles.employmentChipText, selected && styles.employmentChipTextSelected]}>{item}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : section === "debts" ? (
              <View>
              <View style={styles.sectionHeading}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="card-outline" size={18} color={OB.primary} />
                </View>
                <View style={styles.sectionCopy}>
                  <Text style={styles.sectionTitle}>Você possui alguma dívida?</Text>
                  <Text style={styles.sectionSubtitle}>Você pode selecionar mais de uma opção.</Text>
                </View>
              </View>
              <View style={styles.debtList}>
                {DEBT_OPTIONS.map((option) => (
                  <DebtChip
                    key={option}
                    label={option}
                    selected={selectedDebts.has(option)}
                    onPress={() => toggleDebt(option)}
                  />
                ))}
              </View>
              </View>
            ) : (
              <View>
              <View style={styles.sectionHeading}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="business-outline" size={18} color={OB.primary} />
                </View>
                <View style={styles.sectionCopy}>
                  <Text style={styles.sectionTitle}>Quais bancos você usa?</Text>
                  <Text style={styles.sectionSubtitle}>Selecione todos que fazem parte da sua rotina.</Text>
                </View>
              </View>
              <View style={styles.bankGrid}>
                {BANKS.map((bank) => (
                  <BankCard
                    key={bank.name}
                    bank={bank}
                    selected={selectedBanks.has(bank.name)}
                    onPress={() => toggleBank(bank.name)}
                  />
                ))}
              </View>
              </View>
            )}
          </ScrollView>

          {!keyboardVisible ? <View style={styles.footer}>
            <Text style={styles.footerHint}>
              {section === "income"
                ? "Esses valores serão a base das suas projeções financeiras."
                : section === "debts"
                  ? "Na próxima parte, você poderá escolher seus bancos."
                  : "Usaremos essas escolhas para personalizar sua experiência."}
            </Text>
            {section === "income" ? (
              <PrimaryButton
                title="Continuar para minhas dívidas"
                disabled={!incomeAnswered || !employmentType}
                onPress={continueToDebts}
              />
            ) : section === "debts" ? (
              <PrimaryButton
                title="Continuar para meus bancos"
                disabled={!selectedDebts.size}
                onPress={continueToBanks}
              />
            ) : (
              <>
                <PrimaryButton
                  title={saving ? "Preparando sua jornada..." : "Concluir e ver minha jornada"}
                  disabled={!canFinish}
                  onPress={finish}
                />
                {saving ? <ActivityIndicator color={OB.primary} size="small" /> : null}
              </>
            )}
          </View> : null}
        </View>
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  card: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.88)",
    shadowColor: OB.primary,
    shadowOpacity: 0.25,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -10 },
    elevation: 10,
  },
  sectionProgress: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  sectionProgressCopy: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  sectionProgressLabel: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  sectionProgressTitle: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  sectionProgressBars: {
    width: 96,
    flexDirection: "row",
    gap: 6,
  },
  sectionProgressBar: {
    flex: 1,
    height: 5,
    borderRadius: 99,
    backgroundColor: OB.supportSoft,
  },
  sectionProgressBarActive: {
    flex: 1,
    height: 5,
    borderRadius: 99,
    backgroundColor: OB.primary,
  },
  content: {
    padding: 20,
    paddingBottom: 24,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF0F7",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  sectionCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  sectionSubtitle: {
    color: OB.support,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  fieldLabel: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 7,
    marginTop: 8,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  moneyInput: {
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
    paddingHorizontal: 15,
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
  },
  fieldHint: {
    color: OB.support,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 5,
    marginBottom: 7,
  },
  incomeTotalBox: {
    minHeight: 68,
    borderRadius: 17,
    backgroundColor: "#EAF8F1",
    borderWidth: 1,
    borderColor: "#BDE8D1",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginVertical: 10,
  },
  incomeTotalLabel: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
  },
  incomeTotalValue: {
    color: OB.primary,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 2,
  },
  employmentOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  employmentChip: {
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  employmentChipSelected: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  employmentChipText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "900",
  },
  employmentChipTextSelected: {
    color: "#fff",
  },
  debtList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  debtChip: {
    minHeight: 42,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  debtChipSelected: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  debtChipText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  debtChipTextSelected: {
    color: "#fff",
  },
  bankGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  bankCard: {
    width: "48.4%",
    minHeight: 112,
    borderRadius: 20,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    shadowColor: OB.primary,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  bankCardSelected: {
    backgroundColor: "#ECF3FB",
    borderColor: OB.primary,
    shadowOpacity: 0.14,
    elevation: 3,
  },
  bankName: {
    color: OB.primary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
    marginTop: 9,
    alignSelf: "stretch",
    textAlign: "center",
    paddingHorizontal: 4,
  },
  selectionMark: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
  },
  selectionMarkSelected: {
    borderColor: OB.primary,
    backgroundColor: OB.primary,
  },
  footer: {
    padding: 20,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    backgroundColor: "rgba(246,247,249,0.98)",
  },
  footerHint: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
});
