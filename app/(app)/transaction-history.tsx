import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { findTransactionAccountById } from "../../src/lib/banks";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { listTransactionHistory, TxRow } from "../../src/lib/transactions";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";

type FlowFilter = "all" | "income" | "expense";

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function accountName(accountId: string | null) {
  if (!accountId) return "Conta não informada";
  return findTransactionAccountById(accountId)?.name ?? "Outra conta";
}

function TransactionCard({ transaction }: { transaction: TxRow }) {
  const income = transaction.type === "income";
  const color = income ? "#169B62" : "#D84C4C";
  const title = transaction.note?.trim() || transaction.category?.name || "Movimentação";

  return (
    <View style={styles.transactionCard}>
      <View style={[styles.transactionIcon, { backgroundColor: `${color}16` }]}>
        <Ionicons name={income ? "arrow-down" : "arrow-up"} size={18} color={color} />
      </View>
      <View style={styles.transactionInfo}>
        <Text numberOfLines={1} style={styles.transactionTitle}>{title}</Text>
        <Text style={styles.transactionMeta} numberOfLines={2}>
          {transaction.category?.name || "Sem categoria"} · {accountName(transaction.account_id)} · {formatDateBRFromYMD(transaction.occurred_on)}
        </Text>
        <View style={[styles.sourceBadge, transaction.statement_import_id ? styles.sourceBadgeCsv : styles.sourceBadgeManual]}>
          <Ionicons name={transaction.statement_import_id ? "document-text-outline" : "create-outline"} size={11} color={transaction.statement_import_id ? "#376EA5" : OB.support} />
          <Text style={[styles.sourceText, transaction.statement_import_id && styles.sourceTextCsv]}>{transaction.statement_import_id ? "CSV" : "Manual"}</Text>
        </View>
      </View>
      <Text style={[styles.transactionAmount, { color }]}>{income ? "+" : "-"}{formatBRLFromCents(transaction.amount_cents)}</Text>
    </View>
  );
}

