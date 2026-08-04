import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { Category, createCategory, Flow, Kind, listCategories, updateCategoryName } from "../../src/lib/categories";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";

const ICON_OPTIONS: { label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Mercado", icon: "cart-outline" },
  { label: "Casa", icon: "home-outline" },
  { label: "Transporte", icon: "car-outline" },
  { label: "Saúde", icon: "medkit-outline" },
  { label: "Lazer", icon: "game-controller-outline" },
  { label: "Educação", icon: "school-outline" },
  { label: "Renda", icon: "cash-outline" },
  { label: "Outros", icon: "pricetag-outline" },
];

function groupLabel(flow: Flow, kind: Kind) {
  if (flow === "income") return kind === "fixed" ? "Entradas fixas" : "Entradas variáveis";
  return kind === "fixed" ? "Saídas fixas" : "Saídas variáveis";
}

function groupIcon(flow: Flow, kind: Kind): keyof typeof Ionicons.glyphMap {
  if (flow === "income") return kind === "fixed" ? "cash-outline" : "rocket-outline";
  return kind === "fixed" ? "calendar-outline" : "swap-horizontal-outline";
}

export default function NewCategoryScreen() {
  const params = useLocalSearchParams<{ categoryId?: string; categoryName?: string; flow?: string; kind?: string }>();
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const flow: Flow = params.flow === "income" ? "income" : "expense";
  const kind: Kind = params.kind === "fixed" ? "fixed" : "variable";
  const editing = Boolean(params.categoryId);

  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(params.categoryName ?? "");
  const [icon, setIcon] = useState<keyof typeof Ionicons.glyphMap>("pricetag-outline");

  useEffect(() => {
    let active = true;

    async function load() {
      if (!householdId) {
        if (active) setLoadingCategories(false);
        return;
      }

      try {
        if (active) setLoadingCategories(true);
        const rows = await listCategories(householdId);
        if (active) setCategories(rows);
      } catch (error: any) {
        if (active) Alert.alert("Categorias", error?.message ?? "Não foi possível carregar suas categorias.");
      } finally {
        if (active) setLoadingCategories(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [householdId]);

  const duplicate = useMemo(() => {
    const normalized = name.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return false;

    return categories.some(
      (category) =>
        category.id !== params.categoryId &&
        category.flow === flow &&
        category.kind === kind &&
        category.name.trim().toLocaleLowerCase("pt-BR") === normalized
    );
  }, [categories, flow, kind, name, params.categoryId]);

  const loading = householdLoading || loadingCategories;
  const disabled = loading || saving || !name.trim() || duplicate || !householdId;

  async function saveCategory() {
    if (!householdId || disabled) return;

    try {
      setSaving(true);
      if (editing && params.categoryId) {
        await updateCategoryName({ categoryId: params.categoryId, householdId, name: name.trim() });
      } else {
        await createCategory({ householdId, flow, kind, name: name.trim(), icon });
      }
      router.back();
    } catch (error: any) {
      Alert.alert("Categorias", error?.message ?? `Não foi possível ${editing ? "alterar" : "adicionar"} a categoria.`);
    } finally {
      setSaving(false);
    }
  }

  const selectedGroup = groupLabel(flow, kind);

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.headerCard}>
            <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar para categorias">
              <Ionicons name="arrow-back" size={18} color="#fff" />
            </Pressable>
            <Text style={styles.headerEyebrow}>Categorias</Text>
            <Text style={styles.headerTitle}>{editing ? "Alterar categoria" : "Nova categoria"}</Text>
            <Text style={styles.headerSubtitle}>
              {editing ? "Atualize o nome desta categoria." : `Crie uma categoria em ${selectedGroup.toLocaleLowerCase("pt-BR")}.`}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.groupBadge}>
              <View style={styles.groupBadgeIcon}>
                <Ionicons name={groupIcon(flow, kind)} size={19} color={OB.primary} />
              </View>
              <View>
                <Text style={styles.groupBadgeLabel}>Grupo selecionado</Text>
                <Text style={styles.groupBadgeTitle}>{selectedGroup}</Text>
              </View>
            </View>

            <Text style={styles.label}>Nome</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ex: Mercado, pets, academia..."
              placeholderTextColor={OB.support}
              style={styles.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                if (!disabled) void saveCategory();
              }}
            />
            {duplicate ? <Text style={styles.warning}>Essa categoria já existe neste grupo.</Text> : null}

            {!editing ? (
              <>
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
              </>
            ) : null}

            {!householdId && !householdLoading ? <Text style={styles.warning}>Crie uma casa antes de adicionar categorias.</Text> : null}

            <Pressable onPress={() => void saveCategory()} disabled={disabled} style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]}>
              {saving || loading ? <ActivityIndicator color={disabled ? OB.support : "#fff"} /> : (
                <Text style={[styles.primaryText, disabled && styles.primaryTextDisabled]}>
                  {editing ? "Salvar novo nome" : "Criar categoria"}
                </Text>
              )}
            </Pressable>
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
  scroll: {
    padding: 20,
    gap: 18,
    paddingBottom: 28,
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
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  groupBadge: {
    minHeight: 64,
    borderRadius: 16,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  groupBadgeIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  groupBadgeLabel: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  groupBadgeTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 3,
  },
  label: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
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
});
