import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
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
  useWindowDimensions,
  View,
} from "react-native";
import { TRANSACTION_ACCOUNT_OPTIONS, TransactionAccountId } from "../lib/banks";
import { Category } from "../lib/categories";
import { ymd } from "../lib/date";
import { formatBRLFromCents, formatBRLInputFromDigits, formatDateBRFromYMD, parseBRLToCents } from "../lib/format";
import {
  deleteManualTransaction,
  ignoreImportedTransaction,
  TxRow,
  TxType,
  updateImportedTransaction,
  updateManualTransaction,
} from "../lib/transactions";
import { useKeyboardAwareScroll } from "../hooks/useKeyboardAwareScroll";
import { BankLogo } from "./BankLogo";
import { OB } from "./OnboardingKit";

type Field = "amount" | "note";

type Props = {
  visible: boolean;
  transaction: TxRow | null;
  categories: Category[];
  householdId: string;
  userId: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

function dateFromYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12);
}

export function TransactionEditorModal({ visible, transaction, categories, householdId, userId, onClose, onChanged }: Props) {
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<Field>();
  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(ymd(new Date()));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<TransactionAccountId | null>(null);
  const [note, setNote] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const imported = Boolean(transaction?.statement_import_id);
  const availableCategories = useMemo(() => categories.filter((category) => category.flow === type), [categories, type]);

  useEffect(() => {
    if (!transaction || !visible) return;
    setType(transaction.type);
    setAmount(formatBRLFromCents(transaction.amount_cents));
    setOccurredOn(transaction.occurred_on);
    setCategoryId(transaction.category_id);
    setAccountId(transaction.account_id);
    setNote(transaction.note ?? "");
    setShowDatePicker(false);
    setSaving(false);
    setError("");
  }, [transaction, visible]);

  function changeType(nextType: TxType) {
    setType(nextType);
    if (!categories.some((category) => category.id === categoryId && category.flow === nextType)) setCategoryId(null);
  }

  function changeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowDatePicker(false);
    if (event.type === "set" && date) setOccurredOn(ymd(date));
  }

  async function save() {
    if (!transaction || saving) return;
    const amountCents = parseBRLToCents(amount);
    if (!imported && amountCents <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      if (imported) {
        await updateImportedTransaction({
          householdId,
          transactionId: transaction.id,
          category_id: categoryId,
          account_id: accountId,
          note,
        });
      } else {
        if (!accountId) {
          setError("Selecione a conta usada no lançamento.");
          return;
        }
        await updateManualTransaction({
          householdId,
          transactionId: transaction.id,
          type,
          amount_cents: amountCents,
          category_id: categoryId,
          account_id: accountId,
          note,
          occurred_on: occurredOn,
        });
      }
      await onChanged();
      onClose();
    } catch (saveError: any) {
      setError(saveError?.message ?? "Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  }

  function confirmRemove() {
    if (!transaction || saving) return;
    Alert.alert(
      imported ? "Ignorar movimentação?" : "Excluir lançamento?",
      imported
        ? "Ela deixará de aparecer nos totais e nas movimentações, mas continuará protegida contra duplicidade numa nova importação."
        : "Esta ação remove o lançamento manual definitivamente.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: imported ? "Ignorar" : "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              setSaving(true);
              setError("");
              if (imported) {
                await ignoreImportedTransaction({ householdId, transactionId: transaction.id, userId });
              } else {
                await deleteManualTransaction(householdId, transaction.id);
              }
              await onChanged();
              onClose();
            } catch (removeError: any) {
              setError(removeError?.message ?? "Não foi possível concluir a ação.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.header, compact && styles.headerCompact]}>
          <View style={styles.headerActionSlot} pointerEvents="none" />
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{imported ? "Importado por CSV" : "Lançamento manual"}</Text>
            <Text
              style={[styles.title, compact && styles.titleCompact]}
              accessibilityRole="header"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {imported ? "Ajustar movimentação" : "Editar lançamento"}
            </Text>
          </View>
          <Pressable onPress={onClose} disabled={saving} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Fechar" accessibilityState={{ disabled: saving }}>
            <Ionicons name="close" size={22} color={OB.primary} />
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: 36 + keyboardInset }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          onScrollBeginDrag={cancelPendingScroll}
          showsVerticalScrollIndicator={false}
        >
          {imported ? (
            <View style={styles.readOnlyCard}>
              <View><Text style={styles.readOnlyLabel}>Valor original</Text><Text style={styles.readOnlyValue}>{formatBRLFromCents(transaction?.amount_cents ?? 0)}</Text></View>
              <View><Text style={styles.readOnlyLabel}>Data</Text><Text style={styles.readOnlyValue}>{formatDateBRFromYMD(occurredOn)}</Text></View>
            </View>
          ) : (
            <>
              <Text style={styles.label}>Tipo</Text>
              <View style={styles.segmentRow}>
                {([{"id":"income","label":"Receita","icon":"arrow-down"},{"id":"expense","label":"Despesa","icon":"arrow-up"}] as const).map((option) => (
                  <Pressable key={option.id} onPress={() => changeType(option.id)} style={[styles.segment, type === option.id && styles.segmentActive]}>
                    <Ionicons name={option.icon} size={16} color={type === option.id ? "#fff" : OB.support} />
                    <Text style={[styles.segmentText, type === option.id && styles.segmentTextActive]}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View onLayout={registerField("amount")}>
                <Text style={styles.label}>Valor</Text>
                <TextInput
                  value={amount}
                  onChangeText={(value) => setAmount(formatBRLInputFromDigits(value))}
                  onFocus={() => focusField("amount")}
                  onPressIn={() => focusField("amount")}
                  keyboardType="number-pad"
                  placeholder="R$ 0,00"
                  placeholderTextColor={OB.support}
                  selectTextOnFocus
                  style={styles.input}
                />
              </View>

              <Text style={styles.label}>Data</Text>
              <Pressable onPress={() => setShowDatePicker(true)} style={styles.inputButton}>
                <Text style={styles.inputButtonText}>{formatDateBRFromYMD(occurredOn)}</Text>
                <Ionicons name="calendar-outline" size={19} color={OB.support} />
              </Pressable>
              {showDatePicker ? <DateTimePicker value={dateFromYmd(occurredOn)} mode="date" onChange={changeDate} /> : null}
            </>
          )}

          <Text style={styles.label}>Categoria</Text>
          <View style={styles.chipWrap}>
            <Pressable onPress={() => setCategoryId(null)} style={[styles.chip, !categoryId && styles.chipActive]}><Text style={[styles.chipText, !categoryId && styles.chipTextActive]}>Sem categoria</Text></Pressable>
            {availableCategories.map((category) => (
              <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.chip, categoryId === category.id && styles.chipActive]}>
                <Text style={[styles.chipText, categoryId === category.id && styles.chipTextActive]}>{category.name}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Conta</Text>
          <View style={styles.chipWrap}>
            {imported ? <Pressable onPress={() => setAccountId(null)} style={[styles.chip, !accountId && styles.chipActive]}><Text style={[styles.chipText, !accountId && styles.chipTextActive]}>Não informada</Text></Pressable> : null}
            {TRANSACTION_ACCOUNT_OPTIONS.map((account) => {
              const active = accountId === account.id;
              return (
                <Pressable
                  key={account.id}
                  onPress={() => setAccountId(account.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Conta ${account.name}`}
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, styles.accountChip, active && styles.chipActive]}
                >
                  <BankLogo bankId={account.id} size={24} color={account.color} shortName={account.shortName} />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{account.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <View onLayout={registerField("note")}>
            <Text style={styles.label}>Descrição</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              onFocus={() => focusField("note")}
              onPressIn={() => focusField("note")}
              multiline
              maxLength={240}
              placeholder="Ex.: mercado da semana"
              placeholderTextColor={OB.support}
              style={[styles.input, styles.noteInput]}
            />
          </View>

          {imported ? <Text style={styles.helper}>O valor e a data do extrato ficam preservados. Categoria, conta e descrição podem ser ajustadas.</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable onPress={() => void save()} disabled={saving} style={[styles.saveButton, saving && styles.disabled]}>
            {saving ? <ActivityIndicator color="#fff" /> : <><Ionicons name="save-outline" size={19} color="#fff" /><Text style={styles.saveText}>Salvar alterações</Text></>}
          </Pressable>
          <Pressable onPress={confirmRemove} disabled={saving} style={styles.removeButton}>
            <Ionicons name={imported ? "eye-off-outline" : "trash-outline"} size={18} color="#C63F3F" />
            <Text style={styles.removeText}>{imported ? "Ignorar esta movimentação" : "Excluir lançamento"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OB.offWhite },
  header: { paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? 22 : 16, paddingBottom: 15, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: OB.supportSoft, backgroundColor: "#fff" },
  headerCompact: { paddingHorizontal: 12 },
  headerActionSlot: { width: 44, height: 44 },
  headerCopy: { flex: 1, minWidth: 0, alignItems: "center" },
  eyebrow: { color: OB.support, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase", textAlign: "center" },
  title: { color: OB.primary, fontSize: 22, fontWeight: "900", marginTop: 4, textAlign: "center" },
  titleCompact: { fontSize: 19 },
  closeButton: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: OB.offWhite },
  content: { padding: 20, paddingBottom: 36 },
  readOnlyCard: { padding: 16, borderRadius: 18, flexDirection: "row", justifyContent: "space-between", backgroundColor: "rgba(55,110,165,0.10)", borderWidth: 1, borderColor: "rgba(55,110,165,0.18)", marginBottom: 18 },
  readOnlyLabel: { color: OB.support, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  readOnlyValue: { color: OB.primary, fontSize: 15, fontWeight: "900", marginTop: 5 },
  label: { color: OB.primary, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6, marginTop: 16 },
  segmentRow: { flexDirection: "row", gap: 8 },
  segment: { flex: 1, minHeight: 48, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  segmentActive: { backgroundColor: OB.primary, borderColor: OB.primary },
  segmentText: { color: OB.support, fontSize: 12, fontWeight: "900" },
  segmentTextActive: { color: "#fff" },
  input: { minHeight: 54, borderRadius: 16, paddingHorizontal: 15, color: OB.primary, fontSize: 15, fontWeight: "800", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  inputButton: { minHeight: 54, borderRadius: 16, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  inputButtonText: { color: OB.primary, fontSize: 14, fontWeight: "800" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, borderRadius: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  accountChip: { minHeight: 42, paddingLeft: 7, paddingRight: 11, flexDirection: "row", gap: 7 },
  chipActive: { backgroundColor: OB.primary, borderColor: OB.primary },
  chipText: { color: OB.support, fontSize: 10, fontWeight: "800" },
  chipTextActive: { color: "#fff", fontWeight: "900" },
  noteInput: { minHeight: 92, paddingTop: 14, paddingBottom: 14, textAlignVertical: "top" },
  helper: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 16, marginTop: 12 },
  error: { color: "#C63F3F", fontSize: 11, fontWeight: "800", lineHeight: 16, marginTop: 12 },
  saveButton: { minHeight: 54, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: OB.primary, marginTop: 22 },
  saveText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  removeButton: { minHeight: 48, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 10 },
  removeText: { color: "#C63F3F", fontSize: 11, fontWeight: "900" },
});
