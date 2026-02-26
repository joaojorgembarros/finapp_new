// app/(tabs)/home.tsx
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native"; // ✅ NOVO

import Screen from "../../src/ui/Screen";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { formatBRLFromCents } from "../../src/lib/format";
import { getMonthlyNet, getAllTimeNet } from "../../src/lib/transactions";
import { onTxChanged } from "../../src/lib/bus";
import { Ionicons } from "@expo/vector-icons";

function maskBRL() {
  return "R$ ••••";
}

export default function HomeTab() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);

  const [totalNet, setTotalNet] = useState<{ income: number; expense: number; net: number }>({
    income: 0,
    expense: 0,
    net: 0,
  });

  const [monthNet, setMonthNet] = useState<{ income: number; expense: number; net: number }>({
    income: 0,
    expense: 0,
    net: 0,
  });

  const [hideAmounts, setHideAmounts] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      setBusy(true);
      const [all, m] = await Promise.all([getAllTimeNet(householdId), getMonthlyNet(householdId)]);
      setTotalNet(all);
      setMonthNet(m);
    } finally {
      setBusy(false);
    }
  }, [householdId]);

  useEffect(() => {
    load();
  }, [load]);

  // ✅ Recarrega ao voltar pra Home (cinto e suspensório)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    const off = onTxChanged?.((ev: any) => {
      if (!ev?.householdId || ev.householdId !== householdId) return;
      load();
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [householdId, load]);

  return (
    <Screen scroll={false}>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.small}>Saldo atual</Text>

          <Pressable onPress={() => setHideAmounts((v) => !v)} hitSlop={12} style={{ padding: 6 }}>
            <Ionicons
              name={hideAmounts ? "eye-off-outline" : "eye-outline"}
              size={18}
              color={"rgba(231,234,243,0.65)"}
            />
          </Pressable>
        </View>

        {busy ? (
          <View style={{ height: 58, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        ) : (
          <Text style={styles.big}>{hideAmounts ? maskBRL() : formatBRLFromCents(totalNet.net)}</Text>
        )}

        <Text style={styles.sub}>
          No mês: {hideAmounts ? "••••" : formatBRLFromCents(monthNet.net)}
        </Text>

        <View style={{ height: 26 }} />

        <View style={styles.row2}>
          <Pressable onPress={() => router.push("/(tabs)/history")} style={styles.mini}>
            <Text style={styles.miniLabel}>Entradas</Text>
            <Text style={[styles.miniValue, { color: theme.colors.good }]}>
              {hideAmounts ? maskBRL() : formatBRLFromCents(monthNet.income)}
            </Text>
          </Pressable>

          <Pressable onPress={() => router.push("/(tabs)/history")} style={styles.mini}>
            <Text style={styles.miniLabel}>Saídas</Text>
            <Text style={[styles.miniValue, { color: theme.colors.bad }]}>
              {hideAmounts ? maskBRL() : formatBRLFromCents(monthNet.expense)}
            </Text>
          </Pressable>
        </View>

        <View style={{ height: 12 }} />
        <Pressable onPress={() => router.push("/(tabs)/goals")} style={styles.metaCard}>
          <Text style={styles.miniLabel}>Metas</Text>

          <View style={styles.metaDot}>
            <Ionicons name="chevron-forward" size={16} color={"rgba(231,234,243,0.95)"} />
          </View>
        </Pressable>

        <View style={{ height: 16 }} />

        <Pressable onPress={() => router.push("/(tabs)/add-transaction")} style={styles.launchBtn}>
          <Ionicons name="add" size={18} color={theme.colors.primary} />
          <Text style={styles.launchTxt}>Lançar</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  small: {
    color: "rgba(231,234,243,0.55)",
    fontWeight: "800",
    fontSize: 13,
  },
  big: {
    marginTop: 12,
    color: "rgba(231,234,243,0.95)",
    fontWeight: "900",
    fontSize: 44,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  sub: {
    marginTop: 6,
    color: "rgba(231,234,243,0.45)",
    fontWeight: "800",
    fontSize: 12,
  },

  row2: {
    flexDirection: "row",
    gap: 14,
    width: "100%",
    justifyContent: "center",
  },

  mini: {
    flex: 1,
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
  },

  miniLabel: {
    fontWeight: "900",
    fontSize: 14,
    color: "rgba(231,234,243,0.92)",
    textAlign: "center",
  },

  miniValue: {
    marginTop: 10,
    fontWeight: "900",
    fontSize: 14,
    textAlign: "center",
    width: "100%",
  },

  metaCard: {
    width: "62%",
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
  },

  metaDot: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(0,240,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(0,240,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },

  launchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: 170,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,240,255,0.28)",
    backgroundColor: "rgba(0,240,255,0.10)",
  },
  launchTxt: {
    color: theme.colors.primary,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 0.2,
  },
});