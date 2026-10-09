import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ObservedRecurringIncome } from "../lib/financialPatternDetection";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../lib/format";
import {
  INCOME_ACKNOWLEDGEMENT_MAX_CENTS,
  incomeAccountLabel,
  incomeFieldLabel,
  incomePlanDraft,
} from "../lib/incomeAcknowledgementPlan";
import { observedIncomeTitle } from "./observedIncomeCopy";
import { OB } from "./OnboardingKit";

export function ObservedIncomePlanSheet({
  income,
  currentCents,
  accountWarning,
  busy,
  onClose,
  onSave,
  onDecline,
}: {
  income: ObservedRecurringIncome;
  currentCents: number;
  accountWarning: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (desiredTotalCents: number) => void;
  onDecline: () => void;
}) {
  const draft = incomePlanDraft({
    currentCents,
    detectedCents: income.estimatedMonthlyCents,
    behaviorType: income.behaviorType,
  });
  const [totalInput, setTotalInput] = useState(formatBRLInputFromDigits(String(draft.prefillCents)));
  const desiredCents = parseBRLToCents(totalInput);
  const totalIsValid = desiredCents >= 0 && desiredCents <= INCOME_ACKNOWLEDGEMENT_MAX_CENTS;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{observedIncomeTitle(income.normalizedMerchant)}</Text>
      <Text style={styles.meta}>{incomeAccountLabel(income.accountId)}</Text>
      <Text style={styles.meta}>{incomeFieldLabel(income.behaviorType)}</Text>
      <Text style={styles.meta}>Detectado: {formatBRLFromCents(income.estimatedMonthlyCents)}</Text>
      <Text style={styles.meta}>Atual: {formatBRLFromCents(currentCents)}</Text>
      <Text style={styles.explanation}>{draft.explanation}</Text>
      {accountWarning ? <Text style={styles.warning}>{accountWarning}</Text> : null}

      <Text style={styles.label}>Novo total</Text>
      <TextInput
        value={totalInput}
        onChangeText={(text) => setTotalInput(formatBRLInputFromDigits(text))}
        keyboardType="number-pad"
        accessibilityLabel="Novo total"
        style={styles.input}
      />

      <View style={styles.helpers}>
        {draft.mode !== "zero" ? (
          <Pressable onPress={() => setTotalInput(formatBRLInputFromDigits(String(draft.keepCurrentCents)))} accessibilityRole="button">
            <Text style={styles.helper}>Já está incluída</Text>
          </Pressable>
        ) : null}
        {draft.updateToDetectedCents != null ? (
          <Pressable onPress={() => setTotalInput(formatBRLInputFromDigits(String(draft.updateToDetectedCents)))} accessibilityRole="button">
            <Text style={styles.helper}>Atualizar para {formatBRLFromCents(draft.updateToDetectedCents)}</Text>
          </Pressable>
        ) : null}
        {draft.useOnlyDetectedCents != null ? (
          <Pressable onPress={() => setTotalInput(formatBRLInputFromDigits(String(draft.useOnlyDetectedCents)))} accessibilityRole="button">
            <Text style={styles.helper}>Usar só esta renda</Text>
          </Pressable>
        ) : null}
        {draft.addToCurrentCents != null ? (
          <Pressable onPress={() => setTotalInput(formatBRLInputFromDigits(String(draft.addToCurrentCents)))} accessibilityRole="button">
            <Text style={styles.helper}>Somar ao total atual</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={() => onSave(desiredCents)}
        disabled={busy || !totalIsValid}
        accessibilityRole="button"
        accessibilityLabel="Salvar"
        style={[styles.save, (busy || !totalIsValid) && styles.disabled]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Salvar</Text>}
      </Pressable>
      <Pressable onPress={onDecline} disabled={busy} accessibilityRole="button" accessibilityLabel="Não usar no planejamento">
        <Text style={styles.secondary}>Não usar no planejamento</Text>
      </Pressable>
      <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="Cancelar">
        <Text style={styles.secondary}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 20, borderRadius: 24, backgroundColor: "#fff" },
  title: { color: OB.primary, fontSize: 20, fontWeight: "900" },
  meta: { color: OB.support, fontSize: 13, fontWeight: "700" },
  explanation: { color: OB.primary, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  warning: { color: OB.support, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  label: { color: OB.primary, fontSize: 13, fontWeight: "800", marginTop: 4 },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    paddingHorizontal: 14,
    color: OB.primary,
    fontSize: 18,
    fontWeight: "800",
  },
  helpers: { gap: 8 },
  helper: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  save: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
    marginTop: 4,
  },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondary: { color: OB.support, fontSize: 13, fontWeight: "800", textAlign: "center", paddingVertical: 6 },
  disabled: { opacity: 0.55 },
});
