// app/(tabs)/cards.tsx
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useFocusEffect, router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { parseBRLToCents, formatBRLFromCents, formatDateBRFromYMD, formatBRLInputFromDigits } from "../../src/lib/format";
import {
  addCard,
  buildForecast,
  listCards,
  listInstallments,
  listAllUnpaidInstallments,
  setInstallmentPaid,
  PaymentMethod,
  CardInstallmentRow,
  LimitBehavior,
  monthKey,
} from "../../src/lib/cards";
import { addMonths, ymd } from "../../src/lib/date";

function formatMonthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
}

export default function CardsTab() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [instAllUnpaid, setInstAllUnpaid] = useState<CardInstallmentRow[]>([]);
  const [instUpcoming, setInstUpcoming] = useState<CardInstallmentRow[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // add card form
  const [showAdd, setShowAdd] = useState(false);
  const [cardName, setCardName] = useState("");
  const [limit, setLimit] = useState("");
  const [dueDay, setDueDay] = useState("10");
  const [behavior, setBehavior] = useState<LimitBehavior>("full");
  const [saving, setSaving] = useState(false);

  const monthsAhead = 6;

  const range = useMemo(() => {
    const start = ymd(new Date());
    const end = ymd(addMonths(new Date(), monthsAhead));
    return { start, end };
  }, [monthsAhead]);

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      setBusy(true);

      const cs = await listCards(householdId);
      setCards(cs);

      const ids = cs.map((c) => c.id);
      if (!ids.length) {
        setInstAllUnpaid([]);
        setInstUpcoming([]);
        setSelectedCardId(null);
        return;
      }

      // usado = todas as parcelas não pagas (inclui atrasadas)
      const unpaidAll = await listAllUnpaidInstallments({ householdId, cardIds: ids });
      setInstAllUnpaid(unpaidAll);

      // próximas faturas = só próximos meses
      const upcoming = await listInstallments({
        householdId,
        cardIds: ids,
        fromYMD: range.start,
        toYMD: range.end,
        includePaid: true, // pra poder marcar/desmarcar dentro do range
      });
      setInstUpcoming(upcoming);

      if (!selectedCardId || !ids.includes(selectedCardId)) setSelectedCardId(ids[0]);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar cartões.");
    } finally {
      setBusy(false);
    }
  }, [householdId, range.start, range.end, selectedCardId]);

  useFocusEffect(
    useCallback(() => {
      if (!hhLoading && householdId) load();
    }, [hhLoading, householdId, load])
  );

  function usedByCard(cardId: string) {
    return instAllUnpaid
      .filter((i) => i.card_id === cardId && !i.paid_at)
      .reduce((acc, i) => acc + Number(i.amount_cents || 0), 0);
  }

  function forecastByCard(cardId: string) {
    const items = instAllUnpaid.filter((i) => i.card_id === cardId && !i.paid_at);
    return buildForecast(items, monthsAhead);
  }

  const selectedCard = useMemo(() => cards.find((c) => c.id === selectedCardId) ?? null, [cards, selectedCardId]);

  const selectedUpcoming = useMemo(() => {
    if (!selectedCardId) return [];
    return instUpcoming
      .filter((i) => i.card_id === selectedCardId)
      .sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : a.n - b.n));
  }, [instUpcoming, selectedCardId]);

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
      await addCard({
        householdId,
        userId,
        name,
        credit_limit_cents: lim,
        due_day: dd,
        limit_behavior: behavior,
      });

      setCardName("");
      setLimit("");
      setDueDay("10");
      setBehavior("full");
      setShowAdd(false);

      await load();
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
      await setInstallmentPaid({
        householdId,
        installmentId: inst.id,
        paid: willPay,
      });
      await load();
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao atualizar parcela.");
    }
  }

  return (
    <Screen>
      <AppHeader title="Cartões" subtitle="Controle de limite, parcelas e faturas futuras" />

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>Meus cartões</Text>

          <Pressable onPress={() => setShowAdd((v) => !v)} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>
              {showAdd ? "Fechar" : "+ Novo cartão"}
            </Text>
          </Pressable>
        </Row>

        {showAdd ? (
          <View style={{ marginTop: 12 }}>
            <Label>Nome</Label>
            <Input value={cardName} onChangeText={setCardName} placeholder="Ex: Nubank, Itaú..." />

            <View style={{ height: 10 }} />
            <Label>Limite total (R$)</Label>
            <Input value={limit} onChangeText={(t) => setLimit(formatBRLInputFromDigits(t))} placeholder="Ex: 5.000,00" keyboardType="number-pad" />

            <View style={{ height: 10 }} />
            <Label>Dia do vencimento (1 a 28)</Label>
            <Input value={dueDay} onChangeText={(t) => setDueDay(t.replace(/\D/g, ""))} placeholder="10" keyboardType="numeric" />

            <View style={{ height: 10 }} />
            <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Como ocupa o limite?</Text>
            <View style={{ height: 8 }} />

            <Row style={{ gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={behavior === "full" ? "✓ Bloqueia total" : "Bloqueia total"}
                  onPress={() => setBehavior("full")}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={behavior === "installment" ? "✓ Por parcela" : "Por parcela"}
                  onPress={() => setBehavior("installment")}
                />
              </View>
            </Row>

            <View style={{ height: 12 }} />
            <Button title={saving ? "Salvando..." : "Criar cartão"} onPress={onAddCard} disabled={saving} />
          </View>
        ) : null}

        <View style={{ height: 12 }} />

        <Button
          title="Nova compra no cartão"
          onPress={() => router.push("/(tabs)/new-card-charge")}
          disabled={!cards.length}
        />

        <View style={{ height: 12 }} />

        {busy ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : !cards.length ? (
          <P muted>Você ainda não cadastrou cartões.</P>
        ) : (
          <View>
            {cards.map((c) => {
              const used = usedByCard(c.id);
              const lim = Number(c.credit_limit_cents || 0);
              const avail = Math.max(0, lim - used);

              const f = forecastByCard(c.id);
              const nextMonth = f.nextMonth;
              const nextTotal = f.nextTotal;

              const active = c.id === selectedCardId;

              return (
                <Pressable
                  key={c.id}
                  onPress={() => setSelectedCardId(c.id)}
                  style={{
                    paddingVertical: 12,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                    opacity: active ? 1 : 0.92,
                  }}
                >
                  <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: theme.colors.text, fontWeight: active ? "900" : "800" }}>
                      {active ? `✓ ${c.name}` : c.name}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
                      Vence dia {c.due_day ?? "—"}
                    </Text>
                  </Row>

                  <View style={{ height: 8 }} />

                  <Row style={{ justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Limite</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{formatBRLFromCents(lim)}</Text>
                  </Row>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Usado</Text>
                    <Text style={{ color: theme.colors.pink, fontWeight: "900" }}>{formatBRLFromCents(used)}</Text>
                  </Row>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Disponível</Text>
                    <Text style={{ color: theme.colors.good, fontWeight: "900" }}>{formatBRLFromCents(avail)}</Text>
                  </Row>

                  <View style={{ height: 8 }} />

                  <Row style={{ justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Próxima fatura</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                      {nextMonth ? `${formatMonthLabel(nextMonth)} • ${formatBRLFromCents(nextTotal)}` : "—"}
                    </Text>
                  </Row>
                </Pressable>
              );
            })}
          </View>
        )}
      </Card>

      {selectedCard ? (
        <Card intensity={18}>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>
              Parcelas — {selectedCard.name}
            </Text>
            <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
              {formatDateBRFromYMD(range.start)} → {formatDateBRFromYMD(range.end)}
            </Text>
          </Row>

          <View style={{ height: 10 }} />

          {!selectedUpcoming.length ? (
            <P muted>Sem parcelas nos próximos {monthsAhead} meses.</P>
          ) : (
            selectedUpcoming.map((i) => {
              const desc = i.charge?.description?.trim() || "Compra";
              const tot = i.charge?.installments_total ?? 1;
              const paid = !!i.paid_at;

              return (
                <Pressable
                  key={i.id}
                  onPress={() => togglePaid(i)}
                  style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.border }}
                >
                  <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ maxWidth: "70%" }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                        {paid ? "✓ " : ""}
                        {desc} ({i.n}/{tot})
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 4 }}>
                        Venc: {formatDateBRFromYMD(i.due_on)} • {formatMonthLabel(monthKey(i.due_on))}
                      </Text>
                    </View>
                    <Text style={{ color: paid ? theme.colors.muted : theme.colors.text, fontWeight: "900" }}>
                      {formatBRLFromCents(i.amount_cents)}
                    </Text>
                  </Row>

                  <Text style={{ color: theme.colors.muted, fontWeight: "700", marginTop: 6 }}>
                    Toque para {paid ? "desmarcar" : "marcar"} como paga
                  </Text>
                </Pressable>
              );
            })
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
