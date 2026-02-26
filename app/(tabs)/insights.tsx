// app/(tabs)/insights.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

import Screen from "../../src/ui/Screen";
import { Card, H1, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addMonths, ymd } from "../../src/lib/date";
import { formatBRLFromCents } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";

type RangeMode = "month" | "3m" | "6m" | "12m";

type CategoryTotal = {
  category: string;
  total_cents: number;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthLabelFromDate(d: Date) {
  const s = d.toLocaleString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function niceStepCents(targetStep: number) {
  const steps = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000];
  for (const s of steps) if (targetStep <= s) return s;
  return Math.ceil(targetStep / 200000) * 200000;
}

function buildScale(maxRaw: number, tickCount = 6) {
  const safeMax = Math.max(1, maxRaw);
  const step = niceStepCents(safeMax / (tickCount - 1));
  const max = step * (tickCount - 1);
  const ticks = Array.from({ length: tickCount }, (_, i) => i * step);
  return { max, step, ticks };
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        ui.chip,
        active && {
          borderColor: "rgba(0,240,255,0.45)",
          backgroundColor: "rgba(0,240,255,0.10)",
        },
      ]}
    >
      <Text style={[ui.chipText, active && { color: theme.colors.primary }]}>
        {active ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

export default function InsightsTab() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<RangeMode>("month");
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const monthLabel = useMemo(() => monthLabelFromDate(monthDate), [monthDate]);

  const [data, setData] = useState<CategoryTotal[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const barColors = useMemo(
    () => [
      theme.colors.primary,
      theme.colors.pink,
      theme.colors.good,
      "#7C5CFF",
      "#FFB020",
      "#2DD4BF",
      "#60A5FA",
      "#F472B6",
      "#A3E635",
      "#F97316",
    ],
    []
  );

  const range = useMemo(() => {
    if (mode === "month") {
      const start = ymd(startOfMonth(monthDate));
      const end = ymd(addMonths(startOfMonth(monthDate), 1));
      return { start, end, label: monthLabel };
    }

    const endD = new Date();
    const startD = addMonths(endD, mode === "3m" ? -3 : mode === "6m" ? -6 : -12);
    return {
      start: ymd(startD),
      end: ymd(addMonths(endD, 0)),
      label:
        mode === "3m" ? "Últimos 3 meses" : mode === "6m" ? "Últimos 6 meses" : "Últimos 12 meses",
    };
  }, [mode, monthDate, monthLabel]);

  const load = useCallback(async () => {
    if (!householdId) return;

    try {
      setBusy(true);
      setSelectedIdx(null);

      const { data: rows, error } = await supabase
        .from("transactions")
        .select(
          `
          type,
          amount_cents,
          occurred_on,
          category:categories(name)
        `
        )
        .eq("household_id", householdId)
        .gte("occurred_on", range.start)
        .lt("occurred_on", range.end);

      if (error) throw error;

      const map = new Map<string, number>();

      for (const r of rows ?? []) {
        if ((r as any).type !== "expense") continue;
        const name = (r as any)?.category?.name?.trim() || "Sem categoria";
        const v = Number((r as any)?.amount_cents || 0) || 0;
        map.set(name, (map.get(name) || 0) + v);
      }

      const arr: CategoryTotal[] = Array.from(map.entries()).map(([category, total_cents]) => ({
        category,
        total_cents,
      }));
      arr.sort((a, b) => b.total_cents - a.total_cents);

      setData(arr.slice(0, 8));
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar gráficos.");
      setData([]);
    } finally {
      setBusy(false);
    }
  }, [householdId, range.start, range.end]);

  useEffect(() => {
    if (!hhLoading && householdId) load();
  }, [hhLoading, householdId, load]);

  const values = useMemo(() => data.map((x) => Math.max(0, x.total_cents)), [data]);
  const maxRaw = useMemo(() => Math.max(1, ...values), [values]);
  const { max, ticks } = useMemo(() => buildScale(maxRaw, 6), [maxRaw]);

  const Y_W = 62;
  const PLOT_H = 200;
  const BAR_W = 46;
  const GAP = 14;
  const plotW = useMemo(() => data.length * (BAR_W + GAP), [data.length]);

  function yFor(valueCents: number) {
    const p = clamp01(valueCents / max);
    return (1 - p) * PLOT_H;
  }

  const selected = selectedIdx !== null ? data[selectedIdx] : null;
  const selectedY = selected ? yFor(selected.total_cents) : null;

  const totalTop = useMemo(
    () => data.reduce((acc, it) => acc + Math.max(0, it.total_cents || 0), 0),
    [data]
  );

  return (
    // ✅ não passa title/subtitle aqui pra não ir pro header do topo
    <Screen>
      {/* ✅ título abaixo do header, igual as outras telas */}
      <Row style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <H1>Gráficos</H1>
          <P muted>Top categorias de gastos • {range.label}</P>
        </View>

        <Pressable onPress={load} style={ui.iconBtn} hitSlop={12}>
          <Ionicons name="refresh" size={18} color={theme.colors.text} />
        </Pressable>
      </Row>

      <View style={{ height: 14 }} />

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Período</Text>
          <Text style={ui.smallMuted}>{range.label}</Text>
        </Row>

        <View style={{ height: 12 }} />

        <Row style={{ gap: 10 }}>
          <Chip label="Mês" active={mode === "month"} onPress={() => setMode("month")} />
          <Chip label="3M" active={mode === "3m"} onPress={() => setMode("3m")} />
          <Chip label="6M" active={mode === "6m"} onPress={() => setMode("6m")} />
          <Chip label="12M" active={mode === "12m"} onPress={() => setMode("12m")} />
        </Row>

        {mode === "month" ? (
          <>
            <View style={{ height: 12 }} />

            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, -1)))} style={ui.arrowBtn}>
                <Ionicons name="chevron-back" size={22} color={theme.colors.primary} />
              </Pressable>

              <Text style={ui.monthTxt}>{monthLabel}</Text>

              <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, 1)))} style={ui.arrowBtn}>
                <Ionicons name="chevron-forward" size={22} color={theme.colors.primary} />
              </Pressable>
            </Row>
          </>
        ) : null}
      </Card>

      <View style={{ height: 14 }} />

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Top categorias</Text>

          {busy ? (
            <ActivityIndicator />
          ) : (
            <Text style={ui.smallMuted}>
              {data.length ? `${data.length} • ${formatBRLFromCents(totalTop)}` : "0"}
            </Text>
          )}
        </Row>

        <View style={{ height: 12 }} />

        {busy ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : !data.length ? (
          <P muted>Nenhuma despesa encontrada neste período.</P>
        ) : (
          <>
            {selected ? (
              <View style={ui.infoBox}>
                <Text style={ui.infoTitle} numberOfLines={1}>
                  {selected.category}
                </Text>
                <Text style={ui.infoValue}>{formatBRLFromCents(selected.total_cents)}</Text>
              </View>
            ) : (
              <P muted>Toque em uma barra para ver o valor.</P>
            )}

            <View style={{ height: 12 }} />

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ width: Y_W + plotW + 10, paddingRight: 10 }}>
                <View style={{ height: PLOT_H, position: "relative" }}>
                  {ticks
                    .slice()
                    .reverse()
                    .map((t, idx) => {
                      const top = yFor(t);
                      return <View key={`grid-${t}-${idx}`} style={[ui.gridLine, { top, left: 0, right: 0 }]} />;
                    })}

                  {selected && selectedY !== null ? (
                    <View pointerEvents="none" style={[ui.markerLine, { top: selectedY, left: 0, right: 0 }]} />
                  ) : null}

                  {ticks
                    .slice()
                    .reverse()
                    .map((t, idx) => {
                      const top = yFor(t);
                      return (
                        <View key={`lbl-${t}-${idx}`} style={[ui.yLabelWrap, { top: top - 8, width: Y_W - 8 }]}>
                          <Text style={ui.yLabel}>{Math.round(t / 100)}</Text>
                        </View>
                      );
                    })}

                  <View
                    style={{
                      position: "absolute",
                      left: Y_W,
                      right: 0,
                      bottom: 0,
                      top: 0,
                      flexDirection: "row",
                      alignItems: "flex-end",
                    }}
                  >
                    {data.map((it, i) => {
                      const v = Math.max(0, it.total_cents);
                      const h = Math.max(2, (v / max) * PLOT_H);
                      const color = barColors[i % barColors.length];
                      const active = selectedIdx === i;

                      return (
                        <View key={`${it.category}-${i}`} style={{ width: BAR_W + GAP, alignItems: "center" }}>
                          <Pressable
                            onPress={() => setSelectedIdx(i)}
                            style={{ width: BAR_W, height: PLOT_H, justifyContent: "flex-end" }}
                          >
                            <View
                              style={[
                                ui.bar,
                                {
                                  height: h,
                                  width: BAR_W,
                                  backgroundColor: color,
                                  opacity: active ? 1 : 0.85,
                                },
                              ]}
                            />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </View>

                <View style={{ height: 34, flexDirection: "row", paddingLeft: Y_W }}>
                  {data.map((it, i) => (
                    <View key={`x-${it.category}-${i}`} style={{ width: BAR_W + GAP, alignItems: "center" }}>
                      <Text style={ui.xLabel} numberOfLines={2}>
                        {it.category}
                      </Text>
                    </View>
                  ))}
                </View>

                <Text style={ui.yLegend}>R$</Text>
              </View>
            </ScrollView>
          </>
        )}
      </Card>
    </Screen>
  );
}

