import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { BlurView } from "expo-blur";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { Category, listCategories } from "../../src/lib/categories";
import { addTransaction, listTransactionsByMonth, TxRow as DatabaseTx } from "../../src/lib/transactions";

type Tab = "controle" | "jornada" | "desafios";
type MenuIcon = keyof typeof Ionicons.glyphMap;
type TrailPoint = { x: number; y: number };
type TrailSegment = { start: TrailPoint; c1: TrailPoint; c2: TrailPoint; end: TrailPoint };
type TxType = "Receita" | "Despesa";
type Filter = "Todos" | TxType;
type Tx = { id: string; type: TxType; description: string; category: string; categoryId: string | null; date: string; amount: number };
type TxDraft = Omit<Tx, "id" | "date" | "category">;

const WEB_DRAWER_BLUR_STYLE =
  Platform.OS === "web"
    ? ({
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      } as any)
    : null;

const TRAIL_SEGMENTS: TrailSegment[] = [
  {
    start: { x: 34, y: 274 },
    c1: { x: 96, y: 264 },
    c2: { x: 176, y: 260 },
    end: { x: 250, y: 246 },
  },
  {
    start: { x: 250, y: 246 },
    c1: { x: 316, y: 232 },
    c2: { x: 309, y: 214 },
    end: { x: 254, y: 201 },
  },
  {
    start: { x: 254, y: 201 },
    c1: { x: 207, y: 191 },
    c2: { x: 223, y: 169 },
    end: { x: 282, y: 151 },
  },
  {
    start: { x: 282, y: 151 },
    c1: { x: 322, y: 138 },
    c2: { x: 324, y: 121 },
    end: { x: 306, y: 108 },
  },
];

const TRAIL_PATH =
  `M${TRAIL_SEGMENTS[0].start.x} ${TRAIL_SEGMENTS[0].start.y} ` +
  TRAIL_SEGMENTS.map((segment) => `C${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.end.x} ${segment.end.y}`).join(" ");

function cubicPoint(segment: TrailSegment, t: number) {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * segment.start.x +
      3 * mt * mt * t * segment.c1.x +
      3 * mt * t * t * segment.c2.x +
      t * t * t * segment.end.x,
    y:
      mt * mt * mt * segment.start.y +
      3 * mt * mt * t * segment.c1.y +
      3 * mt * t * t * segment.c2.y +
      t * t * t * segment.end.y,
  };
}

function buildTrailPoints() {
  const points: TrailPoint[] = [TRAIL_SEGMENTS[0].start];
  for (const segment of TRAIL_SEGMENTS) {
    for (let step = 1; step <= 18; step += 1) {
      points.push(cubicPoint(segment, step / 18));
    }
  }
  return points;
}

