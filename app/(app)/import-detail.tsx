import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { findBankById } from "../../src/lib/banks";
import { formatBRLFromCents } from "../../src/lib/format";
import {
  countIgnoredImportedTransactions,
  formatStatementPeriod,
  movementsRouteForStatement,
  statementExcludedCountLabel,
  statementImportedCountLabel,
} from "../../src/lib/statementImportManagement";
import {
  deleteStatementImport,
  listStatementImports,
  StatementImport,
} from "../../src/lib/statementImports";
import { useSession } from "../../src/providers/SessionProvider";
import { BankLogo } from "../../src/ui/BankLogo";
import { confirmStatementDeletion } from "../../src/ui/confirmStatementDeletion";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

function routeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

export default function ImportDetailScreen() {
  const params = useLocalSearchParams<{ importId?: string | string[] }>();
  const importId = routeParam(params.importId) ?? "";
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [statement, setStatement] = useState<StatementImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [excludedCount, setExcludedCount] = useState(0);

  const load = useCallback(async () => {
    if (!householdId) {
      if (!householdLoading) setLoading(false);
      return;
    }
    if (!importId) {
      setStatement(null);
      setError("Extrato não informado.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const imports = await listStatementImports(householdId);
      const match = imports.find((item) => item.id === importId) ?? null;
      const excluded = match
        ? await countIgnoredImportedTransactions(householdId, [match.id])
        : {};
      setStatement(match);
      setExcludedCount(excluded[importId] ?? 0);
    } catch (loadError: any) {
      setError(loadError?.message ?? "Não foi possível carregar o extrato.");
    } finally {
      setLoading(false);
    }
  }, [householdId, householdLoading, importId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function openMovements() {
    if (!statement) return;
    const destination = {
      pathname: "/(app)/journey" as const,
      params: movementsRouteForStatement(statement.id),
    };
    if (router.canDismiss()) {
      router.dismissTo(destination);
      return;
    }
    router.replace(destination);
  }

  function confirmDelete() {
    if (!householdId || !statement || deleting) return;
    confirmStatementDeletion({
      householdId,
      statement,
      onConfirm: () => void removeStatement(),
    });
  }

  async function removeStatement() {
    if (!householdId || !statement || deleting) return;
    try {
      setDeleting(true);
      await deleteStatementImport(householdId, statement.id);
      Alert.alert(
        "Extrato excluído",
        "As movimentações deste extrato foram removidas. Os outros extratos continuam no app.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (deleteError: any) {
      Alert.alert(
        "Não foi possível excluir",
        deleteError?.message ?? "Tente novamente em alguns instantes.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const bank = findBankById(statement?.bank_id);
  const excludedLabel = statementExcludedCountLabel(excludedCount);
  const busy = loading || householdLoading;

  return (
    <OnboardingShell light>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ScreenHeaderCard
          eyebrow="Extratos importados"
          title={statement?.file_name ?? "Extrato"}
          subtitle="Detalhes do arquivo importado."
          onBack={() => router.back()}
          backAccessibilityLabel="Voltar"
        />

        {busy ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={OB.primary} />
            <Text style={styles.stateTitle}>Carregando extrato...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Não foi possível carregar</Text>
            <Text style={styles.stateText}>{error}</Text>
          </View>
        ) : !statement ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Extrato não encontrado</Text>
            <Text style={styles.stateText}>Este arquivo não está mais no histórico.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.bankRow}>
              <BankLogo
                bankId={bank?.id ?? "unknown"}
                size={42}
                color={bank?.color ?? OB.support}
                shortName={bank?.shortName ?? "?"}
              />
              <View style={styles.bankCopy}>
                <Text style={styles.bankName}>{bank?.name ?? "Banco não informado"}</Text>
                <Text style={styles.fileName}>{statement.file_name}</Text>
              </View>
            </View>

            <Fact
              label="Período do extrato"
              value={formatStatementPeriod(statement.period_start, statement.period_end)}
            />
            <Fact label="Importado em" value={formatImportedAt(statement.created_at)} />
            <Fact label="Movimentações importadas" value={statementImportedCountLabel(statement.transaction_count)} />
            {excludedLabel ? <Fact label="Excluídas" value={excludedLabel} /> : null}
            <Fact label="Entradas" value={formatBRLFromCents(statement.income_cents)} />
            <Fact label="Saídas" value={formatBRLFromCents(statement.expense_cents)} />
            {statement.final_balance_cents !== null ? (
              <Fact label="Saldo final" value={formatBRLFromCents(statement.final_balance_cents)} />
            ) : null}
            {statement.skipped_transaction_count > 0 ? (
              <Fact
                label="Repetidas"
                value={`${statement.skipped_transaction_count} movimentação(ões) ignorada(s)`}
              />
            ) : null}
            {statement.rejected_transaction_count > 0 ? (
              <Fact
                label="Rejeitadas"
                value={`${statement.rejected_transaction_count} linha(s) inválida(s)`}
              />
            ) : null}

            <Pressable
              onPress={openMovements}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel="Ver movimentações deste extrato"
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, deleting && styles.disabled]}
            >
              <Ionicons name="list-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Ver movimentações deste extrato</Text>
            </Pressable>

            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel="Excluir extrato"
              style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed, deleting && styles.disabled]}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#B42318" />
              ) : (
                <Ionicons name="trash-outline" size={18} color="#B42318" />
              )}
              <Text style={styles.deleteText}>{deleting ? "Excluindo..." : "Excluir extrato"}</Text>
            </Pressable>
          </View>
        )}
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
  card: {
    borderRadius: 18,
    padding: 14,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  bankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bankCopy: {
    flex: 1,
    minWidth: 0,
  },
  bankName: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  fileName: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  fact: {
    gap: 3,
  },
  factLabel: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  factValue: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: OB.primary,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  deleteButton: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(180,35,24,0.28)",
  },
  deleteText: {
    color: "#B42318",
    fontSize: 13,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.84,
  },
  disabled: {
    opacity: 0.6,
  },
  stateCard: {
    borderRadius: 18,
    padding: 18,
    gap: 8,
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  stateTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  stateText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
});
