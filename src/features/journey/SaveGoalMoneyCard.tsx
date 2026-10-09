import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ALLOCATABLE_CASH_COPY,
  allocationAmountIssue,
  allocationAmountMessage,
  classifyAllocationError,
  createAllocationRequestId,
  resolveAllocationRequestId,
  type AllocationRequest,
} from "../../lib/allocatableCashPresentation";
import { allocateKnownCashToGoal, getAllocatableCashPosition, type AllocatableCashPosition } from "../../lib/financialAllocatableCash";
import { formatBRLFromCents, formatBRLInputFromDigits, formatDateBRFromYMD, parseBRLToCents } from "../../lib/format";
import { addSavedOutsideGoalContribution } from "../../lib/goalContributionReview";
import {
  SAVE_MONEY_COPY,
  classifySavedOutsideError,
  reviewFailureKeepsRequest,
  reviewFailureMessage,
  resolveSavedOutsideRequestId,
  saveMoneyChoices,
  savedOutsideAmountIssue,
  savedOutsideAmountMessage,
  savedOutsideConfirmation,
  trackedAccountSaveState,
  type ReviewRequest,
} from "../../lib/goalContributionReviewPresentation";
import { OB } from "../../ui/OnboardingKit";

function todayYmd() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ymdToDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12);
}

