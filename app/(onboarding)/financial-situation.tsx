import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as NavigationBar from "expo-navigation-bar";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  OB,
  OnboardingShell,
} from "../../src/ui/OnboardingKit";
import { markNewOnboardingDone } from "../../src/lib/newOnboarding";
import { useSession } from "../../src/providers/SessionProvider";
import { BANK_OPTIONS } from "../../src/lib/banks";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { EmploymentType, getProfile } from "../../src/lib/profile";
import { BankLogo } from "../../src/ui/BankLogo";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import {
  NO_DEBTS_OPTION,
} from "../../src/lib/onboardingDebts";
import type { OnboardingDebtDetail } from "../../src/lib/onboardingDebts";

type Bank = {
  id: string;
  name: string;
  shortName: string;
  color: string;
};

type DebtDraft = {
  amount: string;
  dueDay: string;
  installmentsRemaining: string;
};

const DEBT_CATEGORY_OPTIONS = [
  "Cartão de crédito",
  "Empréstimo pessoal",
  "Financiamento de veículo",
  "Financiamento imobiliário",
  "Financiamento estudantil",
  "Outros",
] as const;

const DEBT_OPTIONS = [...DEBT_CATEGORY_OPTIONS, "Não tenho dívidas"] as const;

const DEBT_ICONS = {
  "Cartão de crédito": "card-outline",
  "Empréstimo pessoal": "person-outline",
  "Financiamento de veículo": "car-outline",
  "Financiamento imobiliário": "home-outline",
  "Financiamento estudantil": "school-outline",
  Outros: "ellipsis-horizontal",
} as const;

const NO_DEBTS = NO_DEBTS_OPTION;
const NO_BANK = "Não uso banco";

const BANKS: Bank[] = [
  ...BANK_OPTIONS.map(({ id, name, shortName, color }) => ({ id, name, shortName, color })),
  { id: "no-bank", name: NO_BANK, shortName: "—", color: "#64748B" },
];

const EMPLOYMENT_TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];
const BRAND_SYMBOL = require("../../assets/splash-brand-symbol.png");

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

function parseDebtDrafts(raw: unknown) {
  const drafts: Record<string, DebtDraft> = {};
  if (!Array.isArray(raw)) return drafts;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const detail = item as Record<string, unknown>;
    const name = typeof detail.name === "string" ? detail.name : "";
    const amountCents = Number(detail.amountCents);
    const dueDay = Number(detail.dueDay);
    const installmentsRemaining = detail.installmentsRemaining == null
      ? null
      : Number(detail.installmentsRemaining);
    if (!name) continue;
    drafts[name] = {
      amount: Number.isSafeInteger(amountCents) && amountCents > 0
        ? formatBRLFromCents(amountCents)
        : "",
      dueDay: Number.isInteger(dueDay) && dueDay > 0 ? String(dueDay) : "",
      installmentsRemaining: Number.isInteger(installmentsRemaining)
        && Number(installmentsRemaining) > 0
        ? String(installmentsRemaining)
        : "",
    };
  }
  return drafts;
}

function DebtOptionCard({
  label,
  selected,
  twoColumns,
  onPress,
}: {
  label: string;
  selected: boolean;
  twoColumns: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.debtCard,
        twoColumns ? styles.debtCardHalf : styles.debtCardFull,
        selected && styles.debtCardSelected,
      ]}
    >
      <View style={[styles.debtCardIcon, selected && styles.debtCardIconSelected]}>
        <Ionicons
          name={DEBT_ICONS[label as keyof typeof DEBT_ICONS]}
          size={18}
          color={selected ? "#FFFFFF" : "#AFC7E8"}
        />
      </View>
      <Text style={styles.debtCardLabel}>{label}</Text>
      {selected ? (
        <View style={styles.debtCardCheck}>
          <Ionicons name="checkmark" size={10} color="#06152E" />
        </View>
      ) : null}
    </Pressable>
  );
}

