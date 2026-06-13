// app/(tabs)/add-transaction.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View, Platform, Modal } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { listCategories, Category, Flow, Kind } from "../../src/lib/categories";
import { addTransaction, TxType } from "../../src/lib/transactions";
import { parseBRLToCents, formatBRLFromCents, formatDateBRFromYMD, formatBRLInputFromDigits } from "../../src/lib/format";
import { emitTxChanged } from "../../src/lib/bus";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { ymd } from "../../src/lib/date";

// ✅ aceita ponto no teclado e converte pra vírgula (pt-BR)
// ✅ mantém só 1 separador e no máximo 2 casas decimais
export default function AddTransaction() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);

  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("variable"); // para despesa
  const [busy, setBusy] = useState(false);

  // ✅ Data do lançamento (default: hoje)
  const [date, setDate] = useState<Date>(new Date());
  const [iosPickerOpen, setIosPickerOpen] = useState(false);

  const occurredOn = useMemo(() => ymd(date), [date]);

  const flow: Flow = type === "income" ? "income" : "expense";

  function goBackSafe() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
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

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!householdId) return;
      const list = await listCategories(householdId, flow);
      if (alive) {
        setCats(list);
        setSelectedCat(null);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [householdId, flow]);

  const cents = useMemo(() => parseBRLToCents(amount), [amount]);

  const visibleCats = useMemo(() => {
    if (flow === "income") return cats;
    return cats.filter((c) => c.kind === kind);
  }, [cats, flow, kind]);

  async function onSave() {
    if (!userId || !householdId) return;
    if (busy) return;

    if (cents <= 0) return Alert.alert("Atenção", "Informe um valor.");

    try {
      setBusy(true);

      await addTransaction({
        householdId,
        userId,
        type,
        amount_cents: cents,
        category_id: selectedCat,
        note: note.trim() ? note.trim() : undefined,
        occurred_on: occurredOn, // ✅ AQUI
      });

      emitTxChanged({ householdId });

      goBackSafe();
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {/* iOS DatePicker modal */}
      {Platform.OS === "ios" && (
        <Modal
          visible={iosPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIosPickerOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <View
              style={{
                backgroundColor: theme.colors.bg1,
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                padding: 16,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
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

      <AppHeader title="Adicionar" subtitle="Lance entradas e saídas com clareza" />

      <Card>
        <Label>Tipo</Label>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {(["expense", "income"] as TxType[]).map((t) => {
            const active = type === t;
            return (
              <Pressable
                key={t}
                onPress={() => setType(t)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: active ? theme.colors.primary : theme.colors.text, fontWeight: "900" }}>
                  {t === "expense" ? "Saída" : "Entrada"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 10 }} />
        <Label>Valor (R$)</Label>
        <Input
          value={amount}
          onChangeText={(t) => setAmount(formatBRLInputFromDigits(t))}
          placeholder="Ex: 35,90"
          keyboardType="number-pad"
        />
        <P muted>Prévia: {formatBRLFromCents(cents)}</P>

        <View style={{ height: 10 }} />
        <Label>Data do lançamento</Label>
        <Pressable
          onPress={openDatePicker}
          style={{
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: "rgba(255,255,255,0.72)",
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
            {formatDateBRFromYMD(occurredOn)}
          </Text>
          <Text style={{ color: theme.colors.muted, fontWeight: "700", marginTop: 2 }}>
            Toque para alterar
          </Text>
        </Pressable>

        <View style={{ height: 10 }} />
        <Label>Descrição (opcional)</Label>
        <Input value={note} onChangeText={setNote} placeholder="Ex: almoço, gasolina..." />
      </Card>

      {flow === "expense" && (
        <Card intensity={18}>
          <Label>Categoria de despesa</Label>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
            {(["fixed", "variable"] as Kind[]).map((k) => {
              const active = kind === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: active ? theme.colors.primary : theme.colors.text, fontWeight: "900" }}>
                    {k === "fixed" ? "Fixa" : "Variável"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <P muted style={{ marginTop: 8 }}>
            Fixa = costuma repetir todo mês. Variável = oscila.
          </P>
        </Card>
      )}

      <Card>
        <Label>Categoria</Label>
        <P muted>{flow === "income" ? "Entrada" : `Despesa ${kind === "fixed" ? "fixa" : "variável"}`}</P>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <Pressable
            onPress={() => setSelectedCat(null)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: selectedCat === null ? theme.colors.primary : theme.colors.border,
              backgroundColor: selectedCat === null ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
            }}
          >
            <Text style={{ color: selectedCat === null ? theme.colors.primary : theme.colors.text, fontWeight: "900" }}>
              Sem categoria
            </Text>
          </Pressable>

          {visibleCats.slice(0, 18).map((c) => {
            const active = selectedCat === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setSelectedCat(c.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
                }}
              >
                <Text style={{ color: active ? theme.colors.primary : theme.colors.text, fontWeight: "900" }}>
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 12 }} />
        <Button title={busy ? "Salvando..." : "Salvar"} onPress={onSave} disabled={busy} />
      </Card>
    </Screen>
  );
}