export default function TransactionHistoryScreen() {
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [flow, setFlow] = useState<FlowFilter>("all");
  const [month, setMonth] = useState("all");
  const [account, setAccount] = useState("all");

  const load = useCallback(async (refresh = false) => {
    if (!householdId) {
      if (!householdLoading) setLoading(false);
      return;
    }
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setLoadError("");
      setTransactions(await listTransactionHistory(householdId));
    } catch (error: any) {
      setLoadError(error?.message ?? "Não foi possível carregar o histórico.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [householdId, householdLoading]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const months = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.occurred_on.slice(0, 7)))].sort((a, b) => b.localeCompare(a)),
    [transactions]
  );
  const accounts = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.account_id ?? "not-informed"))]
      .map((id) => ({ id, name: id === "not-informed" ? "Não informada" : accountName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [transactions]
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return transactions.filter((transaction) => {
      if (flow !== "all" && transaction.type !== flow) return false;
      if (month !== "all" && !transaction.occurred_on.startsWith(month)) return false;
      const accountKey = transaction.account_id ?? "not-informed";
      if (account !== "all" && accountKey !== account) return false;
      if (!query) return true;
      return [transaction.note, transaction.category?.name, accountName(transaction.account_id)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(query));
    });
  }, [account, flow, month, search, transactions]);
  const totals = useMemo(() => filtered.reduce((summary, transaction) => {
    if (transaction.type === "income") summary.income += Number(transaction.amount_cents || 0);
    else summary.expense += Number(transaction.amount_cents || 0);
    return summary;
  }, { income: 0, expense: 0 }), [filtered]);

  const busy = loading || householdLoading;

  return (
    <OnboardingShell light>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OB.primary} />}
      >
        <View style={styles.headerCard}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerEyebrow}>Controle financeiro</Text>
          <Text style={styles.headerTitle}>Histórico de movimentações</Text>
          <Text style={styles.headerSubtitle}>Consulte tudo o que entrou e saiu, manualmente ou por CSV.</Text>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={19} color={OB.support} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Buscar descrição, categoria ou conta" placeholderTextColor={OB.support} style={styles.searchInput} />
          {search ? <Pressable onPress={() => setSearch("")} hitSlop={10}><Ionicons name="close-circle" size={19} color={OB.support} /></Pressable> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {([{"id":"all","label":"Todas"},{"id":"income","label":"Receitas"},{"id":"expense","label":"Despesas"}] as { id: FlowFilter; label: string }[]).map((item) => (
            <Pressable key={item.id} onPress={() => setFlow(item.id)} style={[styles.filterChip, flow === item.id && styles.filterChipActive]}>
              <Text style={[styles.filterChipText, flow === item.id && styles.filterChipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>Período</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Pressable onPress={() => setMonth("all")} style={[styles.smallChip, month === "all" && styles.smallChipActive]}><Text style={[styles.smallChipText, month === "all" && styles.smallChipTextActive]}>Todo o histórico</Text></Pressable>
            {months.map((item) => <Pressable key={item} onPress={() => setMonth(item)} style={[styles.smallChip, month === item && styles.smallChipActive]}><Text style={[styles.smallChipText, month === item && styles.smallChipTextActive]}>{monthLabel(item)}</Text></Pressable>)}
          </ScrollView>
        </View>

        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>Conta</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Pressable onPress={() => setAccount("all")} style={[styles.smallChip, account === "all" && styles.smallChipActive]}><Text style={[styles.smallChipText, account === "all" && styles.smallChipTextActive]}>Todas as contas</Text></Pressable>
            {accounts.map((item) => <Pressable key={item.id} onPress={() => setAccount(item.id)} style={[styles.smallChip, account === item.id && styles.smallChipActive]}><Text style={[styles.smallChipText, account === item.id && styles.smallChipTextActive]}>{item.name}</Text></Pressable>)}
          </ScrollView>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Entradas</Text><Text style={[styles.summaryValue, { color: "#169B62" }]}>{formatBRLFromCents(totals.income)}</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Saídas</Text><Text style={[styles.summaryValue, { color: "#D84C4C" }]}>{formatBRLFromCents(totals.expense)}</Text></View>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Movimentações</Text>
          <Text style={styles.listCount}>{filtered.length} {filtered.length === 1 ? "registro" : "registros"}</Text>
        </View>

        {busy ? (
          <View style={styles.stateCard}><ActivityIndicator color={OB.primary} /><Text style={styles.stateText}>Carregando histórico...</Text></View>
        ) : loadError ? (
          <View style={styles.stateCard}><Ionicons name="cloud-offline-outline" size={32} color={OB.support} /><Text style={styles.stateTitle}>Não foi possível carregar</Text><Text style={styles.stateText}>{loadError}</Text><Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryText}>Tentar novamente</Text></Pressable></View>
        ) : filtered.length ? (
          <View style={styles.transactionList}>{filtered.map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} />)}</View>
        ) : (
          <View style={styles.stateCard}><Ionicons name="receipt-outline" size={32} color={OB.support} /><Text style={styles.stateTitle}>Nenhuma movimentação encontrada</Text><Text style={styles.stateText}>Altere os filtros ou registre um novo lançamento.</Text></View>
        )}
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 18, gap: 14, paddingBottom: 34 },
  headerCard: { minHeight: 184, borderRadius: 24, padding: 20, paddingRight: 64, justifyContent: "flex-end", backgroundColor: OB.primary },
  backButton: { position: "absolute", right: 14, top: 14, width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.20)" },
  headerEyebrow: { color: OB.textOnDarkMid, fontSize: 10, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },
  headerTitle: { color: "#fff", fontSize: 24, fontWeight: "900", lineHeight: 29, marginTop: 8 },
  headerSubtitle: { color: OB.textOnDarkMid, fontSize: 12, fontWeight: "700", lineHeight: 18, marginTop: 6 },
  searchBox: { minHeight: 54, borderRadius: 17, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  searchInput: { flex: 1, color: OB.primary, fontSize: 13, fontWeight: "700" },
  filterRow: { gap: 8, paddingRight: 4 },
  filterChip: { minHeight: 42, borderRadius: 14, paddingHorizontal: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  filterChipActive: { backgroundColor: OB.primary, borderColor: OB.primary },
  filterChipText: { color: OB.support, fontSize: 12, fontWeight: "900" },
  filterChipTextActive: { color: "#fff" },
  filterGroup: { gap: 8 },
  filterLabel: { color: OB.primary, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  smallChip: { minHeight: 36, borderRadius: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.72)", borderWidth: 1, borderColor: OB.supportSoft },
  smallChipActive: { backgroundColor: "rgba(6,25,54,0.10)", borderColor: "rgba(6,25,54,0.30)" },
  smallChipText: { color: OB.support, fontSize: 10, fontWeight: "800" },
  smallChipTextActive: { color: OB.primary, fontWeight: "900" },
  summaryCard: { minHeight: 82, borderRadius: 19, padding: 15, flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  summaryItem: { flex: 1 },
  summaryLabel: { color: OB.support, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  summaryValue: { fontSize: 15, fontWeight: "900", marginTop: 6 },
  summaryDivider: { width: 1, alignSelf: "stretch", marginHorizontal: 12, backgroundColor: OB.supportSoft },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2, marginTop: 2 },
  listTitle: { color: OB.primary, fontSize: 17, fontWeight: "900" },
  listCount: { color: OB.support, fontSize: 10, fontWeight: "800" },
  transactionList: { borderRadius: 20, overflow: "hidden", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  transactionCard: { minHeight: 92, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 11, borderBottomWidth: 1, borderBottomColor: OB.supportSoft },
  transactionIcon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  transactionInfo: { flex: 1, minWidth: 0 },
  transactionTitle: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  transactionMeta: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 15, marginTop: 3 },
  sourceBadge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  sourceBadgeManual: { backgroundColor: OB.offWhite },
  sourceBadgeCsv: { backgroundColor: "rgba(55,110,165,0.12)" },
  sourceText: { color: OB.support, fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  sourceTextCsv: { color: "#376EA5" },
  transactionAmount: { maxWidth: 105, fontSize: 12, fontWeight: "900", paddingTop: 2 },
  stateCard: { minHeight: 180, borderRadius: 20, padding: 24, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  stateTitle: { color: OB.primary, fontSize: 14, fontWeight: "900", textAlign: "center" },
  stateText: { color: OB.support, fontSize: 11, fontWeight: "700", textAlign: "center", lineHeight: 17 },
  retryButton: { minHeight: 42, borderRadius: 13, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", backgroundColor: OB.primary, marginTop: 5 },
  retryText: { color: "#fff", fontSize: 11, fontWeight: "900" },
});
