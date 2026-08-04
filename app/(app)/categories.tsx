import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { Category, deleteCategory, Flow, Kind, listCategories } from "../../src/lib/categories";

type CategoryGroup = `${Flow}/${Kind}`;

const GROUPS: { key: CategoryGroup; title: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: "expense/fixed", title: "Saídas fixas", icon: "calendar-outline", color: "#e05252" },
  { key: "expense/variable", title: "Saídas variáveis", icon: "swap-horizontal-outline", color: "#f59e0b" },
  { key: "income/fixed", title: "Entradas fixas", icon: "cash-outline", color: "#22a96b" },
  { key: "income/variable", title: "Entradas variáveis", icon: "rocket-outline", color: OB.support },
];

function CategoryChip({
  category,
  deleting,
  onPress,
}: {
  category: Category;
  deleting: boolean;
  onPress: (category: Category) => void;
}) {
  const icon = (category.icon || "pricetag-outline") as keyof typeof Ionicons.glyphMap;

  return (
    <Pressable
      onPress={() => onPress(category)}
      disabled={deleting}
      style={({ pressed }) => [styles.categoryChip, pressed && styles.categoryChipPressed, deleting && styles.categoryChipDisabled]}
      accessibilityRole="button"
      accessibilityLabel={`Gerenciar categoria ${category.name}`}
    >
      <Ionicons name={icon} size={15} color={OB.primary} />
      <Text style={styles.categoryChipText} numberOfLines={1}>{category.name}</Text>
      {deleting ? <ActivityIndicator size="small" color={OB.primary} /> : null}
    </Pressable>
  );
}

export default function OnboardingCategories() {
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [destinationOpen, setDestinationOpen] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) {
      setCategories([]);
      setBusy(false);
      return;
    }

    try {
      setBusy(true);
      setCategories(await listCategories(householdId));
    } catch (error: any) {
      Alert.alert("Categorias", error?.message ?? "Não foi possível carregar suas categorias.");
    } finally {
      setBusy(false);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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

  function openNewCategory(group: CategoryGroup) {
    const [selectedFlow, selectedKind] = group.split("/") as [Flow, Kind];
    router.push({
      pathname: "/(app)/new-category",
      params: { flow: selectedFlow, kind: selectedKind },
    });
  }

  function openCategoryActions(category: Category) {
    if (deletingId) return;

    Alert.alert(
      category.name,
      "O que você deseja fazer com esta categoria?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Alterar nome",
          onPress: () => router.push({
            pathname: "/(app)/new-category",
            params: {
              categoryId: category.id,
              categoryName: category.name,
              flow: category.flow,
              kind: category.kind,
            },
          }),
        },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => confirmDeleteCategory(category),
        },
      ]
    );
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
            <Pressable onPress={() => router.replace("/(app)/journey")} style={styles.backButton} hitSlop={12}>
              <Ionicons name="arrow-back" size={18} color="#fff" />
            </Pressable>
            <Text style={styles.headerEyebrow}>Controle financeiro</Text>
            <Text style={styles.headerTitle}>Categorias</Text>
            <Text style={styles.headerSubtitle}>Crie categorias do seu jeito para organizar seus lançamentos.</Text>
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
              {loading ? <ActivityIndicator /> : (
                <Pressable
                  onPress={() => setDestinationOpen(true)}
                  disabled={!householdId}
                  style={({ pressed }) => [styles.addCategoryButton, pressed && styles.addCategoryButtonPressed, !householdId && styles.addCategoryButtonDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Criar categoria"
                >
                  <Ionicons name="add" size={23} color="#fff" />
                </Pressable>
              )}
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
                      {items.map((category) => (
                        <CategoryChip
                          key={category.id}
                          category={category}
                          deleting={deletingId === category.id}
                          onPress={openCategoryActions}
                        />
                      ))}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>

        <Modal visible={destinationOpen} transparent animationType="fade" onRequestClose={() => setDestinationOpen(false)}>
          <Pressable style={styles.destinationBackdrop} onPress={() => setDestinationOpen(false)}>
            <Pressable style={styles.destinationCard} onPress={(event) => event.stopPropagation()}>
              <View style={styles.destinationHeading}>
                <View style={styles.destinationHeadingIcon}>
                  <Ionicons name="pricetag-outline" size={20} color={OB.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.destinationTitle}>Onde criar a categoria?</Text>
                  <Text style={styles.destinationText}>Escolha o grupo da nova categoria.</Text>
                </View>
                <Pressable onPress={() => setDestinationOpen(false)} style={styles.destinationClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fechar">
                  <Ionicons name="close" size={20} color={OB.support} />
                </Pressable>
              </View>

              <View style={styles.destinationList}>
                {GROUPS.map((group) => (
                  <Pressable
                    key={group.key}
                    onPress={() => {
                      setDestinationOpen(false);
                      openNewCategory(group.key);
                    }}
                    style={({ pressed }) => [styles.destinationOption, pressed && styles.destinationOptionPressed]}
                  >
                    <View style={[styles.destinationOptionIcon, { backgroundColor: `${group.color}1A` }]}>
                      <Ionicons name={group.icon} size={18} color={group.color} />
                    </View>
                    <Text style={styles.destinationOptionText}>{group.title}</Text>
                    <Ionicons name="chevron-forward" size={18} color={OB.support} />
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
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
  addCategoryButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  addCategoryButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  addCategoryButtonDisabled: {
    opacity: 0.4,
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
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  categoryChipPressed: {
    backgroundColor: OB.supportSoft,
    transform: [{ scale: 0.98 }],
  },
  categoryChipDisabled: {
    opacity: 0.6,
  },
  categoryChipText: {
    flexShrink: 1,
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  emptyText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
  destinationBackdrop: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: "rgba(7, 18, 38, 0.58)",
  },
  destinationCard: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: 22,
    padding: 18,
    gap: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  destinationHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  destinationHeadingIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  destinationTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
  },
  destinationText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  destinationClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  destinationList: {
    gap: 9,
  },
  destinationOption: {
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  destinationOptionPressed: {
    backgroundColor: OB.supportSoft,
    transform: [{ scale: 0.99 }],
  },
  destinationOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  destinationOptionText: {
    flex: 1,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
});