export function SaveGoalMoneyCard({
  householdId,
  goalId,
  goalTitle,
  remainingCents,
  onSaved,
}: {
  householdId: string;
  goalId: string;
  goalTitle: string;
  remainingCents: number;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState<"choose" | "tracked" | "outside" | "confirmOutside">("choose");
  const [position, setPosition] = useState<AllocatableCashPosition | null>(null);
  const [positionStatus, setPositionStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [contributedOn, setContributedOn] = useState(todayYmd);
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmingTracked, setConfirmingTracked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [trackedRequest, setTrackedRequest] = useState<AllocationRequest | null>(null);
  const [outsideRequest, setOutsideRequest] = useState<ReviewRequest | null>(null);
  const savingRef = useRef(false);

  const amountCents = parseBRLToCents(amount);
  const trackedState = position ? trackedAccountSaveState(position) : null;
  const availableCents = trackedState?.kind === "ready" ? trackedState.availableCents : 0;
  const trackedIssue = allocationAmountIssue({
    amountCents,
    typed: amount.length > 0,
    availableCents,
    goalRemainingCents: remainingCents,
  });
  const outsideIssue = savedOutsideAmountIssue({
    amountCents,
    typed: amount.length > 0,
    remainingCents,
  });

  function backToChoice() {
    if (saving) return;
    setStep("choose");
    setConfirmingTracked(false);
    setError("");
    setAmount("");
    setNote("");
    setTrackedRequest(null);
    setOutsideRequest(null);
  }

  async function openTracked() {
    setStep("tracked");
    setError("");
    setConfirmingTracked(false);
    setPositionStatus("loading");
    try {
      const next = await getAllocatableCashPosition(householdId);
      setPosition(next);
      setPositionStatus("ready");
    } catch {
      setPosition(null);
      setPositionStatus("error");
      setError(ALLOCATABLE_CASH_COPY.error);
    }
  }

  async function saveTracked() {
    if (savingRef.current || trackedIssue || amountCents <= 0 || remainingCents <= 0) return;
    savingRef.current = true;
    const nextRequest = resolveAllocationRequestId(trackedRequest, goalId, amountCents, createAllocationRequestId);
    setTrackedRequest(nextRequest);
    try {
      setSaving(true);
      setError("");
      await allocateKnownCashToGoal({
        householdId,
        goalId,
        amountCents,
        requestId: nextRequest.id,
      });
      setTrackedRequest(null);
      setAmount("");
      setStep("choose");
      setConfirmingTracked(false);
      await onSaved();
    } catch (failure: any) {
      const classified = classifyAllocationError(failure);
      if (classified.kind === "conflict") setTrackedRequest(null);
      setError(classified.message);
      if (classified.kind === "blocked" || classified.kind === "insufficient") {
        setConfirmingTracked(false);
        try {
          const next = await getAllocatableCashPosition(householdId);
          setPosition(next);
        } catch {
          setError(ALLOCATABLE_CASH_COPY.error);
        }
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function saveOutside() {
    if (savingRef.current || outsideIssue || amountCents <= 0) return;
    savingRef.current = true;
    const nextRequest = resolveSavedOutsideRequestId(
      outsideRequest,
      goalId,
      amountCents,
      contributedOn,
      note,
      createAllocationRequestId,
    );
    setOutsideRequest(nextRequest);
    try {
      setSaving(true);
      setError("");
      await addSavedOutsideGoalContribution({
        householdId,
        goalId,
        amountCents,
        contributedOn,
        note,
        requestId: nextRequest.id,
      });
      setOutsideRequest(null);
      setAmount("");
      setNote("");
      setStep("choose");
      await onSaved();
    } catch (failure: any) {
      const kind = classifySavedOutsideError(failure);
      if (!reviewFailureKeepsRequest(kind)) setOutsideRequest(null);
      const invalidMessage = savedOutsideAmountMessage("over_goal") ?? SAVE_MONEY_COPY.outsideError;
      setError(kind === "conflict" ? SAVE_MONEY_COPY.outsideConflict : kind === "invalid" ? invalidMessage : reviewFailureMessage(kind));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function changeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setDateOpen(false);
    if (event.type === "set" && date) {
      const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      setContributedOn(ymd);
    }
  }

  if (remainingCents <= 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{SAVE_MONEY_COPY.title}</Text>
        <Text style={styles.body}>{SAVE_MONEY_COPY.completed}</Text>
      </View>
    );
  }

  const outsideCopy = savedOutsideConfirmation(amountCents, goalTitle);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{SAVE_MONEY_COPY.title}</Text>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

      {step === "choose" ? (
        <>
          <Text style={styles.body}>{SAVE_MONEY_COPY.question}</Text>
          {saveMoneyChoices().map((choice) => (
            <Pressable
              key={choice.source}
              onPress={() => {
                setError("");
                if (choice.source === "tracked") void openTracked();
                else setStep("outside");
              }}
              style={styles.option}
              accessibilityRole="button"
            >
              <Text style={styles.optionTitle}>{choice.title}</Text>
              <Text style={styles.meta}>{choice.detail}</Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {step === "tracked" ? (
        <>
          {positionStatus === "loading" ? <ActivityIndicator color={OB.primary} /> : null}
          {trackedState?.kind === "blocked" ? (
            <>
              <Text style={styles.body}>{trackedState.message}</Text>
              {trackedState.detail ? <Text style={styles.meta}>{trackedState.detail}</Text> : null}
              {trackedState.review ? (
                <Pressable onPress={() => router.push("/(app)/review-goal-contributions")} style={styles.secondaryButton} accessibilityRole="button">
                  <Text style={styles.secondaryText}>{ALLOCATABLE_CASH_COPY.reviewSaved}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {trackedState?.kind === "unavailable" ? <Text style={styles.body}>{trackedState.message}</Text> : null}
          {trackedState?.kind === "ready" && !confirmingTracked ? (
            <>
              <Text style={styles.amount}>{formatBRLFromCents(trackedState.availableCents)}</Text>
              <Text style={styles.meta}>Disponível para organizar agora.</Text>
              <Text style={styles.meta}>{SAVE_MONEY_COPY.trackedDetail}</Text>
              <TextInput
                value={amount}
                onChangeText={(value) => {
                  setAmount(formatBRLInputFromDigits(value));
                  setError("");
                }}
                keyboardType="number-pad"
                placeholder="R$ 0,00"
                placeholderTextColor={OB.support}
                style={styles.input}
                accessibilityLabel="Valor guardado nas contas acompanhadas"
              />
              {allocationAmountMessage(trackedIssue) ? <Text style={styles.error}>{allocationAmountMessage(trackedIssue)}</Text> : null}
              <Pressable
                onPress={() => setConfirmingTracked(true)}
                disabled={Boolean(trackedIssue) || amountCents <= 0}
                style={[styles.primaryButton, trackedIssue || amountCents <= 0 ? styles.disabled : null]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Continuar</Text>
              </Pressable>
            </>
          ) : null}
          {trackedState?.kind === "ready" && confirmingTracked ? (
            <>
              <Text style={styles.optionTitle}>{`Reservar ${formatBRLFromCents(amountCents)} para ${goalTitle}?`}</Text>
              <Text style={styles.body}>{SAVE_MONEY_COPY.trackedDetail}</Text>
              <Pressable onPress={() => void saveTracked()} disabled={saving} style={styles.primaryButton} accessibilityRole="button">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Confirmar</Text>}
              </Pressable>
              {error ? (
                <Pressable onPress={() => void saveTracked()} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
                  <Text style={styles.secondaryText}>{ALLOCATABLE_CASH_COPY.retry}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          <Pressable onPress={backToChoice} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
            <Text style={styles.secondaryText}>Voltar</Text>
          </Pressable>
        </>
      ) : null}

      {step === "outside" || step === "confirmOutside" ? (
        <>
          <Text style={styles.body}>{SAVE_MONEY_COPY.outsideDetail}</Text>
          {step === "outside" ? (
            <>
              <TextInput
                value={amount}
                onChangeText={(value) => {
                  setAmount(formatBRLInputFromDigits(value));
                  setError("");
                }}
                keyboardType="number-pad"
                placeholder="R$ 0,00"
                placeholderTextColor={OB.support}
                style={styles.input}
                accessibilityLabel="Valor guardado fora das contas"
              />
              <Pressable onPress={() => setDateOpen(true)} style={styles.option} accessibilityRole="button">
                <Text style={styles.meta}>Data</Text>
                <Text style={styles.optionTitle}>{formatDateBRFromYMD(contributedOn)}</Text>
              </Pressable>
              {dateOpen ? (
                <DateTimePicker
                  value={ymdToDate(contributedOn)}
                  mode="date"
                  maximumDate={new Date()}
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  onChange={changeDate}
                />
              ) : null}
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Observação (opcional)"
                placeholderTextColor={OB.support}
                style={styles.input}
              />
              {savedOutsideAmountMessage(outsideIssue) ? <Text style={styles.error}>{savedOutsideAmountMessage(outsideIssue)}</Text> : null}
              <Pressable
                onPress={() => setStep("confirmOutside")}
                disabled={Boolean(outsideIssue) || amountCents <= 0}
                style={[styles.primaryButton, outsideIssue || amountCents <= 0 ? styles.disabled : null]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Continuar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.optionTitle}>{outsideCopy.title}</Text>
              <Text style={styles.body}>{outsideCopy.detail}</Text>
              <Pressable onPress={() => void saveOutside()} disabled={saving} style={styles.primaryButton} accessibilityRole="button">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Confirmar</Text>}
              </Pressable>
              {error ? (
                <Pressable onPress={() => void saveOutside()} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
                  <Text style={styles.secondaryText}>{ALLOCATABLE_CASH_COPY.retry}</Text>
                </Pressable>
              ) : null}
            </>
          )}
          <Pressable onPress={backToChoice} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
            <Text style={styles.secondaryText}>{SAVE_MONEY_COPY.cancel}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: 16,
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  title: { color: OB.primary, fontSize: 18, fontWeight: "900" },
  body: { color: OB.primary, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  meta: { color: OB.support, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  amount: { color: OB.primary, fontSize: 28, fontWeight: "900" },
  option: {
    borderRadius: 16,
    padding: 12,
    gap: 4,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
  },
  optionTitle: { color: OB.primary, fontSize: 15, fontWeight: "900", lineHeight: 20 },
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
    borderWidth: 1.5,
    borderColor: OB.primary,
  },
  secondaryText: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.45 },
});
