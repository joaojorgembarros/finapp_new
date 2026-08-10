import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import {
  getOnboardingDebtValidationError,
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

const DEBT_OPTIONS = [
  "Cartão de crédito",
  "Empréstimo pessoal",
  "Financiamento de veículo",
  "Financiamento imobiliário",
  "Financiamento estudantil",
  "Não tenho dívidas",
] as const;

const NO_DEBTS = NO_DEBTS_OPTION;
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
  const [debtDrafts, setDebtDrafts] = useState<Record<string, DebtDraft>>(
    () => parseDebtDrafts(metadata?.finapp_debt_details)
  );
  const [selectedBanks, setSelectedBanks] = useState<Set<string>>(
    () => new Set(Array.isArray(metadata?.finapp_banks) ? metadata.finapp_banks.map(String) : [])
  );
  const [fixedIncome, setFixedIncome] = useState("");
  const [variableIncome, setVariableIncome] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType | null>(null);
  const [section, setSection] = useState<"income" | "debts" | "banks">("income");
  const [saving, setSaving] = useState(false);

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
  const debtValidationError = useMemo(
    () => getOnboardingDebtValidationError([...selectedDebts], debtDetails),
    [debtDetails, selectedDebts]
  );
  const debtsAnswered = selectedDebts.size > 0 && !debtValidationError;

  function toggleDebt(label: string) {
    setSelectedDebts((current) => {
      if (label === NO_DEBTS) return new Set(current.has(NO_DEBTS) ? [] : [NO_DEBTS]);
      const next = new Set([...current].filter((item) => item !== NO_DEBTS));
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function updateDebtDraft(name: string, changes: Partial<DebtDraft>) {
    setDebtDrafts((current) => ({
      ...current,
      [name]: {
        ...(current[name] ?? {
          amount: "",
          dueDay: "",
          installmentsRemaining: "",
        }),
        ...changes,
      },
    }));
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
    if (debtValidationError) {
      return Alert.alert("Complete suas dívidas", debtValidationError);
    }
    if (!selectedBanks.size) {
      return Alert.alert("Escolha seus bancos", "Selecione ao menos um banco ou marque que não usa banco.");
    }
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

  const canFinish = incomeAnswered && Boolean(employmentType) && debtsAnswered && selectedBanks.size > 0 && !saving;

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
    if (debtValidationError) {
      Alert.alert("Complete suas dívidas", debtValidationError);
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
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            onScrollBeginDrag={cancelPendingScroll}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleContentSizeChange}
            removeClippedSubviews={false}
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

                <View
                  ref={registerFieldNode("income:fixed")}
                  onLayout={registerField("income:fixed")}
                  collapsable={false}
                >
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
                    onFocus={() => focusField("income:fixed")}
                    onPressIn={() => focusField("income:fixed")}
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.moneyInput}
                  />
                  <Text style={styles.fieldHint}>Salário, aposentadoria ou outra entrada recorrente.</Text>
                </View>

                <View
                  ref={registerFieldNode("income:variable")}
                  onLayout={registerField("income:variable")}
                  collapsable={false}
                >
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
                    onFocus={() => focusField("income:variable")}
                    onPressIn={() => focusField("income:variable")}
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
              {selectedDebtNames.length ? (
                <View style={styles.debtDetailsList}>
                  <View style={styles.debtDetailsIntro}>
                    <Ionicons name="calendar-outline" size={18} color={OB.primary} />
                    <Text style={styles.debtDetailsIntroText}>
                      Informe o valor que sai por mês e quando ele vence.
                    </Text>
                  </View>
                  {selectedDebtNames.map((name) => {
                    const draft = debtDrafts[name] ?? {
                      amount: "",
                      dueDay: "",
                      installmentsRemaining: "",
                    };
                    const amountField = `debt:${name}:amount`;
                    const dueDayField = `debt:${name}:due-day`;
                    const installmentsField = `debt:${name}:installments`;
                    return (
                      <View key={name} style={styles.debtDetailCard}>
                        <Text style={styles.debtDetailName}>{name}</Text>
                        <View style={styles.debtFieldsRow}>
                          <View
                            ref={registerFieldNode(amountField)}
                            onLayout={registerField(amountField)}
                            collapsable={false}
                            style={styles.debtAmountField}
                          >
                            <Text style={styles.debtFieldLabel}>Valor mensal</Text>
                            <TextInput
                              accessibilityLabel={`Valor mensal de ${name}`}
                              value={draft.amount}
                              onChangeText={(text) => updateDebtDraft(name, {
                                amount: formatBRLInputFromDigits(text),
                              })}
                              placeholder="R$ 0,00"
                              placeholderTextColor={OB.support}
                              keyboardType="number-pad"
                              returnKeyType="done"
                              selectTextOnFocus
                              onFocus={() => focusField(amountField)}
                              onPressIn={() => focusField(amountField)}
                              onSubmitEditing={Keyboard.dismiss}
                              style={styles.debtInput}
                            />
                          </View>
                          <View
                            ref={registerFieldNode(dueDayField)}
                            onLayout={registerField(dueDayField)}
                            collapsable={false}
                            style={styles.debtDueField}
                          >
                            <Text style={styles.debtFieldLabel}>Vence dia</Text>
                            <TextInput
                              accessibilityLabel={`Dia de vencimento de ${name}`}
                              value={draft.dueDay}
                              onChangeText={(text) => updateDebtDraft(name, {
                                dueDay: text.replace(/\D/g, "").slice(0, 2),
                              })}
                              placeholder="1 a 28"
                              placeholderTextColor={OB.support}
                              keyboardType="number-pad"
                              returnKeyType="done"
                              maxLength={2}
                              onFocus={() => focusField(dueDayField)}
                              onPressIn={() => focusField(dueDayField)}
                              onSubmitEditing={Keyboard.dismiss}
                              style={styles.debtInput}
                            />
                          </View>
                        </View>
                        <View
                          ref={registerFieldNode(installmentsField)}
                          onLayout={registerField(installmentsField)}
                          collapsable={false}
                        >
                          <Text style={styles.debtFieldLabel}>Parcelas restantes (opcional)</Text>
                          <TextInput
                            accessibilityLabel={`Parcelas restantes de ${name}`}
                            value={draft.installmentsRemaining}
                            onChangeText={(text) => updateDebtDraft(name, {
                              installmentsRemaining: text.replace(/\D/g, "").slice(0, 3),
                            })}
                            placeholder="Deixe vazio se não houver número definido"
                            placeholderTextColor={OB.support}
                            keyboardType="number-pad"
                            returnKeyType="done"
                            maxLength={3}
                            onFocus={() => focusField(installmentsField)}
                            onPressIn={() => focusField(installmentsField)}
                            onSubmitEditing={Keyboard.dismiss}
                            style={styles.debtInput}
                          />
                          <Text style={styles.debtFieldHint}>
                            Com parcelas, o compromisso termina automaticamente. Sem elas, continua mensalmente.
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                  {debtValidationError ? (
                    <Text style={styles.debtValidationText}>{debtValidationError}</Text>
                  ) : null}
                </View>
              ) : null}
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
                  ? selectedDebtNames.length
                    ? "Esses valores entrarão automaticamente no seu planejamento mensal."
                    : "Na próxima parte, você poderá escolher seus bancos."
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
                disabled={!debtsAnswered}
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
  debtDetailsList: {
    gap: 12,
    marginTop: 18,
  },
  debtDetailsIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
  },
  debtDetailsIntroText: {
    flex: 1,
    color: OB.support,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  debtDetailCard: {
    borderRadius: 18,
    padding: 15,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  debtDetailName: {
    color: OB.primary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    marginBottom: 10,
  },
  debtFieldsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    marginBottom: 10,
  },
  debtAmountField: {
    flex: 1,
  },
  debtDueField: {
    width: 104,
  },
  debtFieldLabel: {
    color: OB.primary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  debtInput: {
    minHeight: 46,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 12,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  debtFieldHint: {
    color: OB.support,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 6,
  },
  debtValidationText: {
    color: "#B42318",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    paddingHorizontal: 2,
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
