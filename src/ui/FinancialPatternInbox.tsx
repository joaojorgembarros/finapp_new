import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../lib/format";
import type { FinancialPatternSuggestion, PatternCommitmentCandidate } from "../lib/financialPatternSuggestions";
import { useKeyboardAwareScroll } from "../hooks/useKeyboardAwareScroll";
import { OB } from "./OnboardingKit";

type ReviewField = "name" | "amount" | "due";

export type PatternConfirmPayload = {
  suggestion: FinancialPatternSuggestion;
  name: string;
  amountCents: number;
  dueDay: number;
  existingCommitmentId?: string | null;
};

export function FinancialPatternInbox({
  suggestions,
  busyKey,
  onConfirm,
  onReject,
}: {
  suggestions: FinancialPatternSuggestion[];
  busyKey: string | null;
  onConfirm: (payload: PatternConfirmPayload) => Promise<void>;
  onReject: (suggestion: FinancialPatternSuggestion) => Promise<void>;
}) {
  const { height: viewportHeight } = useWindowDimensions();
  const keyboard = useKeyboardAwareScroll<ReviewField>(18, {
    ensureFieldRunway: true,
    keyboardClearance: 72,
  });
  const [reviewing, setReviewing] = useState<FinancialPatternSuggestion | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [selectedCommitmentId, setSelectedCommitmentId] = useState<string | "new" | null>(null);
  const [error, setError] = useState("");

  const reviewValid = useMemo(() => {
    const amountCents = parseBRLToCents(amount);
    const day = Number(dueDay);
    const dueValid = Number.isInteger(day) && day >= 1 && day <= 28;
    if (!reviewing) return false;
    if (reviewing.similarMatch === "single") return true;
    if (reviewing.similarMatch === "multiple") {
      if (!selectedCommitmentId) return false;
      if (selectedCommitmentId !== "new") return true;
    }
    return Boolean(name.trim() && amountCents > 0 && dueValid);
  }, [amount, dueDay, name, reviewing, selectedCommitmentId]);

  if (!suggestions.length && !reviewing) return null;

  function openReview(suggestion: FinancialPatternSuggestion) {
    Keyboard.dismiss();
    setError("");
    setReviewing(suggestion);
    setName(suggestion.title);
    setAmount(formatBRLFromCents(suggestion.pattern.estimatedAmountCents));
    setDueDay(suggestion.pattern.estimatedDay ? String(suggestion.pattern.estimatedDay) : "");
    setSelectedCommitmentId(suggestion.similarMatch === "single" ? suggestion.similarCommitments[0]?.id ?? null : null);
  }

  function closeReview() {
    Keyboard.dismiss();
    setReviewing(null);
    setError("");
  }

  async function submitReview() {
    if (!reviewing || !reviewValid || busyKey) return;
    const linkingId = reviewing.similarMatch === "single"
      ? reviewing.similarCommitments[0]?.id
      : selectedCommitmentId && selectedCommitmentId !== "new"
        ? selectedCommitmentId
        : null;
    try {
      setError("");
      await onConfirm({
        suggestion: reviewing,
        name: name.trim() || reviewing.title,
        amountCents: parseBRLToCents(amount) || reviewing.pattern.estimatedAmountCents,
        dueDay: Number(dueDay) || reviewing.pattern.estimatedDay || 1,
        existingCommitmentId: linkingId,
      });
      closeReview();
    } catch (caught: any) {
      setError(caught?.message ?? "Não foi possível adicionar este padrão.");
    }
  }

  return (
    <>
      <View style={styles.section}>
        <View style={styles.heading}>
          <View style={styles.headingIcon}>
            <Ionicons name="sparkles-outline" size={20} color={OB.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.title}>Encontramos no seu histórico</Text>
            <Text style={styles.subtitle}>
              O Sonho+ identificou alguns gastos que parecem se repetir. Revise antes de adicionar ao seu planejamento.
            </Text>
          </View>
        </View>

        {suggestions.map((suggestion) => {
          const busy = busyKey === suggestion.decisionKey;
          return (
            <View key={suggestion.decisionKey} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons
                  name={suggestion.estimatedAmount ? "pulse-outline" : "repeat-outline"}
                  size={20}
                  color={OB.primary}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.name}>{suggestion.title}</Text>
                <Text style={[styles.amount, suggestion.estimatedAmount && styles.estimate]}>{suggestion.amountLabel}</Text>
                <Text style={styles.meta}>{suggestion.dayLabel}</Text>
                <Text style={styles.meta}>{suggestion.historyLabel}</Text>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => openReview(suggestion)}
                    disabled={Boolean(busyKey)}
                    style={[styles.primaryAction, Boolean(busyKey) && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Adicionar ${suggestion.title} ao planejamento`}
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.primaryActionText}>Adicionar ao planejamento</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => void onReject(suggestion)}
                    disabled={Boolean(busyKey)}
                    style={[styles.secondaryAction, Boolean(busyKey) && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`${suggestion.title} não é recorrente`}
                  >
                    <Text style={styles.secondaryActionText}>Não é recorrente</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <Modal
        visible={Boolean(reviewing)}
        animationType="fade"
        transparent
        statusBarTranslucent
        navigationBarTranslucent={Platform.OS === "android"}
        presentationStyle="overFullScreen"
        onRequestClose={closeReview}
      >
        <View style={styles.scrimRoot}>
          <Pressable style={styles.scrim} onPress={closeReview} accessibilityRole="button" accessibilityLabel="Fechar" />
          <KeyboardAvoidingView
            enabled={Platform.OS === "ios"}
            behavior="padding"
            style={styles.scrimStage}
            pointerEvents="box-none"
          >
            <View style={[styles.overlayCard, { maxHeight: Math.min(viewportHeight * 0.88, 720) }]}>
              <View style={styles.modalHeader}>
                <View style={styles.flex}>
                  <Text style={styles.modalTitle}>
                    {reviewing?.similarMatch === "single"
                      ? "Já existe algo parecido no seu planejamento"
                      : reviewing?.similarMatch === "multiple"
                        ? "Encontramos mais de um compromisso parecido"
                        : "Revisar antes de adicionar"}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {reviewing?.similarMatch === "single"
                      ? "Use o compromisso que já está no planejamento em vez de criar outro."
                      : reviewing?.similarMatch === "multiple"
                        ? "Escolha a qual compromisso ligar, ou crie um novo."
                        : reviewing?.estimatedAmount
                          ? "Este valor é uma estimativa do seu histórico. Você pode corrigir antes de salvar."
                          : "Confira o nome, o valor e o dia antes de incluir no planejamento."}
                  </Text>
                </View>
                <Pressable onPress={closeReview} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Fechar">
                  <Ionicons name="close" size={20} color={OB.support} />
                </Pressable>
              </View>

              <ScrollView
                ref={keyboard.scrollRef}
                style={styles.modalScroll}
                contentContainerStyle={[styles.modalContent, { paddingBottom: 8 + keyboard.keyboardInset }]}
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={false}
              >
                {reviewing?.similarMatch === "single" && reviewing.similarCommitments[0] ? (
                  <ExistingCommitmentCard commitment={reviewing.similarCommitments[0]} selected />
                ) : null}

                {reviewing?.similarMatch === "multiple" ? (
                  <View style={styles.choiceList}>
                    {reviewing.similarCommitments.map((commitment) => (
                      <Pressable
                        key={commitment.id}
                        onPress={() => setSelectedCommitmentId(commitment.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selectedCommitmentId === commitment.id }}
                      >
                        <ExistingCommitmentCard
                          commitment={commitment}
                          selected={selectedCommitmentId === commitment.id}
                        />
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => setSelectedCommitmentId("new")}
                      style={[styles.newChoice, selectedCommitmentId === "new" && styles.newChoiceActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selectedCommitmentId === "new" }}
                    >
                      <Text style={styles.newChoiceText}>Criar um novo compromisso</Text>
                    </Pressable>
                  </View>
                ) : null}

                {reviewing && reviewing.similarMatch !== "single" && (reviewing.similarMatch === "none" || selectedCommitmentId === "new") ? (
                  <>
                    <View
                      ref={keyboard.registerFieldNode("name")}
                      onLayout={keyboard.registerField("name")}
                      collapsable={false}
                      style={styles.fieldBlock}
                    >
                      <Text style={styles.fieldLabel}>Nome</Text>
                      <TextInput
                        value={name}
                        onChangeText={setName}
                        onFocus={() => keyboard.focusField("name")}
                        placeholder="Ex: Netflix"
                        placeholderTextColor={OB.support}
                        style={styles.input}
                        accessibilityLabel="Nome do compromisso"
                      />
                    </View>
                    <View
                      ref={keyboard.registerFieldNode("amount")}
                      onLayout={keyboard.registerField("amount")}
                      collapsable={false}
                      style={styles.fieldBlock}
                    >
                      <Text style={styles.fieldLabel}>
                        {reviewing.estimatedAmount ? "Valor previsto (estimativa)" : "Valor previsto"}
                      </Text>
                      <TextInput
                        value={amount}
                        onChangeText={(value) => setAmount(formatBRLInputFromDigits(value))}
                        onFocus={() => keyboard.focusField("amount")}
                        keyboardType="number-pad"
                        placeholder="R$ 0,00"
                        placeholderTextColor={OB.support}
                        style={styles.input}
                        accessibilityLabel="Valor previsto"
                      />
                    </View>
                    <View
                      ref={keyboard.registerFieldNode("due")}
                      onLayout={keyboard.registerField("due")}
                      collapsable={false}
                      style={styles.fieldBlock}
                    >
                      <Text style={styles.fieldLabel}>Dia</Text>
                      <TextInput
                        value={dueDay}
                        onChangeText={(value) => setDueDay(value.replace(/\D/g, "").slice(0, 2))}
                        onFocus={() => keyboard.focusField("due")}
                        keyboardType="number-pad"
                        placeholder="Ex: 5"
                        placeholderTextColor={OB.support}
                        style={styles.input}
                        accessibilityLabel="Dia do vencimento, entre 1 e 28"
                      />
                    </View>
                  </>
                ) : null}

                {error ? (
                  <View style={styles.inlineError} accessibilityRole="alert">
                    <Ionicons name="alert-circle-outline" size={18} color="#A33F3F" />
                    <Text style={styles.inlineErrorText}>{error}</Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={() => void submitReview()}
                  disabled={!reviewValid || Boolean(busyKey)}
                  style={[styles.modalPrimaryButton, (!reviewValid || Boolean(busyKey)) && styles.disabled]}
                  accessibilityRole="button"
                >
                  {busyKey && reviewing && busyKey === reviewing.decisionKey ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalPrimaryButtonText}>
                      {reviewing?.similarMatch === "single" || (reviewing?.similarMatch === "multiple" && selectedCommitmentId && selectedCommitmentId !== "new")
                        ? "Usar este compromisso"
                        : "Adicionar ao planejamento"}
                    </Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

function ExistingCommitmentCard({
  commitment,
  selected,
}: {
  commitment: PatternCommitmentCandidate;
  selected?: boolean;
}) {
  return (
    <View style={[styles.existingCard, selected && styles.existingCardSelected]}>
      <Text style={styles.existingName}>{commitment.name}</Text>
      <Text style={styles.existingMeta}>
        {formatBRLFromCents(commitment.amount_cents)} · dia {commitment.due_day}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 8 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 2 },
  headingIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  flex: { flex: 1 },
  title: { color: OB.primary, fontSize: 18, fontWeight: "900" },
  subtitle: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 15, marginTop: 4 },
  card: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    backgroundColor: "#F7F5F1",
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  name: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  amount: { color: OB.primary, fontSize: 16, fontWeight: "900", marginTop: 6 },
  estimate: { fontStyle: "italic" },
  meta: { color: OB.support, fontSize: 10, fontWeight: "800", marginTop: 4 },
  actions: { gap: 8, marginTop: 12 },
  primaryAction: {
    minHeight: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
    paddingHorizontal: 12,
  },
  primaryActionText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  secondaryAction: {
    minHeight: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    paddingHorizontal: 12,
  },
  secondaryActionText: { color: OB.primary, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  scrimRoot: { flex: 1 },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OB.modalScrim,
  },
  scrimStage: { flex: 1, padding: 20, justifyContent: "center" },
  overlayCard: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: 22,
    paddingTop: 18,
    paddingHorizontal: 4,
    paddingBottom: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  modalHeader: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalTitle: { color: OB.primary, fontSize: 20, fontWeight: "900" },
  modalSubtitle: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
    paddingRight: 4,
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  modalContent: { paddingHorizontal: 14, paddingBottom: 8, gap: 14 },
  fieldBlock: { gap: 8 },
  fieldLabel: { color: OB.primary, fontSize: 14, fontWeight: "800" },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 14,
    color: OB.primary,
    fontSize: 16,
    fontWeight: "800",
  },
  choiceList: { gap: 8 },
  existingCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: OB.offWhite,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  existingCardSelected: {
    borderColor: OB.primary,
    backgroundColor: "rgba(12,35,72,0.06)",
  },
  existingName: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  existingMeta: { color: OB.support, fontSize: 12, fontWeight: "800", marginTop: 4 },
  newChoice: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
  },
  newChoiceActive: { borderColor: OB.primary },
  newChoiceText: { color: OB.primary, fontSize: 12, fontWeight: "900" },
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
  modalPrimaryButton: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
    marginTop: 2,
  },
  modalPrimaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "900" },
});
