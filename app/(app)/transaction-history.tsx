import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MovementFilters } from "../../src/features/movements/MovementFilters";
import { MovementFirstUse } from "../../src/features/movements/MovementFirstUse";
import { MovementQuickActions } from "../../src/features/movements/MovementQuickActions";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { findTransactionAccountById } from "../../src/lib/banks";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { getEditTransactionHref } from "../../src/lib/editTransactionNavigation";
import {
  filterMovementsForList,
  isInternalTransferLeg,
} from "../../src/lib/internalTransfers";
import {
  CLEARED_MOVEMENT_LIST_FILTERS,
  hasActiveMovementListFilters,
  hasFinancialHistory,
  MANAGE_IMPORTS_HREF,
  resolveAccountFilter,
  type MovementFlowFilter,
} from "../../src/lib/movementHistoryPresentation";
import { resolveMovementListContext } from "../../src/lib/movementImportContext";
import { onlyImportAfterStatementDeletion } from "../../src/lib/statementImportManagement";
import { statementImportExists } from "../../src/lib/statementImports";
import { listTransactionHistory, TxRow } from "../../src/lib/transactions";
import { useSession } from "../../src/providers/SessionProvider";
import { BankLogo } from "../../src/ui/BankLogo";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import {
  JOURNEY_HEADER_HEIGHT,
  getJourneyBottomContentInset,
  shouldShowStandaloneScreenHeader,
} from "../../src/ui/journeyChrome";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

