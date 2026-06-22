import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { OB, OnboardingBackground, OnboardingShell, PrimaryButton } from "../../src/ui/OnboardingKit";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";

type TxType = "Receita" | "Despesa" | "Investimento";
type Filter = "Todos" | TxType;
type Tx = { id: string; type: TxType; description: string; category: string; date: string; amount: number };

const SEED: Tx[] = [
  { id: "1", type: "Receita", description: "Salário junho", category: "Salário", date: "2026-06-05", amount: 520000 },
  { id: "2", type: "Despesa", description: "Supermercado semanal", category: "Supermercado", date: "2026-06-10", amount: 38400 },
  { id: "3", type: "Investimento", description: "Aporte CDB", category: "CDB", date: "2026-06-12", amount: 100000 },
  { id: "4", type: "Despesa", description: "Plano de saúde", category: "Plano de saúde", date: "2026-06-13", amount: 42000 },
  { id: "5", type: "Receita", description: "Freela design", category: "Renda extra", date: "2026-06-15", amount: 80000 },
];

const CATEGORIES: Record<TxType, string[]> = {
  Receita: ["Salário", "Renda extra", "Aluguel", "13º salário", "Férias", "Outros"],
  Despesa: ["Aluguel", "Supermercado", "Internet", "Plano de saúde", "Restaurantes", "Academia", "Outros"],
  Investimento: ["Poupança", "CDB", "Tesouro Direto", "Renda fixa", "Ações", "Outros"],
};

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
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
  const color = tx.type === "Receita" ? "#22a96b" : tx.type === "Investimento" ? OB.support : "#e05252";
  const sign = tx.type === "Receita" ? "+" : tx.type === "Investimento" ? "~" : "-";

  return (
    <View style={styles.txRow}>
      <View style={[styles.txDot, { backgroundColor: `${color}1A` }]}>
        <Text style={[styles.txDotText, { color }]}>{sign}</Text>
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={styles.txMeta}>{tx.category} · {formatDate(tx.date)}</Text>
      </View>
      <View style={styles.txAmountWrap}>
        <Text style={[styles.txAmount, { color }]}>{sign}{formatBRLFromCents(tx.amount)}</Text>
        <Text style={[styles.txType, { color, backgroundColor: `${color}1A` }]}>{tx.type}</Text>
      </View>
    </View>
  );
}

function AddModal({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (tx: Tx) => void }) {
  const [type, setType] = useState<TxType>("Receita");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState(CATEGORIES.Receita[0]);

  function changeType(next: TxType) {
    setType(next);
    setCategory(CATEGORIES[next][0]);
  }

  function save() {
    const cents = parseBRLToCents(amount);
    if (!cents || !desc.trim()) return;
    onSave({
      id: Date.now().toString(),
      type,
      amount: cents,
      description: desc.trim(),
      category,
      date: new Date().toISOString().slice(0, 10),
    });
    setAmount("");
    setDesc("");
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalShade}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Novo lançamento</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={21} color={OB.support} />
            </Pressable>
          </View>

          <View style={styles.typeTabs}>
            {(["Receita", "Despesa", "Investimento"] as TxType[]).map((item) => {
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
            {CATEGORIES[type].map((item) => {
              const active = item === category;
              return (
                <Pressable key={item} onPress={() => setCategory(item)} style={[styles.category, active && styles.categoryActive]}>
                  <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{item}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.fieldLabel}>Descrição</Text>
          <TextInput value={desc} onChangeText={setDesc} placeholder="Ex: compra mercado" placeholderTextColor={OB.support} style={styles.inputBoxText} />

          <PrimaryButton title="Salvar lançamento" disabled={!parseBRLToCents(amount) || !desc.trim()} onPress={save} style={{ marginTop: 14 }} />
        </View>
      </View>
    </Modal>
  );
}

export default function FinancialFreedomScreen() {
  const [txs, setTxs] = useState<Tx[]>(SEED);
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState<Filter>("Todos");

  const totals = useMemo(() => {
    const income = txs.filter((tx) => tx.type === "Receita").reduce((sum, tx) => sum + tx.amount, 0);
    const expense = txs.filter((tx) => tx.type === "Despesa").reduce((sum, tx) => sum + tx.amount, 0);
    const invest = txs.filter((tx) => tx.type === "Investimento").reduce((sum, tx) => sum + tx.amount, 0);
    return { income, expense, invest, balance: income - expense - invest };
  }, [txs]);

  const filtered = filter === "Todos" ? txs : txs.filter((tx) => tx.type === filter);

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <View style={styles.header}>
          <OnboardingBackground compact />
          <Pressable onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={20} color={OB.textOnDark} />
          </Pressable>
          <Text style={styles.headerEyebrow}>Painel financeiro</Text>
          <Text style={styles.headerTitle}>Liberdade Financeira</Text>
          <Text style={styles.headerSubtitle}>Organize seus lançamentos e acompanhe seu dinheiro com clareza.</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.summaryGrid}>
            <SummaryCard label="Receitas do mês" value={totals.income} color="#22a96b" icon="trending-up-outline" />
            <SummaryCard label="Despesas do mês" value={totals.expense} color="#e05252" icon="trending-down-outline" />
            <SummaryCard label="Saldo atual" value={totals.balance} color={OB.primary} icon="wallet-outline" />
            <SummaryCard label="Investimentos" value={totals.invest} color={OB.support} icon="briefcase-outline" />
          </View>

          <Pressable onPress={() => setModal(true)} style={styles.newButton}>
            <Ionicons name="add" size={19} color="#fff" />
            <Text style={styles.newText}>Novo lançamento</Text>
          </Pressable>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {(["Todos", "Receita", "Despesa", "Investimento"] as Filter[]).map((item) => {
              const active = item === filter;
              return (
                <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, active && styles.filterActive]}>
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{item}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.txList}>
            {filtered.map((tx) => <TxRow key={tx.id} tx={tx} />)}
          </View>

          <PrimaryButton title="Voltar para jornada" onPress={() => router.replace("/(onboarding)/journey")} style={{ marginTop: 4 }} />
        </ScrollView>

        <AddModal visible={modal} onClose={() => setModal(false)} onSave={(tx) => setTxs((prev) => [tx, ...prev])} />
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  header: {
    height: 228,
    paddingHorizontal: 20,
    paddingTop: 16,
    overflow: "hidden",
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    marginBottom: 16,
  },
  headerEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  headerTitle: {
    color: OB.textOnDark,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  headerSubtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 310,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 24,
    gap: 16,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: -50,
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
    justifyContent: "flex-end",
    backgroundColor: "rgba(6,21,46,0.62)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#fff",
    padding: 20,
    paddingTop: 12,
    gap: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 99,
    backgroundColor: OB.supportSoft,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sheetTitle: {
    color: OB.primary,
    fontSize: 18,
    fontWeight: "900",
  },
  typeTabs: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 4,
  },
  typeTab: {
    flex: 1,
    minHeight: 39,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  typeTabActive: {
    backgroundColor: OB.primary,
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
    marginTop: 4,
  },
  inputBox: {
    minHeight: 50,
    borderRadius: 15,
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
  inputBoxText: {
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 15,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  categories: {
    gap: 8,
    paddingVertical: 2,
  },
  category: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: OB.offWhite,
  },
  categoryActive: {
    backgroundColor: OB.primary,
  },
  categoryText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "900",
  },
  categoryTextActive: {
    color: "#fff",
  },
});
