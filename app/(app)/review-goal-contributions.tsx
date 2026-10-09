import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { createAllocationRequestId } from "../../src/lib/allocatableCashPresentation";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import {
  listPendingManualContributions,
  reconcileManualContribution,
  type PendingManualContribution,
} from "../../src/lib/goalContributionReview";
import {
  REVIEW_COPY,
  buildReconciliationSubmission,
  nextPendingAfterResolve,
  reviewAmountMessage,
  reviewChoices,
  reviewConfirmation,
  reviewDateCaption,
  reviewFailureKeepsRequest,
  reviewFailureMessage,
  reviewProgressLabel,
  reviewRegisteredCopy,
  classifyReviewError,
  resolveReviewRequestId,
  type ReviewDecision,
  type ReviewRequest,
} from "../../src/lib/goalContributionReviewPresentation";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

export default function ReviewGoalContributionsScreen() {
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<PendingManualContribution[]>([]);
  const [seen, setSeen] = useState(0);
  const [finished, setFinished] = useState(false);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [reducing, setReducing] = useState(false);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"choose" | "adjust" | "confirm">("choose");
  const [request, setRequest] = useState<ReviewRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!householdId) {
      setItems([]);
      setStatus("ready");
      return;
    }
    try {
      setStatus("loading");
      const pending = await listPendingManualContributions(householdId);
      setItems(pending);
      setSeen(0);
      setFinished(false);
      setDecision(null);
      setReducing(false);
      setAmount("");
      setStep("choose");
      setRequest(null);
      setError("");
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      if (householdLoading) return;
      void load();
    }, [householdLoading, load])
  );

  function resetForm() {
    setDecision(null);
    setReducing(false);
    setAmount("");
    setStep("choose");
    setRequest(null);
    setError("");
  }

  function choose(next: ReviewDecision, originalCents: number) {
    setDecision(next);
    setError("");
    setNotice("");
    setReducing(false);
    setAmount(formatBRLFromCents(originalCents));
    setStep(next === "no_longer_saved" ? "confirm" : "adjust");
  }

  function setCorrecting(next: boolean, originalCents: number) {
    setReducing(next);
    setAmount(formatBRLFromCents(originalCents));
    setError("");
  }

  const current = items[0] ?? null;
  const submission = decision && current
    ? buildReconciliationSubmission({
      decision,
      originalCents: current.amountCents,
      correcting: reducing,
      editedCents: parseBRLToCents(amount),
    })
    : null;
  const effectiveAmountToSubmitCents = submission?.effectiveAmountCents ?? null;
  const issue = submission?.issue ?? null;
  const confirmation = decision && current
    ? reviewConfirmation({
      decision,
      amountCents: effectiveAmountToSubmitCents ?? current.amountCents,
      originalCents: current.amountCents,
      goalTitle: current.goalTitle,
    })
    : null;

  async function submit() {
    if (!householdId || !current || !decision || !submission || saving || submission.issue) return;
    const nextRequest = resolveReviewRequestId(
      request,
      current.id,
      decision,
      effectiveAmountToSubmitCents,
      createAllocationRequestId,
    );
    setRequest(nextRequest);
    try {
      setSaving(true);
      setError("");
      await reconcileManualContribution({
        householdId,
        contributionId: current.id,
        decision: submission.decision,
        effectiveAmountCents: effectiveAmountToSubmitCents,
        requestId: nextRequest.id,
      });
      const remaining = nextPendingAfterResolve(items, current.id);
      setItems(remaining);
      setSeen((count) => count + 1);
      if (!remaining.length) setFinished(true);
      resetForm();
    } catch (failure: any) {
      const kind = classifyReviewError(failure);
      if (kind === "already_reviewed") {
        setNotice(reviewFailureMessage(kind));
        resetForm();
        await load();
        return;
      }
      if (!reviewFailureKeepsRequest(kind)) setRequest(null);
      setError(reviewFailureMessage(kind));
    } finally {
      setSaving(false);
    }
  }

  function goToPlan() {
    router.replace("/(app)/financial-plan");
  }

  return (
    <OnboardingShell light>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ScreenHeaderCard
          onBack={() => router.back()}
          backAccessibilityLabel="Voltar"
          eyebrow="Planejamento"
          title={REVIEW_COPY.title}
          subtitle="Um valor por vez."
        />
        {householdLoading || status === "loading" ? (
          <View style={styles.card}>
            <ActivityIndicator color={OB.primary} />
            <Text style={styles.body}>Carregando valores para revisar...</Text>
          </View>
        ) : null}
        {status === "error" ? (
          <View style={styles.card}>
            <Text style={styles.body}>{REVIEW_COPY.loadError}</Text>
            <Pressable onPress={() => void load()} style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryText}>{REVIEW_COPY.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {status === "ready" && finished ? (
          <View style={styles.card}>
            <Text style={styles.heading}>{REVIEW_COPY.doneTitle}</Text>
            <Text style={styles.body}>{REVIEW_COPY.doneDetail}</Text>
            <Pressable onPress={goToPlan} style={styles.primaryButton} accessibilityRole="button">
              <Text style={styles.primaryText}>{REVIEW_COPY.backToPlan}</Text>
            </Pressable>
          </View>
        ) : null}
        {status === "ready" && !finished && !current ? (
          <View style={styles.card}>
            <Text style={styles.body}>{REVIEW_COPY.emptyTitle}</Text>
            <Pressable onPress={goToPlan} style={styles.primaryButton} accessibilityRole="button">
              <Text style={styles.primaryText}>{REVIEW_COPY.backToPlan}</Text>
            </Pressable>
          </View>
        ) : null}
        {status === "ready" && current ? (
          <View style={styles.card}>
            <Text style={styles.progress}>{reviewProgressLabel(seen + 1, seen + items.length)}</Text>
            <Text style={styles.heading}>{reviewRegisteredCopy(current.amountCents, current.goalTitle)}</Text>
            {reviewDateCaption(current.contributedOn) ? (
              <Text style={styles.meta}>{reviewDateCaption(current.contributedOn)}</Text>
            ) : null}
            {current.note ? <Text style={styles.note}>{current.note}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

            {step === "choose" ? (
              <>
                <Text style={styles.question}>{REVIEW_COPY.question}</Text>
                {reviewChoices().map((choice) => (
                  <Pressable
                    key={choice.decision}
                    onPress={() => choose(choice.decision, current.amountCents)}
                    style={styles.option}
                    accessibilityRole="button"
                  >
                    <Text style={styles.optionTitle}>{choice.title}</Text>
                    <Text style={styles.meta}>{choice.detail}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {step === "adjust" && decision && effectiveAmountToSubmitCents != null ? (
              <>
                <Text style={styles.meta}>{REVIEW_COPY.amountToConfirm}</Text>
                <Text style={styles.amount}>{formatBRLFromCents(effectiveAmountToSubmitCents)}</Text>
                <Pressable
                  onPress={() => setCorrecting(!reducing, current.amountCents)}
                  style={[styles.option, reducing && styles.optionSelected]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: reducing }}
                >
                  <Text style={styles.optionTitle}>{REVIEW_COPY.reducePrompt}</Text>
                </Pressable>
                {reducing ? (
                  <TextInput
                    value={amount}
                    onChangeText={(value) => {
                      setAmount(formatBRLInputFromDigits(value));
                      setError("");
                    }}
                    keyboardType="number-pad"
                    placeholder="R$ 0,00"
                    placeholderTextColor={OB.support}
                    style={[styles.input, styles.inputActive]}
                    accessibilityLabel="Valor guardado hoje"
                  />
                ) : null}
                {reviewAmountMessage(issue) ? <Text style={styles.error}>{reviewAmountMessage(issue)}</Text> : null}
                <Pressable
                  onPress={() => setStep("confirm")}
                  disabled={Boolean(issue)}
                  style={[styles.primaryButton, issue ? styles.disabled : null]}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>Continuar</Text>
                </Pressable>
                <Pressable onPress={resetForm} style={styles.secondaryButton} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Voltar</Text>
                </Pressable>
              </>
            ) : null}

            {step === "confirm" && confirmation ? (
              <>
                <Text style={styles.heading}>{confirmation.title}</Text>
                <Text style={styles.body}>{confirmation.detail}</Text>
                <Pressable
                  onPress={() => void submit()}
                  disabled={saving || Boolean(issue)}
                  style={[styles.primaryButton, saving ? styles.disabled : null]}
                  accessibilityRole="button"
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Confirmar</Text>}
                </Pressable>
                {error ? (
                  <Pressable onPress={() => void submit()} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
                    <Text style={styles.secondaryText}>{REVIEW_COPY.retry}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={resetForm} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Voltar</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  progress: { color: OB.support, fontSize: 12, fontWeight: "800" },
  heading: { color: OB.primary, fontSize: 20, fontWeight: "900", lineHeight: 26 },
  question: { color: OB.primary, fontSize: 16, fontWeight: "900" },
  body: { color: OB.primary, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  meta: { color: OB.support, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  note: { color: OB.support, fontSize: 13, fontWeight: "700" },
  notice: { color: "#1F6B45", fontSize: 14, fontWeight: "800" },
  error: { color: "#A33F3F", fontSize: 13, fontWeight: "800", lineHeight: 18 },
  amount: { color: OB.primary, fontSize: 28, fontWeight: "900" },
  option: {
    borderRadius: 16,
    padding: 12,
    gap: 4,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
  },
  optionTitle: { color: OB.primary, fontSize: 15, fontWeight: "900" },
  optionSelected: {
    borderColor: OB.primary,
    backgroundColor: "#fff",
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
  inputActive: {
    borderColor: OB.primary,
    borderWidth: 1.5,
  },
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
