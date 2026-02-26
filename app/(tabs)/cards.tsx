// app/(tabs)/cards.tsx
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View, StyleSheet } from "react-native";
import { useFocusEffect, router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { parseBRLToCents, formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import {
  addCard,
  buildForecast,
  listCards,
  listInstallments,
  listAllUnpaidInstallments,
  setInstallmentPaid,
  PaymentMethod,
  CardInstallmentRow,
  monthKey,
} from "../../src/lib/cards";
import { addMonths, ymd } from "../../src/lib/date";
import { Ionicons } from "@expo/vector-icons";

function normalizeMoneyBR(text: string) {
  if (!text) return "";
  let s = text.replace(/[^\d.,]/g, "");
  s = s.replace(/\./g, ",");
  const idx = s.indexOf(",");
  if (idx >= 0) {
    const intPart = s.slice(0, idx).replace(/[^\d]/g, "");
    const decPart = s.slice(idx + 1).replace(/[^\d]/g, "").slice(0, 2);
    return decPart.length ? `${intPart},${decPart}` : `${intPart},`;
  }
  return s.replace(/[^\d]/g, "");
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function formatMonthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
}
function ProgressBar({ value }: { value: number }) {
  const p = clamp01(value);
  return (
    <View style={ui.barOuter}>
      <View style={[ui.barInner, { width: `${p * 100}%` }]} />
    </View>
  );
}

type DetailTab = "summary" | "installments";
function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ key: string; label: string }>;
  onChange: (v: any) => void;
}) {
  return (
    <View style={seg.wrap}>
      {options.map((o) => {
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
  itemActive: { borderColor: "rgba(0,240,255,0.40)", backgroundColor: "rgba(0,240,255,0.10)" },
  text: { color: theme.colors.text, fontWeight: "900", fontSize: 13 },
  textActive: { color: theme.colors.primary },
});

export default function CardsTab() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  // ✅ estados de loading separados
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [instAllUnpaid, setInstAllUnpaid] = useState<CardInstallmentRow[]>([]);
  const [instUpcoming, setInstUpcoming] = useState<CardInstallmentRow[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("summary");

  const [showAdd, setShowAdd] = useState(false);
  const [cardName, setCardName] = useState("");
  const [limit, setLimit] = useState("");
  const [dueDay, setDueDay] = useState("10");
  const [saving, setSaving] = useState(false);

  const monthsAhead = 6;
  const range = useMemo(() => {
    const start = ymd(new Date());
    const end = ymd(addMonths(new Date(), monthsAhead));
    return { start, end };
  }, [monthsAhead]);

  // evita “piscar” loading em cliques rápidos
  const inFlight = useRef(false);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (!householdId) return;
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        if (mode === "initial") setInitialLoading(true);
        else setRefreshing(true);

        const cs = await listCards(householdId);
        setCards(cs);

        const ids = cs.map((c) => c.id);
        if (!ids.length) {
          setInstAllUnpaid([]);
          setInstUpcoming([]);
          setExpandedId(null);
          return;
        }

        const [unpaidAll, upcoming] = await Promise.all([
          listAllUnpaidInstallments({ householdId, cardIds: ids }),
          listInstallments({
            householdId,
            cardIds: ids,
            fromYMD: range.start,
            toYMD: range.end,
            includePaid: true,
          }),
        ]);

        setInstAllUnpaid(unpaidAll);
        setInstUpcoming(upcoming);

        if (expandedId && !ids.includes(expandedId)) setExpandedId(null);
      } catch (e: any) {
        Alert.alert("Erro", e?.message ?? "Falha ao carregar cartões.");
      } finally {
        inFlight.current = false;
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [householdId, range.start, range.end, expandedId]
  );

  useFocusEffect(
    useCallback(() => {
      if (!hhLoading && householdId) load("initial");
    }, [hhLoading, householdId, load])
  );

  // maps
  const usedByCard = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of instAllUnpaid) {
      if (i.paid_at) continue;
      map.set(i.card_id, (map.get(i.card_id) ?? 0) + Number(i.amount_cents || 0));
    }
    return map;
  }, [instAllUnpaid]);

  const unpaidByCard = useMemo(() => {
    const map = new Map<string, CardInstallmentRow[]>();
    for (const i of instAllUnpaid) {
      if (i.paid_at) continue;
      const arr = map.get(i.card_id) ?? [];
      arr.push(i);
      map.set(i.card_id, arr);
    }
    return map;
  }, [instAllUnpaid]);

  const upcomingByCard = useMemo(() => {
    const map = new Map<string, CardInstallmentRow[]>();
    for (const i of instUpcoming) {
      const arr = map.get(i.card_id) ?? [];
      arr.push(i);
      map.set(i.card_id, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : a.n - b.n));
      map.set(k, arr);
    }
    return map;
  }, [instUpcoming]);

  async function onAddCard() {
    if (!userId || !householdId) return;
    if (saving) return;

    const name = cardName.trim();
    const lim = parseBRLToCents(limit);
    const dd = Math.max(1, Math.min(28, Number(dueDay || "10")));

    if (!name) return Alert.alert("Atenção", "Digite o nome do cartão.");
    if (lim <= 0) return Alert.alert("Atenção", "Digite um limite válido.");
    if (!dd) return Alert.alert("Atenção", "Digite um dia de vencimento (1 a 28).");

    try {
      setSaving(true);
      await addCard({ householdId, userId, name, credit_limit_cents: lim, due_day: dd });

      setCardName("");
      setLimit("");
      setDueDay("10");
      setShowAdd(false);

      // ✅ atualiza discreto (sem “carregando…” grandão)
      await load("refresh");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao criar cartão.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePaid(inst: CardInstallmentRow) {
    if (!householdId) return;
    const willPay = !inst.paid_at;

    try {
      await setInstallmentPaid({ householdId, installmentId: inst.id, paid: willPay });

      // ✅ refresh discreto
      await load("refresh");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao atualizar parcela.");
    }
  }

  return (
    <Screen>
      <P muted>Controle de limite, parcelas e faturas futuras.</P>

      <View style={{ height: 18 }} />

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Cartões</Text>

          <Row style={{ gap: 10, alignItems: "center" }}>
            {/* ✅ loader pequeno e discreto */}
            {refreshing ? <ActivityIndicator size="small" /> : null}

            <Pressable onPress={() => setShowAdd((v) => !v)} style={ui.linkBtn}>
              <Text style={ui.linkText}>{showAdd ? "Fechar" : "+ Novo cartão"}</Text>
            </Pressable>
          </Row>
        </Row>

        {showAdd ? (
          <View style={{ marginTop: 14 }}>
            <View style={ui.hero}>
              <Text style={ui.heroLabel}>Nome</Text>
              <View style={{ height: 12 }} />
              <TextInput
                value={cardName}
                onChangeText={setCardName}
                placeholder="Ex: Banco do Brasil, Nubank..."
                placeholderTextColor={"rgba(231,234,243,0.40)"}
                style={ui.inputLine}
              />

              <View style={ui.hr} />

              <Text style={ui.heroLabel}>Limite total</Text>
              <View style={{ height: 12 }} />
              <Row style={{ alignItems: "flex-end", gap: 10 }}>
                <Text style={ui.currency}>R$</Text>
                <TextInput
                  value={limit}
                  onChangeText={(t) => setLimit(normalizeMoneyBR(t))}
                  placeholder="0,00"
                  placeholderTextColor={"rgba(231,234,243,0.40)"}
                  keyboardType="decimal-pad"
                  style={ui.bigValue}
                />
              </Row>

              <View style={ui.hr} />

              <Text style={ui.heroLabel}>Dia do vencimento</Text>
              <View style={{ height: 12 }} />
              <TextInput
                value={dueDay}
                onChangeText={(t) => setDueDay(t.replace(/\D/g, ""))}
                placeholder="10"
                placeholderTextColor={"rgba(231,234,243,0.40)"}
                keyboardType="numeric"
                style={ui.inputLine}
              />

              <Text style={ui.hint}>Use 1 a 28</Text>

              <View style={{ height: 18 }} />

              <Row style={{ gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title={saving ? "Salvando..." : "Criar cartão"} onPress={onAddCard} disabled={saving} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Cancelar" onPress={() => setShowAdd(false)} disabled={saving} />
                </View>
              </Row>
            </View>
          </View>
        ) : null}
      </Card>

      <View style={{ height: 16 }} />

      {/* ✅ loading só na PRIMEIRA vez */}
      {initialLoading ? (
        <Card intensity={18}>
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando cartões…</P>
          </Row>
        </Card>
      ) : !cards.length ? (
        <Card intensity={18}>
          <P muted>Você ainda não cadastrou cartões.</P>
        </Card>
      ) : (
        <View style={{ gap: 14 }}>
          {cards.map((c) => {
            const used = usedByCard.get(c.id) ?? 0;
            const lim = Number(c.credit_limit_cents || 0);
            const pct = lim > 0 ? used / lim : 0;

            const isOpen = expandedId === c.id;

            const unpaidItems = unpaidByCard.get(c.id) ?? [];
            const forecast = buildForecast(unpaidItems, monthsAhead);
            const nextMonth = forecast.nextMonth;
            const nextTotal = forecast.nextTotal;

            const upcomingItems = upcomingByCard.get(c.id) ?? [];
            const grouped = (() => {
              const map = new Map<string, CardInstallmentRow[]>();
              for (const i of upcomingItems) {
                const k = monthKey(i.due_on);
                const arr = map.get(k) ?? [];
                arr.push(i);
                map.set(k, arr);
              }
              return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
            })();

            const avail = Math.max(0, lim - used);

            return (
              <Card key={c.id} intensity={18}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Row style={{ gap: 10, alignItems: "center" }}>
                    <View style={ui.bankIcon}>
                      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                        {String(c.name || "C").slice(0, 1).toUpperCase()}
                      </Text>
                    </View>

                    <View>
                      <Text style={ui.cardTitle}>{c.name}</Text>
                      <Text style={ui.cardMeta}>Vence dia {c.due_day ?? "—"}</Text>
                    </View>
                  </Row>

                  <Pressable
                    onPress={() => {
                      if (isOpen) setExpandedId(null);
                      else {
                        setExpandedId(c.id);
                        setDetailTab("summary");
                      }
                    }}
                    hitSlop={12}
                    style={ui.chevBtn}
                  >
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={20} color={theme.colors.text} />
                  </Pressable>
                </Row>

                {!isOpen ? (
                  <>
                    <View style={{ height: 12 }} />
                    <ProgressBar value={pct} />
                    <View style={{ height: 10 }} />
                    <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={ui.meta}>Usado</Text>
                      <Text style={{ color: theme.colors.pink, fontWeight: "900" }}>
                        {formatBRLFromCents(used)}{" "}
                        <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
                          / {formatBRLFromCents(lim)}
                        </Text>
                      </Text>
                    </Row>
                  </>
                ) : (
                  <>
                    <View style={ui.hrInner} />

                    <Button
                      title="Nova compra neste cartão"
                      onPress={() => router.push(`/(tabs)/new-card-charge?cardId=${c.id}` as any)}
                    />

                    <View style={{ height: 12 }} />

                    <Segmented
                      value={detailTab}
                      onChange={setDetailTab}
                      options={[
                        { key: "summary", label: "Resumo" },
                        { key: "installments", label: "Parcelas" },
                      ]}
                    />

                    <View style={{ height: 14 }} />

                    {detailTab === "summary" ? (
                      <View style={ui.heroInner}>
                        <Row style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                          <Text style={ui.heroLabel}>Limite</Text>
                          <Text style={ui.bigNumber}>{formatBRLFromCents(lim)}</Text>
                        </Row>

                        <View style={{ height: 14 }} />
                        <ProgressBar value={pct} />

                        <View style={{ height: 14 }} />

                        <Row style={{ justifyContent: "space-between" }}>
                          <Text style={ui.meta}>Usado</Text>
                          <Text style={[ui.value, { color: theme.colors.pink }]}>{formatBRLFromCents(used)}</Text>
                        </Row>

                        <Row style={{ justifyContent: "space-between", marginTop: 8 }}>
                          <Text style={ui.meta}>Disponível</Text>
                          <Text style={[ui.value, { color: theme.colors.good }]}>{formatBRLFromCents(avail)}</Text>
                        </Row>

                        <View style={ui.hrMini} />

                        <Row style={{ justifyContent: "space-between" }}>
                          <Text style={ui.meta}>Próxima fatura</Text>
                          <Text style={ui.value}>
                            {nextMonth ? `${formatMonthLabel(nextMonth)} • ${formatBRLFromCents(nextTotal)}` : "—"}
                          </Text>
                        </Row>

                        <View style={{ height: 10 }} />

                        <Row style={{ justifyContent: "space-between" }}>
                          <Text style={ui.meta}>Período</Text>
                          <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
                            {formatDateBRFromYMD(range.start)} → {formatDateBRFromYMD(range.end)}
                          </Text>
                        </Row>
                      </View>
                    ) : (
                      <View style={ui.heroInner}>
                        {!grouped.length ? (
                          <P muted>Sem parcelas nos próximos {monthsAhead} meses.</P>
                        ) : (
                          <View>
                            {grouped.map(([ym, items]) => (
                              <View key={ym} style={{ marginBottom: 14 }}>
                                <Text style={ui.monthTitle}>{formatMonthLabel(ym)}</Text>
                                <View style={{ height: 8 }} />

                                {items.map((i, idx) => {
                                  const desc = i.charge?.description?.trim() || "Compra";
                                  const tot = i.charge?.installments_total ?? 1;
                                  const paid = !!i.paid_at;

                                  return (
                                    <Pressable
                                      key={i.id}
                                      onPress={() => togglePaid(i)}
                                      style={[ui.installRow, idx === 0 ? { borderTopWidth: 0 } : null]}
                                    >
                                      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                                        <View style={{ maxWidth: "70%" }}>
                                          <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                                            {paid ? "✓ " : ""}
                                            {desc} ({i.n}/{tot})
                                          </Text>
                                          <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 6 }}>
                                            Venc: {formatDateBRFromYMD(i.due_on)}
                                          </Text>
                                        </View>

                                        <Text style={{ color: paid ? theme.colors.muted : theme.colors.text, fontWeight: "900" }}>
                                          {formatBRLFromCents(i.amount_cents)}
                                        </Text>
                                      </Row>

                                      <Text style={{ color: theme.colors.muted2, fontWeight: "800", marginTop: 8 }}>
                                        Toque para {paid ? "desmarcar" : "marcar"} como paga
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const ui = StyleSheet.create({
  sectionTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  linkBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  linkText: { color: theme.colors.primary, fontWeight: "900" },

  hero: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 18,
    padding: 16,
  },
  heroInner: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 18,
    padding: 14,
  },
  heroLabel: { color: "rgba(231,234,243,0.85)", fontWeight: "900", fontSize: 13 },

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
  hint: { color: theme.colors.muted, fontWeight: "800", marginTop: 10 },

  hr: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 18, marginBottom: 18 },
  hrInner: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 16, marginBottom: 16 },
  hrMini: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 14, marginBottom: 14 },

  barOuter: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  barInner: { height: "100%", borderRadius: 999, backgroundColor: theme.colors.primary },

  meta: { color: theme.colors.muted, fontWeight: "800" },
  value: { color: theme.colors.text, fontWeight: "900" },
  bigNumber: { color: theme.colors.text, fontWeight: "900", fontSize: 20 },

  bankIcon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  cardMeta: { color: theme.colors.muted, fontWeight: "800", marginTop: 2 },

  chevBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
  },

  monthTitle: {
    color: "rgba(231,234,243,0.55)",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  installRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
});