const TRAIL_POINTS = buildTrailPoints();

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function distance(a: TrailPoint, b: TrailPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointAtProgress(progress: number) {
  const pct = clampProgress(progress) / 100;
  const total = TRAIL_POINTS.reduce((sum, point, index) => {
    if (index === 0) return sum;
    return sum + distance(TRAIL_POINTS[index - 1], point);
  }, 0);
  const target = total * pct;

  let walked = 0;
  for (let i = 1; i < TRAIL_POINTS.length; i += 1) {
    const start = TRAIL_POINTS[i - 1];
    const end = TRAIL_POINTS[i];
    const segment = distance(start, end);
    if (walked + segment >= target) {
      const t = segment === 0 ? 0 : (target - walked) / segment;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }
    walked += segment;
  }

  return TRAIL_POINTS[TRAIL_POINTS.length - 1];
}

function readJson<T>(raw: string | string[] | undefined, fallback: T): T {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function initialsFrom(nameOrEmail: string) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  if (s.includes("@")) return (s.split("@")[0]?.slice(0, 2) || "U").toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return (parts[0].slice(0, 2) || "U").toUpperCase();
  return `${parts[0]?.[0] ?? "U"}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function MountainHero({ progress }: { progress: number }) {
  const progressPct = clampProgress(progress);
  const marker = pointAtProgress(progressPct);

  return (
    <View style={styles.hero}>
      <Svg pointerEvents="none" viewBox="0 0 390 335" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinearGradient id="journeySky" x1="0" y1="0" x2="0" y2="335" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#061936" />
            <Stop offset="46%" stopColor="#0A3674" />
            <Stop offset="100%" stopColor="#06152E" />
          </SvgLinearGradient>
          <SvgLinearGradient id="farMountain" x1="0" y1="118" x2="0" y2="300" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#2B83E8" />
            <Stop offset="100%" stopColor="#0B2A5E" />
          </SvgLinearGradient>
          <SvgLinearGradient id="mainMountain" x1="250" y1="76" x2="250" y2="300" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#4EA0FF" />
            <Stop offset="52%" stopColor="#1D68C7" />
            <Stop offset="100%" stopColor="#0A2B63" />
          </SvgLinearGradient>
          <SvgLinearGradient id="frontRidge" x1="0" y1="230" x2="0" y2="350" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#164D95" />
            <Stop offset="100%" stopColor="#061833" />
          </SvgLinearGradient>
          <SvgLinearGradient id="pathGlow" x1="40" y1="286" x2="306" y2="108" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#BBDDFF" />
            <Stop offset="100%" stopColor="#FFFFFF" />
          </SvgLinearGradient>
        </Defs>

        <Rect width="390" height="335" rx="0" fill="url(#journeySky)" />
        <Circle cx="285" cy="92" r="118" fill="#2D8BFF" opacity="0.18" />
        <Circle cx="82" cy="270" r="150" fill="#1E72D7" opacity="0.16" />

        {[38, 118, 248, 320].map((x, index) => (
          <Circle key={x} cx={x} cy={[50, 76, 42, 116][index]} r={index === 1 ? 1.5 : 1.1} fill="#7BA0C8" opacity={0.85} />
        ))}
        {[70, 170, 235, 310].map((x, index) => (
          <Circle key={`small-${x}`} cx={x} cy={[24, 112, 66, 48][index]} r={0.8} fill="#BBDDFF" opacity={0.42} />
        ))}

        <Path d="M-20 228 L72 176 L122 202 L188 148 L242 178 L302 96 L410 186 L410 335 L-20 335Z" fill="url(#farMountain)" opacity="0.72" />
        <Path d="M125 212 L174 158 L220 188 L286 88 L372 198 L410 224 L410 335 L125 335Z" fill="url(#mainMountain)" />
        <Path d="M286 88 L306 168 L260 140Z" fill="#7DBBFF" opacity="0.38" />
        <Path d="M286 88 L246 184 L220 188Z" fill="#72B7FF" opacity="0.30" />
        <Path d="M188 148 L208 192 L150 184Z" fill="#7DBBFF" opacity="0.22" />

        <Ellipse cx="235" cy="132" rx="30" ry="5" fill="#69A9ED" opacity="0.24" />
        <Path d="M48 188 C74 174 86 174 112 189 C132 201 168 194 198 208 C116 208 52 206 -10 218Z" fill="#0C2E64" opacity="0.70" />
        <Path d="M-20 252 C54 216 120 260 190 232 C252 204 305 236 410 204 L410 335 L-20 335Z" fill="url(#frontRidge)" opacity="0.92" />
        <Path d="M-20 282 C52 250 112 292 178 266 C242 238 296 270 410 236 L410 335 L-20 335Z" fill="#061D40" opacity="0.84" />

        <G opacity="0.82">
          {[8, 29, 58, 353, 368, 382].map((x, index) => (
            <Path
              key={`tree-${x}`}
              d={`M${x} ${index < 3 ? 248 + index * 10 : 206 + (index - 3) * 15} l10 30 h-20 z M${x} ${index < 3 ? 232 + index * 10 : 190 + (index - 3) * 15} l8 24 h-16 z M${x} ${index < 3 ? 218 + index * 10 : 176 + (index - 3) * 15} l7 20 h-14 z`}
              fill="#03152E"
            />
          ))}
        </G>

        <Path
          d={TRAIL_PATH}
          stroke="rgba(255,255,255,0.26)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Path
          d={TRAIL_PATH}
          stroke="url(#pathGlow)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Circle cx={marker.x} cy={marker.y} r="12" fill="#FFFFFF" />
        <Circle cx={marker.x} cy={marker.y} r="6.5" fill="#2F73E0" />

        <Path d="M306 76 L306 108" stroke="#DCEBFF" strokeWidth="2" strokeLinecap="round" />
        <Path d="M306 76 L326 83 L306 91Z" fill="#DCEBFF" />

      </Svg>

      <View style={styles.heroTextBlock}>
        <Text style={styles.heroTitle}>Sua jornada</Text>
        <Text style={styles.heroSubtitle}>Acompanhe o progresso dos seus sonhos.</Text>
      </View>

    </View>
  );
}

function ProgressCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <View style={styles.goalCard}>
      <View style={styles.goalBadge}>
        <Ionicons name={icon as any} size={20} color={OB.primary} />
      </View>
      <View style={styles.goalInfo}>
        <Text style={styles.goalTitle}>{label}</Text>
        <Text style={styles.goalValue}>Meta: {value}</Text>
        <Text style={{ color: OB.support, fontSize: 11, fontWeight: "700", marginTop: 6 }}>Progresso ainda não registrado</Text>
      </View>
    </View>
  );
}
function SummaryCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryAccent, { backgroundColor: color }]} />
      <View style={[styles.summaryIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon as any} size={17} color={color} />
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{formatBRLFromCents(value)}</Text>
    </View>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const color = tx.type === "Receita" ? "#22a96b" : "#e05252";
  const sign = tx.type === "Receita" ? "+" : "-";

  return (
    <View style={styles.txRow}>
      <View style={[styles.txDot, { backgroundColor: `${color}1A` }]}>
        <Text style={[styles.txDotText, { color }]}>{sign}</Text>
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={styles.txMeta}>{tx.category} - {formatDate(tx.date)}</Text>
      </View>
      <View style={styles.txAmountWrap}>
        <Text style={[styles.txAmount, { color }]}>{sign}{formatBRLFromCents(tx.amount)}</Text>
        <Text style={[styles.txType, { color, backgroundColor: `${color}1A` }]}>{tx.type}</Text>
      </View>
    </View>
  );
}

function AddModal({ visible, categories, saving, onClose, onSave }: { visible: boolean; categories: Category[]; saving: boolean; onClose: () => void; onSave: (tx: TxDraft) => Promise<boolean> }) {
  const insets = useSafeAreaInsets();
  const androidStatusBar = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
  const topInset = Math.max(insets.top, androidStatusBar, 18);
  const scrollRef = useRef<ScrollView>(null);
  const descriptionFocused = useRef(false);
  const [descriptionY, setDescriptionY] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [type, setType] = useState<TxType>("Receita");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const availableCategories = useMemo(() => categories.filter((item) => item.flow === (type === "Receita" ? "income" : "expense")), [categories, type]);

  useEffect(() => {
    if (!availableCategories.some((item) => item.id === categoryId)) {
      setCategoryId(availableCategories[0]?.id ?? null);
    }
  }, [availableCategories, categoryId]);

  const scrollDescriptionIntoView = useCallback((delay = 80) => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(descriptionY - 18, 0), animated: true });
    }, delay);
  }, [descriptionY]);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const showSub = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      if (descriptionFocused.current) {
        scrollDescriptionIntoView(120);
      }
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
      descriptionFocused.current = false;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollDescriptionIntoView]);

  function scrollToDescription() {
    if (Platform.OS !== "android") return;

    descriptionFocused.current = true;
    if (keyboardHeight > 0) {
      scrollDescriptionIntoView();
      return;
    }

    scrollDescriptionIntoView(260);
  }

  function changeType(next: TxType) {
    setType(next);
    setCategoryId(null);
  }

  async function save() {
    const cents = parseBRLToCents(amount);
    if (!cents || !desc.trim() || saving) return;
    const saved = await onSave({ type, amount: cents, description: desc.trim(), categoryId });
    if (!saved) return;
    setAmount("");
    setDesc("");
    onClose();
  }
  function openImportStatement() {
    onClose();
    router.push("/(onboarding)/import-extract");
  }

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" backgroundColor={OB.offWhite} translucent />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalShade}>
        <View style={styles.sheet}>
          <View pointerEvents="none" style={[styles.modalSafeTop, { height: topInset + 8 }]} />
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.sheetContent,
              {
                paddingTop: topInset + 16,
                paddingBottom: Math.max(insets.bottom, 18) + (keyboardHeight ? keyboardHeight + 52 : 28),
              },
            ]}
          >
            <View style={styles.sheetHero}>
              <Pressable onPress={onClose} hitSlop={12} style={styles.sheetClose}>
                <Ionicons name="close" size={21} color="#fff" />
              </Pressable>
              <Text style={styles.sheetEyebrow}>Controle financeiro</Text>
              <Text style={styles.sheetTitle}>Novo lançamento</Text>
              <Text style={styles.sheetSubtitle}>Registre entradas e saídas com clareza.</Text>
            </View>

            <Pressable onPress={openImportStatement} style={styles.importStatementButton}>
              <View style={styles.importStatementIcon}>
                <Ionicons name="cloud-upload-outline" size={18} color={OB.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.importStatementTitle}>Importar extrato</Text>
                <Text style={styles.importStatementText}>Carregue movimentações do banco por arquivo</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={OB.support} />
            </Pressable>

            <View style={styles.typeTabs}>
              {(["Receita", "Despesa"] as TxType[]).map((item) => {
                const active = item === type;
                return (
                  <Pressable key={item} onPress={() => changeType(item)} style={[styles.typeTab, active && styles.typeTabActive]}>
                    <Text style={[styles.typeTabText, active && styles.typeTabTextActive]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Valor</Text>
            <View style={styles.inputBox}>
              <Text style={styles.currency}>R$</Text>
              <TextInput value={amount.replace("R$", "").trim()} onChangeText={(text) => setAmount(formatBRLInputFromDigits(text))} placeholder="0,00" placeholderTextColor={OB.support} keyboardType="number-pad" style={styles.input} />
            </View>

            <Text style={styles.fieldLabel}>Categoria</Text>
            <View style={styles.categoryPanel}>
              {availableCategories.map((item) => {
                const active = item.id === categoryId;
                return (
                  <Pressable key={item.id} onPress={() => setCategoryId(item.id)} style={[styles.category, active && styles.categoryActive]}>
                    {active ? <Ionicons name="checkmark-circle" size={15} color="#fff" /> : null}
                    <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{item.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={styles.descriptionField}
              onLayout={(event) => setDescriptionY(event.nativeEvent.layout.y)}
            >
              <Text style={styles.fieldLabel}>Descrição</Text>
              <TextInput
                value={desc}
                onChangeText={setDesc}
                onFocus={scrollToDescription}
                onPressIn={scrollToDescription}
                onBlur={() => {
                  descriptionFocused.current = false;
                }}
                placeholder="Ex: compra mercado"
                placeholderTextColor={OB.support}
                style={styles.inputBoxText}
              />
            </View>

            <Pressable onPress={save} disabled={saving || !parseBRLToCents(amount) || !desc.trim()} style={[styles.saveButton, (saving || !parseBRLToCents(amount) || !desc.trim()) && styles.saveButtonDisabled]}>
              <Text style={[styles.saveButtonText, (saving || !parseBRLToCents(amount) || !desc.trim()) && styles.saveButtonTextDisabled]}>{saving ? "Salvando..." : "Salvar lançamento"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function mapDatabaseTx(row: DatabaseTx): Tx {
  return {
    id: row.id,
    type: row.type === "income" ? "Receita" : "Despesa",
    amount: Number(row.amount_cents || 0),
    description: row.note?.trim() || row.category?.name || "Lançamento",
    category: row.category?.name || "Sem categoria",
    categoryId: row.category_id,
    date: row.occurred_on,
  };
}

function ControlPanel({ userId }: { userId: string | null }) {
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState<Filter>("Todos");

  const load = useCallback(async () => {
    if (!householdId) {
      setTxs([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [rows, categoryRows] = await Promise.all([listTransactionsByMonth(householdId), listCategories(householdId)]);
      setTxs(rows.map(mapDatabaseTx));
      setCategories(categoryRows);
    } catch (error: any) {
      Alert.alert("Controle financeiro", error?.message ?? "Não foi possível carregar seus lançamentos.");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const income = txs.filter((tx) => tx.type === "Receita").reduce((sum, tx) => sum + tx.amount, 0);
    const expense = txs.filter((tx) => tx.type === "Despesa").reduce((sum, tx) => sum + tx.amount, 0);
    return { income, expense, balance: income - expense };
  }, [txs]);
  const filtered = filter === "Todos" ? txs : txs.filter((tx) => tx.type === filter);

  async function saveTransaction(draft: TxDraft) {
    if (!householdId || !userId) {
      Alert.alert("Controle financeiro", "Sua estrutura financeira ainda não está disponível.");
      return false;
    }
    try {
      setSaving(true);
      await addTransaction({ householdId, userId, type: draft.type === "Receita" ? "income" : "expense", amount_cents: draft.amount, category_id: draft.categoryId, note: draft.description });
      await load();
      return true;
    } catch (error: any) {
      Alert.alert("Controle financeiro", error?.message ?? "Não foi possível salvar o lançamento.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || householdLoading;
  const emptyStyle = { color: OB.support, fontSize: 14, fontWeight: "700" as const, paddingVertical: 24, textAlign: "center" as const };

  return (
    <>
      <ScrollView contentContainerStyle={styles.controlScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.controlHeader}>
          <Text style={styles.controlEyebrow}>Controle financeiro</Text>
          <Text style={styles.controlTitle}>Liberdade financeira</Text>
          <Text style={styles.controlSubtitle}>Organize seus lançamentos e acompanhe seu dinheiro com clareza.</Text>
        </View>
        <View style={styles.summaryGrid}>
          <SummaryCard label="Receitas do mês" value={totals.income} color="#22a96b" icon="trending-up-outline" />
          <SummaryCard label="Despesas do mês" value={totals.expense} color="#e05252" icon="trending-down-outline" />
          <SummaryCard label="Saldo atual" value={totals.balance} color={OB.primary} icon="wallet-outline" />
        </View>
        <Pressable onPress={() => setModal(true)} disabled={busy || !householdId} style={[styles.newButton, (busy || !householdId) && styles.saveButtonDisabled]}>
          <Ionicons name="add" size={19} color="#fff" />
          <Text style={styles.newText}>Novo lançamento</Text>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {(["Todos", "Receita", "Despesa"] as Filter[]).map((item) => {
            const active = item === filter;
            return <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{item}</Text></Pressable>;
          })}
        </ScrollView>
        <View style={styles.txList}>
          {busy ? <ActivityIndicator color={OB.primary} /> : !householdId ? <Text style={emptyStyle}>Conclua o onboarding para criar sua estrutura financeira.</Text> : filtered.length ? filtered.map((tx) => <TxRow key={tx.id} tx={tx} />) : <Text style={emptyStyle}>Nenhum lançamento neste mês.</Text>}
        </View>
      </ScrollView>
      <AddModal visible={modal} categories={categories} saving={saving} onClose={() => setModal(false)} onSave={saveTransaction} />
    </>
  );
}
function DrawerButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: MenuIcon;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.drawerItem, active && styles.drawerItemActive]}>
      <Ionicons name={icon} size={20} color={active ? "#fff" : OB.support} />
      <Text style={[styles.drawerItemText, active && styles.drawerItemTextActive]}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={active ? "rgba(255,255,255,0.74)" : OB.support} />
    </Pressable>
  );
}

function JourneyDrawer({
  open,
  activeTab,
  displayName,
  avatarUrl,
  onClose,
  onTab,
  onLogout,
}: {
  open: boolean;
  activeTab: Tab;
  displayName: string;
  avatarUrl?: string | null;
  onClose: () => void;
  onTab: (tab: Tab) => void;
  onLogout: () => void;
}) {
  if (!open) return null;

  function goTab(tab: Tab) {
    onTab(tab);
    onClose();
  }

  function goProfile() {
    onClose();
    router.push("/(onboarding)/profile");
  }

  function goCategories() {
    onClose();
    router.push("/(onboarding)/categories");
  }

  return (
    <View style={styles.drawerLayer}>
      <Pressable onPress={onClose} style={[styles.drawerScrim, WEB_DRAWER_BLUR_STYLE]}>
        <BlurView
          intensity={24}
          tint="default"
          blurReductionFactor={3}
          experimentalBlurMethod="dimezisBlurView"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.drawerScrimTint} />
      </Pressable>
      <View style={styles.drawerPanel}>
        <View style={styles.drawerHero}>
          <Pressable onPress={onClose} style={styles.drawerClose} hitSlop={12}>
            <Ionicons name="close" size={21} color="#fff" />
          </Pressable>
          <View style={styles.drawerProfile}>
            <Pressable onPress={goProfile} style={styles.drawerAvatar} accessibilityRole="button" accessibilityLabel="Editar perfil">
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.drawerAvatarImage} />
              ) : (
                <Text style={styles.drawerAvatarText}>{initialsFrom(displayName)}</Text>
              )}
              <View style={styles.drawerAvatarEdit}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </Pressable>
            <Text style={styles.drawerUserName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.drawerSubtitle}>Sua jornada financeira</Text>
          </View>
        </View>

        <View style={styles.drawerList}>
          <DrawerButton icon="compass-outline" label="Jornada" active={activeTab === "jornada"} onPress={() => goTab("jornada")} />
          <DrawerButton icon="wallet-outline" label="Controle financeiro" active={activeTab === "controle"} onPress={() => goTab("controle")} />
          <DrawerButton icon="pricetags-outline" label="Categorias" onPress={goCategories} />
          <DrawerButton icon="trophy-outline" label="Desafios" active={activeTab === "desafios"} onPress={() => goTab("desafios")} />
        </View>

        <View style={styles.drawerFooter}>
          <Pressable onPress={onLogout} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={20} color="#B94A4A" />
            <Text style={styles.logoutText}>Sair da conta</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function JourneyScreen() {
  const params = useLocalSearchParams<{ dreams?: string; values?: string }>();
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>("jornada");
  const [menuOpen, setMenuOpen] = useState(false);

  const userMeta = session?.user?.user_metadata as Record<string, any> | undefined;
  const displayName =
    userMeta?.full_name ||
    userMeta?.name ||
    session?.user?.email?.split("@")[0] ||
    "Usuário";
  const avatarUrl = userMeta?.avatar_url || userMeta?.picture || null;

  const savedDreams = Array.isArray(userMeta?.finapp_dreams) ? JSON.stringify(userMeta.finapp_dreams) : undefined;
  const savedValues = userMeta?.finapp_dream_values && typeof userMeta.finapp_dream_values === "object"
    ? JSON.stringify(userMeta.finapp_dream_values)
    : undefined;
  const dreams = useMemo(() => readJson<string[]>(params.dreams ?? savedDreams, []), [params.dreams, savedDreams]);
  const values = useMemo(() => readJson<Record<string, string>>(params.values ?? savedValues, {}), [params.values, savedValues]);

  const cards = dreams.slice(0, 3).map((dream, index) => {
    const cents = parseBRLToCents(values[dream] ?? "");
    return {
      label: dream,
      value: cents > 0 ? formatBRLFromCents(cents) : "a definir",
      icon: ["home-outline", "trending-up-outline", "flag-outline"][index] ?? "sparkles-outline",
    };
  });
  const journeyProgress = 0;

  async function logout() {
    setMenuOpen(false);
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <View style={styles.content}>
          {tab === "controle" ? (
            <ControlPanel userId={session?.user?.id ?? null} />
          ) : tab === "jornada" ? (
            <>
              <MountainHero progress={journeyProgress} />
              <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Seus sonhos</Text>
                </View>
                {cards.map((card) => (
                  <ProgressCard key={card.label} {...card} />
                ))}

              </ScrollView>
            </>
          ) : (
            <View style={styles.placeholder}>
              <Ionicons name="trophy-outline" size={42} color={OB.support} />
              <Text style={styles.placeholderTitle}>Desafios em breve</Text>
              <Text style={styles.placeholderText}>Missões financeiras para manter sua jornada viva.</Text>
            </View>
          )}
        </View>

        <View style={styles.nav}>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.navItem}>
            <Ionicons name="menu-outline" size={23} color={menuOpen ? OB.primary : OB.support} />
            <Text style={[styles.navText, menuOpen && styles.navTextActive]}>Menu</Text>
            {menuOpen ? <View style={styles.navIndicator} /> : null}
          </Pressable>

          {[
            ["controle", "Controle", "bar-chart-outline"],
            ["jornada", "Jornada", "compass-outline"],
            ["desafios", "Desafios", "trophy-outline"],
          ].map(([id, label, icon]) => {
            const active = tab === id;
            return (
              <Pressable key={id} onPress={() => setTab(id as Tab)} style={styles.navItem}>
                <Ionicons name={icon as any} size={21} color={active ? OB.primary : OB.support} />
                <Text style={[styles.navText, active && styles.navTextActive]}>{label}</Text>
                {active ? <View style={styles.navIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
        <JourneyDrawer
          open={menuOpen}
          activeTab={tab}
          displayName={displayName}
          avatarUrl={avatarUrl}
          onClose={() => setMenuOpen(false)}
          onTab={setTab}
          onLogout={logout}
        />
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  content: {
    flex: 1,
  },
  hero: {
    height: 218,
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  heroTextBlock: {
    position: "absolute",
    left: 24,
    top: 22,
    maxWidth: 210,
  },
  heroTitle: {
    color: OB.offWhite,
    fontSize: 27,
    fontWeight: "900",
    marginTop: 14,
    letterSpacing: 0,
  },
  heroSubtitle: {
    color: "rgba(220,235,255,0.86)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 7,
  },
  scroll: {
    padding: 16,
    paddingTop: 8,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  goalCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  goalBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  goalInfo: {
    flex: 1,
  },
  goalTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  goalValue: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  smallTrack: {
    height: 5,
    borderRadius: 99,
    backgroundColor: OB.supportSoft,
    marginTop: 8,
    overflow: "hidden",
  },
  smallFill: {
    height: "100%",
    backgroundColor: OB.primary,
  },
  ring: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 5,
    borderColor: OB.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: {
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  monthCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 16,
    backgroundColor: OB.primary,
  },
  monthIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  monthEyebrow: {
    color: "rgba(123,160,200,0.85)",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  monthTitle: {
    color: OB.offWhite,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 3,
  },
  challenge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  challengeEyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  challengeTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 6,
  },
  challengeText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
  },
  checkButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  checkButtonDone: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  controlScroll: {
    padding: 16,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 16,
  },
  controlHeader: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  controlEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  controlTitle: {
    color: OB.textOnDark,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  controlSubtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 6,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryCard: {
    width: "48.5%",
    minHeight: 112,
    borderRadius: 18,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    padding: 14,
    overflow: "hidden",
    shadowColor: OB.primary,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  summaryAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  summaryLabel: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
  },
  summaryValue: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  newButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: OB.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  newText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  filters: {
    gap: 8,
  },
  filter: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: "#fff",
  },
  filterActive: {
    backgroundColor: OB.primary,
  },
  filterText: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "900",
  },
  filterTextActive: {
    color: "#fff",
  },
  txList: {
    borderRadius: 20,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  txDot: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  txDotText: {
    fontSize: 15,
    fontWeight: "900",
  },
  txInfo: {
    flex: 1,
  },
  txDesc: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  txMeta: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  txAmountWrap: {
    alignItems: "flex-end",
  },
  txAmount: {
    fontSize: 13,
    fontWeight: "900",
  },
  txType: {
    fontSize: 10,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
  },
  modalShade: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  sheet: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  modalSafeTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: OB.offWhite,
  },
  sheetHero: {
    borderRadius: 22,
    padding: 20,
    paddingRight: 62,
    alignItems: "flex-start",
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  sheetEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sheetTitle: {
    color: OB.textOnDark,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  sheetSubtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 6,
  },
  sheetClose: {
    position: "absolute",
    right: 14,
    top: 14,
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  typeTabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  sheetContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  importStatementButton: {
    minHeight: 66,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  importStatementIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  importStatementTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  importStatementText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
    marginTop: 2,
  },
  typeTab: {
    flex: 1,
    minHeight: 52,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  typeTabActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  typeTabText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "900",
  },
  typeTabTextActive: {
    color: "#fff",
  },
  fieldLabel: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  inputBox: {
    minHeight: 58,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  currency: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginRight: 6,
  },
  input: {
    flex: 1,
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  descriptionField: {
    gap: 12,
  },
  inputBoxText: {
    minHeight: 58,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 15,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  categoryPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
    padding: 10,
  },
  category: {
    minHeight: 38,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: "transparent",
  },
  categoryActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  categoryText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "900",
  },
  categoryTextActive: {
    color: "#fff",
  },
  saveButton: {
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: OB.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveButtonDisabled: {
    backgroundColor: "rgba(123,160,200,0.32)",
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  saveButtonTextDisabled: {
    color: OB.support,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  placeholderTitle: {
    color: OB.primary,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 14,
  },
  placeholderText: {
    color: OB.support,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  nav: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingBottom: 6,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingTop: 11,
    paddingBottom: 8,
  },
  navText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
  },
  navTextActive: {
    color: OB.primary,
    fontWeight: "900",
  },
  navIndicator: {
    position: "absolute",
    bottom: 0,
    width: 28,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: OB.primary,
  },
  drawerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
  },
  drawerScrim: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  drawerScrimTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,21,46,0.18)",
  },
  drawerPanel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "72%",
    maxWidth: 280,
    backgroundColor: OB.offWhite,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
    elevation: 35,
  },
  drawerHero: {
    minHeight: 154,
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 16,
    backgroundColor: OB.primary,
    justifyContent: "flex-end",
  },
  drawerClose: {
    position: "absolute",
    top: 14,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  drawerProfile: {
    alignItems: "flex-start",
  },
  drawerAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 11,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.28)",
    overflow: "visible",
  },
  drawerAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 29,
  },
  drawerAvatarText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  drawerAvatarEdit: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.support,
    borderWidth: 2,
    borderColor: OB.primary,
  },
  drawerUserName: {
    color: OB.offWhite,
    fontSize: 16,
    fontWeight: "900",
    maxWidth: "92%",
  },
  drawerSubtitle: {
    color: "rgba(160,200,235,0.86)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  drawerList: {
    padding: 10,
    gap: 6,
    flex: 1,
  },
  drawerItem: {
    minHeight: 46,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
  },
  drawerItemActive: {
    backgroundColor: OB.primary,
  },
  drawerItemText: {
    flex: 1,
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  drawerItemTextActive: {
    color: "#fff",
  },
  drawerFooter: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  logoutButton: {
    minHeight: 46,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FDE7E7",
    borderWidth: 1,
    borderColor: "#F5B9B9",
  },
  logoutText: {
    color: "#B94A4A",
    fontSize: 13,
    fontWeight: "900",
  },
});
