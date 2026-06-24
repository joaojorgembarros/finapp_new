import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { Category, createCategory, deleteCategory, Flow, Kind, listCategories } from "../../src/lib/categories";

type CategoryGroup = `${Flow}/${Kind}`;

const ICON_OPTIONS: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { label: "Mercado", icon: "cart-outline" },
  { label: "Casa", icon: "home-outline" },
  { label: "Transporte", icon: "car-outline" },
  { label: "Saúde", icon: "medkit-outline" },
  { label: "Lazer", icon: "game-controller-outline" },
  { label: "Educação", icon: "school-outline" },
  { label: "Renda", icon: "cash-outline" },
  { label: "Outros", icon: "pricetag-outline" },
];

const GROUPS: Array<{ key: CategoryGroup; title: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = [
  { key: "expense/fixed", title: "Saídas fixas", icon: "calendar-outline", color: "#e05252" },
  { key: "expense/variable", title: "Saídas variáveis", icon: "swap-horizontal-outline", color: "#f59e0b" },
  { key: "income/fixed", title: "Entradas fixas", icon: "cash-outline", color: "#22a96b" },
  { key: "income/variable", title: "Entradas variáveis", icon: "rocket-outline", color: OB.support },
];

function initialsLabel(flow: Flow, kind: Kind) {
  if (flow === "income") return kind === "fixed" ? "Entrada fixa" : "Entrada variável";
  return kind === "fixed" ? "Saída fixa" : "Saída variável";
}

function OptionButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.optionButton, active && styles.optionButtonActive]}>
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CategoryChip({
  category,
  deleting,
  editing,
  onDelete,
}: {
  category: Category;
  deleting: boolean;
  editing: boolean;
  onDelete: (category: Category) => void;
}) {
  const icon = (category.icon || "pricetag-outline") as keyof typeof Ionicons.glyphMap;

  return (
    <View style={styles.categoryChip}>
      <Ionicons name={icon} size={15} color={OB.primary} />
      <Text style={styles.categoryChipText} numberOfLines={1}>{category.name}</Text>
      {editing ? (
        <Pressable
          onPress={() => onDelete(category)}
          disabled={deleting}
          style={[styles.deleteCategoryButton, deleting && styles.deleteCategoryButtonDisabled]}
          hitSlop={8}
        >
          <Ionicons name="close" size={13} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function OnboardingCategories() {
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingCategories, setEditingCategories] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [flow, setFlow] = useState<Flow>("expense");
  const [kind, setKind] = useState<Kind>("variable");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<keyof typeof Ionicons.glyphMap>("cart-outline");

  async function load() {
    if (!householdId) return;
    try {
      setBusy(true);
      setCategories(await listCategories(householdId));
    } catch (error: any) {
      Alert.alert("Categorias", error?.message ?? "Não foi possível carregar suas categorias.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const grouped = useMemo(() => {
    const map: Record<CategoryGroup, Category[]> = {
      "income/fixed": [],
      "income/variable": [],
      "expense/fixed": [],
      "expense/variable": [],
    };

    for (const category of categories) {
      map[`${category.flow}/${category.kind}` as CategoryGroup].push(category);
    }

    return map;
  }, [categories]);

  const duplicate = useMemo(() => {
    const normalized = name.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return false;

    return categories.some(
      (category) =>
        category.flow === flow &&
        category.kind === kind &&
        category.name.trim().toLocaleLowerCase("pt-BR") === normalized
    );
  }, [categories, flow, kind, name]);

  async function addCategory() {
    if (!householdId || saving) return;
    const cleanName = name.trim();

    if (!cleanName) return Alert.alert("Categorias", "Digite um nome para a categoria.");
    if (duplicate) return Alert.alert("Categorias", "Essa categoria já existe neste grupo.");

    try {
      setSaving(true);
      await createCategory({ householdId, flow, kind, name: cleanName, icon });
      setName("");
      await load();
    } catch (error: any) {
      Alert.alert("Categorias", error?.message ?? "Não foi possível adicionar a categoria.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteCategory(category: Category) {
    if (!householdId || deletingId) return;

    Alert.alert(
      "Excluir categoria",
      `Deseja remover "${category.name}"? Os lançamentos antigos continuam salvos, mas ficam sem essa categoria.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingId(category.id);
              await deleteCategory(category.id, householdId);
              setCategories((current) => current.filter((item) => item.id !== category.id));
            } catch (error: any) {
              Alert.alert("Categorias", error?.message ?? "Não foi possível excluir a categoria.");
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }

  const loading = busy || householdLoading;

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.headerCard}>
            <Pressable onPress={() => router.replace("/(onboarding)/journey")} style={styles.backButton} hitSlop={12}>
              <Ionicons name="arrow-back" size={18} color="#fff" />
            </Pressable>
            <Text style={styles.headerEyebrow}>Controle financeiro</Text>
            <Text style={styles.headerTitle}>Categorias</Text>
            <Text style={styles.headerSubtitle}>Crie categorias do seu jeito para organizar seus lançamentos.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeading}>
              <View style={styles.cardIcon}>
                <Ionicons name="pricetags-outline" size={20} color={OB.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Nova categoria</Text>
                <Text style={styles.cardText}>{initialsLabel(flow, kind)}</Text>
              </View>
            </View>

            <Text style={styles.label}>Tipo</Text>
            <View style={styles.optionRow}>
              <OptionButton label="Saída" active={flow === "expense"} onPress={() => setFlow("expense")} />
              <OptionButton label="Entrada" active={flow === "income"} onPress={() => setFlow("income")} />
            </View>

            <Text style={styles.label}>Frequência</Text>
            <View style={styles.optionRow}>
              <OptionButton label="Variável" active={kind === "variable"} onPress={() => setKind("variable")} />
              <OptionButton label="Fixa" active={kind === "fixed"} onPress={() => setKind("fixed")} />
            </View>

            <Text style={styles.label}>Nome</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ex: Mercado, pets, academia..."
              placeholderTextColor={OB.support}
              style={styles.input}
            />
            {duplicate ? <Text style={styles.warning}>Essa categoria já existe neste grupo.</Text> : null}

            <Text style={styles.label}>Ícone</Text>
            <View style={styles.iconGrid}>
              {ICON_OPTIONS.map((item) => {
                const active = icon === item.icon;
                return (
                  <Pressable key={item.icon} onPress={() => setIcon(item.icon)} style={[styles.iconOption, active && styles.iconOptionActive]}>
                    <Ionicons name={item.icon} size={18} color={active ? "#fff" : OB.primary} />
                    <Text style={[styles.iconLabel, active && styles.iconLabelActive]} numberOfLines={1}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={addCategory}
              disabled={saving || !name.trim() || duplicate}
              style={[styles.primaryButton, (saving || !name.trim() || duplicate) && styles.primaryButtonDisabled]}
            >
              <Text style={[styles.primaryText, (saving || !name.trim() || duplicate) && styles.primaryTextDisabled]}>
                {saving ? "Adicionando..." : "Adicionar categoria"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeading}>
              <View style={styles.cardIcon}>
                <Ionicons name="folder-open-outline" size={20} color={OB.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Suas categorias</Text>
                <Text style={styles.cardText}>{categories.length} categoria(s) cadastrada(s)</Text>
              </View>
              {loading ? (
                <ActivityIndicator />
              ) : categories.length ? (
                <Pressable
                  onPress={() => setEditingCategories((current) => !current)}
                  disabled={!!deletingId}
                  style={[styles.editButton, editingCategories && styles.editButtonActive, deletingId && styles.editButtonDisabled]}
                >
                  <Text style={[styles.editButtonText, editingCategories && styles.editButtonTextActive]}>
                    {editingCategories ? "Concluir" : "Editar"}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {!householdId && !householdLoading ? (
              <Text style={styles.emptyText}>Crie uma casa antes de adicionar categorias.</Text>
            ) : loading ? (
              <Text style={styles.emptyText}>Carregando...</Text>
            ) : (
              GROUPS.map((group) => {
                const items = grouped[group.key];
                return (
                  <View key={group.key} style={styles.groupBlock}>
                    <View style={styles.groupHeader}>
                      <View style={[styles.groupIcon, { backgroundColor: `${group.color}1A` }]}>
                        <Ionicons name={group.icon} size={17} color={group.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupTitle}>{group.title}</Text>
                        <Text style={styles.groupCount}>{items.length} item(ns)</Text>
                      </View>
                    </View>

                    <View style={styles.chipWrap}>
                      {items.length ? (
                        items.map((category) => (
                          <CategoryChip
                            key={category.id}
                            category={category}
                            deleting={deletingId === category.id}
                            editing={editingCategories}
                            onDelete={confirmDeleteCategory}
                          />
                        ))
                      ) : (
                        <Text style={styles.emptyText}>Nenhuma categoria neste grupo.</Text>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  headerCard: {
    minHeight: 154,
    borderRadius: 22,
    padding: 20,
    paddingRight: 58,
    justifyContent: "flex-end",
    backgroundColor: OB.primary,
  },
  backButton: {
    position: "absolute",
    right: 14,
    top: 14,
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
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
  },
  scroll: {
    padding: 20,
    gap: 18,
    paddingBottom: 28,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  cardHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  cardTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
  },
  cardText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  editButton: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  editButtonActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  editButtonDisabled: {
    opacity: 0.55,
  },
  editButtonText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  editButtonTextActive: {
    color: "#fff",
  },
  label: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  optionRow: {
    flexDirection: "row",
    gap: 10,
  },
  optionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  optionButtonActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  optionText: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "900",
  },
  optionTextActive: {
    color: "#fff",
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 15,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  warning: {
    color: "#B94A4A",
    fontSize: 12,
    fontWeight: "800",
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  iconOption: {
    width: "48%",
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  iconOptionActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  iconLabel: {
    flex: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  iconLabelActive: {
    color: "#fff",
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  primaryButtonDisabled: {
    backgroundColor: "rgba(123,160,200,0.32)",
  },
  primaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  primaryTextDisabled: {
    color: OB.support,
  },
  groupBlock: {
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    paddingTop: 14,
    gap: 10,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  groupTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  groupCount: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    minHeight: 38,
    maxWidth: "100%",
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  categoryChipText: {
    flexShrink: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  deleteCategoryButton: {
    width: 21,
    height: 21,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E05252",
  },
  deleteCategoryButtonDisabled: {
    opacity: 0.45,
  },
  emptyText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
});
