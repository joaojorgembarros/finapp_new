import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
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
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { allocateSurplus, FinancialCycle } from "../../src/lib/financialPlanning";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { GoalProgress, listGoalsWithProgress } from "../../src/lib/goals";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

type FormField = "amount" | "note";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function centsParam(value: string | string[] | undefined) {
  const cents = Number(firstParam(value));
  return Number.isFinite(cents) ? Math.max(0, Math.trunc(cents)) : 0;
}

function toLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function cycleLabel(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return "Ciclo selecionado";
  }
  const first = toLocalDate(start).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const last = addDays(toLocalDate(end), -1).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `${first} a ${last}`;
}

function progressPercent(goal: GoalProgress) {
  if (goal.target_cents <= 0) return 0;
  return Math.max(0, Math.min(100, (goal.contributed_cents / goal.target_cents) * 100));
}

export default function AllocateSurplusScreen() {
  const params = useLocalSearchParams<{
    cycleKey?: string | string[];
    cycleStart?: string | string[];
    cycleEnd?: string | string[];
    availableCents?: string | string[];
    cycleDate?: string | string[];
  }>();
  const cycleKey = firstParam(params.cycleKey) ?? "";
  const cycleStart = firstParam(params.cycleStart) ?? "";
  const cycleEnd = firstParam(params.cycleEnd) ?? "";
  const cycleDate = firstParam(params.cycleDate) ?? cycleStart;
  const availableCents = centsParam(params.availableCents);
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } =
    useKeyboardAwareScroll<FormField>(18);

  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [amount, setAmount] = useState(() => availableCents > 0 ? formatBRLFromCents(availableCents) : "");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cycle = useMemo<FinancialCycle>(() => ({
    key: cycleKey,
    start: cycleStart,
    end: cycleEnd,
    label: cycleLabel(cycleStart, cycleEnd),
  }), [cycleEnd, cycleKey, cycleStart]);

  const validCycle = Boolean(
    cycleKey &&
      /^\d{4}-\d{2}-\d{2}$/.test(cycleStart) &&
      /^\d{4}-\d{2}-\d{2}$/.test(cycleEnd) &&
      cycleStart < cycleEnd
  );

  const loadGoals = useCallback(async () => {
    if (!householdId) {
      if (!householdLoading) setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const rows = await listGoalsWithProgress(householdId);
      const active = rows.filter((goal) => goal.contributed_cents < goal.target_cents);
      setGoals(active);
      setSelectedGoalId((current) => (
        current && active.some((goal) => goal.id === current) ? current : null
      ));
    } catch (loadError: any) {
      setError(loadError?.message ?? "Não foi possível carregar seus sonhos.");
    } finally {
      setLoading(false);
    }
  }, [householdId, householdLoading]);

  useFocusEffect(
    useCallback(() => {
      void loadGoals();
    }, [loadGoals])
  );

  const amountCents = parseBRLToCents(amount);
  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) ?? null;
  const goalRemainingCents = selectedGoal
    ? Math.max(selectedGoal.target_cents - selectedGoal.contributed_cents, 0)
    : availableCents;
  const allocationLimitCents = Math.min(availableCents, goalRemainingCents);
  const amountError = amountCents > allocationLimitCents
    ? goalRemainingCents < availableCents
      ? `Faltam ${formatBRLFromCents(goalRemainingCents)} para concluir este sonho.`
      : `O limite deste ciclo é ${formatBRLFromCents(availableCents)}.`
    : amount.length > 0 && amountCents <= 0
      ? "Informe um valor maior que zero."
      : "";
  const valid = Boolean(
    validCycle &&
      householdId &&
      selectedGoal &&
      amountCents > 0 &&
      amountCents <= allocationLimitCents
  );

  const returnToControl = useCallback(() => {
    router.replace({
      pathname: "/(app)/journey",
      params: cycleDate ? { tab: "controle", cycleDate } : { tab: "controle" },
    });
  }, [cycleDate]);

  async function confirmAllocation() {
    if (!valid || !householdId || !selectedGoal || saving) return;
    try {
      setSaving(true);
      await allocateSurplus({
        householdId,
        goalId: selectedGoal.id,
        cycle,
        amountCents,
        note: note.trim() || undefined,
      });
      returnToControl();
    } catch (saveError: any) {
      Alert.alert("Não foi possível destinar a sobra", saveError?.message ?? "Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  function askForConfirmation() {
    if (!valid || !selectedGoal) return;
    Keyboard.dismiss();
    Alert.alert(
      "O dinheiro já foi separado?",
      `Confirme somente se você já separou ${formatBRLFromCents(amountCents)} para “${selectedGoal.title}”. O app registrará a destinação, mas não fará uma transferência bancária.`,
      [
        { text: "Ainda não", style: "cancel" },
        { text: "Sim, já separei", onPress: () => void confirmAllocation() },
      ]
    );
  }

  const busy = loading || householdLoading;

  return (
    <OnboardingShell light>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.screen}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: 34 + keyboardInset }]}
          keyboardDismissMode="none"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={cancelPendingScroll}
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeaderCard
            onBack={() => router.back()}
            eyebrow="Fechamento do ciclo"
            title="Transforme a sobra em progresso"
            subtitle="Escolha um sonho para receber o valor que você realmente separou."
          />

          <View style={styles.availableCard}>
            <View style={styles.availableIcon}>
              <Ionicons name="sparkles-outline" size={22} color="#178A55" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.availableLabel}>Limite estimado do ciclo</Text>
              <Text style={styles.availableValue}>{formatBRLFromCents(availableCents)}</Text>
              <Text style={styles.availableCycle}>{cycle.label}</Text>
            </View>
          </View>

          <View style={styles.noticeCard} accessibilityRole="summary">
            <Ionicons name="information-circle-outline" size={22} color={OB.primary} />
            <View style={styles.flex}>
              <Text style={styles.noticeTitle}>Primeiro separe, depois confirme</Text>
              <Text style={styles.noticeText}>
                Separe o dinheiro antes de confirmar. Essa destinação não é uma despesa e não reduz o resultado do ciclo. Se a transferência aparecer depois no CSV como uma saída, abra Movimentações e use “Ignorar esta movimentação” para não contar o mesmo valor duas vezes.
              </Text>
            </View>
          </View>

          {!validCycle ? (
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={28} color="#B94A4A" />
              <Text style={styles.stateTitle}>Ciclo inválido</Text>
              <Text style={styles.stateText}>Volte ao Resumo e abra novamente o fechamento deste ciclo.</Text>
              <Pressable onPress={returnToControl} style={styles.secondaryButton} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>Voltar ao Resumo</Text>
              </Pressable>
            </View>
          ) : busy ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color={OB.primary} />
              <Text style={styles.stateTitle}>Carregando seus sonhos...</Text>
            </View>
          ) : error ? (
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={28} color="#B94A4A" />
              <Text style={styles.stateTitle}>Não foi possível carregar</Text>
              <Text style={styles.stateText}>{error}</Text>
              <Pressable onPress={() => void loadGoals()} style={styles.secondaryButton} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>Tentar novamente</Text>
              </Pressable>
            </View>
          ) : !goals.length ? (
            <View style={styles.stateCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="flag-outline" size={25} color={OB.primary} />
              </View>
              <Text style={styles.stateTitle}>Cadastre um sonho primeiro</Text>
              <Text style={styles.stateText}>Você precisa de um sonho ativo para destinar esta sobra.</Text>
              <Pressable
                onPress={() => router.push({
                  pathname: "/(onboarding)/dreams",
                  params: { returnToJourney: "1" },
                })}
                style={styles.primaryButton}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Cadastrar sonho</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Para qual sonho?</Text>
                <Text style={styles.sectionText}>Selecione um objetivo ativo.</Text>
              </View>

              <View style={styles.goalList} accessibilityRole="radiogroup">
                {goals.map((goal) => {
                  const active = goal.id === selectedGoalId;
                  const progress = progressPercent(goal);
                  const remaining = Math.max(goal.target_cents - goal.contributed_cents, 0);
                  return (
                    <Pressable
                      key={goal.id}
                      onPress={() => setSelectedGoalId(goal.id)}
                      style={[styles.goalCard, active && styles.goalCardActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={`${goal.title}, faltam ${formatBRLFromCents(remaining)}`}
                    >
                      <View style={[styles.goalIcon, active && styles.goalIconActive]}>
                        <Ionicons name="flag-outline" size={19} color={active ? "#fff" : OB.primary} />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.goalTitle} numberOfLines={2}>{goal.title}</Text>
                        <Text style={styles.goalMeta}>Faltam {formatBRLFromCents(remaining)}</Text>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${progress}%` }]} />
                        </View>
                      </View>
                      <Ionicons
                        name={active ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={active ? OB.primary : OB.supportSoft}
                      />
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.formCard}>
                <View onLayout={registerField("amount")}>
                  <Text style={styles.label}>Quanto você separou?</Text>
                  <TextInput
                    value={amount}
                    onChangeText={(value) => setAmount(formatBRLInputFromDigits(value))}
                    onFocus={() => focusField("amount")}
                    onPressIn={() => focusField("amount")}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    selectTextOnFocus
                    placeholder="R$ 0,00"
                    placeholderTextColor={OB.support}
                    style={[styles.input, amountError && styles.inputError]}
                    accessibilityLabel="Valor separado para o sonho"
                  />
                  {amountError ? <Text style={styles.errorText}>{amountError}</Text> : (
                    <Text style={styles.helper}>{selectedGoal
                      ? `Você pode destinar até ${formatBRLFromCents(allocationLimitCents)} para este sonho.`
                      : "Selecione um sonho para conferir o limite."}</Text>
                  )}
                </View>

                <View onLayout={registerField("note")}>
                  <Text style={styles.label}>Nota (opcional)</Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    onFocus={() => focusField("note")}
                    onPressIn={() => focusField("note")}
                    multiline
                    maxLength={180}
                    textAlignVertical="top"
                    placeholder="Ex: sobra do salário de agosto"
                    placeholderTextColor={OB.support}
                    style={[styles.input, styles.noteInput]}
                    accessibilityLabel="Nota opcional sobre a destinação"
                  />
                  <Text style={styles.characterCount}>{note.length}/180</Text>
                </View>

                <Pressable
                  onPress={askForConfirmation}
                  disabled={!valid || saving}
                  style={[styles.primaryButton, (!valid || saving) && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !valid || saving }}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={19} color="#fff" />
                      <Text style={styles.primaryButtonText}>Confirmar valor separado</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OB.offWhite },
  content: { padding: 20, gap: 14, paddingBottom: 34 },
  flex: { flex: 1 },
  availableCard: {
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(23,138,85,0.24)",
  },
  availableIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(23,138,85,0.10)",
  },
  availableLabel: { color: "#178A55", fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  availableValue: { color: OB.primary, fontSize: 23, fontWeight: "900", marginTop: 4 },
  availableCycle: { color: OB.support, fontSize: 10, fontWeight: "700", marginTop: 3 },
  noticeCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(123,160,200,0.15)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  noticeTitle: { color: OB.primary, fontSize: 12, fontWeight: "900" },
  noticeText: { color: OB.support, fontSize: 10, lineHeight: 16, fontWeight: "700", marginTop: 3 },
  sectionHeader: { paddingHorizontal: 2, marginTop: 3 },
  sectionTitle: { color: OB.primary, fontSize: 18, fontWeight: "900" },
  sectionText: { color: OB.support, fontSize: 10, fontWeight: "700", marginTop: 4 },
  goalList: { gap: 9 },
  goalCard: {
    minHeight: 88,
    borderRadius: 18,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  goalCardActive: { borderColor: OB.primary, backgroundColor: "rgba(123,160,200,0.09)" },
  goalIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  goalIconActive: { backgroundColor: OB.primary },
  goalTitle: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  goalMeta: { color: OB.support, fontSize: 9, fontWeight: "800", marginTop: 4 },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden", backgroundColor: OB.supportSoft, marginTop: 8 },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: OB.primary },
  formCard: {
    borderRadius: 20,
    padding: 16,
    gap: 15,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  label: { color: OB.support, fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginBottom: 7 },
  input: {
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 14,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  noteInput: { minHeight: 92, paddingTop: 13, paddingBottom: 13 },
  inputError: { borderColor: "#D46A6A" },
  errorText: { color: "#B94A4A", fontSize: 10, fontWeight: "800", marginTop: 6 },
  helper: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 15, marginTop: 6 },
  characterCount: { color: OB.support, fontSize: 9, fontWeight: "700", textAlign: "right", marginTop: 5 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: OB.primary,
  },
  primaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    marginTop: 6,
  },
  secondaryButtonText: { color: OB.primary, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  stateCard: {
    minHeight: 215,
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
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
  stateTitle: { color: OB.primary, fontSize: 14, fontWeight: "900", textAlign: "center" },
  stateText: { color: OB.support, fontSize: 11, lineHeight: 17, fontWeight: "700", textAlign: "center" },
});
