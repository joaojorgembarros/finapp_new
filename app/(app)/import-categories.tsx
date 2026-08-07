import React, { useCallback, useMemo, useState } from "react";
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
import { Category, listCategories } from "../../src/lib/categories";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import {
  categorizeStatementImport,
  listStatementImportTransactions,
  StatementImportTransaction,
} from "../../src/lib/statementImports";
import {
  statementSimilarityKey,
  suggestStatementCategory,
} from "../../src/lib/statementCategorization";
import {
  listStatementCategoryRules,
  StatementCategoryRuleInput,
} from "../../src/lib/statementCategoryRules";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

function ImportedTransactionCategoryRow({
  transaction,
  categories,
  categoryId,
  autoSuggested,
  similarCount,
  canRemember,
  onCategoryChange,
  onRemember,
}: {
  transaction: StatementImportTransaction;
  categories: Category[];
  categoryId: string | null;
  autoSuggested: boolean;
  similarCount: number;
  canRemember: boolean;
  onCategoryChange: (categoryId: string | null) => void;
  onRemember: () => void;
}) {
  const availableCategories = categories.filter((category) => category.flow === transaction.type);
  const isIncome = transaction.type === "income";

  return (
    <View style={styles.transactionCard}>
      <View style={styles.transactionTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.transactionTitle} numberOfLines={2}>
            {transaction.note?.trim() || "Movimentação sem descrição"}
          </Text>
          <Text style={styles.transactionMeta}>
            {formatDateBRFromYMD(transaction.occurred_on)}
            {transaction.source_line ? ` · Linha ${transaction.source_line}` : ""}
          </Text>
        </View>
        <Text style={[styles.transactionAmount, { color: isIncome ? "#178A55" : "#B94A4A" }]}>
          {isIncome ? "+" : "-"}{formatBRLFromCents(transaction.amount_cents)}
        </Text>
      </View>

      <View style={styles.categoryHeader}>
        <Text style={styles.categoryLabel}>Categoria</Text>
        {autoSuggested ? <Text style={styles.autoLabel}>Sugerida automaticamente</Text> : null}
      </View>

      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryChips}
      >
        <Pressable
          onPress={() => onCategoryChange(null)}
          style={[styles.categoryChip, !categoryId && styles.categoryChipActive]}
        >
          <Text style={[styles.categoryChipText, !categoryId && styles.categoryChipTextActive]}>
            Sem categoria
          </Text>
        </Pressable>
        {availableCategories.map((category) => {
          const active = category.id === categoryId;
          return (
            <Pressable
              key={category.id}
              onPress={() => onCategoryChange(category.id)}
              style={[styles.categoryChip, active && styles.categoryChipActive]}
            >
              <Ionicons
                name={(category.icon || "pricetag-outline") as any}
                size={12}
                color={active ? "#fff" : OB.primary}
              />
              <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                {category.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {categoryId && canRemember ? (
        <Pressable onPress={onRemember} style={styles.rememberButton}>
          <Ionicons name="bookmark-outline" size={13} color={OB.primary} />
          <Text style={styles.rememberText}>
            {similarCount > 1
              ? `Aplicar a ${similarCount} semelhantes e lembrar`
              : "Lembrar para próximas importações"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ImportCategoriesScreen() {
  const params = useLocalSearchParams<{ importId?: string | string[] }>();
  const importId = Array.isArray(params.importId) ? params.importId[0] : params.importId;
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [transactions, setTransactions] = useState<StatementImportTransaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [autoSuggested, setAutoSuggested] = useState<Set<string>>(new Set());
  const [pendingRules, setPendingRules] = useState<Record<string, StatementCategoryRuleInput>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!householdId || !importId) {
      if (!householdLoading) setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const [transactionRows, categoryRows, learnedRules] = await Promise.all([
        listStatementImportTransactions(householdId, importId),
        listCategories(householdId),
        listStatementCategoryRules(householdId),
      ]);

      const nextAssignments: Record<string, string | null> = {};
      const nextAutoSuggested = new Set<string>();

      for (const transaction of transactionRows) {
        if (transaction.category_id) {
          nextAssignments[transaction.id] = transaction.category_id;
          continue;
        }

        const suggestion = suggestStatementCategory(
          {
            key: transaction.id,
            type: transaction.type,
            amount_cents: transaction.amount_cents,
            note: transaction.note?.trim() || "Movimentação sem descrição",
            occurred_on: transaction.occurred_on,
            rawLine: transaction.source_line ?? 1,
          },
          categoryRows,
          learnedRules
        );

        if (suggestion?.confidence === "high") {
          nextAssignments[transaction.id] = suggestion.categoryId;
          nextAutoSuggested.add(transaction.id);
        }
      }

      setTransactions(transactionRows);
      setCategories(categoryRows);
      setAssignments(nextAssignments);
      setAutoSuggested(nextAutoSuggested);
      setPendingRules({});
    } catch (loadError: any) {
      setError(loadError?.message ?? "Não foi possível carregar as movimentações.");
    } finally {
      setLoading(false);
    }
  }, [householdId, householdLoading, importId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const similarityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const transaction of transactions) {
      const key = `${transaction.type}:${statementSimilarityKey(transaction.note ?? "")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [transactions]);

  const categorizedCount = transactions.filter((transaction) => Boolean(assignments[transaction.id])).length;

  function changeCategory(transaction: StatementImportTransaction, categoryId: string | null) {
    setAssignments((current) => ({ ...current, [transaction.id]: categoryId }));
    setAutoSuggested((current) => {
      const next = new Set(current);
      next.delete(transaction.id);
      return next;
    });

    const matchKey = statementSimilarityKey(transaction.note ?? "");
    if (matchKey.length < 2) return;
    const ruleKey = `${transaction.type}:${matchKey}`;
    setPendingRules((current) => {
      if (!current[ruleKey]) return current;
      const next = { ...current };
      if (categoryId) {
        next[ruleKey] = {
          flow: transaction.type,
          match_key: matchKey,
          category_id: categoryId,
        };
      } else {
        delete next[ruleKey];
      }
      return next;
    });
  }

  function rememberCategory(transaction: StatementImportTransaction) {
    const categoryId = assignments[transaction.id];
    if (!categoryId) return;
    const matchKey = statementSimilarityKey(transaction.note ?? "");
    if (matchKey.length < 2) {
      Alert.alert("Regra automática", "Esta movimentação não possui uma descrição suficiente para criar uma regra.");
      return;
    }
    const ruleKey = `${transaction.type}:${matchKey}`;

    setAssignments((current) => {
      const next = { ...current };
      for (const candidate of transactions) {
        if (
          candidate.type === transaction.type &&
          statementSimilarityKey(candidate.note ?? "") === matchKey
        ) {
          next[candidate.id] = categoryId;
        }
      }
      return next;
    });
    setAutoSuggested((current) => {
      const next = new Set(current);
      transactions.forEach((candidate) => {
        if (
          candidate.type === transaction.type &&
          statementSimilarityKey(candidate.note ?? "") === matchKey
        ) next.delete(candidate.id);
      });
      return next;
    });
    setPendingRules((current) => ({
      ...current,
      [ruleKey]: {
        flow: transaction.type,
        match_key: matchKey,
        category_id: categoryId,
      },
    }));
  }

  async function save() {
    if (!householdId || !importId || saving) return;

    try {
      setSaving(true);
      const result = await categorizeStatementImport({
        householdId,
        importId,
        assignments: transactions.map((transaction) => ({
          transaction_id: transaction.id,
          category_id: assignments[transaction.id] ?? null,
        })),
        categoryRules: Object.values(pendingRules),
      });

      Alert.alert(
        "Categorias salvas",
        `${result.updated_count} movimentação(ões) foram revisadas${
          result.learned_rules_count
            ? ` e ${result.learned_rules_count} regra(s) serão usadas no futuro`
            : ""
        }.`,
        [{ text: "Concluir", onPress: () => router.back() }]
      );
    } catch (saveError: any) {
      Alert.alert("Não foi possível salvar", saveError?.message ?? "Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || householdLoading;

  return (
    <OnboardingShell light>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ScreenHeaderCard
          eyebrow="Histórico de importações"
          title="Revisar categorias"
          subtitle="Organize movimentações antigas e ensine o app para as próximas importações."
          onBack={() => router.back()}
        />

        {busy ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={OB.primary} />
            <Text style={styles.stateTitle}>Carregando movimentações...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={27} color="#B42318" />
            <Text style={styles.stateTitle}>Não foi possível carregar</Text>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryIcon}>
                <Ionicons name="pricetags-outline" size={21} color={OB.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryTitle}>
                  {categorizedCount} de {transactions.length} categorizadas
                </Text>
                <Text style={styles.summaryText}>
                  {autoSuggested.size} sugestão(ões) automática(s) · {Object.keys(pendingRules).length} regra(s) para lembrar
                </Text>
              </View>
            </View>

            {transactions.map((transaction) => (
              <ImportedTransactionCategoryRow
                key={transaction.id}
                transaction={transaction}
                categories={categories}
                categoryId={assignments[transaction.id] ?? null}
                autoSuggested={autoSuggested.has(transaction.id)}
                similarCount={
                  similarityCounts.get(
                    `${transaction.type}:${statementSimilarityKey(transaction.note ?? "")}`
                  ) ?? 1
                }
                canRemember={statementSimilarityKey(transaction.note ?? "").length >= 2}
                onCategoryChange={(categoryId) => changeCategory(transaction, categoryId)}
                onRemember={() => rememberCategory(transaction)}
              />
            ))}

            {!transactions.length ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateTitle}>Nenhuma movimentação encontrada</Text>
              </View>
            ) : null}

            <Pressable
              onPress={save}
              disabled={saving || !transactions.length}
              style={[styles.saveButton, (saving || !transactions.length) && styles.saveButtonDisabled]}
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={19} color="#fff" />
                  <Text style={styles.saveButtonText}>Salvar categorias</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
    gap: 14,
    paddingBottom: 30,
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
  },
  summaryTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  summaryText: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 15,
    marginTop: 4,
  },
  transactionCard: {
    borderRadius: 18,
    padding: 14,
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  transactionTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  transactionTitle: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  transactionMeta: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
  },
  transactionAmount: {
    fontSize: 12,
    fontWeight: "900",
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  categoryLabel: {
    color: OB.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  autoLabel: {
    color: "#178A55",
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  categoryChips: {
    gap: 7,
    paddingRight: 4,
  },
  categoryChip: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  categoryChipActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  categoryChipText: {
    color: OB.primary,
    fontSize: 9,
    fontWeight: "900",
  },
  categoryChipTextActive: {
    color: "#fff",
  },
  rememberButton: {
    alignSelf: "flex-start",
    minHeight: 31,
    borderRadius: 10,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  rememberText: {
    color: OB.primary,
    fontSize: 9,
    fontWeight: "900",
  },
  stateCard: {
    minHeight: 190,
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  stateTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  stateText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
    textAlign: "center",
  },
  retryButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
    marginTop: 6,
  },
  retryText: {
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  saveButton: {
    minHeight: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: OB.primary,
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
});
