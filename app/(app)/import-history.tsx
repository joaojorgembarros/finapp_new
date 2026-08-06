import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { findBankById } from "../../src/lib/banks";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import {
  deleteStatementImport,
  listStatementImports,
  StatementImport,
} from "../../src/lib/statementImports";
import { useSession } from "../../src/providers/SessionProvider";
import { BankLogo } from "../../src/ui/BankLogo";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";

function formatImportedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPeriod(statementImport: StatementImport) {
  const start = formatDateBRFromYMD(statementImport.period_start);
  const end = formatDateBRFromYMD(statementImport.period_end);
  return start === end ? start : `${start} a ${end}`;
}

function ImportCard({
  statementImport,
  deleting,
  onDelete,
  onReviewCategories,
}: {
  statementImport: StatementImport;
  deleting: boolean;
  onDelete: () => void;
  onReviewCategories: () => void;
}) {
  const bank = findBankById(statementImport.bank_id);

  return (
    <View style={styles.importCard}>
      <View style={styles.importTop}>
        <View style={[styles.bankIcon, bank && { backgroundColor: `${bank.color}18` }]}>
          <Ionicons name="document-text-outline" size={21} color={bank?.color ?? OB.primary} />
        </View>
        <View style={styles.importHeading}>
          <Text style={styles.fileName} numberOfLines={1}>{statementImport.file_name}</Text>
          <Text style={styles.importedAt}>Importado em {formatImportedAt(statementImport.created_at)}</Text>
        </View>
        {bank ? (
          <View style={[styles.bankBadge, { backgroundColor: `${bank.color}18` }]}>
            <Text style={[styles.bankBadgeText, { color: bank.color }]}>{bank.name}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.periodRow}>
        <Ionicons name="calendar-outline" size={15} color={OB.support} />
        <Text style={styles.periodText}>{formatPeriod(statementImport)}</Text>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Movimentações</Text>
          <Text style={styles.metricValue}>{statementImport.transaction_count}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Entradas</Text>
          <Text style={[styles.metricValue, styles.income]}>
            {formatBRLFromCents(statementImport.income_cents)}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Saídas</Text>
          <Text style={[styles.metricValue, styles.expense]}>
            {formatBRLFromCents(statementImport.expense_cents)}
          </Text>
        </View>
      </View>

      {statementImport.skipped_transaction_count > 0 ? (
        <View style={styles.skippedRow}>
          <Ionicons name="shield-checkmark-outline" size={15} color="#175CD3" />
          <Text style={styles.skippedText}>
            {statementImport.skipped_transaction_count} movimentação(ões) repetida(s) foram ignoradas
          </Text>
        </View>
      ) : null}

      {statementImport.rejected_transaction_count > 0 ? (
        <View style={styles.rejectedRow}>
          <Ionicons name="alert-circle-outline" size={15} color="#B54708" />
          <Text style={styles.rejectedText}>
            {statementImport.rejected_transaction_count} linha(s) inválida(s) não foram importadas
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Revisar categorias de ${statementImport.file_name}`}
        disabled={deleting}
        onPress={onReviewCategories}
        style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]}
      >
        <Ionicons name="pricetags-outline" size={17} color={OB.primary} />
        <Text style={styles.reviewButtonText}>Revisar categorias</Text>
        <Ionicons name="chevron-forward" size={15} color={OB.support} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Desfazer importação de ${statementImport.file_name}`}
        disabled={deleting}
        onPress={onDelete}
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && styles.pressed,
          deleting && styles.disabled,
        ]}
      >
        {deleting ? (
          <ActivityIndicator size="small" color="#B42318" />
        ) : (
          <Ionicons name="trash-outline" size={17} color="#B42318" />
        )}
        <Text style={styles.deleteText}>{deleting ? "Desfazendo..." : "Desfazer importação"}</Text>
      </Pressable>
    </View>
  );
}