function BankCard({
  bank,
  selected,
  twoColumns,
  onPress,
}: {
  bank: Bank;
  selected: boolean;
  twoColumns: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={bank.name}
      onPress={onPress}
      style={[
        styles.bankCard,
        twoColumns ? styles.bankCardHalf : styles.bankCardFull,
        selected && styles.bankCardSelected,
      ]}
    >
      <View style={[styles.bankCheck, selected && styles.bankCheckSelected]}>
        {selected ? <Ionicons name="checkmark" size={10} color="#06152E" /> : null}
      </View>
      <BankLogo bankId={bank.id} size={36} color={bank.color} shortName={bank.shortName} />
      <Text numberOfLines={2} style={styles.bankName}>{bank.name}</Text>
    </Pressable>
  );
}

export default function FinancialSituationScreen() {
  const { height, width } = useWindowDimensions();
  const compact = height < 760;
  const debtGridTwoColumns = width >= 360;
  const params = useLocalSearchParams<{ dreams?: string; values?: string }>();
  const { session, userId } = useSession();
  const metadata = session?.user.user_metadata;
  const {
    scrollRef: listRef,
    keyboardVisible,
    keyboardInset,
    registerField,
    registerFieldNode,
    focusField,
    cancelPendingScroll,
    handleScroll,
    handleContentSizeChange,
  } = useKeyboardAwareScroll<string>(12, {
    ensureFieldRunway: true,
    keyboardClearance: 72,
  });
  const savingRef = useRef(false);

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
  const [debtDrafts] = useState<Record<string, DebtDraft>>(
    () => parseDebtDrafts(metadata?.finapp_debt_details)
  );
  const [selectedBanks, setSelectedBanks] = useState<Set<string>>(
    () => new Set(Array.isArray(metadata?.finapp_banks) ? metadata.finapp_banks.map(String) : [])
  );
  const [fixedIncome, setFixedIncome] = useState("");
  const [variableIncome, setVariableIncome] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType | null>(null);
  const [variableIncomeOpen, setVariableIncomeOpen] = useState(false);
  const [fixedFocused, setFixedFocused] = useState(false);
  const [section, setSection] = useState<"income" | "debts" | "banks">("income");
  const [saving, setSaving] = useState(false);
  const [debtChoiceError, setDebtChoiceError] = useState<string | null>(null);
  const [bankChoiceError, setBankChoiceError] = useState<string | null>(null);
  const variableInputRef = useRef<TextInput>(null);

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

  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setBackgroundColorAsync(OB.primaryDeep).catch(() => {});
    NavigationBar.setButtonStyleAsync("light").catch(() => {});
    return () => {
      NavigationBar.setBackgroundColorAsync("#f8fafc").catch(() => {});
      NavigationBar.setButtonStyleAsync("dark").catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (variableIncome.trim()) setVariableIncomeOpen(true);
  }, [variableIncome]);

  const fixedIncomeCents = useMemo(() => parseBRLToCents(fixedIncome), [fixedIncome]);
  const variableIncomeCents = useMemo(() => parseBRLToCents(variableIncome), [variableIncome]);
  const incomeAnswered = Boolean(fixedIncome.trim() || variableIncome.trim());

  const selectedDebtNames = useMemo(
    () => DEBT_OPTIONS.filter((name) => name !== NO_DEBTS && selectedDebts.has(name)),
    [selectedDebts]
  );
  const debtDetails = useMemo<OnboardingDebtDetail[]>(
    () => selectedDebtNames.map((name) => {
      const draft = debtDrafts[name] ?? { amount: "", dueDay: "", installmentsRemaining: "" };
      return {
        name,
        amountCents: parseBRLToCents(draft.amount),
        dueDay: /^\d+$/.test(draft.dueDay.trim()) ? Number(draft.dueDay) : Number.NaN,
        installmentsRemaining: draft.installmentsRemaining.trim()
          ? Number(draft.installmentsRemaining)
          : null,
      };
    }),
    [debtDrafts, selectedDebtNames]
  );

  function toggleDebt(label: string) {
    setDebtChoiceError(null);
    setSelectedDebts((current) => {
      if (label === NO_DEBTS) return new Set(current.has(NO_DEBTS) ? [] : [NO_DEBTS]);
      const next = new Set([...current].filter((item) => item !== NO_DEBTS));
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleBank(label: string) {
    setBankChoiceError(null);
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
    if (!selectedBanks.size) return;
    if (savingRef.current) return;

    try {
      savingRef.current = true;
      setSaving(true);
      await markNewOnboardingDone(userId, dreams, values, {
        banks: [...selectedBanks],
        debts: [...selectedDebts],
        debtDetails,
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
      savingRef.current = false;
      setSaving(false);
    }
  }

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

  function openVariableIncome() {
    setVariableIncomeOpen(true);
    requestAnimationFrame(() => {
      focusField("income:variable");
      variableInputRef.current?.focus();
    });
  }

  function continueToBanks() {
    if (!selectedDebts.size) {
      setDebtChoiceError("Selecione uma opção para continuar.");
      return;
    }
    setDebtChoiceError(null);
    setSection("banks");
  }

  function completeOnboarding() {
    if (!selectedBanks.size) {
      setBankChoiceError("Selecione uma opção para continuar.");
      return;
    }
    setBankChoiceError(null);
    void finish();
  }

  const variableFilled = Boolean(variableIncome.trim());
  const continueDisabled = !incomeAnswered || !employmentType;

  if (section === "income") {
    return (
      <OnboardingShell>
        <StatusBar style="light" backgroundColor={OB.primaryDeep} translucent={false} />
        <View pointerEvents="none" style={styles.incomeBackground} />
        <KeyboardAvoidingView
          enabled={Platform.OS === "ios"}
          behavior="padding"
          style={styles.incomeKeyboard}
        >
          <View style={styles.incomeFrame}>
            <View style={[styles.incomeTop, compact && styles.incomeTopCompact]}>
              <View style={styles.incomeNav}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Voltar"
                  hitSlop={6}
                  onPress={handleBack}
                  style={({ pressed }) => [styles.incomeBack, pressed && styles.incomeBackPressed]}
                >
                  <Ionicons name="arrow-back" size={27} color="#FFFFFF" />
                </Pressable>
                <Image
                  accessible={false}
                  resizeMode="contain"
                  source={BRAND_SYMBOL}
                  style={styles.incomeBrand}
                  tintColor="#FFFFFF"
                />
              </View>
              <View
                accessibilityRole="text"
                accessibilityLabel="Etapa 3 de 3"
                style={styles.incomeProgressBlock}
              >
                <Text style={styles.incomeStepText}>3 de 3</Text>
                <View style={styles.incomeProgressTrack}>
                  {[0, 1, 2].map((index) => (
                    <View key={index} style={[styles.incomeProgressSegment, styles.incomeProgressSegmentActive]} />
                  ))}
                </View>
              </View>
            </View>

            <ScrollView
              ref={listRef}
              style={styles.incomeScroll}
              contentContainerStyle={[
                styles.incomeContent,
                compact && styles.incomeContentCompact,
                keyboardVisible && styles.incomeContentKeyboard,
                keyboardInset ? { paddingBottom: 28 + keyboardInset } : null,
              ]}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
              onScrollBeginDrag={cancelPendingScroll}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onContentSizeChange={handleContentSizeChange}
              removeClippedSubviews={false}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.incomeBadge}>
                <Text style={styles.incomeBadgeText}>Parte 1 de 3</Text>
              </View>
              <Text accessibilityRole="header" style={[styles.incomeTitle, compact && styles.incomeTitleCompact]}>
                {"Vamos entender\nsua renda."}
              </Text>
              <Text style={[styles.incomeSubtitle, compact && styles.incomeSubtitleCompact]}>
                Essas informações ajudam a montar seu plano inicial.
              </Text>

              <Text style={styles.incomeFieldLabel}>Renda fixa mensal</Text>
              <View
                ref={registerFieldNode("income:fixed")}
                onLayout={registerField("income:fixed")}
                collapsable={false}
                style={[styles.incomeFixedField, fixedFocused && styles.incomeFixedFieldFocused]}
              >
                <Text style={[styles.incomeCurrency, !fixedIncome.trim() && styles.incomeCurrencyMuted]}>R$</Text>
                <TextInput
                  accessibilityLabel="Renda fixa mensal"
                  value={fixedIncome.replace("R$", "").trim()}
                  onChangeText={(text) => setFixedIncome(formatBRLInputFromDigits(text))}
                  placeholder="0"
                  placeholderTextColor="#8C9AAE"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  onFocus={() => {
                    setFixedFocused(true);
                    focusField("income:fixed");
                  }}
                  onBlur={() => setFixedFocused(false)}
                  onPressIn={() => focusField("income:fixed")}
                  onSubmitEditing={Keyboard.dismiss}
                  style={styles.incomeFixedInput}
                />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tenho renda variável"
                onPress={openVariableIncome}
                style={({ pressed }) => [styles.incomeVariableRow, pressed && styles.incomeVariableRowPressed]}
              >
                <View style={styles.incomeVariableMark}>
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                </View>
                <Text style={styles.incomeVariableLabel}>Tenho renda variável</Text>
                {variableFilled ? (
                  <Text style={styles.incomeVariableValue}>{variableIncome} / mês</Text>
                ) : null}
                <Ionicons name="chevron-forward" size={18} color="#C2CBD9" />
              </Pressable>

              {variableIncomeOpen ? (
                <View
                  ref={registerFieldNode("income:variable")}
                  onLayout={registerField("income:variable")}
                  collapsable={false}
                  style={styles.incomeVariableField}
                >
                  <TextInput
                    ref={variableInputRef}
                    accessibilityLabel="Média de renda extra mensal"
                    value={variableIncome.replace("R$", "").trim()}
                    onChangeText={(text) => setVariableIncome(formatBRLInputFromDigits(text))}
                    placeholder="Média mensal"
                    placeholderTextColor="#8C9AAE"
                    keyboardType="number-pad"
                    returnKeyType="done"
                    selectTextOnFocus
                    onFocus={() => focusField("income:variable")}
                    onPressIn={() => focusField("income:variable")}
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.incomeVariableInput}
                  />
                </View>
              ) : null}

              <Text style={[styles.incomeFieldLabel, styles.incomeWorkLabel]}>Tipo de trabalho</Text>
              <View style={styles.incomeChips}>
                {EMPLOYMENT_TYPES.map((item) => {
                  const selected = employmentType === item;
                  return (
                    <Pressable
                      key={item}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setEmploymentType(item)}
                      style={[styles.incomeChip, selected && styles.incomeChipSelected]}
                    >
                      <Text style={[styles.incomeChipText, selected && styles.incomeChipTextSelected]}>{item}</Text>
                      {selected ? (
                        <View style={styles.incomeChipCheck}>
                          <Ionicons name="checkmark" size={10} color="#06152E" />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {!keyboardVisible ? (
              <View style={styles.incomeFooter}>
                <View style={styles.incomeFooterHintRow}>
                  <Ionicons name="shield-checkmark-outline" size={15} color="#8C9AAE" />
                  <Text style={styles.incomeFooterHint}>Você poderá ajustar isso depois.</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Continuar"
                  accessibilityState={{ disabled: continueDisabled }}
                  disabled={continueDisabled}
                  onPress={continueToDebts}
                  style={({ pressed }) => [
                    styles.incomeContinue,
                    continueDisabled && styles.incomeContinueDisabled,
                    pressed && !continueDisabled ? styles.incomeContinuePressed : null,
                  ]}
                >
                  <Text style={[styles.incomeContinueText, continueDisabled && styles.incomeContinueTextDisabled]}>
                    Continuar
                  </Text>
                  <View style={styles.incomeContinueArrow}>
                    <Ionicons
                      name="arrow-forward"
                      size={18}
                      color={continueDisabled ? "rgba(255,255,255,0.42)" : "#06152E"}
                    />
                  </View>
                </Pressable>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </OnboardingShell>
    );
  }

  if (section === "debts") {
    return (
      <OnboardingShell>
        <StatusBar style="light" backgroundColor={OB.primaryDeep} translucent={false} />
        <View pointerEvents="none" style={styles.incomeBackground} />
        <View style={styles.incomeFrame}>
          <View style={[styles.incomeTop, compact && styles.incomeTopCompact]}>
            <View style={styles.incomeNav}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Voltar"
                hitSlop={6}
                onPress={handleBack}
                style={({ pressed }) => [styles.incomeBack, pressed && styles.incomeBackPressed]}
              >
                <Ionicons name="arrow-back" size={27} color="#FFFFFF" />
              </Pressable>
              <Image
                accessible={false}
                resizeMode="contain"
                source={BRAND_SYMBOL}
                style={styles.incomeBrand}
                tintColor="#FFFFFF"
              />
            </View>
            <View
              accessibilityRole="text"
              accessibilityLabel="Etapa 3 de 3"
              style={styles.incomeProgressBlock}
            >
              <Text style={styles.incomeStepText}>3 de 3</Text>
              <View style={styles.incomeProgressTrack}>
                {[0, 1, 2].map((index) => (
                  <View key={index} style={[styles.incomeProgressSegment, styles.incomeProgressSegmentActive]} />
                ))}
              </View>
            </View>
          </View>

          <ScrollView
            style={styles.incomeScroll}
            contentContainerStyle={[
              styles.incomeContent,
              compact && styles.incomeContentCompact,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.incomeBadge}>
              <Text style={styles.incomeBadgeText}>Parte 2 de 3</Text>
            </View>
            <Text accessibilityRole="header" style={[styles.incomeTitle, compact && styles.incomeTitleCompact]}>
              {"Vamos entender\nsuas dívidas."}
            </Text>
            <Text style={[styles.incomeSubtitle, compact && styles.incomeSubtitleCompact]}>
              Escolha os compromissos que fazem parte do seu momento atual.
            </Text>

            <Text style={styles.debtQuestion}>Você possui alguma dívida?</Text>
            <Text style={styles.debtHelper}>Você pode selecionar mais de uma opção.</Text>

            <View style={styles.debtGrid}>
              {DEBT_CATEGORY_OPTIONS.map((option) => (
                <DebtOptionCard
                  key={option}
                  label={option}
                  selected={selectedDebts.has(option)}
                  twoColumns={debtGridTwoColumns}
                  onPress={() => toggleDebt(option)}
                />
              ))}
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selectedDebts.has(NO_DEBTS) }}
              accessibilityLabel="Não tenho dívidas"
              onPress={() => toggleDebt(NO_DEBTS)}
              style={[
                styles.debtNoneRow,
                selectedDebts.has(NO_DEBTS) && styles.debtNoneRowSelected,
              ]}
            >
              <View style={[styles.debtNoneMark, selectedDebts.has(NO_DEBTS) && styles.debtNoneMarkSelected]}>
                {selectedDebts.has(NO_DEBTS) ? (
                  <Ionicons name="checkmark" size={16} color="#06152E" />
                ) : (
                  <Ionicons name="checkmark" size={16} color="#AFC7E8" />
                )}
              </View>
              <Text style={styles.debtNoneLabel}>Não tenho dívidas</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.incomeFooter}>
            {debtChoiceError ? (
              <Text style={styles.debtChoiceError}>{debtChoiceError}</Text>
            ) : (
              <View style={styles.incomeFooterHintRow}>
                <Ionicons name="shield-checkmark-outline" size={15} color="#8C9AAE" />
                <Text style={styles.incomeFooterHint}>Você poderá ajustar isso depois.</Text>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continuar"
              onPress={continueToBanks}
              style={({ pressed }) => [
                styles.incomeContinue,
                pressed ? styles.incomeContinuePressed : null,
              ]}
            >
              <Text style={styles.incomeContinueText}>Continuar</Text>
              <View style={styles.incomeContinueArrow}>
                <Ionicons name="arrow-forward" size={18} color="#06152E" />
              </View>
            </Pressable>
          </View>
        </View>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell>
      <StatusBar style="light" backgroundColor={OB.primaryDeep} translucent={false} />
      <View pointerEvents="none" style={styles.incomeBackground} />
      <View style={styles.incomeFrame}>
        <View style={[styles.incomeTop, compact && styles.incomeTopCompact]}>
          <View style={styles.incomeNav}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Voltar"
              hitSlop={6}
              onPress={handleBack}
              style={({ pressed }) => [styles.incomeBack, pressed && styles.incomeBackPressed]}
            >
              <Ionicons name="arrow-back" size={27} color="#FFFFFF" />
            </Pressable>
            <Image
              accessible={false}
              resizeMode="contain"
              source={BRAND_SYMBOL}
              style={styles.incomeBrand}
              tintColor="#FFFFFF"
            />
          </View>
          <View
            accessibilityRole="text"
            accessibilityLabel="Etapa 3 de 3"
            style={styles.incomeProgressBlock}
          >
            <Text style={styles.incomeStepText}>3 de 3</Text>
            <View style={styles.incomeProgressTrack}>
              {[0, 1, 2].map((index) => (
                <View key={index} style={[styles.incomeProgressSegment, styles.incomeProgressSegmentActive]} />
              ))}
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.incomeScroll}
          contentContainerStyle={[
            styles.incomeContent,
            compact && styles.incomeContentCompact,
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.incomeBadge}>
            <Text style={styles.incomeBadgeText}>Parte 3 de 3</Text>
          </View>
          <Text accessibilityRole="header" style={[styles.incomeTitle, compact && styles.incomeTitleCompact]}>
            {"Vamos entender\nseus bancos."}
          </Text>
          <Text style={[styles.incomeSubtitle, compact && styles.incomeSubtitleCompact]}>
            Selecione os bancos que fazem parte da sua rotina.
          </Text>

          <Text style={styles.debtQuestion}>Quais bancos você usa?</Text>

          <View style={styles.bankGrid}>
            {BANKS.map((bank) => (
              <BankCard
                key={bank.name}
                bank={bank}
                selected={selectedBanks.has(bank.name)}
                twoColumns={debtGridTwoColumns}
                onPress={() => toggleBank(bank.name)}
              />
            ))}
          </View>
        </ScrollView>

        <View style={styles.incomeFooter}>
          {bankChoiceError ? (
            <Text style={styles.debtChoiceError}>{bankChoiceError}</Text>
          ) : (
            <View style={styles.incomeFooterHintRow}>
              <Ionicons name="shield-checkmark-outline" size={15} color="#8C9AAE" />
              <Text style={styles.incomeFooterHint}>Você poderá ajustar isso depois.</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Concluir"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={completeOnboarding}
            style={({ pressed }) => [
              styles.incomeContinue,
              saving && styles.incomeContinueDisabled,
              pressed && !saving ? styles.incomeContinuePressed : null,
            ]}
          >
            <Text style={[styles.incomeContinueText, saving && styles.incomeContinueTextDisabled]}>
              {saving ? "Preparando sua jornada..." : "Concluir"}
            </Text>
            {saving ? null : (
              <View style={styles.incomeContinueArrow}>
                <Ionicons name="arrow-forward" size={18} color="#06152E" />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  debtQuestion: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    marginBottom: 6,
  },
  debtHelper: {
    marginBottom: 18,
    color: "#8C9AAE",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  debtGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  debtCard: {
    position: "relative",
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.22)",
    backgroundColor: "rgba(255,255,255,0.03)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  debtCardHalf: {
    width: "48%",
    flexGrow: 1,
  },
  debtCardFull: {
    width: "100%",
  },
  debtCardSelected: {
    borderColor: "rgba(175,199,232,0.78)",
    backgroundColor: "rgba(123,160,200,0.12)",
  },
  debtCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(175,199,232,0.28)",
  },
  debtCardIconSelected: {
    borderColor: "rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  debtCardLabel: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  debtCardCheck: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  debtNoneRow: {
    minHeight: 58,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.22)",
    backgroundColor: "rgba(255,255,255,0.03)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
  },
  debtNoneRowSelected: {
    borderColor: "rgba(175,199,232,0.82)",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  debtNoneMark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(175,199,232,0.32)",
  },
  debtNoneMarkSelected: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
  },
  debtNoneLabel: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
  },
  debtChoiceError: {
    marginBottom: 12,
    color: "#C9D4E4",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    textAlign: "center",
  },
  bankGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  bankCard: {
    position: "relative",
    minHeight: 118,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.22)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingTop: 22,
    paddingBottom: 14,
    gap: 10,
  },
  bankCardHalf: {
    width: "48%",
    flexGrow: 1,
  },
  bankCardFull: {
    width: "100%",
  },
  bankCardSelected: {
    borderColor: "rgba(175,199,232,0.82)",
    backgroundColor: "rgba(123,160,200,0.12)",
    shadowColor: "#7BA0C8",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  bankName: {
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 4,
  },
  bankCheck: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.42)",
    backgroundColor: "transparent",
  },
  bankCheckSelected: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
  },
  incomeBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#06152E",
  },
  incomeKeyboard: {
    flex: 1,
  },
  incomeFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  incomeTop: {
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 5,
  },
  incomeTopCompact: {
    paddingTop: 2,
  },
  incomeNav: {
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  incomeBack: {
    position: "absolute",
    left: -7,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  incomeBackPressed: {
    opacity: 0.7,
  },
  incomeBrand: {
    width: 46,
    height: 52,
  },
  incomeProgressBlock: {
    alignItems: "center",
    paddingTop: 8,
  },
  incomeStepText: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
  },
  incomeProgressTrack: {
    width: "74%",
    maxWidth: 284,
    flexDirection: "row",
    gap: 7,
    marginTop: 13,
  },
  incomeProgressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 99,
    backgroundColor: "rgba(140,154,174,0.20)",
  },
  incomeProgressSegmentActive: {
    backgroundColor: "#FFFFFF",
  },
  incomeScroll: {
    flex: 1,
  },
  incomeContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
  },
  incomeContentCompact: {
    paddingTop: 10,
  },
  incomeContentKeyboard: {
    paddingBottom: 28,
  },
  incomeBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.28)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  incomeBadgeText: {
    color: "#AFC7E8",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  incomeTitle: {
    color: "#FFFFFF",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -0.7,
    textAlign: "left",
  },
  incomeTitleCompact: {
    fontSize: 28,
    lineHeight: 34,
  },
  incomeSubtitle: {
    marginTop: 10,
    marginBottom: 28,
    color: "#8C9AAE",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    textAlign: "left",
  },
  incomeSubtitleCompact: {
    marginTop: 8,
    marginBottom: 20,
    fontSize: 14,
    lineHeight: 20,
  },
  incomeFieldLabel: {
    color: "#8C9AAE",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginBottom: 10,
  },
  incomeWorkLabel: {
    marginTop: 26,
  },
  incomeFixedField: {
    minHeight: 64,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.28)",
    backgroundColor: "rgba(255,255,255,0.035)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  incomeFixedFieldFocused: {
    borderColor: "rgba(175,199,232,0.72)",
    backgroundColor: "rgba(123,160,200,0.10)",
  },
  incomeCurrency: {
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginRight: 8,
  },
  incomeCurrencyMuted: {
    color: "#8C9AAE",
  },
  incomeFixedInput: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.4,
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  incomeVariableRow: {
    minHeight: 54,
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.20)",
    backgroundColor: "rgba(255,255,255,0.025)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 12,
    paddingRight: 12,
  },
  incomeVariableRowPressed: {
    backgroundColor: "rgba(123,160,200,0.08)",
  },
  incomeVariableMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  incomeVariableLabel: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
  },
  incomeVariableValue: {
    color: "#8C9AAE",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "500",
  },
  incomeVariableField: {
    marginTop: 10,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.28)",
    backgroundColor: "rgba(255,255,255,0.03)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  incomeVariableInput: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    paddingVertical: 10,
  },
  incomeChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  incomeChip: {
    position: "relative",
    minHeight: 42,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.22)",
    backgroundColor: "rgba(255,255,255,0.02)",
    overflow: "visible",
  },
  incomeChipSelected: {
    borderColor: "rgba(255,255,255,0.88)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  incomeChipText: {
    color: "#8C9AAE",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
  },
  incomeChipTextSelected: {
    color: "#FFFFFF",
  },
  incomeChipCheck: {
    position: "absolute",
    top: -5,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  incomeFooter: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 10,
  },
  incomeFooterHintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 12,
  },
  incomeFooterHint: {
    color: "#8C9AAE",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  incomeContinue: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  incomeContinueDisabled: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  incomeContinuePressed: {
    opacity: 0.86,
  },
  incomeContinueText: {
    color: "#06152E",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  incomeContinueTextDisabled: {
    color: "rgba(255,255,255,0.42)",
  },
  incomeContinueArrow: {
    position: "absolute",
    right: 22,
  },
});
