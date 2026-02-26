// app/(tabs)/history.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addMonths } from "../../src/lib/date";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { getMonthlyNet, listTransactionsByMonth, TxRow } from "../../src/lib/transactions";
import { onTxChanged } from "../../src/lib/bus";

type FilterMode = "all" | "income" | "expense";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthKeyFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

function monthLabelFromDate(d: Date) {
  const s = d.toLocaleString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function SegmentedFilter({
  value,
  onChange,
}: {
  value: FilterMode;
  onChange: (v: FilterMode) => void;
}) {
  const opts: Array<{ key: FilterMode; label: string }> = [
    { key: "all", label: "Todos" },
    { key: "income", label: "Entradas" },
    { key: "expense", label: "Saídas" },
  ];

  return (
    <View style={seg.wrap}>
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[seg.item, active && seg.itemActive]}>
            <Text numberOfLines={1} style={[seg.text, active && seg.textActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const seg = StyleSheet.create({
  wrap: { flexDirection: "row", gap: 10 },
  item: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  itemActive: {
    borderColor: "rgba(0,240,255,0.40)",
    backgroundColor: "rgba(0,240,255,0.10)",
  },
  text: { color: theme.colors.text, fontWeight: "900", fontSize: 13 },
  textActive: { color: theme.colors.primary },
});

export default function HistoryTab() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);

  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const monthKey = useMemo(() => monthKeyFromDate(monthDate), [monthDate]);
  const monthLabel = useMemo(() => monthLabelFromDate(monthDate), [monthDate]);

  const [filter, setFilter] = useState<FilterMode>("all");
  const [hideAmounts, setHideAmounts] = useState(false);

  // loading suave
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const [net, setNet] = useState<{ income: number; expense: number; net: number }>({
    income: 0,
    expense: 0,
    net: 0,
  });
  const [txs, setTxs] = useState<TxRow[]>([]);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (!householdId) return;
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        if (mode === "initial") setInitialLoading(true);
        else setRefreshing(true);

        const [n, t] = await Promise.all([getMonthlyNet(householdId, monthKey), listTransactionsByMonth(householdId, monthKey)]);
        setNet(n);
        setTxs(t);
      } catch (e: any) {
        Alert.alert("Erro", e?.message ?? "Falha ao carregar histórico.");
      } finally {
        inFlight.current = false;
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [householdId, monthKey]
  );

  useEffect(() => {
    load("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, monthKey]);

  useEffect(() => {
    if (!householdId) return;
    const off = onTxChanged?.((p: any) => {
      if (!p?.householdId || p.householdId !== householdId) return;
      load("refresh");
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [householdId, load]);

  const filtered = useMemo(() => {
    if (filter === "all") return txs;
    return txs.filter((t) => t.type === filter);
  }, [txs, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, TxRow[]>();
    for (const t of filtered) {
      const k = t.occurred_on || "0000-00-00";
      const arr = map.get(k) ?? [];
      arr.push(t);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] > b[0] ? -1 : 1));
  }, [filtered]);

  const netColor = net.net > 0 ? theme.colors.good : net.net < 0 ? theme.colors.bad : theme.colors.text;

  const shownNet = hideAmounts ? "••••" : formatBRLFromCents(net.net);
  const shownIncome = hideAmounts ? "••••" : formatBRLFromCents(net.income);
  const shownExpense = hideAmounts ? "••••" : formatBRLFromCents(net.expense);

  return (
    <Screen>
      {/* topo com setas + mês */}
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, -1)))} style={ui.arrowBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.primary} />
        </Pressable>

        <View style={{ alignItems: "center" }}>
          <H1>Histórico</H1>
          <Text style={{ color: theme.colors.muted, fontWeight: "900", marginTop: 2 }}>{monthLabel}</Text>
        </View>

        <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, 1)))} style={ui.arrowBtn} hitSlop={12}>
          <Ionicons name="chevron-forward" size={24} color={theme.colors.primary} />
        </Pressable>
      </Row>

      <View style={{ height: 14 }} />

      {/* resumo */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Resumo</Text>

          <Row style={{ gap: 10, alignItems: "center" }}>
            {refreshing ? <ActivityIndicator size="small" /> : null}

            <Pressable onPress={() => setHideAmounts((v) => !v)} hitSlop={10} style={ui.iconBtn}>
              <Ionicons name={hideAmounts ? "eye-off-outline" : "eye-outline"} size={18} color={theme.colors.text} />
            </Pressable>
          </Row>
        </Row>

        <View style={{ height: 10 }} />

        {initialLoading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : (
          <>
            <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Saldo do mês</Text>
            <Text style={{ color: netColor, fontWeight: "900", fontSize: 30, marginTop: 6 }}>{shownNet}</Text>

            <View style={{ height: 14 }} />

            <Row style={{ gap: 10 }}>
              <View style={ui.pill}>
                <Text style={ui.pillLabel}>Entradas</Text>
                <Text style={[ui.pillValue, { color: theme.colors.good }]}>{shownIncome}</Text>
              </View>

              <View style={ui.pill}>
                <Text style={ui.pillLabel}>Saídas</Text>
                <Text style={[ui.pillValue, { color: theme.colors.bad }]}>{shownExpense}</Text>
              </View>
            </Row>

            <View style={{ height: 14 }} />

            <SegmentedFilter value={filter} onChange={setFilter} />
          </>
        )}
      </Card>

      <View style={{ height: 14 }} />

      {/* lista */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Lançamentos</Text>

          <Pressable onPress={() => router.push("/(tabs)/add-transaction")} style={ui.linkBtn}>
            <Text style={ui.linkText}>+ Lançar</Text>
          </Pressable>
        </Row>

        <View style={{ height: 10 }} />

        {initialLoading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando lançamentos…</P>
          </Row>
        ) : !filtered.length ? (
          <P muted>Nenhum lançamento neste mês.</P>
        ) : (
          <View style={{ marginTop: 6 }}>
            {grouped.map(([day, items], idx) => (
              <View key={day} style={{ marginTop: idx === 0 ? 0 : 14 }}>
                <Text style={ui.dayTitle}>{formatDateBRFromYMD(day)}</Text>
                <View style={{ height: 8 }} />

                <View style={ui.dayBox}>
                  {items.map((t, i) => {
                    const isIncome = t.type === "income";
                    const sign = isIncome ? "+" : "-";
                    const color = isIncome ? theme.colors.good : theme.colors.bad;
                    const cat = t.category?.name || "Sem categoria";

                    return (
                      <View
                        key={t.id}
                        style={[
                          ui.txRow,
                          i === 0 ? { borderTopWidth: 0, paddingTop: 0, marginTop: 0 } : null,
                        ]}
                      >
                        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                          <View style={{ maxWidth: "70%" }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{cat}</Text>

                            {t.note ? (
                              <Text style={ui.note} numberOfLines={1}>
                                {t.note}
                              </Text>
                            ) : null}
                          </View>

                          <Text style={{ color, fontWeight: "900" }}>
                            {hideAmounts ? `${sign} ••••` : `${sign} ${formatBRLFromCents(t.amount_cents)}`}
                          </Text>
                        </Row>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
    </Screen>
  );
}

const ui = StyleSheet.create({
  arrowBtn: { paddingVertical: 8, paddingHorizontal: 10 },

  sectionTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },

  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },

  linkBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  linkText: { color: theme.colors.primary, fontWeight: "900" },

  pill: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pillLabel: { color: theme.colors.muted, fontWeight: "900", fontSize: 12 },
  pillValue: { fontWeight: "900", fontSize: 15, marginTop: 6 },

  dayTitle: {
    color: "rgba(231,234,243,0.55)",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },

  // ✅ menos padding interno no box do dia (sobe tudo um pouco)
  dayBox: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  // ✅ diminui o “empurra pra baixo”
  txRow: {
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },

  // ✅ nota mais colada no título
  note: { color: theme.colors.muted, fontWeight: "800", marginTop: 4 },
});