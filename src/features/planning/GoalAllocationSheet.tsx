import React, { useCallback, useEffect, useRef, useState } from "react";
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
  View,
} from "react-native";
import { useKeyboardAwareScroll } from "../../hooks/useKeyboardAwareScroll";
import {
  allocationAmountIssue,
  allocationAmountMessage,
  allocationConfirmCopy,
  canSubmitAllocation,
  classifyAllocationError,
  createAllocationRequestId,
  goalProgressPercent,
  goalRemainingCents,
  isAllocatableGoal,
  resolveAllocationRequestId,
  ALLOCATABLE_CASH_COPY,
  type AllocationRequest,
} from "../../lib/allocatableCashPresentation";
import {
  allocateKnownCashToGoal,
  type AllocatableCashPosition,
  type KnownCashAllocationResult,
} from "../../lib/financialAllocatableCash";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../lib/format";
import { listGoalsWithProgress, type GoalProgress } from "../../lib/goals";
import { OB } from "../../ui/OnboardingKit";

export function GoalAllocationSheet({
  visible,
  householdId,
  position,
  onClose,
  onSuccess,
  onRefresh,
  onNotice,
}: {
  visible: boolean;
  householdId: string;
  position: AllocatableCashPosition;
  onClose: () => void;
  onSuccess: (result: KnownCashAllocationResult, goalTitle: string) => void;
  onRefresh: () => Promise<AllocatableCashPosition | null>;
  onNotice: (message: string) => void;
}) {
  const keyboard = useKeyboardAwareScroll<"amount">(18);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsError, setGoalsError] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [request, setRequest] = useState<AllocationRequest | null>(null);
  const savingRef = useRef(false);

  const availableCents = position.availableToOrganizeCents ?? 0;
  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) ?? null;
  const remainingCents = selectedGoal ? goalRemainingCents(selectedGoal) : 0;
  const amountCents = parseBRLToCents(amount);
  const issue = allocationAmountIssue({
    amountCents,
    typed: amount.length > 0,
    availableCents,
    goalRemainingCents: remainingCents,
  });
  const canContinue = canSubmitAllocation({
    saving,
    goalSelected: Boolean(selectedGoal),
    issue,
    amountCents,
  });

  const loadGoals = useCallback(async () => {
    try {
      setGoalsLoading(true);
      setGoalsError("");
      const rows = (await listGoalsWithProgress(householdId)).filter(isAllocatableGoal);
      setGoals(rows);
      setSelectedGoalId((current) => (current && rows.some((goal) => goal.id === current) ? current : null));
    } catch (error: any) {
      setGoalsError(error?.message ?? "Não foi possível carregar seus sonhos.");
    } finally {
      setGoalsLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    if (!visible) return;
    setConfirming(false);
    setFormError("");
    setAmount("");
    setRequest(null);
    void loadGoals();
  }, [loadGoals, visible]);

  function close() {
    if (saving) return;
    Keyboard.dismiss();
    onClose();
  }

  function openConfirm() {
    if (!canContinue || !selectedGoal) return;
    Keyboard.dismiss();
    setFormError("");
    setConfirming(true);
  }

  async function submit() {
    if (!canContinue || !selectedGoal || savingRef.current) return;
    savingRef.current = true;
    const nextRequest = resolveAllocationRequestId(
      request,
      selectedGoal.id,
      amountCents,
      createAllocationRequestId,
    );
    setRequest(nextRequest);
    try {
      setSaving(true);
      setFormError("");
      const result = await allocateKnownCashToGoal({
        householdId,
        goalId: selectedGoal.id,
        amountCents,
        requestId: nextRequest.id,
      });
      setRequest(null);
      onSuccess(result, selectedGoal.title);
    } catch (error: any) {
      const failure = classifyAllocationError(error);
      setFormError(failure.message);
      if (failure.kind === "conflict") setRequest(null);
      if (failure.kind === "insufficient" || failure.kind === "blocked") {
        setConfirming(false);
        const refreshed = await onRefresh();
        const stillOpen = Boolean(refreshed?.canAllocate && (refreshed.availableToOrganizeCents ?? 0) > 0);
        if (!stillOpen) {
          onNotice(failure.message);
          onClose();
        }
        return;
      }
      if (failure.kind === "goal_changed") {
        setConfirming(false);
        setSelectedGoalId(null);
        await loadGoals();
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const confirmation = selectedGoal ? allocationConfirmCopy(amountCents, selectedGoal.title) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        enabled={Platform.OS === "ios"}
        behavior="padding"
        style={styles.screen}
      >
        <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Fechar distribuição" />
        <View style={styles.sheet}>
          <ScrollView
            ref={keyboard.scrollRef}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={keyboard.cancelPendingScroll}
            contentContainerStyle={[styles.content, { paddingBottom: 28 + keyboard.keyboardInset }]}
          >
            <Text style={styles.eyebrow}>Distribuir para um sonho</Text>
            <Text style={styles.available}>{formatBRLFromCents(availableCents)}</Text>
            <Text style={styles.helper}>Disponível para organizar agora.</Text>
            {formError ? (
              <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">{formError}</Text>
            ) : null}

            {confirming && confirmation ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>{confirmation.title}</Text>
                <Text style={styles.helper}>{confirmation.detail}</Text>
                <Pressable
                  onPress={() => void submit()}
                  disabled={saving}
                  style={[styles.primaryButton, saving && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: saving, busy: saving }}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" accessibilityLabel="Destinando valor" />
                  ) : (
                    <Text style={styles.primaryText}>Confirmar destinação</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setConfirming(false)}
                  disabled={saving}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Voltar</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {goalsLoading ? <ActivityIndicator color={OB.primary} accessibilityLabel="Carregando sonhos" /> : null}
                {goalsError ? <Text style={styles.error}>{goalsError}</Text> : null}
                {!goalsLoading && !goals.length && !goalsError ? (
                  <Text style={styles.helper}>{ALLOCATABLE_CASH_COPY.noGoals}</Text>
                ) : null}
                {goals.map((goal) => {
                  const selected = goal.id === selectedGoalId;
                  const remaining = goalRemainingCents(goal);
                  return (
                    <Pressable
                      key={goal.id}
                      onPress={() => setSelectedGoalId(goal.id)}
                      style={[styles.goal, selected && styles.goalSelected]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${goal.title}. ${formatBRLFromCents(goal.contributed_cents)} de ${formatBRLFromCents(goal.target_cents)}. Faltam ${formatBRLFromCents(remaining)}.`}
                    >
                      <Text style={styles.goalTitle}>{goal.title}</Text>
                      <Text style={styles.goalMeta}>
                        {formatBRLFromCents(goal.contributed_cents)} de {formatBRLFromCents(goal.target_cents)}
                      </Text>
                      <Text style={styles.goalMeta}>Faltam {formatBRLFromCents(remaining)}</Text>
                      <View style={styles.track}>
                        <View style={[styles.fill, { width: `${goalProgressPercent(goal)}%` }]} />
                      </View>
                    </Pressable>
                  );
                })}
                <View onLayout={keyboard.registerField("amount")}>
                  <Text style={styles.label}>Valor</Text>
                  <TextInput
                    value={amount}
                    onChangeText={(value) => {
                      setAmount(formatBRLInputFromDigits(value));
                      setFormError("");
                    }}
                    onFocus={() => keyboard.focusField("amount")}
                    keyboardType="number-pad"
                    placeholder="R$ 0,00"
                    placeholderTextColor={OB.support}
                    style={styles.input}
                    accessibilityLabel="Valor para destinar ao sonho"
                  />
                  {allocationAmountMessage(issue) ? (
                    <Text style={styles.error}>{allocationAmountMessage(issue)}</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={openConfirm}
                  disabled={!canContinue}
                  style={[styles.primaryButton, !canContinue && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canContinue }}
                >
                  <Text style={styles.primaryText}>Revisar destinação</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "flex-end" },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: OB.modalScrim,
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: OB.offWhite,
  },
  content: { padding: 20, gap: 10 },
  eyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  available: { color: OB.primary, fontSize: 28, fontWeight: "900" },
  helper: { color: OB.support, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  label: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    color: OB.primary,
    fontSize: 16,
    fontWeight: "800",
  },
  goal: {
    borderRadius: 16,
    padding: 12,
    gap: 3,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  goalSelected: { borderColor: OB.primary },
  goalTitle: { color: OB.primary, fontSize: 15, fontWeight: "900" },
  goalMeta: { color: OB.support, fontSize: 12, fontWeight: "700" },
  track: { height: 6, borderRadius: 99, backgroundColor: OB.supportSoft, marginTop: 6, overflow: "hidden" },
  fill: { height: 6, backgroundColor: OB.primary },
  confirmBox: { gap: 10, padding: 4 },
  confirmTitle: { color: OB.primary, fontSize: 18, fontWeight: "900", lineHeight: 24 },
  error: { color: "#A33F3F", fontSize: 13, fontWeight: "800", lineHeight: 18 },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.45 },
});
