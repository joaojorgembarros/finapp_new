// app/(tabs)/planning.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row, SoftIcon } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addMonths } from "../../src/lib/date";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { listTransactionsByMonth, TxRow } from "../../src/lib/transactions";
import { listCategories, Category } from "../../src/lib/categories";
import { listBudgetsByMonth, upsertBudget } from "../../src/lib/budgets";
import { onTxChanged } from "../../src/lib/bus";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthKeyFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabelFromDate(d: Date) {
  const s = d.toLocaleString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function centsToInput(cents: number) {
  if (!cents) return "";
  return formatBRLFromCents(cents);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function BudgetBar({ spent, planned }: { spent: number; planned: number }) {
  const value = planned > 0 ? clamp01(spent / planned) : 0;
  const over = planned > 0 && spent > planned;

  return (
    <View style={{ height: 10, borderRadius: 999, backgroundColor: "#e2e8f0", overflow: "hidden" }}>
      <View
        style={{
          width: `${Math.round(value * 100)}%`,
          height: "100%",
          borderRadius: 999,
          backgroundColor: over ? theme.colors.bad : value >= 0.85 ? theme.colors.warn : theme.colors.primary,
        }}
      />
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
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [budgetValue, setBudgetValue] = useState("");

  async function load() {
    if (!householdId) return;
    try {
      setBusy(true);
      const [cats, transactions, budgetRows] = await Promise.all([
        listCategories(householdId, "expense"),
        listTransactionsByMonth(householdId, monthKey),
        listBudgetsByMonth(householdId, monthKey),
      ]);

      const map: Record<string, number> = {};
      for (const b of budgetRows) map[b.category_id] = Number(b.planned_cents || 0);

      setCategories(cats);
      setTxs(transactions.filter((t) => t.type === "expense"));
      setBudgets(map);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar orcamento.");
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
    return onTxChanged((p) => {
      if (!p?.householdId || p.householdId === householdId) load();
    });
  }, [householdId, monthKey]);

  const spentByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of txs) {
      if (!t.category_id) continue;
      map[t.category_id] = (map[t.category_id] ?? 0) + Number(t.amount_cents || 0);
    }
    return map;
  }, [txs]);

  function openBudget(cat: Category) {
    setPickerOpen(false);
    setTimeout(() => {
      setEditing(cat);
      setBudgetValue(centsToInput(budgets[cat.id] ?? 0));
    }, 180);
  }

  async function saveBudget() {
    if (!householdId || !editing || saving) return;
    const cents = parseBRLToCents(budgetValue);

    try {
      setSaving(true);
      await upsertBudget({
        householdId,
        categoryId: editing.id,
        monthKey,
        plannedCents: cents,
      });
      setBudgets((prev) => ({ ...prev, [editing.id]: cents }));
      setEditing(null);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar limite.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <AppHeader title="Orcamento" subtitle="Limites por categoria" />

      <View style={monthControl}>
        <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, -1)))} style={monthButton}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.primary} />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>{monthLabel}</Text>
          <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 2 }}>{monthKey}</Text>
        </View>

        <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, 1)))} style={monthButton}>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
        </Pressable>
      </View>

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 18 }}>Limites de gastos</Text>
            <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 4 }}>
              Escolha uma categoria e defina quanto pode gastar nela.
            </Text>
          </View>
        </Row>

        <Button title="Escolher categoria" onPress={() => setPickerOpen(true)} />

        {busy ? (
          <Row style={{ gap: 10, paddingVertical: 8 }}>
            <ActivityIndicator />
            <P muted>Carregando...</P>
          </Row>
        ) : !categories.some((cat) => (budgets[cat.id] ?? 0) > 0) ? (
          <P muted>Nenhum limite definido ainda.</P>
        ) : (
          categories.filter((cat) => (budgets[cat.id] ?? 0) > 0).map((cat, idx) => {
            const spent = spentByCategory[cat.id] ?? 0;
            const planned = budgets[cat.id] ?? 0;
            const left = planned - spent;

            return (
              <Pressable
                key={cat.id}
                onPress={() => openBudget(cat)}
                style={{
                  paddingVertical: 12,
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: theme.colors.border,
                }}
              >
                <Row style={{ gap: 12, alignItems: "center" }}>
                  <SoftIcon name={(cat.icon || "wallet-outline") as any} tone={left < 0 ? "bad" : "primary"} />
                  <View style={{ flex: 1 }}>
                    <Row style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "900", flex: 1 }}>{cat.name}</Text>
                      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                        {formatBRLFromCents(planned)}
                      </Text>
                    </Row>

                    <View style={{ height: 10 }} />
                    <BudgetBar spent={spent} planned={planned} />

                    <Row style={{ justifyContent: "space-between", marginTop: 8 }}>
                      <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
                        Gasto: {formatBRLFromCents(spent)}
                      </Text>
                      <Text style={{ color: left >= 0 ? theme.colors.good : theme.colors.bad, fontWeight: "900" }}>
                        Resta {formatBRLFromCents(left)}
                      </Text>
                    </Row>
                  </View>
                </Row>
              </Pressable>
            );
          })
        )}
      </Card>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          onPress={() => setPickerOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" }}
        >
          <Pressable onPress={() => {}} style={categoryPickerCard}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 18 }}>Escolher categoria</Text>
                <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 4 }}>
                  Toque para definir ou editar o limite.
                </Text>
              </View>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.colors.muted} />
              </Pressable>
            </Row>

            {busy ? (
              <Row style={{ gap: 10, paddingVertical: 8 }}>
                <ActivityIndicator />
                <P muted>Carregando...</P>
              </Row>
            ) : !categories.length ? (
              <P muted>Nenhuma categoria de despesa cadastrada.</P>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {categories.map((cat, idx) => {
                  const planned = budgets[cat.id] ?? 0;
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => openBudget(cat)}
                      style={{
                        paddingVertical: 12,
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderTopColor: theme.colors.border,
                      }}
                    >
                      <Row style={{ gap: 12 }}>
                        <SoftIcon name={(cat.icon || "wallet-outline") as any} tone={planned > 0 ? "primary" : "warn"} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{cat.name}</Text>
                          <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 4 }}>
                            {planned > 0 ? `Limite atual: ${formatBRLFromCents(planned)}` : "Sem limite definido"}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.muted2} />
                      </Row>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!editing}
        transparent
        animationType="fade"
        onRequestClose={() => (!saving ? setEditing(null) : null)}
      >
        <Pressable
          onPress={() => (!saving ? setEditing(null) : null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" }}
        >
          <Pressable onPress={() => {}} style={modalCard}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 18 }}>
              {editing?.name ?? "Categoria"}
            </Text>
            <P muted>Defina o limite dessa categoria para {monthLabel}.</P>

            <Label>Limite do mes (R$)</Label>
            <Input
              value={budgetValue}
              onChangeText={(t) => setBudgetValue(formatBRLInputFromDigits(t))}
              placeholder="R$ 0,00"
              keyboardType="numeric"
            />
            <P muted>Previa: {formatBRLFromCents(parseBRLToCents(budgetValue))}</P>

            <Row style={{ gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title={saving ? "Salvando..." : "Salvar"} onPress={saveBudget} disabled={saving} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Cancelar" variant="ghost" onPress={() => setEditing(null)} disabled={saving} />
              </View>
            </Row>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const monthControl = {
  minHeight: 58,
  borderRadius: 22,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: "rgba(255,255,255,0.86)",
  padding: 8,
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  ...theme.shadow,
} as const;

const monthButton = {
  width: 42,
  height: 42,
  borderRadius: 16,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.primarySoft,
} as const;

const modalCard = {
  borderRadius: 22,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.bg0,
  padding: 16,
  gap: 10,
  width: "100%",
  maxWidth: 520,
  alignSelf: "center",
} as const;

const categoryPickerCard = {
  borderRadius: 22,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.bg0,
  padding: 16,
  gap: 10,
  width: "100%",
  maxWidth: 520,
  maxHeight: "82%",
  alignSelf: "center",
} as const;
