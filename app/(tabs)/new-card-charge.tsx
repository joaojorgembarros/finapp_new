// app/(tabs)/new-card-charge.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, Text, TextInput, View, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { formatBRLFromCents, parseBRLToCents, formatDateBRFromYMD } from "../../src/lib/format";
import { ymd } from "../../src/lib/date";
import { listCards, PaymentMethod } from "../../src/lib/cards";
import { addCardChargeAndInstallments } from "../../src/lib/cardCharges";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

// aceita ponto e converte pra vírgula (pt-BR), no máximo 2 casas
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

export default function NewCardCharge() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);
  const params = useLocalSearchParams();

  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cards, setCardsState] = useState<PaymentMethod[]>([]);
  const [cardId, setCardId] = useState<string>("");

  const [showCardPicker, setShowCardPicker] = useState(false);

  const [desc, setDesc] = useState("");
  const [value, setValue] = useState("");
  const [installments, setInstallments] = useState("1");

  // ✅ data com calendário
  const [date, setDate] = useState<Date>(new Date());
  const [iosPickerOpen, setIosPickerOpen] = useState(false);

  const purchasedOn = useMemo(() => ymd(date), [date]);
  const preview = useMemo(() => parseBRLToCents(value), [value]);

  const nInstallments = useMemo(() => {
    const n = Number(installments || "1");
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(60, Math.floor(n)));
  }, [installments]);

  const perInstallment = useMemo(() => {
    const total = Math.max(0, preview);
    const n = Math.max(1, nInstallments);
    return Math.floor(total / n);
  }, [preview, nInstallments]);

  const card = useMemo(() => cards.find((c) => c.id === cardId) ?? null, [cards, cardId]);

  function goBackSafe() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/cards");
  }

  function openDatePicker() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: date,
        mode: "date",
        onChange: (_, selected) => {
          if (selected) setDate(selected);
        },
      });
    } else {
      setIosPickerOpen(true);
    }
  }

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      setBusy(true);

      const cs = await listCards(householdId);
      setCardsState(cs);

      const paramCardIdRaw = params?.cardId;
      const paramCardId =
        typeof paramCardIdRaw === "string"
          ? paramCardIdRaw
          : Array.isArray(paramCardIdRaw)
          ? paramCardIdRaw[0]
          : "";

      if (cs.length) {
        const exists = paramCardId && cs.some((c) => c.id === paramCardId);
        setCardId(exists ? paramCardId : cs[0].id);
      } else {
        setCardId("");
      }
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar cartões.");
    } finally {
      setBusy(false);
    }
  }, [householdId, params?.cardId]);

  useEffect(() => {
    if (!hhLoading && householdId) load();
  }, [hhLoading, householdId, load]);

  async function onSave() {
    if (!userId || !householdId) return;
    if (saving) return;

    if (!cardId) return Alert.alert("Atenção", "Selecione um cartão.");
    const cents = parseBRLToCents(value);
    if (cents <= 0) return Alert.alert("Atenção", "Digite um valor válido.");

    try {
      setSaving(true);

      await addCardChargeAndInstallments({
        householdId,
        userId,
        cardId,
        purchased_on: purchasedOn,
        description: desc?.trim() ? desc.trim() : null,
        total_cents: cents,
        installments_total: nInstallments,
        due_day: card?.due_day ?? null, // continua usando internamente
      });

      goBackSafe();
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar compra.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      {/* iOS DatePicker modal */}
      {Platform.OS === "ios" && (
        <Modal visible={iosPickerOpen} transparent animationType="fade" onRequestClose={() => setIosPickerOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <View style={styles.iosSheet}>
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Escolher data</Text>
                <Pressable onPress={() => setIosPickerOpen(false)} style={{ padding: 10 }}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>OK</Text>
                </Pressable>
              </Row>

              <DateTimePicker
                value={date}
                mode="date"
                display="spinner"
                onChange={(_, selected) => {
                  if (selected) setDate(selected);
                }}
                style={{ marginTop: 8 }}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* header simples */}
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Pressable onPress={goBackSafe} style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
          <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>Voltar</Text>
        </Pressable>
        <Text style={{ color: theme.colors.muted, fontWeight: "900" }}>Cartão</Text>
        <View style={{ width: 54 }} />
      </Row>

      {/* ✅ nome novo */}
      <H1>Compra no cartão</H1>
      <P muted>Registre a compra e gere as parcelas futuras.</P>

      <View style={{ height: 14 }} />

      {/* ✅ fica só 1 Card (removi o “card dentro do card”) */}
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
            <Button title="Voltar" onPress={goBackSafe} />
          </>
        ) : (
          <View>
            {/* Cartão */}
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Text style={ui.label}>Cartão</Text>
              <Pressable onPress={() => setShowCardPicker((v) => !v)} style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
                <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>
                  {showCardPicker ? "Fechar" : "Trocar"}
                </Text>
              </Pressable>
            </Row>

            <View style={{ height: 10 }} />

            {/* ✅ só nome (sem “Vence dia …” junto) */}
            <Text style={ui.titleLine} numberOfLines={1}>
              {card?.name ?? "Selecione um cartão"}
            </Text>

            {showCardPicker ? (
              <View style={{ marginTop: 12 }}>
                <View style={ui.hrSoft} />
                <View style={{ height: 10 }} />

                {cards.map((c) => {
                  const active = c.id === cardId;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        setCardId(c.id);
                        setShowCardPicker(false);
                      }}
                      style={[
                        ui.pickRow,
                        active && { borderColor: "rgba(0,240,255,0.35)", backgroundColor: "rgba(0,240,255,0.08)" },
                      ]}
                    >
                      <Text style={{ color: active ? theme.colors.primary : theme.colors.text, fontWeight: "900" }} numberOfLines={1}>
                        {active ? `✓ ${c.name}` : c.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={ui.hr} />

            {/* Valor */}
            <Text style={ui.label}>Valor total</Text>
            <View style={{ height: 12 }} />
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

            <Text style={ui.hint}>
              Prévia: {formatBRLFromCents(preview)} • {nInstallments}x de {formatBRLFromCents(perInstallment)}
            </Text>

            <View style={ui.hr} />

            {/* Parcelas */}
            <Text style={ui.label}>Parcelas</Text>
            <View style={{ height: 12 }} />
            <TextInput
              value={installments}
              onChangeText={(t) => setInstallments(t.replace(/\D/g, ""))}
              placeholder="1"
              placeholderTextColor={"rgba(231,234,243,0.40)"}
              keyboardType="numeric"
              style={ui.inputLine}
            />
            <Text style={ui.hint}>Máx. 60 parcelas</Text>

            <View style={ui.hr} />

            {/* Data */}
            <Text style={ui.label}>Data da compra</Text>
            <View style={{ height: 12 }} />
            <Pressable onPress={openDatePicker} style={ui.dateRow}>
              <Row style={{ gap: 10, alignItems: "center" }}>
                <Ionicons name="calendar-outline" size={18} color={theme.colors.text} />
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{formatDateBRFromYMD(purchasedOn)}</Text>
              </Row>
              <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Alterar</Text>
            </Pressable>

            <View style={ui.hr} />

            {/* Descrição */}
            <Text style={ui.label}>Descrição (opcional)</Text>
            <View style={{ height: 12 }} />
            <TextInput
              value={desc}
              onChangeText={setDesc}
              placeholder="Ex: Notebook, Mercado, Celular..."
              placeholderTextColor={"rgba(231,234,243,0.40)"}
              style={ui.inputLine}
            />

            <View style={{ height: 18 }} />

            <Row style={{ gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title={saving ? "Salvando..." : "Salvar compra"} onPress={onSave} disabled={saving} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Cancelar" onPress={goBackSafe} disabled={saving} />
              </View>
            </Row>
          </View>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iosSheet: {
    backgroundColor: theme.colors.bg1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
});

const ui = StyleSheet.create({
  label: { color: "rgba(231,234,243,0.85)", fontWeight: "900", fontSize: 13 },

  titleLine: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },

  hr: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 18, marginBottom: 18 },
  hrSoft: { height: 1, backgroundColor: "rgba(255,255,255,0.08)" },

  currency: { color: "rgba(231,234,243,0.55)", fontWeight: "900", fontSize: 18, marginBottom: 4 },
  bigValue: {
    flex: 1,
    height: 44,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 28,
    paddingVertical: 0,
  },

  hint: { color: theme.colors.muted, fontWeight: "800", marginTop: 10 },

  inputLine: {
    height: 44,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 16,
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },

  dateRow: {
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  pickRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.02)",
    marginBottom: 10,
  },
});