const ui = StyleSheet.create({
  sectionTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  smallMuted: { color: theme.colors.muted, fontWeight: "800" },

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

  chip: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  chipText: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },

  arrowBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
  },
  monthTxt: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },

  infoBox: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  infoTitle: { color: theme.colors.text, fontWeight: "900" },
  infoValue: { color: theme.colors.primary, fontWeight: "900", marginTop: 6 },

  gridLine: {
    position: "absolute",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  markerLine: {
    position: "absolute",
    height: 2,
    backgroundColor: "rgba(0,240,255,0.55)",
  },

  yLabelWrap: {
    position: "absolute",
    left: 0,
    alignItems: "flex-end",
    paddingRight: 8,
  },
  yLabel: {
    color: "rgba(231,234,243,0.55)",
    fontWeight: "800",
    fontSize: 11,
  },
  yLegend: {
    color: "rgba(231,234,243,0.45)",
    fontWeight: "800",
    fontSize: 11,
    marginTop: 6,
    textAlign: "left",
    paddingLeft: 6,
  },

  bar: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.18)",
  },

  xLabel: {
    width: 56,
    textAlign: "center",
    color: theme.colors.muted,
    fontWeight: "800",
    fontSize: 11,
    lineHeight: 13,
    marginTop: 8,
  },
});