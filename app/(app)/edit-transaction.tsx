import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { Category, listCategories } from "../../src/lib/categories";
import {
  firstSearchParam,
  getEditTransactionSafeAreaEdges,
} from "../../src/lib/editTransactionNavigation";
import { listHouseholdPaymentTransactionIds } from "../../src/lib/internalTransferPersistence";
import { listTransactionHistory, TxRow } from "../../src/lib/transactions";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { TransactionEditorBody } from "../../src/ui/TransactionEditorModal";

export default function EditTransactionScreen() {
  const params = useLocalSearchParams<{ transactionId?: string | string[] }>();
  const transactionId = firstSearchParam(params.transactionId);
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [transaction, setTransaction] = useState<TxRow | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [paymentTransactionIds, setPaymentTransactionIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/journey");
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!transactionId) {
        if (active) {
          setLoading(false);
          setLoadError("Lançamento não informado.");
        }
        return;
      }
      if (!householdId) {
        if (!householdLoading && active) setLoading(false);
        return;
      }

      try {
        if (active) {
          setLoading(true);
          setLoadError("");
        }
        const [nextTransactions, nextCategories, nextPaymentIds] = await Promise.all([
          listTransactionHistory(householdId),
          listCategories(householdId),
          listHouseholdPaymentTransactionIds(householdId),
        ]);
        if (!active) return;
        const nextTransaction = nextTransactions.find((row) => row.id === transactionId) ?? null;
        setTransactions(nextTransactions);
        setCategories(nextCategories);
        setPaymentTransactionIds(nextPaymentIds);
        setTransaction(nextTransaction);
        if (!nextTransaction) setLoadError("Lançamento não encontrado.");
      } catch (error: any) {
        if (active) setLoadError(error?.message ?? "Não foi possível carregar o lançamento.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [householdId, householdLoading, transactionId]);

  return (
    <OnboardingShell light edges={getEditTransactionSafeAreaEdges(Platform.OS)}>
      {loading || householdLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={OB.primary} />
          <Text style={styles.stateText}>Carregando lançamento...</Text>
        </View>
      ) : loadError || !transaction || !householdId || !userId ? (
        <View style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={OB.support} />
          <Text style={styles.stateTitle}>Não foi possível abrir</Text>
          <Text style={styles.stateText}>{loadError || "Este lançamento não está disponível."}</Text>
          <Pressable onPress={close} style={styles.closeError} accessibilityRole="button" accessibilityLabel="Fechar">
            <Text style={styles.closeErrorText}>Fechar</Text>
          </Pressable>
        </View>
      ) : (
        <TransactionEditorBody
          transaction={transaction}
          categories={categories}
          householdId={householdId}
          userId={userId}
          transactions={transactions}
          paymentTransactionIds={paymentTransactionIds}
          onClose={close}
        />
      )}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  stateCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 10,
  },
  stateTitle: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  stateText: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 18,
  },
  closeError: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    marginTop: 8,
  },
  closeErrorText: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
});