export default function ImportHistoryScreen() {
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [imports, setImports] = useState<StatementImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadImports = useCallback(async (asRefresh = false) => {
    if (!householdId) {
      if (!householdLoading) setLoading(false);
      return;
    }

    try {
      if (asRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      setImports(await listStatementImports(householdId));
    } catch (loadError: any) {
      setError(loadError?.message ?? "Não foi possível carregar o histórico.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [householdId, householdLoading]);

  useFocusEffect(
    useCallback(() => {
      void loadImports();
    }, [loadImports])
  );

  function confirmDelete(statementImport: StatementImport) {
    Alert.alert(
      "Desfazer esta importação?",
      `${statementImport.transaction_count} movimentação(ões) de “${statementImport.file_name}” serão excluídas. Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir movimentações",
          style: "destructive",
          onPress: () => void removeImport(statementImport),
        },
      ]
    );
  }

  async function removeImport(statementImport: StatementImport) {
    if (!householdId || deletingId) return;

    try {
      setDeletingId(statementImport.id);
      await deleteStatementImport(householdId, statementImport.id);
      setImports((current) => current.filter((item) => item.id !== statementImport.id));
      Alert.alert(
        "Importação desfeita",
        `${statementImport.transaction_count} movimentação(ões) foram removidas do app.`
      );
    } catch (deleteError: any) {
      Alert.alert(
        "Não foi possível desfazer",
        deleteError?.message ?? "Tente novamente em alguns instantes."
      );
    } finally {
      setDeletingId(null);
    }
  }

  const busy = loading || householdLoading;
  const totalTransactions = imports.reduce((sum, item) => sum + item.transaction_count, 0);
  const bankSummaries = useMemo(() => {
    const totals = new Map<string, { bankId: string; name: string; shortName: string; color: string; files: number; transactions: number }>();

    for (const statementImport of imports) {
      const bank = findBankById(statementImport.bank_id);
      const key = bank?.id ?? "unknown";
      const current = totals.get(key) ?? {
        bankId: key,
        name: bank?.name ?? "Banco não informado",
        shortName: bank?.shortName ?? "?",
        color: bank?.color ?? OB.support,
        files: 0,
        transactions: 0,
      };
      current.files += 1;
      current.transactions += statementImport.transaction_count;
      totals.set(key, current);
    }

    return [...totals.values()].sort((a, b) => b.transactions - a.transactions);
  }, [imports]);

  return (
    <OnboardingShell light>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadImports(true)}
            tintColor={OB.primary}
            colors={[OB.primary]}
          />
        }
      >
        <View style={styles.headerCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            style={styles.backButton}
            hitSlop={12}
          >
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <Text style={styles.headerEyebrow}>Importar extrato</Text>
          <Text style={styles.headerTitle}>Histórico</Text>
          <Text style={styles.headerSubtitle}>
            Consulte os arquivos importados e corrija uma importação feita por engano.
          </Text>
        </View>

        {!busy && imports.length ? (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryIcon}>
                <Ionicons name="folder-open-outline" size={21} color={OB.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryTitle}>
                  {imports.length === 1 ? "1 arquivo importado" : `${imports.length} arquivos importados`}
                </Text>
                <Text style={styles.summaryText}>
                  {totalTransactions === 1
                    ? "1 movimentação registrada"
                    : `${totalTransactions} movimentações registradas`}
                </Text>
              </View>
            </View>

            <View style={styles.bankSummaryCard}>
              <View style={styles.bankSummaryHeader}>
                <Ionicons name="business-outline" size={19} color={OB.primary} />
                <Text style={styles.bankSummaryTitle}>Movimentações por banco</Text>
              </View>
              <View style={styles.bankSummaryList}>
                {bankSummaries.map((summary) => (
                  <View key={summary.bankId} style={styles.bankSummaryRow}>
                    <BankLogo
                      bankId={summary.bankId}
                      size={38}
                      color={summary.color}
                      shortName={summary.shortName}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bankSummaryName}>{summary.name}</Text>
                      <Text style={styles.bankSummaryFiles}>
                        {summary.files === 1 ? "1 arquivo" : `${summary.files} arquivos`}
                      </Text>
                    </View>
                    <View style={styles.bankSummaryCount}>
                      <Text style={styles.bankSummaryCountValue}>{summary.transactions}</Text>
                      <Text style={styles.bankSummaryCountLabel}>movimentações</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}

        {busy ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={OB.primary} />
            <Text style={styles.stateTitle}>Carregando histórico...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <View style={styles.errorIcon}>
              <Ionicons name="alert-circle-outline" size={25} color="#B42318" />
            </View>
            <Text style={styles.stateTitle}>Não foi possível carregar</Text>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable onPress={() => void loadImports()} style={styles.retryButton}>
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : imports.length ? (
          <View style={styles.list}>
            {imports.map((statementImport) => (
              <ImportCard
                key={statementImport.id}
                statementImport={statementImport}
                deleting={deletingId === statementImport.id}
                onReviewCategories={() =>
                  router.push({
                    pathname: "/(app)/import-categories",
                    params: { importId: statementImport.id },
                  })
                }
                onDelete={() => confirmDelete(statementImport)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.stateCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="receipt-outline" size={26} color={OB.support} />
            </View>
            <Text style={styles.stateTitle}>Nenhuma importação ainda</Text>
            <Text style={styles.stateText}>
              Quando você importar um extrato CSV, os detalhes aparecerão aqui.
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => router.push("/(app)/import-csv")}
          style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}
        >
          <Ionicons name="cloud-upload-outline" size={19} color="#fff" />
          <Text style={styles.importButtonText}>Importar novo CSV</Text>
        </Pressable>
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
    gap: 16,
    paddingBottom: 28,
  },
  headerCard: {
    minHeight: 140,
    borderRadius: 22,
    padding: 20,
    paddingRight: 58,
    justifyContent: "flex-end",
    backgroundColor: OB.primary,
  },
  backButton: {
    position: "absolute",
    right: 14,
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
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  headerTitle: {
    color: OB.textOnDark,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  headerSubtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 6,
  },
  summaryCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(123,160,200,0.14)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  summaryTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  summaryText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  bankSummaryCard: {
    borderRadius: 18,
    padding: 14,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  bankSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bankSummaryTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  bankSummaryList: {
    gap: 8,
  },
  bankSummaryRow: {
    minHeight: 58,
    borderRadius: 15,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  bankSummaryName: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  bankSummaryFiles: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 3,
  },
  bankSummaryCount: {
    alignItems: "flex-end",
  },
  bankSummaryCountValue: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  bankSummaryCountLabel: {
    color: OB.support,
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 2,
  },
  list: {
    gap: 12,
  },
  importCard: {
    borderRadius: 20,
    padding: 16,
    gap: 13,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  importTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bankIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  importHeading: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  importedAt: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
  },
  bankBadge: {
    maxWidth: 100,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  bankBadgeText: {
    fontSize: 9,
    fontWeight: "900",
  },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  periodText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
  metrics: {
    flexDirection: "row",
    gap: 8,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    borderRadius: 13,
    padding: 10,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  metricLabel: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
  },
  metricValue: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 5,
  },
  income: {
    color: "#178A55",
  },
  expense: {
    color: "#B94A4A",
  },
  skippedRow: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#EFF8FF",
  },
  skippedText: {
    flex: 1,
    color: "#175CD3",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 15,
  },
  rejectedRow: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#FFFAEB",
  },
  rejectedText: {
    flex: 1,
    color: "#B54708",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 15,
  },
  reviewButton: {
    minHeight: 45,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(123,160,200,0.14)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  reviewButtonText: {
    flex: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  deleteButton: {
    minHeight: 45,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFF4F2",
    borderWidth: 1,
    borderColor: "#FDA29B",
  },
  deleteText: {
    color: "#B42318",
    fontSize: 12,
    fontWeight: "900",
  },
  stateCard: {
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
    width: 58,
    height: 58,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.14)",
    marginBottom: 13,
  },
  errorIcon: {
    width: 58,
    height: 58,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF4F2",
    marginBottom: 13,
  },
  stateTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  stateText: {
    maxWidth: 280,
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "center",
    marginTop: 7,
  },
  retryButton: {
    minHeight: 42,
    borderRadius: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
    marginTop: 14,
  },
  retryText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  importButton: {
    minHeight: 54,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: OB.primary,
  },
  importButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.58,
  },
});
