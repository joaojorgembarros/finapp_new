import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { BANK_OPTIONS, CASH_ACCOUNT, OTHER_BANK, TransactionAccountId, TransactionAccountOption } from "../../src/lib/banks";
import { Category, listCategories } from "../../src/lib/categories";
import { formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { addTransaction } from "../../src/lib/transactions";
import { useSession } from "../../src/providers/SessionProvider";
import { BankLogo } from "../../src/ui/BankLogo";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

type TxType = "Receita" | "Despesa";

export default function NewTransactionScreen() {
  const { session, userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<"amount" | "description">(18);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<TxType>("Receita");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<TransactionAccountId | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const userMeta = session?.user?.user_metadata as Record<string, any> | undefined;
  const registeredBankNames = useMemo(
    () => Array.isArray(userMeta?.finapp_banks) ? userMeta.finapp_banks.map(String) : [],
    [userMeta?.finapp_banks]
  );
  const registeredAccounts = useMemo(
    () => BANK_OPTIONS.filter((account) => registeredBankNames.includes(account.name)),
    [registeredBankNames]
  );
  const accountOptions = useMemo<TransactionAccountOption[]>(() => {
    const options = [...registeredAccounts, CASH_ACCOUNT];
    if (!options.some((account) => account.id === OTHER_BANK.id)) options.push(OTHER_BANK);
    return options;
  }, [registeredAccounts]);
  const defaultAccountId = useMemo<TransactionAccountId | null>(() => {
    if (registeredAccounts.length === 1) return registeredAccounts[0].id;
    return registeredBankNames.includes("Não uso banco") ? CASH_ACCOUNT.id : null;
  }, [registeredAccounts, registeredBankNames]);
  const availableCategories = useMemo(
    () => categories.filter((category) => category.flow === (type === "Receita" ? "income" : "expense")),
    [categories, type]
  );

  useFocusEffect(
    useCallback(() => {
      if (!householdId) {
        if (!householdLoading) setLoading(false);
        return;
      }
      let active = true;
      setLoading(true);
      listCategories(householdId)
        .then((rows) => { if (active) setCategories(rows); })
        .catch((error: any) => { if (active) Alert.alert("Novo lançamento", error?.message ?? "Não foi possível carregar as categorias."); })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [householdId, householdLoading])
  );

  useEffect(() => {
    if (!availableCategories.some((category) => category.id === categoryId)) {
      setCategoryId(availableCategories[0]?.id ?? null);
    }
  }, [availableCategories, categoryId]);

  useEffect(() => {
    if (accountId && accountOptions.some((account) => account.id === accountId)) return;
    setAccountId(defaultAccountId && accountOptions.some((account) => account.id === defaultAccountId) ? defaultAccountId : null);
  }, [accountId, accountOptions, defaultAccountId]);

  function changeType(nextType: TxType) {
    setType(nextType);
    setCategoryId(null);
  }

  async function save() {
    const amountCents = parseBRLToCents(amount);
    if (!householdId || !userId || !amountCents || !description.trim() || !accountId || saving) return;
    try {
      setSaving(true);
      await addTransaction({
        householdId,
        userId,
        type: type === "Receita" ? "income" : "expense",
        amount_cents: amountCents,
        category_id: categoryId,
        account_id: accountId,
        note: description,
      });
      router.back();
    } catch (error: any) {
      Alert.alert("Novo lançamento", error?.message ?? "Não foi possível salvar o lançamento.");
    } finally {
      setSaving(false);
    }
  }

  const valid = Boolean(parseBRLToCents(amount) && description.trim() && accountId && householdId && userId);

  return (
    <OnboardingShell light>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.screen}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: 32 + keyboardInset }]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="none"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={cancelPendingScroll}
        >
          <ScreenHeaderCard
            onBack={() => router.back()}
            backAccessibilityLabel="Fechar"
            navigationVariant="close"
            eyebrow="Controle financeiro"
            title="Novo lançamento"
            subtitle="Registre entradas e saídas com clareza."
          />

          <Pressable onPress={() => router.push("/(app)/import-extract")} style={styles.importButton}>
            <View style={styles.importIcon}><Ionicons name="cloud-upload-outline" size={18} color={OB.primary} /></View>
            <View style={styles.flex}><Text style={styles.importTitle}>Importar extrato</Text><Text style={styles.importText}>Carregue movimentações do banco por arquivo</Text></View>
            <Ionicons name="chevron-forward" size={18} color={OB.support} />
          </Pressable>

          <View style={styles.typeTabs}>
            {(["Receita", "Despesa"] as TxType[]).map((item) => {
              const active = item === type;
              return <Pressable key={item} onPress={() => changeType(item)} style={[styles.typeTab, active && styles.typeTabActive]}><Text style={[styles.typeTabText, active && styles.typeTabTextActive]}>{item}</Text></Pressable>;
            })}
          </View>

          <Text style={styles.label}>{type === "Receita" ? "Onde o dinheiro entrou?" : "De onde o dinheiro saiu?"}</Text>
          <View style={styles.panel}>
            {accountOptions.map((account) => {
              const active = account.id === accountId;
              return (
                <Pressable key={account.id} onPress={() => setAccountId(account.id)} style={[styles.account, active && styles.active]}>
                  <BankLogo bankId={account.id} size={34} color={account.color} shortName={account.shortName} />
                  <Text numberOfLines={1} style={[styles.accountText, active && styles.activeText]}>{account.name}</Text>
                  {active ? <Ionicons name="checkmark-circle" size={17} color="#fff" /> : null}
                </Pressable>
              );
            })}
          </View>
          {!accountId ? <Text style={styles.required}>Escolha uma conta para continuar.</Text> : null}

          <View onLayout={registerField("amount")}>
            <Text style={styles.label}>Valor</Text>
            <View style={styles.inputBox}>
              <Text style={styles.currency}>R$</Text>
              <TextInput value={amount.replace("R$", "").trim()} onChangeText={(text) => setAmount(formatBRLInputFromDigits(text))} onFocus={() => focusField("amount")} onPressIn={() => focusField("amount")} onSubmitEditing={Keyboard.dismiss} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus placeholder="0,00" placeholderTextColor={OB.support} style={styles.moneyInput} />
            </View>
          </View>

          <Text style={styles.label}>Categoria</Text>
          <View style={[styles.panel, styles.categoryPanel]}>
            {loading || householdLoading ? <ActivityIndicator color={OB.primary} /> : availableCategories.map((category) => {
              const active = category.id === categoryId;
              return <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.category, active && styles.active]}>{active ? <Ionicons name="checkmark-circle" size={15} color="#fff" /> : null}<Text style={[styles.categoryText, active && styles.activeText]}>{category.name}</Text></Pressable>;
            })}
          </View>

          <View onLayout={registerField("description")}>
            <Text style={styles.label}>Descrição</Text>
            <TextInput value={description} onChangeText={setDescription} onFocus={() => focusField("description")} onPressIn={() => focusField("description")} onSubmitEditing={Keyboard.dismiss} returnKeyType="done" placeholder="Ex: compra mercado" placeholderTextColor={OB.support} style={styles.textInput} />
          </View>

          <Pressable onPress={() => void save()} disabled={!valid || saving} style={[styles.saveButton, (!valid || saving) && styles.saveDisabled]}>
            <Text style={[styles.saveText, (!valid || saving) && styles.saveTextDisabled]}>{saving ? "Salvando..." : "Salvar lançamento"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OB.offWhite },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  importButton: { minHeight: 66, borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  importIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: OB.offWhite },
  flex: { flex: 1 },
  importTitle: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  importText: { color: OB.support, fontSize: 11, fontWeight: "800", lineHeight: 16, marginTop: 2 },
  typeTabs: { flexDirection: "row", gap: 8, marginBottom: 2 },
  typeTab: { flex: 1, minHeight: 52, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  typeTabActive: { backgroundColor: OB.primary, borderColor: OB.primary },
  typeTabText: { color: OB.support, fontSize: 12, fontWeight: "900" },
  typeTabTextActive: { color: "#fff" },
  label: { color: OB.support, fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginTop: 2, marginBottom: 4 },
  panel: { gap: 8, borderRadius: 18, borderWidth: 1, borderColor: OB.supportSoft, backgroundColor: "#fff", padding: 10 },
  account: { minHeight: 52, borderRadius: 15, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: OB.offWhite, borderWidth: 1, borderColor: "transparent" },
  active: { backgroundColor: OB.primary, borderColor: OB.primary },
  accountText: { flex: 1, color: OB.primary, fontSize: 13, fontWeight: "900" },
  activeText: { color: "#fff" },
  required: { color: "#B94A4A", fontSize: 10, fontWeight: "800", marginTop: -8, paddingHorizontal: 2 },
  inputBox: { minHeight: 58, borderRadius: 17, borderWidth: 1.5, borderColor: OB.supportSoft, backgroundColor: OB.offWhite, flexDirection: "row", alignItems: "center", paddingHorizontal: 15 },
  currency: { color: OB.primary, fontSize: 15, fontWeight: "900", marginRight: 6 },
  moneyInput: { flex: 1, color: OB.primary, fontSize: 16, fontWeight: "900" },
  categoryPanel: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  category: { minHeight: 38, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: OB.offWhite, borderWidth: 1, borderColor: "transparent" },
  categoryText: { color: OB.support, fontSize: 12, fontWeight: "900" },
  textInput: { minHeight: 58, borderRadius: 17, borderWidth: 1.5, borderColor: OB.supportSoft, backgroundColor: OB.offWhite, paddingHorizontal: 15, color: OB.primary, fontSize: 15, fontWeight: "800" },
  saveButton: { minHeight: 58, borderRadius: 18, backgroundColor: OB.primary, alignItems: "center", justifyContent: "center", marginTop: 8 },
  saveDisabled: { backgroundColor: "rgba(123,160,200,0.32)" },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  saveTextDisabled: { color: OB.support },
});
