import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import {
  archiveCommitment,
  CommitmentKind,
  createCommitment,
  CycleMode,
  FinancialCommitment,
  FinancialSettings,
  getFinancialSettings,
  listCommitments,
  saveFinancialSettings,
  updateCommitment,
} from "../../src/lib/financialPlanning";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

type SettingsField = "payday" | "reserve";
type CommitmentField = "name" | "amount" | "due" | "start" | "installments";

type CommitmentDraft = {
  name: string;
  kind: CommitmentKind;
  amount: string;
  dueDay: string;
  startMonth: string;
  installmentCount: string;
};

const KIND_OPTIONS: {
  value: CommitmentKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "fixed_bill", label: "Conta fixa", icon: "receipt-outline" },
  { value: "debt", label: "Dívida", icon: "alert-circle-outline" },
  { value: "installment", label: "Parcela", icon: "layers-outline" },
];

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function emptyDraft(): CommitmentDraft {
  return {
    name: "",
    kind: "fixed_bill",
    amount: "",
    dueDay: "",
    startMonth: currentMonth(),
    installmentCount: "",
  };
}

function digits(input: string, maxLength: number) {
  return input.replace(/\D/g, "").slice(0, maxLength);
}

function formatMonthInput(input: string) {
  const value = digits(input, 6);
  if (value.length <= 4) return value;
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function isValidMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function kindLabel(kind: CommitmentKind) {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "Compromisso";
}

export default function FinancialPlanScreen() {
  const params = useLocalSearchParams<{ guided?: string }>();
  const requestedGuided = Array.isArray(params.guided) ? params.guided[0] : params.guided;
  const guided = requestedGuided === "1";
  const insets = useSafeAreaInsets();
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const settingsKeyboard = useKeyboardAwareScroll<SettingsField>(18);
  const modalKeyboard = useKeyboardAwareScroll<CommitmentField>(18, {
    ensureFieldRunway: true,
    keyboardClearance: 72,
  });

  const [cycleType, setCycleType] = useState<CycleMode>("calendar");
  const [paydayDay, setPaydayDay] = useState("5");
  const [minimumReserve, setMinimumReserve] = useState("");
  const [commitments, setCommitments] = useState<FinancialCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingCommitment, setSavingCommitment] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [settingsSaveError, setSettingsSaveError] = useState("");
  const [commitmentSaveError, setCommitmentSaveError] = useState("");
  const [guidedStep, setGuidedStep] = useState<1 | 2>(1);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<FinancialCommitment | null>(null);
  const [draft, setDraft] = useState<CommitmentDraft>(emptyDraft);

  const applySettings = useCallback((settings: FinancialSettings | null) => {
    if (!settings) return;
    setCycleType(settings.cycle_mode);
    setPaydayDay(String(settings.payday_day ?? 5));
    setMinimumReserve(
      settings.reserve_cents > 0
        ? formatBRLFromCents(settings.reserve_cents)
        : ""
    );
  }, []);

  const load = useCallback(async () => {
    if (!householdId) {
      if (!householdLoading) setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError("");
      const [settings, rows] = await Promise.all([
        getFinancialSettings(householdId),
        listCommitments(householdId),
      ]);
      applySettings(settings);
      setCommitments(rows);
      if (guided && settings.updated_by !== null) setGuidedStep(2);
    } catch (error: any) {
      setLoadError(error?.message ?? "Não foi possível carregar seu planejamento.");
    } finally {
      setLoading(false);
    }
  }, [applySettings, guided, householdId, householdLoading]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const settingsValid = useMemo(() => {
    if (cycleType === "calendar") return true;
    const day = Number(paydayDay);
    return Number.isInteger(day) && day >= 1 && day <= 28;
  }, [cycleType, paydayDay]);

  const commitmentValid = useMemo(() => {
    const amountCents = parseBRLToCents(draft.amount);
    const dueDay = Number(draft.dueDay);
    const installments = draft.installmentCount ? Number(draft.installmentCount) : null;
    return Boolean(
      draft.name.trim() &&
        amountCents > 0 &&
        Number.isInteger(dueDay) &&
        dueDay >= 1 &&
        dueDay <= 28 &&
        isValidMonth(draft.startMonth) &&
        (draft.kind !== "installment"
          || (installments !== null && Number.isInteger(installments) && installments > 0 && installments <= 600))
    );
  }, [draft]);

  async function saveSettings() {
    if (!householdId || !userId || !settingsValid || savingSettings) return;
    try {
      setSavingSettings(true);
      setSettingsSaveError("");
      const saved = await saveFinancialSettings({
        householdId,
        userId,
        cycleMode: cycleType,
        paydayDay: cycleType === "payday" ? Number(paydayDay) : null,
        reserveCents: parseBRLToCents(minimumReserve),
      });
      applySettings(saved);
      if (guided) {
        Keyboard.dismiss();
        setGuidedStep(2);
        requestAnimationFrame(() => settingsKeyboard.scrollRef.current?.scrollTo({ y: 0, animated: true }));
      } else {
        Alert.alert("Planejamento salvo", "Seu ciclo e sua reserva mínima foram atualizados.");
      }
    } catch (error: any) {
      const message = error?.message ?? "Tente novamente.";
      setSettingsSaveError(message);
      if (!guided && Platform.OS !== "web") Alert.alert("Não foi possível salvar", message);
    } finally {
      setSavingSettings(false);
    }
  }

  function openNewCommitment() {
    Keyboard.dismiss();
    setCommitmentSaveError("");
    setEditing(null);
    setDraft(emptyDraft());
    setModalVisible(true);
  }

  function openEditCommitment(commitment: FinancialCommitment) {
    Keyboard.dismiss();
    setCommitmentSaveError("");
    setEditing(commitment);
    setDraft({
      name: commitment.name,
      kind: commitment.kind,
      amount: formatBRLFromCents(commitment.amount_cents),
      dueDay: String(commitment.due_day),
      startMonth: commitment.starts_on.slice(0, 7),
      installmentCount: commitment.installments_total
        ? String(commitment.installments_total)
        : "",
    });
    setModalVisible(true);
  }

  function closeModal() {
    Keyboard.dismiss();
    setCommitmentSaveError("");
    setModalVisible(false);
    setEditing(null);
  }

  async function saveCommitment() {
    if (!householdId || !userId || !commitmentValid || savingCommitment) return;
    const values = {
      householdId,
      name: draft.name.trim(),
      kind: draft.kind,
      amountCents: parseBRLToCents(draft.amount),
      dueDay: Number(draft.dueDay),
      startsOn: `${draft.startMonth}-01`,
      installmentsTotal: draft.kind === "installment" && draft.installmentCount
        ? Number(draft.installmentCount)
        : null,
    };

    try {
      setSavingCommitment(true);
      setCommitmentSaveError("");
      if (editing) {
        await updateCommitment({ ...values, commitmentId: editing.id });
      } else {
        await createCommitment({ ...values, userId });
      }
      const rows = await listCommitments(householdId);
      setCommitments(rows);
      closeModal();
    } catch (error: any) {
      const message = error?.message ?? "Confira os dados e tente novamente.";
      setCommitmentSaveError(message);
      if (Platform.OS !== "web") Alert.alert("Não foi possível salvar", message);
    } finally {
      setSavingCommitment(false);
    }
  }

  function confirmArchive(commitment: FinancialCommitment) {
    const persist = async () => {
      if (!householdId) return;
      try {
        setCommitmentSaveError("");
        await archiveCommitment(householdId, commitment.id);
        setCommitments((current) => current.filter((item) => item.id !== commitment.id));
      } catch (error: any) {
        const message = error?.message ?? "Tente novamente.";
        if (Platform.OS === "web") setCommitmentSaveError(message);
        else Alert.alert("Não foi possível arquivar", message);
      }
    };

    if (Platform.OS === "web") {
      const confirmed = typeof globalThis.confirm === "function"
        ? globalThis.confirm(`Arquivar ${commitment.name}? Esse compromisso deixará de entrar nos próximos cálculos.`)
        : false;
      if (confirmed) void persist();
      return;
    }

    Alert.alert(
      "Arquivar compromisso?",
      `${commitment.name} deixará de entrar nos próximos cálculos.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Arquivar",
          style: "destructive",
          onPress: () => void persist(),
        },
      ]
    );
  }

  const busy = loading || householdLoading;

  return (
    <OnboardingShell light>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.screen}>
        <ScrollView
          ref={settingsKeyboard.scrollRef}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 32 + settingsKeyboard.keyboardInset },
          ]}
          keyboardDismissMode="none"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={settingsKeyboard.cancelPendingScroll}
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeaderCard
            onBack={() => router.back()}
            eyebrow={guided ? `Etapa ${guidedStep} de 2` : "Seu plano financeiro"}
            title={guided
              ? guidedStep === 1 ? "Defina seu período e proteção" : "Informe o que ainda falta pagar"
              : "Organize o seu ciclo"}
            subtitle={guided
              ? guidedStep === 1
                ? "Escolha como seu período funciona e quanto deseja manter na conta."
                : "Adicione somente contas, dívidas ou parcelas que ainda precisam ser pagas."
              : "Diga quando seu dinheiro se renova e o que já está comprometido."}
          />

          {busy ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color={OB.primary} />
              <Text style={styles.stateTitle}>Carregando planejamento...</Text>
            </View>
          ) : loadError ? (
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={28} color="#B94A4A" />
              <Text style={styles.stateTitle}>Não foi possível carregar</Text>
              <Text style={styles.stateText}>{loadError}</Text>
              <Pressable onPress={() => void load()} style={styles.retryButton} accessibilityRole="button">
                <Text style={styles.retryText}>Tentar novamente</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {!guided || guidedStep === 1 ? (
                <View style={styles.card}>
                <View style={styles.sectionHeading}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name="calendar-outline" size={20} color={OB.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>Como é o seu ciclo?</Text>
                    <Text style={styles.cardSubtitle}>Você poderá mudar essa escolha depois.</Text>
                  </View>
                </View>

                <View style={styles.cycleOptions} accessibilityRole="radiogroup">
                  <Pressable
                    onPress={() => setCycleType("calendar")}
                    style={[styles.cycleOption, cycleType === "calendar" && styles.optionActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: cycleType === "calendar" }}
                    accessibilityLabel="Mês calendário"
                  >
                    <Ionicons
                      name="calendar-number-outline"
                      size={22}
                      color={cycleType === "calendar" ? "#fff" : OB.primary}
                    />
                    <Text style={[styles.optionTitle, cycleType === "calendar" && styles.optionTextActive]}>
                      Mês calendário
                    </Text>
                    <Text style={[styles.optionText, cycleType === "calendar" && styles.optionTextActive]}>
                      Do dia 1 ao último dia do mês
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setCycleType("payday")}
                    style={[styles.cycleOption, cycleType === "payday" && styles.optionActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: cycleType === "payday" }}
                    accessibilityLabel="De salário a salário"
                  >
                    <Ionicons
                      name="cash-outline"
                      size={22}
                      color={cycleType === "payday" ? "#fff" : OB.primary}
                    />
                    <Text style={[styles.optionTitle, cycleType === "payday" && styles.optionTextActive]}>
                      De salário a salário
                    </Text>
                    <Text style={[styles.optionText, cycleType === "payday" && styles.optionTextActive]}>
                      O ciclo começa no dia em que você recebe
                    </Text>
                  </Pressable>
                </View>

                {cycleType === "payday" ? (
                  <View onLayout={settingsKeyboard.registerField("payday")}>
                    <Text style={styles.label}>Dia do salário</Text>
                    <TextInput
                      value={paydayDay}
                      onChangeText={(value) => setPaydayDay(digits(value, 2))}
                      onFocus={() => settingsKeyboard.focusField("payday")}
                      onPressIn={() => settingsKeyboard.focusField("payday")}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      onSubmitEditing={Keyboard.dismiss}
                      placeholder="Ex: 5"
                      placeholderTextColor={OB.support}
                      style={[styles.input, paydayDay && !settingsValid && styles.inputError]}
                      accessibilityLabel="Dia do salário, entre 1 e 28"
                    />
                    <Text style={styles.helper}>Use um dia entre 1 e 28.</Text>
                  </View>
                ) : null}

                <View onLayout={settingsKeyboard.registerField("reserve")}>
                  <Text style={styles.label}>{guided ? "Quanto quer manter na conta?" : "Reserva mínima"}</Text>
                  <TextInput
                    value={minimumReserve}
                    onChangeText={(value) => setMinimumReserve(formatBRLInputFromDigits(value))}
                    onFocus={() => settingsKeyboard.focusField("reserve")}
                    onPressIn={() => settingsKeyboard.focusField("reserve")}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    placeholder="R$ 0,00"
                    placeholderTextColor={OB.support}
                    style={styles.input}
                    accessibilityLabel="Valor da reserva mínima"
                  />
                  <Text style={styles.helper}>
                    Esse valor será descontado antes de mostrarmos o que pode ir para seus sonhos.
                  </Text>
                </View>

                {settingsSaveError ? (
                  <View style={styles.inlineError} accessibilityRole="alert">
                    <Ionicons name="alert-circle-outline" size={18} color="#A33F3F" />
                    <Text style={styles.inlineErrorText}>{settingsSaveError}</Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={() => void saveSettings()}
                  disabled={!settingsValid || savingSettings}
                  style={[styles.primaryButton, (!settingsValid || savingSettings) && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !settingsValid || savingSettings }}
                >
                  {savingSettings ? <ActivityIndicator color="#fff" /> : (
                    <Text style={styles.primaryButtonText}>
                      {guided ? "Salvar e continuar" : "Salvar configurações"}
                    </Text>
                  )}
                </Pressable>
                </View>
              ) : null}

              {!guided || guidedStep === 2 ? (
                <>
                  <View style={styles.commitmentHeader}>
                    <View style={styles.flex}>
                      <Text style={styles.sectionTitle}>O que ainda falta pagar?</Text>
                      <Text style={styles.sectionSubtitle}>
                        Adicione somente contas, dívidas ou parcelas que não aparecem como pagas no extrato.
                      </Text>
                    </View>
                    <Pressable
                      onPress={openNewCommitment}
                      style={styles.addButton}
                      accessibilityRole="button"
                      accessibilityLabel="Adicionar compromisso"
                    >
                      <Ionicons name="add" size={22} color="#fff" />
                    </Pressable>
                  </View>

                  {commitmentSaveError && !modalVisible ? (
                    <View style={styles.inlineError} accessibilityRole="alert">
                      <Ionicons name="alert-circle-outline" size={18} color="#A33F3F" />
                      <Text style={styles.inlineErrorText}>{commitmentSaveError}</Text>
                    </View>
                  ) : null}

                  {commitments.length ? commitments.map((commitment) => (
                    <View key={commitment.id} style={styles.commitmentCard}>
                      <View style={styles.commitmentIcon}>
                        <Ionicons
                          name={KIND_OPTIONS.find((option) => option.value === commitment.kind)?.icon ?? "receipt-outline"}
                          size={20}
                          color={OB.primary}
                        />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.commitmentName} numberOfLines={2}>{commitment.name}</Text>
                        <Text style={styles.commitmentMeta}>
                          {kindLabel(commitment.kind)} · vence dia {commitment.due_day}
                        </Text>
                        {commitment.installments_total ? (
                          <Text style={styles.installmentText}>{commitment.installments_total} parcelas cadastradas</Text>
                        ) : null}
                        <Text style={styles.commitmentAmount}>{formatBRLFromCents(commitment.amount_cents)}</Text>
                      </View>
                      <View style={styles.cardActions}>
                        <Pressable
                          onPress={() => openEditCommitment(commitment)}
                          hitSlop={8}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel={`Editar ${commitment.name}`}
                        >
                          <Ionicons name="pencil-outline" size={17} color={OB.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => confirmArchive(commitment)}
                          hitSlop={8}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel={`Arquivar ${commitment.name}`}
                        >
                          <Ionicons name="archive-outline" size={17} color="#B94A4A" />
                        </Pressable>
                      </View>
                    </View>
                  )) : (
                    <View style={styles.emptyCard}>
                      <View style={styles.emptyIcon}>
                        <Ionicons name="shield-checkmark-outline" size={26} color={OB.primary} />
                      </View>
                      <Text style={styles.emptyTitle}>Nenhuma conta futura cadastrada</Text>
                      <Text style={styles.emptyText}>
                        Se não há mais nada para pagar neste período, pode concluir agora.
                      </Text>
                      <Pressable onPress={openNewCommitment} style={styles.secondaryButton} accessibilityRole="button">
                        <Text style={styles.secondaryButtonText}>Adicionar uma conta</Text>
                      </Pressable>
                    </View>
                  )}

                  {guided ? (
                    <Pressable
                      onPress={() => router.dismissTo({ pathname: "/(app)/journey", params: { tab: "controle" } })}
                      style={styles.primaryButton}
                      accessibilityRole="button"
                      accessibilityLabel="Concluir e voltar ao Controle"
                    >
                      <Text style={styles.primaryButtonText}>Concluir e voltar ao Controle</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            enabled={Platform.OS === "ios"}
            behavior="padding"
            style={styles.modalKeyboard}
          >
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <View style={styles.flex}>
                  <Text style={styles.modalEyebrow}>Planejamento</Text>
                  <Text style={styles.modalTitle}>{editing ? "Editar compromisso" : "Novo compromisso"}</Text>
                </View>
                <Pressable
                  onPress={closeModal}
                  style={styles.modalClose}
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                >
                  <Ionicons name="close" size={21} color={OB.primary} />
                </Pressable>
              </View>

              <ScrollView
                ref={modalKeyboard.scrollRef}
                style={styles.modalScroll}
                contentContainerStyle={[
                  styles.modalContent,
                  { paddingBottom: 22 + modalKeyboard.keyboardInset },
                ]}
                keyboardDismissMode="none"
                keyboardShouldPersistTaps="always"
                onScrollBeginDrag={modalKeyboard.cancelPendingScroll}
                onScroll={modalKeyboard.handleScroll}
                scrollEventThrottle={16}
                onContentSizeChange={modalKeyboard.handleContentSizeChange}
                removeClippedSubviews={false}
                showsVerticalScrollIndicator={false}
              >
                <View
                  ref={modalKeyboard.registerFieldNode("name")}
                  onLayout={modalKeyboard.registerField("name")}
                  collapsable={false}
                >
                  <Text style={styles.label}>Nome</Text>
                  <TextInput
                    value={draft.name}
                    onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
                    onFocus={() => modalKeyboard.focusField("name")}
                    onPressIn={() => modalKeyboard.focusField("name")}
                    placeholder="Ex: Aluguel"
                    placeholderTextColor={OB.support}
                    returnKeyType="next"
                    style={styles.input}
                    accessibilityLabel="Nome do compromisso"
                  />
                </View>

                <Text style={styles.label}>Tipo</Text>
                <View style={styles.kindOptions} accessibilityRole="radiogroup">
                  {KIND_OPTIONS.map((option) => {
                    const active = draft.kind === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setDraft((current) => ({ ...current, kind: option.value }))}
                        style={[styles.kindOption, active && styles.kindOptionActive]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                      >
                        <Ionicons name={option.icon} size={17} color={active ? "#fff" : OB.primary} />
                        <Text style={[styles.kindText, active && styles.optionTextActive]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View
                  ref={modalKeyboard.registerFieldNode("amount")}
                  onLayout={modalKeyboard.registerField("amount")}
                  collapsable={false}
                >
                  <Text style={styles.label}>Valor</Text>
                  <TextInput
                    value={draft.amount}
                    onChangeText={(value) => setDraft((current) => ({
                      ...current,
                      amount: formatBRLInputFromDigits(value),
                    }))}
                    onFocus={() => modalKeyboard.focusField("amount")}
                    onPressIn={() => modalKeyboard.focusField("amount")}
                    keyboardType="number-pad"
                    placeholder="R$ 0,00"
                    placeholderTextColor={OB.support}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.input}
                    accessibilityLabel="Valor do compromisso"
                  />
                </View>

                <View style={styles.twoColumns}>
                  <View
                    ref={modalKeyboard.registerFieldNode("due")}
                    style={styles.column}
                    onLayout={modalKeyboard.registerField("due")}
                    collapsable={false}
                  >
                    <Text style={styles.label}>Vencimento</Text>
                    <TextInput
                      value={draft.dueDay}
                      onChangeText={(dueDay) => setDraft((current) => ({
                        ...current,
                        dueDay: digits(dueDay, 2),
                      }))}
                      onFocus={() => modalKeyboard.focusField("due")}
                      onPressIn={() => modalKeyboard.focusField("due")}
                      keyboardType="number-pad"
                      placeholder="Dia 1–28"
                      placeholderTextColor={OB.support}
                      returnKeyType="done"
                      onSubmitEditing={Keyboard.dismiss}
                      style={styles.input}
                      accessibilityLabel="Dia do vencimento, entre 1 e 28"
                    />
                  </View>
                  <View
                    ref={modalKeyboard.registerFieldNode("start")}
                    style={styles.column}
                    onLayout={modalKeyboard.registerField("start")}
                    collapsable={false}
                  >
                    <Text style={styles.label}>Início</Text>
                    <TextInput
                      value={draft.startMonth}
                      onChangeText={(startMonth) => setDraft((current) => ({
                        ...current,
                        startMonth: formatMonthInput(startMonth),
                      }))}
                      onFocus={() => modalKeyboard.focusField("start")}
                      onPressIn={() => modalKeyboard.focusField("start")}
                      keyboardType="number-pad"
                      placeholder="AAAA-MM"
                      placeholderTextColor={OB.support}
                      returnKeyType="done"
                      onSubmitEditing={Keyboard.dismiss}
                      style={styles.input}
                      accessibilityLabel="Mês de início no formato ano e mês"
                    />
                  </View>
                </View>

                {draft.kind === "installment" ? (
                <View
                  ref={modalKeyboard.registerFieldNode("installments")}
                  onLayout={modalKeyboard.registerField("installments")}
                  collapsable={false}
                >
                  <Text style={styles.label}>Quantidade de parcelas</Text>
                  <TextInput
                    value={draft.installmentCount}
                    onChangeText={(installmentCount) => setDraft((current) => ({
                      ...current,
                      installmentCount: digits(installmentCount, 3),
                    }))}
                    onFocus={() => modalKeyboard.focusField("installments")}
                    onPressIn={() => modalKeyboard.focusField("installments")}
                    keyboardType="number-pad"
                    placeholder="Ex: 12"
                    placeholderTextColor={OB.support}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.input}
                    accessibilityLabel="Quantidade de parcelas"
                  />
                  <Text style={styles.helper}>Informe o total contratado, entre 1 e 600 parcelas.</Text>
                </View>
                ) : null}

                {commitmentSaveError ? (
                  <View style={styles.inlineError} accessibilityRole="alert">
                    <Ionicons name="alert-circle-outline" size={18} color="#A33F3F" />
                    <Text style={styles.inlineErrorText}>{commitmentSaveError}</Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={() => void saveCommitment()}
                  disabled={!commitmentValid || savingCommitment}
                  style={[styles.primaryButton, (!commitmentValid || savingCommitment) && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !commitmentValid || savingCommitment }}
                >
                  {savingCommitment ? <ActivityIndicator color="#fff" /> : (
                    <Text style={styles.primaryButtonText}>{editing ? "Salvar alterações" : "Adicionar compromisso"}</Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OB.offWhite },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  flex: { flex: 1 },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 11 },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  cardTitle: { color: OB.primary, fontSize: 17, fontWeight: "900" },
  cardSubtitle: { color: OB.support, fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 3 },
  cycleOptions: { flexDirection: "row", gap: 9 },
  cycleOption: {
    flex: 1,
    minHeight: 126,
    borderRadius: 17,
    padding: 13,
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  optionActive: { backgroundColor: OB.primary, borderColor: OB.primary },
  optionTitle: { color: OB.primary, fontSize: 12, fontWeight: "900", lineHeight: 16, marginTop: 9 },
  optionText: { color: OB.support, fontSize: 9, fontWeight: "700", lineHeight: 14, marginTop: 4 },
  optionTextActive: { color: "#fff" },
  label: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  input: {
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 14,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  inputError: { borderColor: "#D46A6A" },
  helper: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 15, marginTop: 6 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  primaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  commitmentHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 2, marginTop: 4 },
  sectionTitle: { color: OB.primary, fontSize: 18, fontWeight: "900" },
  sectionSubtitle: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 15, marginTop: 4 },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  commitmentCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  commitmentIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  commitmentName: { color: OB.primary, fontSize: 14, fontWeight: "900", paddingRight: 3 },
  commitmentMeta: { color: OB.support, fontSize: 10, fontWeight: "800", marginTop: 4 },
  installmentText: { color: OB.support, fontSize: 9, fontWeight: "700", marginTop: 3 },
  commitmentAmount: { color: OB.primary, fontSize: 16, fontWeight: "900", marginTop: 8 },
  cardActions: { gap: 7 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  emptyCard: {
    minHeight: 210,
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  emptyTitle: { color: OB.primary, fontSize: 14, fontWeight: "900", marginTop: 12 },
  emptyText: {
    maxWidth: 270,
    color: OB.support,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center",
    marginTop: 5,
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    marginTop: 14,
  },
  secondaryButtonText: { color: OB.primary, fontSize: 11, fontWeight: "900" },
  stateCard: {
    minHeight: 210,
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  stateTitle: { color: OB.primary, fontSize: 14, fontWeight: "900", textAlign: "center" },
  stateText: { color: OB.support, fontSize: 11, fontWeight: "700", lineHeight: 16, textAlign: "center" },
  retryButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
    marginTop: 6,
  },
  retryText: { color: OB.primary, fontSize: 11, fontWeight: "900" },
  inlineError: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#FFF2F2",
    borderWidth: 1,
    borderColor: "rgba(163,63,63,0.22)",
  },
  inlineErrorText: {
    flex: 1,
    color: "#7F3030",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
  },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(6,21,46,0.54)" },
  modalKeyboard: { flex: 1, justifyContent: "flex-end" },
  modalSheet: {
    maxHeight: "91%",
    minHeight: "72%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    backgroundColor: OB.offWhite,
  },
  modalHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    backgroundColor: OB.supportSoft,
    marginTop: 10,
  },
  modalHeader: { padding: 18, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  modalScroll: { flex: 1 },
  modalEyebrow: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  modalTitle: { color: OB.primary, fontSize: 21, fontWeight: "900", marginTop: 4 },
  modalClose: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  modalContent: { paddingHorizontal: 18, paddingBottom: 22, gap: 14 },
  kindOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindOption: {
    minHeight: 42,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  kindOptionActive: { backgroundColor: OB.primary, borderColor: OB.primary },
  kindText: { color: OB.primary, fontSize: 11, fontWeight: "900" },
  twoColumns: { flexDirection: "row", gap: 10 },
  column: { flex: 1 },
});
