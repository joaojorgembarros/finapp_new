// app/(tabs)/insights.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import Screen from "../../src/ui/Screen";
import ProfileAvatarMenu from "../../src/ui/ProfileAvatarMenu";
import { AppHeader, Card, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addMonths } from "../../src/lib/date";
import { getMonthlyNet, listTransactionsByMonth } from "../../src/lib/transactions";
import { onTxChanged } from "../../src/lib/bus";

const periods = [
  { value: "month", label: "Mês" },
  { value: "3months", label: "3 Meses" },
  { value: "6months", label: "6 Meses" },
  { value: "year", label: "Ano" },
] as const;

type PeriodValue = (typeof periods)[number]["value"];
type Summary = { income: number; expenses: number; balance: number; previousExpenses: number };
type CategoryDatum = { name: string; value: number; pct: number; color: string };
type ComparisonDatum = { month: string; income: number; expenses: number };
type EvolutionDatum = { day: number; value: number };

const categoryColors = ["#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function periodMonths(period: PeriodValue) {
  if (period === "3months") return 3;
  if (period === "6months") return 6;
  if (period === "year") return 12;
  return 3;
}

function monthKey(ref: Date) {
  const year = ref.getFullYear();
  const month = String(ref.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabel(ref: Date) {
  return ref.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
}

function monthLabelFull(ref: Date) {
  const label = ref.toLocaleString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function brl(cents: number, compact = false) {
  return ((cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  });
}

function axisMoney(cents: number) {
  return `${Math.round((cents || 0) / 100)}`;
}

function niceMax(value: number) {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function DonutChart({ data, progress }: { data: CategoryDatum[]; progress: number }) {
  const size = 150;
  const strokeWidth = 30;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke="#e2e8f0" strokeWidth={strokeWidth} />
      <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
        {data.map((cat) => {
          const length = (cat.pct / 100) * circumference * progress;
          const dash = `${Math.max(length - 3, 0)} ${circumference}`;
          const dashOffset = -offset;
          offset += length;

          return (
            <Circle
              key={cat.name}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke={cat.color}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
            />
          );
        })}
      </G>
    </Svg>
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

function BarsChart({ data, progress }: { data: ComparisonDatum[]; progress: number }) {
  const width = 310;
  const height = 160;
  const left = 42;
  const bottom = 126;
  const chartTop = 12;
  const maxValue = niceMax(Math.max(...data.map((item) => Math.max(item.income, item.expenses)), 0));
  const available = width - left - 12;
  const groupWidth = available / Math.max(data.length, 1);
  const barWidth = Math.max(8, Math.min(23, groupWidth * 0.26));

  const yFor = (value: number) => bottom - (value / maxValue) * (bottom - chartTop);

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const tick = Math.round(maxValue * ratio);
          const y = yFor(tick);
          return (
            <G key={tick}>
              <Line x1={left} x2={width - 10} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <SvgText x={left - 6} y={y + 4} fill="#64748b" fontSize="9" textAnchor="end">
                {axisMoney(tick)}
              </SvgText>
            </G>
          );
        })}

        <Line x1={left} x2={width - 10} y1={bottom} y2={bottom} stroke="#94a3b8" strokeWidth={1.2} />
        <Line x1={left} x2={left} y1={chartTop} y2={bottom} stroke="#94a3b8" strokeWidth={1.2} />

        {data.map((item, index) => {
          const x = left + groupWidth * index + Math.max(3, groupWidth * 0.18);
          const itemProgress = Math.max(0, Math.min(1, (progress - index * 0.08) / 0.78));
          const incomeY = yFor(item.income * itemProgress);
          const expenseY = yFor(item.expenses * itemProgress);
          return (
            <G key={item.month}>
              <Rect x={x} y={incomeY} width={barWidth} height={bottom - incomeY} rx={7} fill="#10b981" />
              <Rect x={x + barWidth + Math.max(5, groupWidth * 0.12)} y={expenseY} width={barWidth} height={bottom - expenseY} rx={7} fill="#ef4444" />
              <SvgText x={x + barWidth + 5} y={bottom + 16} fill="#64748b" fontSize="10" textAnchor="middle">
                {item.month}
              </SvgText>
            </G>
          );
        })}
      </Svg>

      <Row style={{ gap: 14, justifyContent: "center", marginTop: -2 }}>
        <LegendDot color="#10b981" label="Receitas" />
        <LegendDot color="#ef4444" label="Despesas" />
      </Row>
    </View>
  );
}

function AreaChart({ data, progress }: { data: EvolutionDatum[]; progress: number }) {
  const width = 310;
  const height = 175;
  const left = 42;
  const right = 10;
  const top = 12;
  const bottom = 132;
  const maxValue = niceMax(Math.max(...data.map((item) => item.value), 0));
  const minDay = 1;
  const maxDay = Math.max(...data.map((item) => item.day), new Date().getDate(), 1);
  const daySpan = Math.max(1, maxDay - minDay);

  const visibleProgress = Math.max(0, Math.min(1, progress));
  const points = data.map((item) => {
    const x = left + ((item.day - minDay) / daySpan) * (width - left - right);
    const y = bottom - ((item.value * visibleProgress) / maxValue) * (bottom - top);
    return { x, y };
  });

  const linePath = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const cx = (previous.x + point.x) / 2;
    return `${path} C ${cx} ${previous.y}, ${cx} ${point.y}, ${point.x} ${point.y}`;
  }, "");

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`;

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <SvgLinearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#8b5cf6" stopOpacity="0.28" />
            <Stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
          </SvgLinearGradient>
        </Defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const tick = Math.round(maxValue * ratio);
          const y = bottom - (tick / maxValue) * (bottom - top);
          return (
            <G key={tick}>
              <Line x1={left} x2={width - right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <SvgText x={left - 6} y={y + 4} fill="#64748b" fontSize="9" textAnchor="end">
                {axisMoney(tick)}
              </SvgText>
            </G>
          );
        })}

        <Line x1={left} x2={width - right} y1={bottom} y2={bottom} stroke="#94a3b8" strokeWidth={1.2} />
        <Line x1={left} x2={left} y1={top} y2={bottom} stroke="#94a3b8" strokeWidth={1.2} />
        <Path d={areaPath} fill="url(#spendFill)" />
        <Path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth={4} strokeLinecap="round" />

        {data.map((item) => item.day).filter((day, index, arr) => index === 0 || index === arr.length - 1 || index % Math.ceil(arr.length / 5) === 0).map((day) => {
          const x = left + ((day - minDay) / daySpan) * (width - left - right);
          return (
            <SvgText key={day} x={x} y={bottom + 15} fill="#64748b" fontSize="9" textAnchor="middle">
              {day}
            </SvgText>
          );
        })}
        <SvgText x={width / 2 + 12} y={height - 4} fill="#64748b" fontSize="10" textAnchor="middle">
          Dia do mês
        </SvgText>
      </Svg>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Row style={{ gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ color, fontSize: 10, fontWeight: "900" }}>{label}</Text>
    </Row>
  );
}

function InsightCard({
  icon,
  text,
  border,
  background,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  border: string;
  background: string;
  color: string;
}) {
  return (
    <View
      style={{
        borderRadius: 13,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: background,
        paddingVertical: 12,
        paddingHorizontal: 13,
      }}
    >
      <Row style={{ gap: 10, alignItems: "center" }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: color,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#fff",
          }}
        >
          <Ionicons name={icon} size={15} color={color} />
        </View>
        <Text style={{ flex: 1, color: "#0f172a", fontSize: 12, fontWeight: "800", lineHeight: 17 }}>{text}</Text>
      </Row>
    </View>
  );
}

function SmallStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: "good" | "primary";
}) {
  const isGood = tone === "good";
  const color = isGood ? theme.colors.good : theme.colors.primary;
  return (
    <View
      style={{
        flex: 1,
        minHeight: 72,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: isGood ? "#86efac" : "#93c5fd",
        backgroundColor: isGood ? "#f0fdf4" : "#eff6ff",
        padding: 12,
      }}
    >
      <Row style={{ gap: 6 }}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={{ color, fontSize: 10, fontWeight: "900" }}>{label}</Text>
      </Row>
      <Text style={{ color: "#064e3b", fontSize: 20, fontWeight: "900", marginTop: 7 }}>{value}</Text>
    </View>
  );
}

export default function InsightsTab() {
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [period, setPeriod] = useState<PeriodValue>("month");
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary>({ income: 0, expenses: 0, balance: 0, previousExpenses: 0 });
  const [categories, setCategories] = useState<CategoryDatum[]>([]);
  const [comparison, setComparison] = useState<ComparisonDatum[]>([]);
  const [evolution, setEvolution] = useState<EvolutionDatum[]>([{ day: 1, value: 0 }]);
  const [chartProgress, setChartProgress] = useState(0);
  const chartAnimation = useRef(new Animated.Value(0)).current;
  const savingRate = useMemo(() => (summary.income > 0 ? (summary.balance / summary.income) * 100 : 0), [summary.balance, summary.income]);
  const topCategory = categories[0] ?? null;
  const selectedMonthKey = useMemo(() => monthKey(monthDate), [monthDate]);
  const selectedMonthLabel = useMemo(() => monthLabelFull(monthDate), [monthDate]);
  const monthName = useMemo(() => monthDate.toLocaleDateString("pt-BR", { month: "long" }), [monthDate]);

  const load = useCallback(async () => {
    if (!householdId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const selectedMonth = startOfMonth(monthDate);
      const previousMonth = addMonths(selectedMonth, -1);
      const months = periodMonths(period);
      const refs = Array.from({ length: months }, (_, index) => addMonths(selectedMonth, index - months + 1));

      const [currentTransactions, currentNet, previousNet, monthlyNets] = await Promise.all([
        listTransactionsByMonth(householdId, selectedMonth),
        getMonthlyNet(householdId, selectedMonth),
        getMonthlyNet(householdId, previousMonth),
        Promise.all(refs.map((ref) => getMonthlyNet(householdId, monthKey(ref)))),
      ]);

      const expensesByCategory = new Map<string, number>();
      const expensesByDay = new Map<number, number>();

      for (const tx of currentTransactions) {
        if (tx.type !== "expense") continue;
        const categoryName = tx.category?.name ?? "Sem categoria";
        const amount = Number(tx.amount_cents || 0);
        const day = Number(tx.occurred_on.split("-")[2] || 1);
        expensesByCategory.set(categoryName, (expensesByCategory.get(categoryName) ?? 0) + amount);
        expensesByDay.set(day, (expensesByDay.get(day) ?? 0) + amount);
      }

      const sortedCategories = Array.from(expensesByCategory.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, value], index) => ({
          name,
          value,
          pct: currentNet.expense > 0 ? (value / currentNet.expense) * 100 : 0,
          color: categoryColors[index % categoryColors.length],
        }));

      const days = Array.from(expensesByDay.keys()).sort((a, b) => a - b);
      const evolutionData: EvolutionDatum[] = [];
      let runningTotal = 0;

      if (!days.includes(1)) evolutionData.push({ day: 1, value: 0 });
      for (const day of days) {
        runningTotal += expensesByDay.get(day) ?? 0;
        evolutionData.push({ day, value: runningTotal });
      }
      if (!evolutionData.length) evolutionData.push({ day: 1, value: 0 });

      setSummary({
        income: currentNet.income,
        expenses: currentNet.expense,
        balance: currentNet.net,
        previousExpenses: previousNet.expense,
      });
      setCategories(sortedCategories);
      setComparison(
        refs.map((ref, index) => ({
          month: monthLabel(ref),
          income: monthlyNets[index].income,
          expenses: monthlyNets[index].expense,
        })),
      );
      setEvolution(evolutionData);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar gráficos.");
    } finally {
      setLoading(false);
    }
  }, [householdId, monthDate, period]);

  useEffect(() => {
    if (!householdLoading) load();
  }, [householdLoading, load]);

  useEffect(() => {
    const off = onTxChanged((payload) => {
      if (!payload.householdId || payload.householdId === householdId) load();
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [householdId, load]);

  useFocusEffect(
    useCallback(() => {
      const listenerId = chartAnimation.addListener(({ value }) => {
        setChartProgress(value);
      });

      chartAnimation.setValue(0);
      Animated.timing(chartAnimation, {
        toValue: 1,
        duration: 1050,
        delay: 120,
        useNativeDriver: false,
      }).start();

      return () => {
        chartAnimation.stopAnimation();
        chartAnimation.removeListener(listenerId);
      };
    }, [chartAnimation]),
  );

  return (
    <Screen>
      <AppHeader title="Gráficos" subtitle="Visualize seus gastos e receitas" right={<ProfileAvatarMenu />} />

      {loading ? (
        <Card>
          <Row style={{ gap: 10, justifyContent: "center", paddingVertical: 12 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Carregando gráficos...</Text>
          </Row>
        </Card>
      ) : null}

      <Card style={{ paddingBottom: 2 }}>
        <Row style={{ gap: 8 }}>
          {periods.map((item) => {
            const active = period === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => setPeriod(item.value)}
                style={{
                  flex: 1,
                  minHeight: 38,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? theme.colors.primary : "transparent",
                }}
              >
                <Text style={{ color: active ? "#fff" : theme.colors.muted, fontWeight: "900", fontSize: 12 }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      <View style={monthControl}>
        <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, -1)))} style={monthButton}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.primary} />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>{selectedMonthLabel}</Text>
          <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 2 }}>{selectedMonthKey}</Text>
        </View>

        <Pressable onPress={() => setMonthDate((d) => startOfMonth(addMonths(d, 1)))} style={monthButton}>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
        </Pressable>
      </View>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 14 }}>Gastos por Categoria</Text>
        <View style={{ alignItems: "center", marginTop: 4, marginBottom: 8 }}>
          <DonutChart data={categories} progress={chartProgress} />
        </View>
        {categories.length ? (
          <View style={{ gap: 7 }}>
            {categories.map((cat) => (
            <Row key={cat.name} style={{ justifyContent: "space-between", gap: 10 }}>
              <Row style={{ gap: 7, flex: 1 }}>
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: cat.color }} />
                <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "800" }}>{cat.name}</Text>
              </Row>
              <Text style={{ color: theme.colors.text, width: 76, textAlign: "right", fontSize: 11, fontWeight: "900" }}>
                {brl(cat.value)}
              </Text>
              <Text style={{ color: theme.colors.muted, width: 34, textAlign: "right", fontSize: 10, fontWeight: "800" }}>
                {cat.pct.toFixed(1)}%
              </Text>
            </Row>
            ))}
          </View>
        ) : (
          <Text style={{ color: theme.colors.muted, fontWeight: "700", textAlign: "center", marginBottom: 6 }}>
            Nenhuma despesa neste mês.
          </Text>
        )}
      </Card>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 14 }}>Receitas vs Despesas</Text>
        <BarsChart data={comparison} progress={chartProgress} />
      </Card>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 14 }}>Evolução dos Gastos no Mês</Text>
        <AreaChart data={evolution} progress={chartProgress} />
      </Card>

      <View style={{ gap: 10 }}>
        <Row style={{ gap: 7 }}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.text} />
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 14 }}>Insights</Text>
        </Row>

        <InsightCard
          icon="home-outline"
          text={
            topCategory
              ? `Sua maior despesa foi ${topCategory.name} (${topCategory.pct.toFixed(1)}%)`
              : `Você ainda não tem despesas em ${monthName}`
          }
          border="#fdba74"
          background="#fff7ed"
          color="#f97316"
        />
        <InsightCard
          icon="checkmark-outline"
          text={
            summary.income >= summary.expenses
              ? "Suas receitas foram maiores que as despesas neste mês"
              : "Suas despesas passaram das receitas neste mês"
          }
          border="#86efac"
          background="#f0fdf4"
          color="#16a34a"
        />
        <InsightCard
          icon="bar-chart-outline"
          text={
            summary.previousExpenses > 0
              ? `Você gastou ${Math.abs(((summary.expenses - summary.previousExpenses) / summary.previousExpenses) * 100).toFixed(0)}% ${
                  summary.expenses >= summary.previousExpenses ? "a mais" : "a menos"
                } que no mês passado`
              : "Ainda não há despesas do mês passado para comparar"
          }
          border="#93c5fd"
          background="#eff6ff"
          color="#2563eb"
        />

        <Row style={{ gap: 10 }}>
          <SmallStat icon="trending-up-outline" label="Economia" value={brl(summary.balance)} tone="good" />
          <SmallStat icon="pulse-outline" label="Taxa de Economia" value={`${savingRate.toFixed(1)}%`} tone="primary" />
        </Row>
      </View>
    </Screen>
  );
}
