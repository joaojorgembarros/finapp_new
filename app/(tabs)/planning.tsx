// app/(tabs)/planning.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Card, H2, P, Row, Pill, Button } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addMonths } from "../../src/lib/date";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { getMonthlyNet, listTransactionsByMonth, TxRow } from "../../src/lib/transactions";
import { onTxChanged } from "../../src/lib/bus";
import { Ionicons } from "@expo/vector-icons";

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

function maskBRL() {
  return "R$ ••••";
}

function groupByDate(txs: TxRow[]) {
  const map = new Map<string, TxRow[]>();
  for (const t of txs) {
    const key = t.occurred_on;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort((a, b) => String(b[0]).localeCompare(String(a[0])));
}

function StatBox({
  label,
  value,
  tone,
  hidden,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
  hidden: boolean;
}) {
  const border =
    tone === "good" ? "rgba(0,240,255,0.20)" : tone === "bad" ? "rgba(255,80,80,0.20)" : "rgba(255,255,255,0.10)";
  const bg =
    tone === "good" ? "rgba(0,240,255,0.08)" : tone === "bad" ? "rgba(255,80,80,0.06)" : "rgba(255,255,255,0.03)";
  const color =
    tone === "good" ? theme.colors.primary : tone === "bad" ? theme.colors.bad : theme.colors.text;

  return (
    <View
      style={{
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        paddingVertical: 12,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ color: theme.colors.muted, fontWeight: "900", fontSize: 12 }}>{label}</Text>
      <Text style={{ color, fontWeight: "900", fontSize: 14, marginTop: 6 }}>{hidden ? maskBRL() : value}</Text>
    </View>
  );
}

export default function Planning() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);

  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const monthKey = useMemo(() => monthKeyFromDate(monthDate), [monthDate]);
  const monthLabel = useMemo(() => monthLabelFromDate(monthDate), [monthDate]);

  const [busy, setBusy] = useState(true);
  const [net, setNet] = useState({ income: 0, expense: 0, net: 0 });
  const [txs, setTxs] = useState<TxRow[]>([]);

  // ✅ olhinho
  const [hideAmounts, setHideAmounts] = useState(false);

  async function load() {
    if (!householdId) return;
    try {
      setBusy(true);
      const [n, t] = await Promise.all([
        getMonthlyNet(householdId, monthKey),
        listTransactionsByMonth(householdId, monthKey),
      ]);
      setNet(n);
      setTxs(t);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar Meu mês.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, monthKey]);

  useEffect(() => {
    if (!householdId) return;
    const off = onTxChanged((p) => {
      if (!p?.householdId || p.householdId === householdId) load();
    });
    return off;
  }, [householdId, monthKey]);

  const grouped = useMemo(() => groupByDate(txs.slice(0, 60)), [txs]);

  return (
    <Screen>
      {/* seletor do mês */}
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Pressable
          onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, -1)))}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: "900", fontSize: 24 }}>‹</Text>
        </Pressable>

        <View
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>{monthLabel}</Text>
        </View>

        <Pressable
          onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, 1)))}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: "900", fontSize: 24 }}>›</Text>
        </Pressable>
      </Row>

      <View style={{ height: 14 }} />

      {/* Resumo (com olhinho) */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <H2>Resumo</H2>

          <Row style={{ gap: 10, alignItems: "center" }}>
            <Pill text="mês" />
            <Pressable onPress={() => setHideAmounts((v) => !v)} hitSlop={12} style={{ padding: 6 }}>
              <Ionicons
                name={hideAmounts ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={"rgba(231,234,243,0.65)"}
              />
            </Pressable>
          </Row>
        </Row>

        {busy ? (
          <Row style={{ gap: 10, paddingTop: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : (
          <>
            <Text style={{ color: theme.colors.muted, fontWeight: "900", marginTop: 10 }}>
              Saldo do mês
            </Text>

            <Text
              style={{
                color: net.net >= 0 ? theme.colors.good : theme.colors.bad,
                fontWeight: "900",
                fontSize: 30,
                marginTop: 8,
              }}
            >
              {hideAmounts ? maskBRL() : formatBRLFromCents(net.net)}
            </Text>

            <View style={{ height: 12 }} />

            <Row style={{ gap: 10 }}>
              <StatBox label="Entradas" value={formatBRLFromCents(net.income)} tone="good" hidden={hideAmounts} />
              <StatBox label="Saídas" value={formatBRLFromCents(net.expense)} tone="bad" hidden={hideAmounts} />
            </Row>
          </>
        )}
      </Card>

      <View style={{ height: 14 }} />

      {/* Lançamentos (mantive valores visíveis aqui) */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Lançamentos</Text>
          <Pressable onPress={() => router.push("/(tabs)/add-transaction")}>
            <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>+ Lançar</Text>
          </Pressable>
        </Row>

        {busy ? (
          <Row style={{ gap: 10, paddingTop: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando lançamentos…</P>
          </Row>
        ) : !txs.length ? (
          <P muted style={{ marginTop: 10 }}>Nenhum lançamento nesse mês ainda.</P>
        ) : (
          <View style={{ marginTop: 8 }}>
            {grouped.map(([date, list]) => (
              <View key={date} style={{ marginTop: 10 }}>
                <Text style={{ color: theme.colors.muted, fontWeight: "900" }}>
                  {formatDateBRFromYMD(date)}
                </Text>

                <View style={{ height: 8 }} />

                {list.map((t) => {
                  const isIncome = t.type === "income";
                  const sign = isIncome ? "+" : "-";
                  const color = isIncome ? theme.colors.good : theme.colors.bad;
                  const cat = t.category?.name || "Sem categoria";

                  return (
                    <View
                      key={t.id}
                      style={{
                        paddingVertical: 10,
                        borderTopWidth: 1,
                        borderTopColor: "rgba(255,255,255,0.08)",
                      }}
                    >
                      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ maxWidth: "70%" }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{cat}</Text>
                          {t.note ? (
                            <Text style={{ color: theme.colors.muted, fontWeight: "700", marginTop: 4 }}>
                              {t.note}
                            </Text>
                          ) : null}
                        </View>

                        <Text style={{ color, fontWeight: "900" }}>
                          {sign} {formatBRLFromCents(t.amount_cents)}
                        </Text>
                      </Row>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 10 }} />
        <Button title="Lançar agora" onPress={() => router.push("/(tabs)/add-transaction")} />
      </Card>
    </Screen>
  );
}