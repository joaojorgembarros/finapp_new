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
import { TRANSACTION_ACCOUNT_OPTIONS, TransactionAccountId, findTransactionAccountById } from "../lib/banks";
import { Category } from "../lib/categories";
import { ymd } from "../lib/date";
import { formatBRLFromCents, formatBRLInputFromDigits, formatDateBRFromYMD, parseBRLToCents } from "../lib/format";
import {
  findInternalTransferCounterparts,
  isInternalTransferLeg,
} from "../lib/internalTransfers";
import {
  linkInternalTransfer,
  unlinkInternalTransfer,
} from "../lib/internalTransferPersistence";
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
  transactions?: TxRow[];
  paymentTransactionIds?: Iterable<string>;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

function dateFromYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12);
}

export function TransactionEditorModal({
  visible,
  transaction,
  categories,
  householdId,
  userId,
  transactions = [],
  paymentTransactionIds = [],
  onClose,
  onChanged,
}: Props) {
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
  const [pickingCounterpart, setPickingCounterpart] = useState(false);

  const imported = Boolean(transaction?.statement_import_id);
  const linkedTransfer = isInternalTransferLeg(transaction ?? {});
  const availableCategories = useMemo(() => categories.filter((category) => category.flow === type), [categories, type]);
  const counterparts = useMemo(() => {
    if (!transaction) return [];
    return findInternalTransferCounterparts(transaction, transactions, paymentTransactionIds);
  }, [paymentTransactionIds, transaction, transactions]);

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
    setPickingCounterpart(false);
  }, [transaction, visible]);

  function changeType(nextType: TxType) {
    setType(nextType);
    if (!categories.some((category) => category.id === categoryId && category.flow === nextType)) setCategoryId(null);
  }

  function changeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowDatePicker(false);
    if (event.type === "set" && date) setOccurredOn(ymd(date));
  }

  async function confirmLink(counterpart: { id: string }) {
    if (!transaction || saving) return;
    try {
      setSaving(true);
      setError("");
      await linkInternalTransfer({
        householdId,
        transactionId: transaction.id,
        counterpartId: counterpart.id,
      });
      await onChanged();
      onClose();
    } catch (linkError: any) {
      setError(linkError?.message ?? "Não foi possível vincular essas movimentações.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmUnlink(afterUnlink?: () => Promise<void>) {
    if (!transaction || saving) return;
    try {
      setSaving(true);
      setError("");
      await unlinkInternalTransfer({
        householdId,
        transactionId: transaction.id,
      });
      if (afterUnlink) await afterUnlink();
      await onChanged();
      onClose();
    } catch (unlinkError: any) {
      setError(unlinkError?.message ?? "Não foi possível desfazer a transferência.");
    } finally {
      setSaving(false);
    }
  }

  function askUnlink() {
    if (!transaction || saving) return;
    Alert.alert(
      "Desfazer transferência?",
      "As duas movimentações serão mantidas e voltarão a ser consideradas normalmente nos seus totais.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Desfazer transferência", onPress: () => { void confirmUnlink(); } },
      ],
    );
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
          account_id: linkedTransfer ? transaction.account_id : accountId,
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
          type: linkedTransfer ? transaction.type : type,
          amount_cents: linkedTransfer ? transaction.amount_cents : amountCents,
          category_id: categoryId,
          account_id: linkedTransfer ? transaction.account_id ?? accountId : accountId,
          note,
          occurred_on: linkedTransfer ? transaction.occurred_on : occurredOn,
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
    if (linkedTransfer) {
      Alert.alert(
        "Desfazer vínculo primeiro",
        imported
          ? "Esta movimentação faz parte de uma transferência entre as suas contas. Desfaça o vínculo para ignorá-la. A contraparte será mantida."
          : "Este lançamento faz parte de uma transferência entre as suas contas. Desfaça o vínculo para excluí-lo. A contraparte será mantida.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Só desfazer o vínculo", onPress: () => { void confirmUnlink(); } },
          {
            text: imported ? "Desfazer vínculo e ignorar" : "Desfazer vínculo e excluir",
            style: "destructive",
            onPress: () => {
              void confirmUnlink(async () => {
                if (imported) {
                  await ignoreImportedTransaction({ householdId, transactionId: transaction.id, userId });
                } else {
                  await deleteManualTransaction(householdId, transaction.id);
                }
              });
            },
          },
        ],
      );
      return;
    }
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
              {pickingCounterpart ? "Escolher contraparte" : imported ? "Ajustar movimentação" : "Editar lançamento"}
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
          {pickingCounterpart ? (
            <>
              <Text style={styles.helper}>
                Escolha a movimentação correspondente, com o mesmo valor, tipo oposto e outra conta.
              </Text>
              {counterparts.length ? counterparts.map((counterpart) => {
                const counterpartAccount = findTransactionAccountById(counterpart.account_id);
                return (
                  <Pressable
                    key={counterpart.id}
                    onPress={() => void confirmLink(counterpart)}
                    disabled={saving}
                    style={({ pressed }) => [styles.counterpartCard, pressed && styles.transactionCardPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Vincular com ${counterpart.note?.trim() || counterpart.category?.name || "movimentação"}`}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.counterpartTitle} numberOfLines={1}>
                        {counterpart.note?.trim() || counterpart.category?.name || "Movimentação"}
                      </Text>
                      <Text style={styles.counterpartMeta}>
                        {counterpartAccount?.name ?? "Conta não informada"} · {formatDateBRFromYMD(counterpart.occurred_on ?? "")}
                      </Text>
                    </View>
                    <Text style={[styles.counterpartAmount, { color: counterpart.type === "income" ? "#169B62" : "#D84C4C" }]}>
                      {counterpart.type === "income" ? "+" : "-"}{formatBRLFromCents(counterpart.amount_cents)}
                    </Text>
                  </Pressable>
                );
              }) : (
                <Text style={styles.helper}>Não encontrei uma contraparte válida com o mesmo valor em outra conta.</Text>
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable onPress={() => setPickingCounterpart(false)} disabled={saving} style={styles.removeButton}>
                <Text style={styles.cancelPickText}>Voltar</Text>
              </Pressable>
            </>
          ) : (
            <>
          {linkedTransfer ? (
            <View style={styles.transferBanner}>
              <Ionicons name="swap-horizontal-outline" size={18} color={OB.primary} />
              <Text style={styles.transferBannerText}>Transferência entre as suas contas. Valor, tipo e conta ficam preservados enquanto o vínculo existir.</Text>
            </View>
          ) : null}
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
                  <Pressable key={option.id} onPress={() => { if (!linkedTransfer) changeType(option.id); }} style={[styles.segment, type === option.id && styles.segmentActive, linkedTransfer && styles.disabled]}>
                    <Ionicons name={option.icon} size={16} color={type === option.id ? "#fff" : OB.support} />
                    <Text style={[styles.segmentText, type === option.id && styles.segmentTextActive]}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View onLayout={registerField("amount")}>
                <Text style={styles.label}>Valor</Text>
                <TextInput
                  value={amount}
                  onChangeText={(value) => { if (!linkedTransfer) setAmount(formatBRLInputFromDigits(value)); }}
                  onFocus={() => focusField("amount")}
                  onPressIn={() => focusField("amount")}
                  editable={!linkedTransfer}
                  keyboardType="number-pad"
                  placeholder="R$ 0,00"
                  placeholderTextColor={OB.support}
                  selectTextOnFocus
                  style={[styles.input, linkedTransfer && styles.disabled]}
                />
              </View>

              <Text style={styles.label}>Data</Text>
              <Pressable onPress={() => { if (!linkedTransfer) setShowDatePicker(true); }} style={[styles.inputButton, linkedTransfer && styles.disabled]}>
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
            {imported ? <Pressable onPress={() => { if (!linkedTransfer) setAccountId(null); }} style={[styles.chip, !accountId && styles.chipActive, linkedTransfer && styles.disabled]}><Text style={[styles.chipText, !accountId && styles.chipTextActive]}>Não informada</Text></Pressable> : null}
            {TRANSACTION_ACCOUNT_OPTIONS.map((account) => {
              const active = accountId === account.id;
              return (
                <Pressable
                  key={account.id}
                  onPress={() => { if (!linkedTransfer) setAccountId(account.id); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Conta ${account.name}`}
                  accessibilityState={{ selected: active, disabled: linkedTransfer }}
                  style={[styles.chip, styles.accountChip, active && styles.chipActive, linkedTransfer && styles.disabled]}
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

          {linkedTransfer ? (
            <Pressable onPress={askUnlink} disabled={saving} style={styles.transferAction}>
              <Ionicons name="git-compare-outline" size={18} color={OB.primary} />
              <Text style={styles.transferActionText}>Desfazer transferência</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setPickingCounterpart(true)} disabled={saving} style={styles.transferAction}>
              <Ionicons name="swap-horizontal-outline" size={18} color={OB.primary} />
              <Text style={styles.transferActionText}>Marcar como transferência entre minhas contas</Text>
            </Pressable>
          )}

          <Pressable onPress={() => void save()} disabled={saving} style={[styles.saveButton, saving && styles.disabled]}>
            {saving ? <ActivityIndicator color="#fff" /> : <><Ionicons name="save-outline" size={19} color="#fff" /><Text style={styles.saveText}>Salvar alterações</Text></>}
          </Pressable>
          <Pressable onPress={confirmRemove} disabled={saving} style={styles.removeButton}>
            <Ionicons name={imported ? "eye-off-outline" : "trash-outline"} size={18} color="#C63F3F" />
            <Text style={styles.removeText}>{imported ? "Ignorar esta movimentação" : "Excluir lançamento"}</Text>
          </Pressable>
            </>
          )}
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
  flex: { flex: 1, minWidth: 0 },
  transferBanner: { borderRadius: 16, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "rgba(6,25,54,0.06)", borderWidth: 1, borderColor: OB.supportSoft, marginBottom: 8 },
  transferBannerText: { flex: 1, color: OB.primary, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  transferAction: { minHeight: 48, borderRadius: 15, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  transferActionText: { color: OB.primary, fontSize: 11, fontWeight: "900", textAlign: "center" },
  counterpartCard: { minHeight: 64, borderRadius: 16, padding: 13, marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  counterpartTitle: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  counterpartMeta: { color: OB.support, fontSize: 10, fontWeight: "700", marginTop: 4 },
  counterpartAmount: { fontSize: 12, fontWeight: "900" },
  cancelPickText: { color: OB.support, fontSize: 12, fontWeight: "900" },
  transactionCardPressed: { backgroundColor: OB.offWhite },
});
