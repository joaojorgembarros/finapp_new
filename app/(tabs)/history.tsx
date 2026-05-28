// app/(tabs)/history.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import Screen from "../../src/ui/Screen";
import { AppHeader, Card, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { listTransactionsByMonth, Transaction } from "../../src/lib/transactions";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { onTxChanged } from "../../src/lib/bus";
import { router } from "expo-router";

function monthKeyFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonthsLocal(d: Date, delta: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + delta);
  return x;
}

function monthLabelFromKey(key: string) {
  const [yy, mm] = key.split("-");
  const y = Number(yy);
  const m = Number(mm);
  const d = new Date(y, (m || 1) - 1, 1);
  const s = d.toLocaleString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function History() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [items, setItems] = useState<Transaction[]>([]);
  const [ref, setRef] = useState<Date>(new Date());

  const monthKey = useMemo(() => monthKeyFromDate(ref), [ref]);
  const monthLabel = useMemo(() => monthLabelFromKey(monthKey), [monthKey]);

  async function load() {
    if (!householdId) return;
    try {
      setBusy(true);
      const list = await listTransactionsByMonth(householdId, monthKey);
      setItems(list);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!householdId) return;
    load();
  }, [householdId, monthKey]);

  useEffect(() => {
    if (!householdId) return;
    const off = onTxChanged((p) => {
      if (!p?.householdId || p.householdId === householdId) load();
    });
    return off;
  }, [householdId, monthKey]);

  return (
    <Screen>
      <AppHeader
        title="Histórico"
        subtitle="Movimentações por período"
        right={
        <Pressable
          onPress={() => router.push("/(tabs)/add-transaction")}
          style={({ pressed }) => ({
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.colors.primary,
            backgroundColor: "rgba(37,99,235,0.12)",
            opacity: pressed ? 0.86 : 1,
          })}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>+ Lançar</Text>
        </Pressable>
        }
      />

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Pressable onPress={() => setRef(addMonthsLocal(ref, -1))} style={{ padding: 10 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>◀</Text>
          </Pressable>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{monthLabel}</Text>
            <Text style={{ color: theme.colors.muted, fontWeight: "700", marginTop: 2 }}>{monthKey}</Text>
          </View>

          <Pressable onPress={() => setRef(addMonthsLocal(ref, +1))} style={{ padding: 10 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>▶</Text>
          </Pressable>
        </Row>
      </Card>

      {busy ? (
        <Card>
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        </Card>
      ) : items.length ? (
        <Card>
          {items.map((t) => {
            const isIncome = t.type === "income";
            const title = t.category?.name || (isIncome ? "Entrada" : "Saída");
            const subtitle = t.note?.trim() ? t.note.trim() : `Data: ${formatDateBRFromYMD(t.occurred_on)}`;

            return (
              <View key={t.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ maxWidth: "70%" }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{title}</Text>
                    <Text style={{ color: theme.colors.muted, fontWeight: "700", marginTop: 2 }}>{subtitle}</Text>
                  </View>

                  <Text
                    style={{
                      color: isIncome ? theme.colors.good : theme.colors.bad,
                      fontWeight: "900",
                    }}
                  >
                    {isIncome ? "+" : "-"} {formatBRLFromCents(t.amount_cents)}
                  </Text>
                </Row>
              </View>
            );
          })}
        </Card>
      ) : (
        <Card>
          <P muted>Nenhuma movimentação nesse mês.</P>
        </Card>
      )}
    </Screen>
  );
}
