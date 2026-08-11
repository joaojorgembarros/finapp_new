import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
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
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

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

function localYmd(date = new Date()) {
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
  const [actionError, setActionError] = useState("");
  const [showOtherExpenses, setShowOtherExpenses] = useState(false);

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
      setShowOtherExpenses(false);
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
  const suggestedCandidates = data?.candidates.filter(
    (transaction) => transaction.exactAmount || transaction.currentlyLinked
  ) ?? [];
  const otherCandidates = data?.candidates.filter(
    (transaction) => !transaction.exactAmount && !transaction.currentlyLinked
  ) ?? [];
  const displayedCandidates = showOtherExpenses
    ? data?.candidates ?? []
    : suggestedCandidates;

  const registerManually = useCallback(() => {
    if (!data) return;
    const today = localYmd();
    const occurredOn = today >= cycle.start && today < cycle.end
      ? today
      : data.commitment.due_on;
    router.push({
      pathname: "/(app)/new-transaction",
      params: {
        paymentFlow: "1",
        commitmentId: data.commitment.id,
        commitmentName: data.commitment.name,
        amountCents: String(data.commitment.pending_cents || data.commitment.amount_cents),
        occurredOn,
        cycleKey: cycle.key,
        cycleDate: cycleDate || cycle.start,
      },
    });
  }, [cycle.end, cycle.key, cycle.start, cycleDate, data]);

  const confirmLink = useCallback(async () => {
    if (!data || !selectedTransaction || !householdId || !userId || saving) return;
    try {
      setSaving(true);
      setActionError("");
      const latestPayments = await listCommitmentPayments(householdId, cycle.key);
      const alreadyLinked = latestPayments.some(
        (payment) =>
          payment.commitment_id !== data.commitment.id &&
          payment.transaction_id === selectedTransaction.id
      );
      if (alreadyLinked) {
        const message = "Outra conta acabou de usar esta despesa. Atualizamos a lista para você escolher outra.";
        setSelectedTransactionId(null);
        await load();
        if (Platform.OS === "web") setActionError(message);
        else Alert.alert("Despesa já vinculada", message);
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
      goBack();
    } catch (saveError: any) {
      const message = saveError?.message ?? "Confira a despesa selecionada e tente novamente.";
      if (Platform.OS === "web") setActionError(message);
      else Alert.alert("Não foi possível vincular", message);
    } finally {
      setSaving(false);
    }
  }, [cycle.key, data, goBack, householdId, load, saving, selectedTransaction, userId]);

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
            <ScreenHeaderCard
              onBack={goBack}
              eyebrow="Pagamento do mês"
              title="Registrar pagamento"
              subtitle="Escolha como esse pagamento entrou no seu controle."
            />

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
                    <Ionicons name="information-circle-outline" size={20} color={OB.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.noticeTitle}>O extrato é opcional</Text>
                    <Text style={styles.noticeText}>
                      Use um gasto que já está no app ou registre o pagamento manualmente. O vínculo apenas evita que a mesma saída seja descontada duas vezes.
                    </Text>
                  </View>
                </View>

                <View style={styles.sectionHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.sectionEyebrow}>Gasto real</Text>
                    <Text style={styles.sectionTitle}>
                      {suggestedCandidates.length
                        ? suggestedCandidates.length === 1
                          ? "Encontramos um possível pagamento"
                          : `Encontramos ${suggestedCandidates.length} possíveis pagamentos`
                        : "Como você quer registrar o pagamento?"}
                    </Text>
                    <Text style={styles.sectionText}>
                      {suggestedCandidates.length
                        ? "Confira a descrição e a data antes de confirmar."
                        : `Ainda não há um gasto de ${formatBRLFromCents(data.commitment.amount_cents)} associado a esta conta.`}
                    </Text>
                  </View>
                  {suggestedCandidates.length ? (
                    <View style={styles.countBadge}>
                      <Text style={styles.countText}>{suggestedCandidates.length}</Text>
                    </View>
                  ) : null}
                </View>

                {displayedCandidates.length ? (
                  <View style={styles.transactionList} accessibilityRole="radiogroup">
                    {displayedCandidates.map((transaction) => {
                      const selected = transaction.id === selectedTransactionId;
                      return (
                        <Pressable
                          key={transaction.id}
                          onPress={() => {
                            setActionError("");
                            setSelectedTransactionId(transaction.id);
                          }}
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
                      <Ionicons name="create-outline" size={25} color={OB.primary} />
                    </View>
                    <Text style={styles.stateTitle}>Registre sem importar um extrato</Text>
                    <Text style={styles.stateText}>
                      {data.excludedCount > 0
                        ? "Os outros gastos deste ciclo já foram usados em contas diferentes. Você ainda pode registrar este pagamento manualmente."
                        : "Informe apenas de qual conta o dinheiro saiu. O valor e a descrição já estarão preenchidos."}
                    </Text>
                    <View style={styles.emptyActionsVertical}>
                      <Pressable
                        onPress={registerManually}
                        style={styles.primaryButton}
                        accessibilityRole="button"
                      >
                        <Ionicons name="create-outline" size={18} color="#fff" />
                        <Text style={styles.primaryButtonText}>Registrar manualmente</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => router.push("/(app)/import-csv")}
                        style={styles.secondaryButton}
                        accessibilityRole="button"
                      >
                        <Ionicons name="document-text-outline" size={17} color={OB.primary} />
                        <Text style={styles.secondaryButtonText}>Importar extrato do banco</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {otherCandidates.length ? (
                  <Pressable
                    onPress={() => {
                      setSelectedTransactionId(null);
                      setShowOtherExpenses((visible) => !visible);
                    }}
                    style={styles.showOtherButton}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showOtherExpenses }}
                  >
                    <Ionicons name="search-outline" size={17} color={OB.primary} />
                    <Text style={styles.showOtherButtonText}>
                      {showOtherExpenses
                        ? "Ocultar outros gastos"
                        : `Procurar em ${otherCandidates.length} ${otherCandidates.length === 1 ? "outro gasto" : "outros gastos"}`}
                    </Text>
                    <Ionicons name={showOtherExpenses ? "chevron-up" : "chevron-down"} size={16} color={OB.support} />
                  </Pressable>
                ) : null}

                {displayedCandidates.length ? <View style={styles.confirmCard}>
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

                  {actionError ? (
                    <View style={styles.actionError} accessibilityRole="alert">
                      <Ionicons name="alert-circle-outline" size={18} color="#A33F3F" />
                      <Text style={styles.actionErrorText}>{actionError}</Text>
                    </View>
                  ) : null}

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
                        <Ionicons name="checkmark-circle-outline" size={19} color="#fff" />
                        <Text style={styles.primaryButtonText}>Usar este gasto</Text>
                      </>
                    )}
                  </Pressable>
                </View> : null}

                {displayedCandidates.length ? (
                  <View style={styles.alternativeCard}>
                    <View style={styles.flex}>
                      <Text style={styles.alternativeTitle}>Não é nenhum desses gastos?</Text>
                      <Text style={styles.alternativeText}>Registre manualmente ou importe outro extrato.</Text>
                    </View>
                    <View style={styles.alternativeActions}>
                      <Pressable onPress={registerManually} style={styles.iconAction} accessibilityRole="button" accessibilityLabel="Registrar pagamento manualmente">
                        <Ionicons name="create-outline" size={18} color={OB.primary} />
                      </Pressable>
                      <Pressable onPress={() => router.push("/(app)/import-csv")} style={styles.iconAction} accessibilityRole="button" accessibilityLabel="Importar extrato do banco">
                        <Ionicons name="document-text-outline" size={18} color={OB.primary} />
                      </Pressable>
                    </View>
                  </View>
                ) : null}
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
  emptyActionsVertical: { width: "100%", gap: 8, marginTop: 14 },
  showOtherButton: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(123,160,200,0.10)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  showOtherButtonText: { flex: 1, color: OB.primary, fontSize: 10, fontWeight: "900" },
  confirmCard: {
    borderRadius: 20,
    padding: 15,
    gap: 13,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  alternativeCard: {
    minHeight: 66,
    borderRadius: 18,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(123,160,200,0.08)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  alternativeTitle: { color: OB.primary, fontSize: 11, fontWeight: "900" },
  alternativeText: { color: OB.support, fontSize: 9, lineHeight: 13, fontWeight: "700", marginTop: 3 },
  alternativeActions: { flexDirection: "row", gap: 7 },
  iconAction: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  actionError: {
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
  actionErrorText: {
    flex: 1,
    color: "#7F3030",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
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
