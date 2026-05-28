// app/(tabs)/new-card-charge.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { formatBRLFromCents, parseBRLToCents, formatDateBRFromYMD } from "../../src/lib/format";
import { ymd } from "../../src/lib/date";
import { listCards, PaymentMethod } from "../../src/lib/cards";
import { addCardChargeAndInstallments } from "../../src/lib/cardCharges";

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

export default function NewCardCharge() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cards, setCardsState] = useState<PaymentMethod[]>([]);
  const [cardId, setCardId] = useState<string>("");

  const [desc, setDesc] = useState("");
  const [value, setValue] = useState("");
  const [installments, setInstallments] = useState("1");
  const [purchasedOn, setPurchasedOn] = useState(ymd(new Date()));

  const preview = useMemo(() => parseBRLToCents(value), [value]);
  const card = useMemo(() => cards.find((c) => c.id === cardId) ?? null, [cards, cardId]);

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      setBusy(true);
      const cs = await listCards(householdId);
      setCardsState(cs);
      if (cs.length) setCardId(cs[0].id);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar cartões.");
    } finally {
      setBusy(false);
    }
  }, [householdId]);

  useEffect(() => {
    if (!hhLoading && householdId) load();
  }, [hhLoading, householdId, load]);

  async function onSave() {
    if (!userId || !householdId) return;
    if (saving) return;

    if (!cardId) return Alert.alert("Atenção", "Selecione um cartão.");
    const cents = parseBRLToCents(value);
    const n = Math.max(1, Math.min(60, Number(installments || "1")));

    if (cents <= 0) return Alert.alert("Atenção", "Digite um valor válido.");
    if (!purchasedOn) return Alert.alert("Atenção", "Digite a data da compra (YYYY-MM-DD).");

    try {
      setSaving(true);

      await addCardChargeAndInstallments({
        householdId,
        userId,
        cardId,
        purchased_on: purchasedOn,
        description: desc?.trim() ? desc.trim() : null,
        total_cents: cents,
        installments_total: n,
        due_day: card?.due_day ?? null,
      });

      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar compra.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <AppHeader title="Compra no cartão" subtitle="Crie a compra e acompanhe as parcelas futuras" />

      <Card intensity={18}>
        {busy ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : !cards.length ? (
          <>
            <P muted>Você ainda não tem cartões cadastrados.</P>
            <View style={{ height: 12 }} />
            <Button title="Voltar" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Cartão</Text>
            <View style={{ height: 8 }} />

            {cards.map((c) => {
              const active = c.id === cardId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCardId(c.id)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                    {active ? `✓ ${c.name}` : c.name} • vence dia {c.due_day ?? "—"}
                  </Text>
                </Pressable>
              );
            })}

            <View style={{ height: 8 }} />
            <Label>Descrição</Label>
            <Input value={desc} onChangeText={setDesc} placeholder="Ex: Notebook / Mercado / Celular..." />

            <View style={{ height: 10 }} />
            <Label>Valor total (R$)</Label>
            <Input value={value} onChangeText={(t) => setValue(normalizeMoneyBR(t))} placeholder="Ex: 1.200,00" keyboardType="decimal-pad" />
            <P muted>Prévia: {formatBRLFromCents(preview)}</P>

            <View style={{ height: 10 }} />
            <Label>Parcelas</Label>
            <Input value={installments} onChangeText={(t) => setInstallments(t.replace(/\D/g, ""))} placeholder="1" keyboardType="numeric" />

            <View style={{ height: 10 }} />
            <Label>Data da compra (YYYY-MM-DD)</Label>
            <Input value={purchasedOn} onChangeText={setPurchasedOn} placeholder="2026-02-17" keyboardType="numbers-and-punctuation" />
            <P muted>Data: {formatDateBRFromYMD(purchasedOn)}</P>

            <View style={{ height: 12 }} />
            <Button title={saving ? "Salvando..." : "Salvar compra"} onPress={onSave} disabled={saving} />

            <View style={{ height: 10 }} />
            <Button title="Cancelar" onPress={() => router.back()} disabled={saving} />
          </>
        )}
      </Card>
    </Screen>
  );
}