type TransactionHistoryScreenProps = {
  embedded?: boolean;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

function routeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function accountName(accountId: string | null) {
  if (!accountId) return "Conta não informada";
  return findTransactionAccountById(accountId)?.name ?? "Outra conta";
}

function TransactionCard({ transaction, onPress }: { transaction: TxRow; onPress: () => void }) {
  const income = transaction.type === "income";
  const internalTransfer = isInternalTransferLeg(transaction);
  const color = income ? "#169B62" : "#D84C4C";
  const transactionAccount = findTransactionAccountById(transaction.account_id);
  const title = transaction.note?.trim() || transaction.category?.name || "Movimentação";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.transactionCard, pressed && styles.transactionCardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Editar ${internalTransfer ? "transferência interna" : income ? "receita" : "despesa"}: ${title}, ${transactionAccount?.name ?? "conta não informada"}`}
    >
      {transactionAccount ? (
        <BankLogo
          bankId={transactionAccount.id}
          size={39}
          color={transactionAccount.color}
          shortName={transactionAccount.shortName}
        />
      ) : (
        <View style={[styles.transactionIcon, { backgroundColor: `${color}16` }]}>
          <Ionicons name={income ? "arrow-down" : "arrow-up"} size={18} color={color} />
        </View>
      )}
      <View style={styles.transactionInfo}>
        <Text numberOfLines={1} style={styles.transactionTitle}>{title}</Text>
        <Text style={styles.transactionMeta} numberOfLines={2}>
          {transaction.category?.name || "Sem categoria"} · {accountName(transaction.account_id)} · {formatDateBRFromYMD(transaction.occurred_on)}
        </Text>
        <View style={[styles.sourceBadge, transaction.statement_import_id ? styles.sourceBadgeCsv : styles.sourceBadgeManual]}>
          <Ionicons name={transaction.statement_import_id ? "document-text-outline" : "create-outline"} size={11} color={transaction.statement_import_id ? "#376EA5" : OB.support} />
          <Text style={[styles.sourceText, transaction.statement_import_id && styles.sourceTextCsv]}>{transaction.statement_import_id ? "CSV" : "Manual"}</Text>
        </View>
        {internalTransfer ? (
          <View style={[styles.sourceBadge, styles.sourceBadgeTransfer]}>
            <Ionicons name="swap-horizontal-outline" size={11} color={OB.primary} />
            <Text style={[styles.sourceText, styles.sourceTextTransfer]}>Entre contas</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.amountColumn}>
        <Text style={[styles.transactionAmount, { color }]}>{income ? "+" : "-"}{formatBRLFromCents(transaction.amount_cents)}</Text>
        <Ionicons name="chevron-forward" size={16} color={OB.support} />
      </View>
    </Pressable>
  );
}

export function TransactionHistoryScreen({
  embedded = false,
  onScroll,
}: TransactionHistoryScreenProps = {}) {
  const params = useLocalSearchParams<{
    importId?: string | string[];
    postImport?: string | string[];
    onlyImport?: string | string[];
  }>();
  const requestedImportId = routeParam(params.importId);
  const onlyImportParam = routeParam(params.onlyImport);
  const postImportActive = routeParam(params.postImport) === "1" && Boolean(requestedImportId);
  const insets = useSafeAreaInsets();
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<"search">();
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [flow, setFlow] = useState<MovementFlowFilter>("all");
  const [month, setMonth] = useState("all");
  const [account, setAccount] = useState("all");
  const [statementImportId, setStatementImportId] = useState<string | null>(null);
  const [importNoticeDismissed, setImportNoticeDismissed] = useState(false);
  const seenPostImportId = useRef<string | null>(null);

  useEffect(() => {
    const next = resolveMovementListContext({
      routeImportId: requestedImportId,
      onlyImport: onlyImportParam,
      postImportActive,
      seenPostImportId: seenPostImportId.current,
    });
    seenPostImportId.current = next.seenPostImportId;
    if (next.resetListFilters) {
      setSearch("");
      setFlow("all");
      setMonth("all");
      setAccount("all");
      setImportNoticeDismissed(false);
    }
    setStatementImportId(next.statementImportId);
    if (next.clearOnlyImportParam) {
      router.setParams({ onlyImport: undefined });
    }
  }, [onlyImportParam, postImportActive, requestedImportId]);

  const showAllMovements = useCallback(() => {
    setStatementImportId(null);
    setImportNoticeDismissed(true);
    router.setParams({ onlyImport: undefined });
  }, []);

  const clearExplicitImport = useCallback(() => {
    setStatementImportId(null);
    setImportNoticeDismissed(false);
    router.setParams({ onlyImport: undefined });
  }, []);

  const showOnlyThisImport = useCallback(() => {
    if (!requestedImportId) return;
    setSearch("");
    setFlow("all");
    setMonth("all");
    setAccount("all");
    setStatementImportId(requestedImportId);
    router.setParams({ onlyImport: requestedImportId });
  }, [requestedImportId]);

  const clearListFilters = useCallback(() => {
    setSearch(CLEARED_MOVEMENT_LIST_FILTERS.search);
    setFlow(CLEARED_MOVEMENT_LIST_FILTERS.flow);
    setMonth(CLEARED_MOVEMENT_LIST_FILTERS.month);
    setAccount(CLEARED_MOVEMENT_LIST_FILTERS.account);
  }, []);

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
      setLoadError(error?.message ?? "Não foi possível carregar as movimentações.");
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

  useFocusEffect(
    useCallback(() => {
      if (!householdId || !onlyImportParam) return;
      let cancelled = false;
      void statementImportExists(householdId, onlyImportParam)
        .then((exists) => {
          if (cancelled || exists) return;
          setStatementImportId(onlyImportAfterStatementDeletion(onlyImportParam, onlyImportParam));
          router.setParams({ onlyImport: undefined });
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [householdId, onlyImportParam])
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
  const accountIds = useMemo(() => accounts.map((item) => item.id), [accounts]);
  const accountFilter = resolveAccountFilter(account, accountIds);
  const historyFilters = useMemo(() => ({
    month,
    account: accountFilter,
    statementImportId,
    flow,
    search,
  }), [accountFilter, flow, month, search, statementImportId]);
  const filtered = useMemo(
    () => filterMovementsForList(
      transactions,
      historyFilters,
      (transaction) => [transaction.note, transaction.category?.name, accountName(transaction.account_id)],
    ),
    [historyFilters, transactions],
  );
  const busy = loading || householdLoading;
  const returning = !busy && !loadError && hasFinancialHistory(transactions);
  const firstUse = !busy && !loadError && !hasFinancialHistory(transactions);
  const showImportSuccess = postImportActive && !statementImportId && !importNoticeDismissed && !busy && !loadError;
  const canClearFilters = hasActiveMovementListFilters({ search, flow, month, account: accountFilter });

  const content = (
    <>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.keyboard}>
        <Animated.ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scroll,
            embedded && styles.scrollEmbedded,
            {
              paddingBottom:
                (embedded
                  ? getJourneyBottomContentInset(insets.bottom)
                  : 34) + keyboardInset,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          scrollEventThrottle={16}
          onScroll={onScroll}
          onScrollBeginDrag={cancelPendingScroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OB.primary} />}
        >
        {shouldShowStandaloneScreenHeader(embedded) ? (
        <ScreenHeaderCard
          onBack={() => router.back()}
          backAccessibilityLabel="Voltar"
          eyebrow="Entradas e saídas"
          title="Movimentações"
          subtitle="Consulte tudo o que entrou e saiu, manualmente ou por CSV."
        />
        ) : null}

        {busy ? (
          <View style={styles.stateCard}><ActivityIndicator color={OB.primary} /><Text style={styles.stateText}>Carregando movimentações...</Text></View>
        ) : loadError ? (
          <View style={styles.stateCard}><Ionicons name="cloud-offline-outline" size={32} color={OB.support} /><Text style={styles.stateTitle}>Não foi possível carregar</Text><Text style={styles.stateText}>{loadError}</Text><Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryText}>Tentar novamente</Text></Pressable></View>
        ) : firstUse ? (
          <MovementFirstUse />
        ) : returning ? (
          <>
            <MovementQuickActions />

            <View style={styles.searchBox} onLayout={registerField("search")}>
              <Ionicons name="search-outline" size={19} color={OB.support} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Buscar descrição, categoria ou conta" placeholderTextColor={OB.support} returnKeyType="search" onFocus={() => focusField("search")} onPressIn={() => focusField("search")} onSubmitEditing={Keyboard.dismiss} style={styles.searchInput} />
              {search ? <Pressable onPress={() => setSearch("")} hitSlop={10}><Ionicons name="close-circle" size={19} color={OB.support} /></Pressable> : null}
            </View>

            <MovementFilters
              flow={flow}
              month={month}
              account={accountFilter}
              months={months}
              accounts={accounts}
              onFlowChange={setFlow}
              onMonthChange={setMonth}
              onAccountChange={setAccount}
            />

            {showImportSuccess ? (
              <View style={styles.importDoneCard}>
                <View style={styles.importDoneHeader}>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#169B62" />
                  <View style={styles.importFilterInfo}>
                    <Text style={styles.importFilterTitle}>Importação concluída</Text>
                    <Text style={styles.importFilterText}>
                      {transactions.length === 1
                        ? "1 movimentação disponível"
                        : `${transactions.length} movimentações disponíveis`}
                    </Text>
                  </View>
                </View>
                <View style={styles.importDoneActions}>
                  <Pressable
                    onPress={showAllMovements}
                    accessibilityRole="button"
                    accessibilityLabel="Ver todas as movimentações"
                    style={styles.importDoneButton}
                  >
                    <Text style={styles.importDoneButtonText}>Ver todas as movimentações</Text>
                  </Pressable>
                  <Pressable
                    onPress={showOnlyThisImport}
                    accessibilityRole="button"
                    accessibilityLabel="Ver somente esta importação"
                    style={[styles.importDoneButton, styles.importDoneButtonSecondary]}
                  >
                    <Text style={styles.importDoneButtonTextSecondary}>Ver somente esta importação</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {statementImportId ? (
              <View style={styles.importFilterCard}>
                <Ionicons name="document-text-outline" size={19} color="#376EA5" />
                <View style={styles.importFilterInfo}>
                  <Text style={styles.importFilterTitle}>Movimentações do arquivo importado</Text>
                  <Text style={styles.importFilterText}>A lista está mostrando somente os registros desta importação.</Text>
                </View>
                <Pressable onPress={clearExplicitImport} hitSlop={10} accessibilityRole="button" accessibilityLabel="Mostrar todas as movimentações">
                  <Ionicons name="close-circle" size={21} color={OB.support} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Movimentações</Text>
              <Text style={styles.listCount}>{filtered.length} {filtered.length === 1 ? "registro" : "registros"}</Text>
            </View>

            {filtered.length ? (
              <View style={styles.transactionList}>{filtered.map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} onPress={() => router.push(getEditTransactionHref(transaction.id))} />)}</View>
            ) : (
              <View style={styles.filterEmptyCard}>
                <Text style={styles.stateTitle}>Nenhuma movimentação encontrada com esses filtros.</Text>
                <Text style={styles.stateText}>Ajuste a busca ou os filtros para ver suas movimentações.</Text>
                {canClearFilters ? (
                  <Pressable onPress={clearListFilters} style={styles.retryButton}>
                    <Text style={styles.retryText}>Limpar filtros</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            <Pressable
              onPress={() => router.push(MANAGE_IMPORTS_HREF)}
              accessibilityRole="button"
              accessibilityLabel="Gerenciar extratos importados"
              style={({ pressed }) => [styles.importsLink, pressed && styles.pressed]}
            >
              <Text style={styles.importsLinkText}>Gerenciar extratos importados</Text>
              <Ionicons name="chevron-forward" size={14} color={OB.support} />
            </Pressable>
          </>
        ) : null}
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </>
  );

  if (embedded) return content;

  return (
    <OnboardingShell light>
      {content}
    </OnboardingShell>
  );
}

export default TransactionHistoryScreen;

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  scroll: { padding: 18, gap: 10, paddingBottom: 34 },
  scrollEmbedded: { paddingTop: JOURNEY_HEADER_HEIGHT + 12 },
  searchBox: { minHeight: 48, borderRadius: 16, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  searchInput: { flex: 1, color: OB.primary, fontSize: 13, fontWeight: "700" },
  importDoneCard: { borderRadius: 16, padding: 13, gap: 12, backgroundColor: "rgba(22,155,98,0.08)", borderWidth: 1, borderColor: "rgba(22,155,98,0.22)" },
  importDoneHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  importDoneActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  importDoneButton: { minHeight: 42, borderRadius: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", backgroundColor: OB.primary },
  importDoneButtonSecondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  importDoneButtonText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  importDoneButtonTextSecondary: { color: OB.primary, fontSize: 12, fontWeight: "900" },
  importFilterCard: { minHeight: 64, borderRadius: 16, padding: 13, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(55,110,165,0.10)", borderWidth: 1, borderColor: "rgba(55,110,165,0.22)" },
  importFilterInfo: { flex: 1 },
  importFilterTitle: { color: OB.primary, fontSize: 11, fontWeight: "900" },
  importFilterText: { color: OB.support, fontSize: 9, lineHeight: 14, fontWeight: "700", marginTop: 2 },
  importsLink: { minHeight: 40, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4, paddingVertical: 4 },
  importsLinkText: { color: OB.support, fontSize: 13, fontWeight: "800" },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  listTitle: { color: OB.primary, fontSize: 17, fontWeight: "900" },
  listCount: { color: OB.support, fontSize: 10, fontWeight: "800" },
  transactionList: { borderRadius: 20, overflow: "hidden", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  transactionCard: { minHeight: 92, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 11, borderBottomWidth: 1, borderBottomColor: OB.supportSoft },
  transactionCardPressed: { backgroundColor: OB.offWhite },
  transactionIcon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  transactionInfo: { flex: 1, minWidth: 0 },
  transactionTitle: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  transactionMeta: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 15, marginTop: 3 },
  sourceBadge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  sourceBadgeManual: { backgroundColor: OB.offWhite },
  sourceBadgeCsv: { backgroundColor: "rgba(55,110,165,0.12)" },
  sourceBadgeTransfer: { backgroundColor: "rgba(6,25,54,0.08)" },
  sourceText: { color: OB.support, fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  sourceTextCsv: { color: "#376EA5" },
  sourceTextTransfer: { color: OB.primary },
  transactionAmount: { maxWidth: 105, fontSize: 12, fontWeight: "900", paddingTop: 2 },
  amountColumn: { minHeight: 42, alignItems: "flex-end", justifyContent: "space-between" },
  stateCard: { minHeight: 180, borderRadius: 20, padding: 24, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  filterEmptyCard: { borderRadius: 20, padding: 20, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  stateTitle: { color: OB.primary, fontSize: 14, fontWeight: "900", textAlign: "center" },
  stateText: { color: OB.support, fontSize: 11, fontWeight: "700", textAlign: "center", lineHeight: 17 },
  retryButton: { minHeight: 42, borderRadius: 13, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", backgroundColor: OB.primary, marginTop: 5 },
  retryText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  pressed: { opacity: 0.84 },
});
