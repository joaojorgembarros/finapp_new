import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import {
  FinancialCycle,
  FinancialOverview,
  FinancialOverviewCommitment,
  FinancialOverviewTransaction,
  getFinancialOverview,
  listCommitmentPayments,
  setCommitmentPaid,
} from "../../src/lib/financialPlanning";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";

type CandidateTransaction = FinancialOverviewTransaction & {
  exactAmount: boolean;
  currentlyLinked: boolean;
};

type ScreenData = {
  overview: FinancialOverview;
  commitment: FinancialOverviewCommitment;
  candidates: CandidateTransaction[];
  excludedCount: number;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function addDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, (day || 1) + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cycleLabel(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return "Ciclo selecionado";
  }
  return `${formatDateBRFromYMD(start)} a ${formatDateBRFromYMD(addDays(end, -1))}`;
}

function transactionTitle(transaction: FinancialOverviewTransaction) {
  return transaction.note?.trim() || transaction.category?.name || "Despesa sem descrição";
}

function transactionMeta(transaction: FinancialOverviewTransaction) {
  const category = transaction.category?.name || "Sem categoria";
  const source = transaction.statement_import_id ? "Extrato importado" : "Lançamento manual";
  return `${category} · ${source}`;
}

export default function LinkCommitmentScreen() {
  const params = useLocalSearchParams<{
    commitmentId?: string | string[];
    cycleKey?: string | string[];
    cycleStart?: string | string[];
    cycleEnd?: string | string[];
    cycleDate?: string | string[];
  }>();
  const commitmentId = firstParam(params.commitmentId) ?? "";
  const cycleKey = firstParam(params.cycleKey) ?? "";
  const cycleStart = firstParam(params.cycleStart) ?? "";
  const cycleEnd = firstParam(params.cycleEnd) ?? "";
  const cycleDate = firstParam(params.cycleDate) ?? cycleStart;
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const loadTokenRef = useRef(0);

  const [data, setData] = useState<ScreenData | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cycle = useMemo<FinancialCycle>(() => ({
    key: cycleKey,
    start: cycleStart,
    end: cycleEnd,
    label: cycleLabel(cycleStart, cycleEnd),
  }), [cycleEnd, cycleKey, cycleStart]);

  const validParams = Boolean(
    commitmentId &&
      cycleKey &&
      /^\d{4}-\d{2}-\d{2}$/.test(cycleStart) &&
      /^\d{4}-\d{2}-\d{2}$/.test(cycleEnd) &&
      cycleStart < cycleEnd
  );

  const returnToControl = useCallback(() => {
    router.replace({
      pathname: "/(app)/journey",
      params: cycleDate ? { tab: "controle", cycleDate } : { tab: "controle" },
    });
  }, [cycleDate]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    returnToControl();
  }, [returnToControl]);

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current;
    if (!validParams) {
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    if (!householdId || !userId) {
      setData(null);
      setError("");
      if (!householdLoading) setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const [overview, payments] = await Promise.all([
        getFinancialOverview({ householdId, userId, cycle }),
        listCommitmentPayments(householdId, cycle.key),
      ]);
      if (token !== loadTokenRef.current) return;

      const commitment = overview.commitments.find((item) => item.id === commitmentId);
      if (!commitment) {
        setData(null);
        setError("Este compromisso não faz parte do ciclo selecionado.");
        return;
      }

      const currentPayment = payments.find((payment) => payment.commitment_id === commitmentId);
      const linkedByAnotherCommitment = new Set(
        payments
          .filter((payment) => payment.commitment_id !== commitmentId && payment.transaction_id)
          .map((payment) => payment.transaction_id as string)
      );
      const visibleExpenses = overview.transactions.filter((transaction) => transaction.type === "expense");
      const candidates = visibleExpenses
        .filter((transaction) => !linkedByAnotherCommitment.has(transaction.id))
        .map((transaction): CandidateTransaction => ({
          ...transaction,
          exactAmount: transaction.amount_cents === commitment.amount_cents,
          currentlyLinked: currentPayment?.transaction_id === transaction.id,
        }))
        .sort((left, right) => {
          if (left.exactAmount !== right.exactAmount) return left.exactAmount ? -1 : 1;
          const leftDifference = Math.abs(left.amount_cents - commitment.amount_cents);
          const rightDifference = Math.abs(right.amount_cents - commitment.amount_cents);
          if (leftDifference !== rightDifference) return leftDifference - rightDifference;
          return right.occurred_on.localeCompare(left.occurred_on);
        });

      setData({
        overview,
        commitment,
        candidates,
        excludedCount: visibleExpenses.length - candidates.length,
      });
      setSelectedTransactionId((current) => (
        current && candidates.some((transaction) => transaction.id === current) ? current : null
      ));
    } catch (loadError: any) {
      if (token !== loadTokenRef.current) return;
      setData(null);
      setError(loadError?.message ?? "Não foi possível carregar as despesas deste ciclo.");
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [commitmentId, cycle, householdId, householdLoading, userId, validParams]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        loadTokenRef.current += 1;
      };
    }, [load])
  );

  const selectedTransaction = data?.candidates.find(
    (transaction) => transaction.id === selectedTransactionId
  ) ?? null;
  const paidCents = data && selectedTransaction
    ? Math.min(data.commitment.amount_cents, selectedTransaction.amount_cents)
    : 0;

  const confirmLink = useCallback(async () => {
    if (!data || !selectedTransaction || !householdId || !userId || saving) return;
    try {
      setSaving(true);
      const latestPayments = await listCommitmentPayments(householdId, cycle.key);
      const alreadyLinked = latestPayments.some(
        (payment) =>
          payment.commitment_id !== data.commitment.id &&
          payment.transaction_id === selectedTransaction.id
      );
      if (alreadyLinked) {
        Alert.alert(
          "Despesa já vinculada",
          "Outra conta acabou de usar esta despesa. Atualizamos a lista para você escolher outra."
        );
        setSelectedTransactionId(null);
        await load();
        return;
      }

      await setCommitmentPaid({
        householdId,
        userId,
        commitmentId: data.commitment.id,
        cycleKey: cycle.key,
        paid: true,
        paidCents: Math.min(data.commitment.amount_cents, selectedTransaction.amount_cents),
        paidOn: selectedTransaction.occurred_on,
        transactionId: selectedTransaction.id,
      });
      returnToControl();
    } catch (saveError: any) {
      Alert.alert(
        "Não foi possível vincular",
        saveError?.message ?? "Confira a despesa selecionada e tente novamente."
      );
    } finally {
      setSaving(false);
    }
  }, [cycle.key, data, householdId, load, returnToControl, saving, selectedTransaction, userId]);

  const busy = loading || householdLoading;

  return (
    <OnboardingShell light>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            compact && styles.contentCompact,
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.contentInner, compact && styles.contentInnerCompact]}>
            <View style={[styles.headerCard, compact && styles.headerCardCompact]}>
              <Pressable
                onPress={goBack}
                hitSlop={12}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Voltar"
              >
                <Ionicons name="arrow-back" size={19} color="#fff" />
              </Pressable>
              <Text style={styles.headerEyebrow}>Conferência do ciclo</Text>
              <Text style={[styles.headerTitle, compact && styles.headerTitleCompact]}>
                Vincule a conta à despesa real
              </Text>
              <Text style={styles.headerSubtitle}>
                Escolha o lançamento que corresponde ao pagamento deste compromisso.
              </Text>
            </View>

            {!validParams ? (
              <StateCard
                icon="alert-circle-outline"
                iconColor="#B94A4A"
                title="Dados do ciclo incompletos"
                text="Volte ao Controle e abra este compromisso novamente."
                actionLabel="Voltar ao Controle"
                onAction={returnToControl}
              />
            ) : busy ? (
              <View style={styles.stateCard}>
                <ActivityIndicator color={OB.primary} />
                <Text style={styles.stateTitle}>Procurando despesas do ciclo...</Text>
              </View>
            ) : !householdId || !userId ? (
              <StateCard
                icon="people-outline"
                title="Estrutura financeira indisponível"
                text="Conclua a configuração inicial antes de vincular um pagamento."
                actionLabel="Voltar ao Controle"
                onAction={returnToControl}
              />
            ) : error ? (
              <StateCard
                icon="alert-circle-outline"
                iconColor="#B94A4A"
                title="Não foi possível continuar"
                text={error}
                actionLabel="Tentar novamente"
                onAction={() => void load()}
              />
            ) : data ? (
              <>
                <View style={styles.commitmentCard}>
                  <View style={styles.commitmentIcon}>
                    <Ionicons name="receipt-outline" size={22} color={OB.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.commitmentEyebrow}>Conta planejada</Text>
                    <Text style={styles.commitmentName} numberOfLines={2}>{data.commitment.name}</Text>
                    <View style={styles.commitmentMetaRow}>
                      <Text style={styles.commitmentAmount}>{formatBRLFromCents(data.commitment.amount_cents)}</Text>
                      <Text style={styles.commitmentDue}>Vence em {formatDateBRFromYMD(data.commitment.due_on)}</Text>
                    </View>
                    <Text style={styles.cycleText}>{data.overview.cycle.label}</Text>
                  </View>
                </View>

                <View style={styles.noticeCard} accessibilityRole="summary">
                  <View style={styles.noticeIcon}>
                    <Ionicons name="git-merge-outline" size={20} color={OB.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.noticeTitle}>Por que fazer este vínculo?</Text>
                    <Text style={styles.noticeText}>
                      A conta planejada e a despesa importada representam o mesmo pagamento. Ao ligá-las, o app considera a conta realizada e evita descontar esse valor duas vezes.
                    </Text>
                  </View>
                </View>

                <View style={styles.sectionHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.sectionEyebrow}>Despesas visíveis</Text>
                    <Text style={styles.sectionTitle}>Qual lançamento é esta conta?</Text>
                    <Text style={styles.sectionText}>
                      Valores iguais aparecem primeiro. Confira também a data e a descrição.
                    </Text>
                  </View>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{data.candidates.length}</Text>
                  </View>
                </View>

                {data.candidates.length ? (
                  <View style={styles.transactionList} accessibilityRole="radiogroup">
                    {data.candidates.map((transaction) => {
                      const selected = transaction.id === selectedTransactionId;
                      return (
                        <Pressable
                          key={transaction.id}
                          onPress={() => setSelectedTransactionId(transaction.id)}
                          style={({ pressed }) => [
                            styles.transactionCard,
                            selected && styles.transactionCardSelected,
                            pressed && styles.transactionCardPressed,
                          ]}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`${transactionTitle(transaction)}, ${formatBRLFromCents(transaction.amount_cents)}, em ${formatDateBRFromYMD(transaction.occurred_on)}`}
                        >
                          <View style={[styles.dateBadge, selected && styles.dateBadgeSelected]}>
                            <Text style={[styles.dateDay, selected && styles.dateTextSelected]}>
                              {transaction.occurred_on.slice(8, 10)}
                            </Text>
                            <Text style={[styles.dateMonth, selected && styles.dateTextSelected]}>
                              {new Date(`${transaction.occurred_on}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                            </Text>
                          </View>
                          <View style={styles.transactionInfo}>
                            <View style={styles.transactionTitleRow}>
                              <Text style={styles.transactionTitle} numberOfLines={2}>
                                {transactionTitle(transaction)}
                              </Text>
                              {transaction.exactAmount ? (
                                <View style={styles.exactBadge}>
                                  <Ionicons name="sparkles" size={11} color="#178A55" />
                                  <Text style={styles.exactText}>Valor igual</Text>
                                </View>
                              ) : null}
                            </View>
                            <Text style={styles.transactionMeta} numberOfLines={1}>{transactionMeta(transaction)}</Text>
                            {transaction.currentlyLinked ? (
                              <Text style={styles.currentLinkText}>Vínculo atual</Text>
                            ) : null}
                          </View>
                          <View style={styles.transactionEnd}>
                            <Text
                              style={styles.transactionAmount}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.72}
                            >
                              {formatBRLFromCents(transaction.amount_cents)}
                            </Text>
                            <Ionicons
                              name={selected ? "checkmark-circle" : "ellipse-outline"}
                              size={23}
                              color={selected ? OB.primary : OB.supportSoft}
                            />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.emptyCard}>
                    <View style={styles.emptyIcon}>
                      <Ionicons name="search-outline" size={25} color={OB.primary} />
                    </View>
                    <Text style={styles.stateTitle}>Nenhuma despesa disponível</Text>
                    <Text style={styles.stateText}>
                      {data.excludedCount > 0
                        ? "As despesas deste ciclo já estão vinculadas a outros compromissos."
                        : "Importe um extrato ou crie o lançamento da despesa antes de marcar esta conta como realizada."}
                    </Text>
                    <View style={styles.emptyActions}>
                      <Pressable
                        onPress={() => router.push("/(app)/import-csv")}
                        style={styles.secondaryButton}
                        accessibilityRole="button"
                      >
                        <Ionicons name="document-text-outline" size={17} color={OB.primary} />
                        <Text style={styles.secondaryButtonText}>Importar extrato</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => router.push("/(app)/new-transaction")}
                        style={styles.secondaryButton}
                        accessibilityRole="button"
                      >
                        <Ionicons name="add" size={18} color={OB.primary} />
                        <Text style={styles.secondaryButtonText}>Criar lançamento</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                <View style={styles.confirmCard}>
                  {selectedTransaction ? (
                    <>
                      <View style={styles.confirmSummary}>
                        <View style={styles.confirmIcon}>
                          <Ionicons name="checkmark" size={18} color="#fff" />
                        </View>
                        <View style={styles.flex}>
                          <Text style={styles.confirmEyebrow}>Despesa selecionada</Text>
                          <Text style={styles.confirmTitle} numberOfLines={1}>{transactionTitle(selectedTransaction)}</Text>
                          <Text style={styles.confirmMeta}>
                            {formatBRLFromCents(selectedTransaction.amount_cents)} · {formatDateBRFromYMD(selectedTransaction.occurred_on)}
                          </Text>
                        </View>
                      </View>
                      {paidCents < data.commitment.amount_cents ? (
                        <View style={styles.partialNotice}>
                          <Ionicons name="information-circle-outline" size={18} color="#8A5A12" />
                          <Text style={styles.partialText}>
                            Serão contabilizados {formatBRLFromCents(paidCents)}. A diferença continuará pendente neste ciclo.
                          </Text>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.selectHint}>Selecione uma despesa acima para liberar a confirmação.</Text>
                  )}

                  <Pressable
                    onPress={() => void confirmLink()}
                    disabled={!selectedTransaction || saving}
                    style={[styles.primaryButton, (!selectedTransaction || saving) && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !selectedTransaction || saving }}
                  >
                    {saving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="link-outline" size={19} color="#fff" />
                        <Text style={styles.primaryButtonText}>Vincular e contabilizar pagamento</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </OnboardingShell>
  );
}

function StateCard({
  icon,
  iconColor = OB.primary,
  title,
  text,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.stateCard}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={27} color={iconColor} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{text}</Text>
      <Pressable onPress={onAction} style={styles.secondaryButton} accessibilityRole="button">
        <Text style={styles.secondaryButtonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OB.offWhite },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingVertical: 20 },
  contentCompact: { paddingHorizontal: 13, paddingVertical: 13 },
  contentInner: { width: "100%", maxWidth: 680, alignSelf: "center", gap: 14 },
  contentInnerCompact: { gap: 11 },
  flex: { flex: 1, minWidth: 0 },
  headerCard: {
    minHeight: 164,
    borderRadius: 23,
    padding: 20,
    paddingLeft: 64,
    justifyContent: "flex-end",
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  headerCardCompact: { minHeight: 154, paddingRight: 15, paddingBottom: 16 },
  backButton: {
    position: "absolute",
    left: 14,
    top: 14,
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  headerEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  headerTitle: { color: OB.textOnDark, fontSize: 24, lineHeight: 29, fontWeight: "900", marginTop: 8 },
  headerTitleCompact: { fontSize: 21, lineHeight: 26 },
  headerSubtitle: { color: OB.textOnDarkMid, fontSize: 12, lineHeight: 18, fontWeight: "700", marginTop: 6 },
  commitmentCard: {
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  commitmentIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  commitmentEyebrow: { color: OB.support, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  commitmentName: { color: OB.primary, fontSize: 17, lineHeight: 21, fontWeight: "900", marginTop: 4 },
  commitmentMetaRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginTop: 6 },
  commitmentAmount: { color: OB.primary, fontSize: 18, fontWeight: "900" },
  commitmentDue: { color: OB.support, fontSize: 10, fontWeight: "800" },
  cycleText: { color: OB.support, fontSize: 9, fontWeight: "700", marginTop: 4 },
  noticeCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    backgroundColor: "rgba(123,160,200,0.14)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  noticeIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.76)",
  },
  noticeTitle: { color: OB.primary, fontSize: 12, fontWeight: "900" },
  noticeText: { color: OB.support, fontSize: 10, lineHeight: 16, fontWeight: "700", marginTop: 3 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 2, marginTop: 3 },
  sectionEyebrow: { color: OB.support, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  sectionTitle: { color: OB.primary, fontSize: 18, lineHeight: 22, fontWeight: "900", marginTop: 4 },
  sectionText: { color: OB.support, fontSize: 10, lineHeight: 15, fontWeight: "700", marginTop: 4 },
  countBadge: {
    minWidth: 38,
    height: 38,
    borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  countText: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  transactionList: { gap: 9 },
  transactionCard: {
    minHeight: 86,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  transactionCardSelected: { borderColor: OB.primary, backgroundColor: "rgba(123,160,200,0.08)" },
  transactionCardPressed: { opacity: 0.82 },
  dateBadge: {
    width: 45,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  dateBadgeSelected: { backgroundColor: OB.primary, borderColor: OB.primary },
  dateDay: { color: OB.primary, fontSize: 16, lineHeight: 18, fontWeight: "900" },
  dateMonth: { color: OB.support, fontSize: 8, fontWeight: "900", textTransform: "uppercase", marginTop: 2 },
  dateTextSelected: { color: "#fff" },
  transactionInfo: { flex: 1, minWidth: 0 },
  transactionTitleRow: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 6 },
  transactionTitle: { flexShrink: 1, color: OB.primary, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  transactionMeta: { color: OB.support, fontSize: 8.5, fontWeight: "700", marginTop: 5 },
  exactBadge: {
    minHeight: 20,
    borderRadius: 999,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(23,138,85,0.10)",
  },
  exactText: { color: "#178A55", fontSize: 7.5, fontWeight: "900" },
  currentLinkText: { color: "#178A55", fontSize: 8, fontWeight: "900", marginTop: 4 },
  transactionEnd: { width: 90, alignItems: "flex-end", gap: 8 },
  transactionAmount: { width: "100%", color: "#C44747", fontSize: 13, fontWeight: "900", textAlign: "right" },
  emptyCard: {
    minHeight: 220,
    borderRadius: 20,
    padding: 20,
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
  emptyActions: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 14 },
  confirmCard: {
    borderRadius: 20,
    padding: 15,
    gap: 13,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  confirmSummary: { flexDirection: "row", alignItems: "center", gap: 11 },
  confirmIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#178A55",
  },
  confirmEyebrow: { color: "#178A55", fontSize: 8.5, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  confirmTitle: { color: OB.primary, fontSize: 12, fontWeight: "900", marginTop: 3 },
  confirmMeta: { color: OB.support, fontSize: 9, fontWeight: "700", marginTop: 3 },
  partialNotice: {
    borderRadius: 13,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(220,160,64,0.12)",
  },
  partialText: { flex: 1, color: "#8A5A12", fontSize: 9, lineHeight: 14, fontWeight: "700" },
  selectHint: { color: OB.support, fontSize: 10, lineHeight: 15, fontWeight: "700", textAlign: "center" },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: OB.primary,
  },
  primaryButtonText: { flexShrink: 1, color: "#fff", fontSize: 13, fontWeight: "900", textAlign: "center" },
  disabled: { opacity: 0.42 },
  stateCard: {
    minHeight: 230,
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  stateTitle: { color: OB.primary, fontSize: 14, fontWeight: "900", textAlign: "center", marginTop: 3 },
  stateText: { maxWidth: 420, color: OB.support, fontSize: 10, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 13,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  secondaryButtonText: { color: OB.primary, fontSize: 10, fontWeight: "900", textAlign: "center" },
});
