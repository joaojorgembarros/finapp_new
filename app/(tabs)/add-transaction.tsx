// app/(tabs)/add-transaction.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from "react-native";
import { router } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";

import Screen from "../../src/ui/Screen";
import { supabase } from "../../src/lib/supabase";
import { getMyHouseholdId } from "../../src/lib/household";
import { ymd } from "../../src/lib/date";
import { theme } from "../../src/ui/theme";
import { formatBRLFromCents } from "../../src/lib/format";
import { emitTxChanged } from "../../src/lib/bus";

type TxType = "income" | "expense";

type CategoryRow = {
  id: string;
  name: string;
  type?: string | null;
};

function normalizeTxType(v: any): TxType | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();

  if (s === "income" || s === "entrada" || s === "in" || s === "receita") return "income";
  if (s === "expense" || s === "saida" || s === "saída" || s === "out" || s === "despesa")
    return "expense";

  return null;
}

// Máscara fixa: digita números => centavos
function textToCentsMasked(text: string): number {
  const digits = (text ?? "").replace(/\D/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10);
}

function brlNoSymbolFromCents(cents: number) {
  return formatBRLFromCents(cents).replace(/^R\$\s*/u, "");
}

function formatDateBR(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function AddTransaction() {
  const [type, setType] = useState<TxType>("expense");
  const [amountCents, setAmountCents] = useState<number>(0);

  const [note, setNote] = useState("");
  const [date, setDate] = useState<Date>(new Date());

  const [busy, setBusy] = useState(false);
  const [householdId, setHouseholdId] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [catModalOpen, setCatModalOpen] = useState(false);

  const [showDatePicker, setShowDatePicker] = useState(false);

  const amountText = useMemo(() => brlNoSymbolFromCents(amountCents), [amountCents]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId]
  );

  const filteredCategories = useMemo(() => {
    const hasTyped = categories.some((c) => normalizeTxType(c.type) !== null);
    if (!hasTyped) return categories;
    return categories.filter((c) => normalizeTxType(c.type) === type);
  }, [categories, type]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const hid = await getMyHouseholdId().catch(() => null);
      if (!alive) return;
      setHouseholdId(hid);

      if (!hid) return;

      const res = await supabase
        .from("categories")
        .select("id,name,type")
        .eq("household_id", hid)
        .order("name", { ascending: true });

      if (!alive) return;

      if (res.error) {
        console.log("[categories] error:", res.error);
        Alert.alert("Erro", "Não consegui carregar as categorias.");
        setCategories([]);
        return;
      }

      setCategories((res.data as any) ?? []);
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setCategoryId(null);
  }, [type]);

  function goBackToMain() {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace("/(tabs)/home");
  }

  async function onSubmit() {
    if (busy) return;

    if (!amountCents || amountCents <= 0) {
      return Alert.alert("Atenção", "Digite um valor maior que zero.");
    }

    if (!householdId) {
      return Alert.alert("Atenção", "Não encontrei seu household. Volte para a Home e tente novamente.");
    }

    try {
      setBusy(true);

      const userRes = await supabase.auth.getUser();
      const uid = userRes.data.user?.id ?? null;

      const payload: any = {
        household_id: householdId,
        type,
        amount_cents: amountCents,
        note: note.trim() ? note.trim() : null,
        category_id: categoryId,
        occurred_on: ymd(date),
      };

      if (uid) payload.created_by = uid;

      const ins = await supabase.from("transactions").insert(payload);
      if (ins.error) throw ins.error;

      emitTxChanged({ householdId });

      setAmountCents(0);
      setNote("");
      setCategoryId(null);

      if (Platform.OS === "android") {
        ToastAndroid.show("Lançamento concluído ✅", ToastAndroid.SHORT);
        goBackToMain();
      } else {
        Alert.alert("Lançamento concluído ✅", "Transação lançada com sucesso.", [
          { text: "OK", onPress: goBackToMain },
        ]);
      }
    } catch (e: any) {
      Alert.alert("Erro ao lançar", e?.message ?? "Não foi possível lançar a transação.");
    } finally {
      setBusy(false);
    }
  }

  const primary = theme?.colors?.primary ?? "#00f0ff";
  const card = theme?.colors?.card ?? "rgba(255,255,255,0.06)";
  const border = theme?.colors?.border ?? "rgba(255,255,255,0.10)";
  const text = theme?.colors?.text ?? "#e7eaf3";
  const muted = theme?.colors?.muted ?? "rgba(231,234,243,.72)";
  const bg1 = theme?.colors?.bg1 ?? "#0b1122";

  return (
    <Screen title="Lançar">
      {/* No Android, com softwareKeyboardLayoutMode: "resize", não precisa forçar behavior */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          nestedScrollEnabled
        >
          {/* Tipo */}
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.label, { color: muted }]}>Tipo</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable
                disabled={busy}
                onPress={() => setType("expense")}
                style={[
                  styles.chip,
                  { borderColor: type === "expense" ? primary : border, opacity: busy ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.chipText, { color: text }]}>Saída</Text>
              </Pressable>

              <Pressable
                disabled={busy}
                onPress={() => setType("income")}
                style={[
                  styles.chip,
                  { borderColor: type === "income" ? primary : border, opacity: busy ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.chipText, { color: text }]}>Entrada</Text>
              </Pressable>
            </View>
          </View>

          {/* Valor */}
          <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: 12 }]}>
            <Text style={[styles.label, { color: muted }]}>Valor (R$)</Text>

            <TextInput
              editable={!busy}
              value={amountText}
              onChangeText={(t) => setAmountCents(textToCentsMasked(t))}
              keyboardType={Platform.OS === "ios" ? "number-pad" : "numeric"}
              style={[styles.input, { color: text, borderColor: border, opacity: busy ? 0.7 : 1 }]}
              selection={{ start: amountText.length, end: amountText.length }}
            />

            <Text style={{ color: muted, marginTop: 8, fontSize: 12 }}>
              Dica: digite só números (ex: 1 → 0,01 | 1234 → 12,34).
            </Text>
          </View>

          {/* Categoria */}
          <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: 12 }]}>
            <Text style={[styles.label, { color: muted }]}>Categoria (opcional)</Text>
            <Pressable
              disabled={busy}
              onPress={() => setCatModalOpen(true)}
              style={[styles.picker, { borderColor: border, opacity: busy ? 0.7 : 1 }]}
            >
              <Text style={{ color: selectedCategory ? text : muted }}>
                {selectedCategory ? selectedCategory.name : "Selecionar categoria"}
              </Text>
            </Pressable>
          </View>

          {/* Data */}
          <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: 12 }]}>
            <Text style={[styles.label, { color: muted }]}>Data</Text>
            <Pressable
              disabled={busy}
              onPress={() => setShowDatePicker(true)}
              style={[styles.picker, { borderColor: border, opacity: busy ? 0.7 : 1 }]}
            >
              <Text style={{ color: text }}>{formatDateBR(date)}</Text>
            </Pressable>

            {showDatePicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, selected) => {
                  if (Platform.OS !== "ios") setShowDatePicker(false);
                  if (selected) setDate(selected);
                }}
              />
            )}

            {Platform.OS === "ios" && showDatePicker && (
              <Pressable onPress={() => setShowDatePicker(false)} style={[styles.smallBtn, { borderColor: border }]}>
                <Text style={{ color: text }}>Concluir</Text>
              </Pressable>
            )}
          </View>

          {/* Observação */}
          <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: 12 }]}>
            <Text style={[styles.label, { color: muted }]}>Observação (opcional)</Text>
            <TextInput
              editable={!busy}
              value={note}
              onChangeText={setNote}
              placeholder="Ex: Mercado / Salário / Uber…"
              placeholderTextColor={muted}
              style={[styles.input, { color: text, borderColor: border, opacity: busy ? 0.7 : 1 }]}
              returnKeyType="done"
            />
          </View>

          {/* Botão */}
          <Pressable
            onPress={onSubmit}
            disabled={busy}
            style={[styles.submit, { backgroundColor: primary, opacity: busy ? 0.75 : 1 }]}
          >
            {busy ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator />
                <Text style={styles.submitText}>Lançando…</Text>
              </View>
            ) : (
              <Text style={styles.submitText}>Lançar</Text>
            )}
          </Pressable>
        </ScrollView>

        {/* Modal categorias */}
        <Modal visible={catModalOpen} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { backgroundColor: bg1 }]}>
              <Text style={[styles.modalTitle, { color: text }]}>
                Categorias ({type === "expense" ? "Saída" : "Entrada"})
              </Text>

              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 10 }} nestedScrollEnabled>
                <Pressable
                  onPress={() => {
                    setCategoryId(null);
                    setCatModalOpen(false);
                  }}
                  style={[styles.modalItem, { borderColor: border }]}
                >
                  <Text style={{ color: muted }}>Sem categoria</Text>
                </Pressable>

                {filteredCategories.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setCategoryId(c.id);
                      setCatModalOpen(false);
                    }}
                    style={[styles.modalItem, { borderColor: border }]}
                  >
                    <Text style={{ color: text }}>{c.name}</Text>
                  </Pressable>
                ))}

                {!filteredCategories.length && (
                  <Text style={{ color: muted, marginTop: 10 }}>Nenhuma categoria encontrada para este tipo.</Text>
                )}
              </ScrollView>

              <Pressable
                onPress={() => setCatModalOpen(false)}
                style={[styles.smallBtn, { borderColor: border, alignSelf: "flex-end" }]}
              >
                <Text style={{ color: text }}>Fechar</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },
  chip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontSize: 14, fontWeight: "800" },
  input: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: "800",
  },
  picker: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  submit: {
    marginTop: 16,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { fontSize: 16, fontWeight: "900", color: "#041016" },
  smallBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 16,
    justifyContent: "flex-end",
  },
  modalCard: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  modalTitle: { fontSize: 16, fontWeight: "900", marginBottom: 10 },
  modalItem: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
});