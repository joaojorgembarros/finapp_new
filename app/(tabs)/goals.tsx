// app/(tabs)/goals.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addMonths, ymd } from "../../src/lib/date";
import { formatBRLFromCents, formatDateBRFromYMD, parseBRLToCents } from "../../src/lib/format";
import { addGoal, listGoals, Goal } from "../../src/lib/goals";
import { emitGoalsChanged, onGoalsChanged } from "../../src/lib/bus";

type FilterMode = "all" | "active" | "done";

// aceita ponto e converte pra vírgula (pt-BR), 2 casas
function normalizeMoneyBR(text: string) {
  if (!text) return "";
  let s = text.replace(/[^\d.,]/g, "");
  s = s.replace(/\./g, ",");
  const idx = s.indexOf(",");
  if (idx >= 0) {
    const intPart = s.slice(0, idx).replace(/[^\d]/g, "");
    const decPart = s
      .slice(idx + 1)
      .replace(/[^\d]/g, "")
      .slice(0, 2);
    return decPart.length ? `${intPart},${decPart}` : `${intPart},`;
  }
  return s.replace(/[^\d]/g, "");
}

function desiredDateFromMonths(m: string) {
  const months = Math.max(1, Number(m || "12"));
  return ymd(addMonths(new Date(), months));
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function pctLabel(p: number) {
  return `${Math.round(clamp01(p) * 100)}%`;
}

function ProgressBar({ value }: { value: number }) {
  const p = clamp01(value);
  return (
    <View style={ui.barOuter}>
      <View style={[ui.barInner, { width: `${p * 100}%` }]} />
    </View>
  );
}

function SegmentedFilter({
  value,
  onChange,
}: {
  value: FilterMode;
  onChange: (v: FilterMode) => void;
}) {
  const opts: Array<{ key: FilterMode; label: string }> = [
    { key: "all", label: "Todas" },
    { key: "active", label: "Ativas" },
    { key: "done", label: "Concluídas" },
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

export default function GoalsTab() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  // loading suave
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [hideAmounts, setHideAmounts] = useState(false);

  // add goal
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [months, setMonths] = useState("12");

  const previewCents = useMemo(() => parseBRLToCents(value), [value]);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (!householdId) return;
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        if (mode === "initial") setInitialLoading(true);
        else setRefreshing(true);

        const g = await listGoals(householdId);
        setGoals(g);
      } catch (e: any) {
        Alert.alert("Erro", e?.message ?? "Falha ao carregar metas.");
      } finally {
        inFlight.current = false;
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [householdId]
  );

  useEffect(() => {
    if (!hhLoading && householdId) load("initial");
  }, [hhLoading, householdId, load]);

  useEffect(() => {
    if (!householdId) return;
    const off = onGoalsChanged?.((ev: any) => {
      if (!ev?.householdId || ev.householdId !== householdId) return;
      load("refresh");
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [householdId, load]);

  const sorted = useMemo(() => {
    const arr = [...(goals ?? [])];
    // mais próximo do prazo primeiro
    arr.sort((a: any, b: any) => String(a.desired_date || "").localeCompare(String(b.desired_date || "")));
    return arr;
  }, [goals]);

  const filtered = useMemo(() => {
    if (filter === "all") return sorted;
    if (filter === "active")
      return sorted.filter((g) => Number(g.current_cents ?? 0) < Number(g.target_cents ?? 0));
    return sorted.filter((g) => Number(g.current_cents ?? 0) >= Number(g.target_cents ?? 0));
  }, [sorted, filter]);

  const totals = useMemo(() => {
    let current = 0;
    let target = 0;
    for (const g of goals) {
      current += Number(g.current_cents ?? 0) || 0;
      target += Number(g.target_cents ?? 0) || 0;
    }
    return { current, target };
  }, [goals]);

  const shown = useCallback(
    (cents: number) => (hideAmounts ? "••••" : formatBRLFromCents(cents)),
    [hideAmounts]
  );

  async function onAdd() {
    if (!userId || !householdId) return;
    if (saving) return;

    const t = title.trim();
    const cents = parseBRLToCents(value);

    if (!t) return Alert.alert("Atenção", "Digite um título.");
    if (cents <= 0) return Alert.alert("Atenção", "Digite um valor válido.");

    try {
      setSaving(true);

      await addGoal({
        householdId,
        userId,
        title: t,
        target_cents: cents,
        desired_date: desiredDateFromMonths(months),
      });

      setTitle("");
      setValue("");
      setMonths("12");
      setShowAdd(false);

      await load("refresh");
      emitGoalsChanged({ householdId });
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao adicionar meta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <H1>Metas</H1>
          <P muted>Crie metas e acompanhe seu progresso.</P>
        </View>

        <Row style={{ gap: 10, alignItems: "center" }}>
          {refreshing ? <ActivityIndicator size="small" /> : null}

          <Pressable onPress={() => setHideAmounts((v) => !v)} hitSlop={10} style={ui.iconBtn}>
            <Ionicons name={hideAmounts ? "eye-off-outline" : "eye-outline"} size={18} color={theme.colors.text} />
          </Pressable>
        </Row>
      </Row>

      <View style={{ height: 14 }} />

      {/* Resumo */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Resumo</Text>

          <Pressable onPress={() => router.push("/(tabs)/closures")} style={ui.linkBtn}>
            <Text style={ui.linkText}>Fechamentos</Text>
          </Pressable>
        </Row>

        <View style={{ height: 10 }} />

        {initialLoading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : (
          <>
            <Row style={{ gap: 10 }}>
              <View style={ui.pill}>
                <Text style={ui.pillLabel}>Metas</Text>
                <Text style={ui.pillValue}>{goals.length}</Text>
              </View>

              <View style={ui.pill}>
                <Text style={ui.pillLabel}>Acumulado</Text>
                <Text style={ui.pillValue}>{shown(totals.current)}</Text>
              </View>
            </Row>

            <View style={{ height: 12 }} />

            <Row style={{ justifyContent: "space-between" }}>
              <Text style={ui.meta}>Total das metas</Text>
              <Text style={ui.value}>{shown(totals.target)}</Text>
            </Row>

            <View style={{ height: 10 }} />
            <ProgressBar value={totals.target > 0 ? totals.current / totals.target : 0} />
          </>
        )}
      </Card>

      <View style={{ height: 14 }} />

      {/* Lista */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Minhas metas</Text>

          <Pressable onPress={() => setShowAdd((v) => !v)} style={ui.linkBtn}>
            <Text style={ui.linkText}>{showAdd ? "Fechar" : "+ Nova meta"}</Text>
          </Pressable>
        </Row>

        <View style={{ height: 12 }} />

        <SegmentedFilter value={filter} onChange={setFilter} />

        {/* Form (expand) */}
        {showAdd ? (
          <View style={{ marginTop: 14 }}>
            <View style={ui.formBox}>
              <Text style={ui.label}>Título</Text>
              <View style={{ height: 10 }} />
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Ex: Reserva, Viagem, Carro..."
                placeholderTextColor={"rgba(231,234,243,0.40)"}
                style={ui.inputLine}
              />

              <View style={ui.hr} />

              <Text style={ui.label}>Valor da meta</Text>
              <View style={{ height: 10 }} />
              <Row style={{ alignItems: "flex-end", gap: 10 }}>
                <Text style={ui.currency}>R$</Text>
                <TextInput
                  value={value}
                  onChangeText={(t) => setValue(normalizeMoneyBR(t))}
                  placeholder="0,00"
                  placeholderTextColor={"rgba(231,234,243,0.40)"}
                  keyboardType="decimal-pad"
                  style={ui.bigValue}
                />
              </Row>
              <Text style={ui.hint}>Prévia: {formatBRLFromCents(previewCents)}</Text>

              <View style={ui.hr} />

              <Text style={ui.label}>Prazo (meses)</Text>
              <View style={{ height: 10 }} />
              <TextInput
                value={months}
                onChangeText={(t) => setMonths(t.replace(/\D/g, ""))}
                placeholder="12"
                placeholderTextColor={"rgba(231,234,243,0.40)"}
                keyboardType="numeric"
                style={ui.inputLine}
              />
              <Text style={ui.hint}>Data estimada: {formatDateBRFromYMD(desiredDateFromMonths(months))}</Text>

              <View style={{ height: 16 }} />

              <Row style={{ gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title={saving ? "Salvando..." : "Criar meta"} onPress={onAdd} disabled={saving} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Cancelar" onPress={() => setShowAdd(false)} disabled={saving} />
                </View>
              </Row>
            </View>
          </View>
        ) : null}

        <View style={{ height: 12 }} />

        {initialLoading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando metas…</P>
          </Row>
        ) : !filtered.length ? (
          <P muted>Nenhuma meta nesse filtro.</P>
        ) : (
          <View style={{ marginTop: 6 }}>
            {filtered.map((g, idx) => {
              const current = Number(g.current_cents ?? 0) || 0;
              const target = Math.max(1, Number(g.target_cents ?? 0) || 1);
              const progress = current / target;

              const done = current >= target;

              return (
                <View key={g.id} style={[ui.goalRow, idx === 0 ? { borderTopWidth: 0, paddingTop: 0, marginTop: 0 } : null]}>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{g.title}</Text>
                      <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 4 }}>
                        Prazo: {formatDateBRFromYMD(g.desired_date)}
                      </Text>
                      <Text style={{ color: theme.colors.muted2, fontWeight: "900", marginTop: 6 }}>
                        {pctLabel(progress)} {done ? "• Concluída" : ""}
                      </Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{shown(current)}</Text>
                      <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 4 }}>de {shown(target)}</Text>
                    </View>
                  </Row>

                  <View style={{ height: 10 }} />
                  <ProgressBar value={progress} />

                  {!done ? (
                    <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 8 }}>
                      Faltam {shown(Math.max(0, target - current))}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </Screen>
  );
}

const ui = StyleSheet.create({
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
  pillValue: { color: theme.colors.text, fontWeight: "900", fontSize: 15, marginTop: 6 },

  meta: { color: theme.colors.muted, fontWeight: "800" },
  value: { color: theme.colors.text, fontWeight: "900" },

  barOuter: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  barInner: { height: "100%", borderRadius: 999, backgroundColor: theme.colors.primary },

  // form (sem “balões”)
  formBox: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 18,
    padding: 14,
  },
  label: { color: "rgba(231,234,243,0.85)", fontWeight: "900", fontSize: 13 },
  hr: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 16, marginBottom: 16 },
  hint: { color: theme.colors.muted, fontWeight: "800", marginTop: 10 },

  currency: { color: "rgba(231,234,243,0.55)", fontWeight: "900", fontSize: 18, marginBottom: 4 },
  bigValue: {
    flex: 1,
    height: 44,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 28,
    paddingVertical: 0,
  },
  inputLine: {
    height: 44,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 16,
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },

  goalRow: {
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },
});