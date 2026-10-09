import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import type { FinancialOverview, FinancialOverviewCommitment } from "../../lib/financialPlanning";
import {
  formatShortDateFromYmd,
  getCommitmentPaymentProgress,
  sortPendingCommitments,
} from "../../lib/financialOverviewPresentation";
import { OB } from "../../ui/OnboardingKit";
import {
  canAllocateCycleSurplus,
  commitmentPaymentParams,
  PLANNING_CYCLE_ACTION_COPY,
  surplusAllocationParams,
} from "./planningCycleActions";

export function PlanningActionsSection({ overview }: { overview: FinancialOverview | null }) {
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const { height: viewportHeight } = useWindowDimensions();
  const canAllocate = canAllocateCycleSurplus(overview);
  const pendingCommitments = useMemo(
    () => sortPendingCommitments(overview?.commitments ?? []),
    [overview],
  );
  const confirmedCommitments = useMemo(
    () => overview?.commitments.filter((item) => item.pending_cents <= 0) ?? [],
    [overview],
  );

  function openCommitment(commitment: FinancialOverviewCommitment) {
    if (!overview) return;
    setPaymentsOpen(false);
    router.push({
      pathname: "/(app)/link-commitment",
      params: commitmentPaymentParams(overview, commitment, "planejamento"),
    });
  }

  function openAllocation() {
    if (!overview || !canAllocate) return;
    router.push({
      pathname: "/(app)/allocate-surplus",
      params: surplusAllocationParams(overview, "planejamento"),
    });
  }

  function renderPaymentRow(commitment: FinancialOverviewCommitment) {
    const progress = getCommitmentPaymentProgress(commitment.amount_cents, commitment.paid_cents);
    const isPaid = progress.status === "Pago";
    const hasPartialPayment = progress.status === "Pago parcialmente";
    const actionLabel = isPaid || hasPartialPayment ? "Ver pagamento" : "Registrar pagamento";
    return (
      <View key={commitment.id} style={styles.paymentRow}>
        <Pressable
          onPress={() => openCommitment(commitment)}
          style={({ pressed }) => [styles.paymentMain, pressed && styles.pressed]}
        >
          <View style={[styles.paymentCheck, isPaid && styles.paymentCheckDone]}>
            <Ionicons name={isPaid ? "checkmark" : "receipt-outline"} size={17} color={isPaid ? "#fff" : OB.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.paymentName} numberOfLines={1}>{commitment.name}</Text>
            <Text style={styles.paymentMeta}>
              {commitment.installment_number && commitment.installments_total
                ? `Parcela ${commitment.installment_number}/${commitment.installments_total} · `
                : ""}
              Vence em {formatShortDateFromYmd(commitment.due_on)}
            </Text>
            <Text style={styles.paymentAmounts}>
              Total {formatBRLFromCents(progress.totalCents)} · Falta {formatBRLFromCents(progress.remainingCents)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={OB.support} />
        </Pressable>
        <Pressable
          onPress={() => openCommitment(commitment)}
          style={({ pressed }) => [styles.paymentAction, isPaid && styles.paymentActionDone, pressed && styles.pressed]}
        >
          <Text style={[styles.paymentActionText, isPaid && styles.paymentActionTextDone]}>{actionLabel}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{PLANNING_CYCLE_ACTION_COPY.title}</Text>
      <Pressable
        onPress={() => setPaymentsOpen(true)}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={PLANNING_CYCLE_ACTION_COPY.reviewPayments}
      >
        <Text style={styles.actionText}>{PLANNING_CYCLE_ACTION_COPY.reviewPayments}</Text>
      </Pressable>
      {canAllocate ? (
        <Pressable
          onPress={openAllocation}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={PLANNING_CYCLE_ACTION_COPY.allocateDream}
        >
          <Text style={styles.actionText}>{PLANNING_CYCLE_ACTION_COPY.allocateDream}</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={paymentsOpen}
        animationType="fade"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent={Platform.OS === "android"}
        navigationBarTranslucent={Platform.OS === "android"}
        onRequestClose={() => setPaymentsOpen(false)}
      >
        <View style={styles.scrimRoot}>
          <Pressable
            style={styles.scrim}
            onPress={() => setPaymentsOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Fechar"
          />
          <View style={styles.scrimStage} pointerEvents="box-none">
            <View style={[styles.overlayCard, { maxHeight: Math.min(viewportHeight * 0.88, 720) }]}>
              <View style={styles.modalHeader}>
                <View style={styles.flex}>
                  <Text style={styles.modalTitle}>{PLANNING_CYCLE_ACTION_COPY.reviewPayments}</Text>
                  <Text style={styles.modalSubtitle}>Contas e parcelas deste ciclo.</Text>
                </View>
                <Pressable
                  onPress={() => setPaymentsOpen(false)}
                  style={styles.modalClose}
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                >
                  <Ionicons name="close" size={20} color={OB.support} />
                </Pressable>
              </View>
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalContent}
                showsVerticalScrollIndicator={false}
              >
                {pendingCommitments.length ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Pendentes</Text>
                    {pendingCommitments.map(renderPaymentRow)}
                  </View>
                ) : null}
                {confirmedCommitments.length ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Já pagos</Text>
                    {confirmedCommitments.map(renderPaymentRow)}
                  </View>
                ) : null}
                {!pendingCommitments.length && !confirmedCommitments.length ? (
                  <View style={styles.modalEmpty}>
                    <Text style={styles.modalEmptyTitle}>
                      {overview ? "Nada pendente" : "Carregando planejamento"}
                    </Text>
                    <Text style={styles.modalEmptyText}>
                      {overview
                        ? "Não há pagamentos para revisar neste período."
                        : "Abra de novo em alguns instantes se os pagamentos não aparecerem."}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  title: { color: OB.primary, fontSize: 16, fontWeight: "900" },
  action: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  actionText: { color: OB.primary, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.82 },
  flex: { flex: 1, minWidth: 0 },
  scrimRoot: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: OB.modalScrim },
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
    overflow: "hidden",
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
  modalSubtitle: { color: OB.support, fontSize: 13, fontWeight: "700", lineHeight: 18, marginTop: 4 },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  modalContent: { paddingHorizontal: 14, paddingBottom: 8, gap: 14 },
  modalEmpty: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 12, gap: 6 },
  modalEmptyTitle: { color: OB.primary, fontSize: 16, fontWeight: "900" },
  modalEmptyText: { color: OB.support, fontSize: 13, fontWeight: "700", textAlign: "center", lineHeight: 19 },
  modalSection: { gap: 10 },
  modalSectionTitle: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  paymentRow: { borderRadius: 16, padding: 12, gap: 10, backgroundColor: OB.offWhite },
  paymentMain: { flexDirection: "row", alignItems: "center", gap: 10 },
  paymentCheck: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  paymentCheckDone: { backgroundColor: "#168A59" },
  paymentName: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  paymentMeta: { color: OB.support, fontSize: 12, fontWeight: "700", marginTop: 2 },
  paymentAmounts: { color: OB.primary, fontSize: 12, fontWeight: "800", marginTop: 4 },
  paymentAction: {
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  paymentActionDone: { backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  paymentActionText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  paymentActionTextDone: { color: OB.primary },
});
