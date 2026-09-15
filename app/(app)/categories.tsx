import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { Category, deleteCategory, Flow, Kind, listCategories } from "../../src/lib/categories";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

function ScreenScrimModal({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.scrimRoot}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <View style={styles.scrimStage} pointerEvents="box-none">
          {children}
        </View>
      </View>
    </Modal>
  );
}

type CategoryGroup = `${Flow}/${Kind}`;

const GROUPS: { key: CategoryGroup; title: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: "expense/fixed", title: "Saídas fixas", icon: "calendar-outline", color: "#9A6B73" },
  { key: "expense/variable", title: "Saídas variáveis", icon: "swap-horizontal-outline", color: "#A8895A" },
  { key: "income/fixed", title: "Entradas fixas", icon: "cash-outline", color: "#5B8F7A" },
  { key: "income/variable", title: "Entradas variáveis", icon: "rocket-outline", color: OB.support },
];

function categoryCountLabel(count: number) {
  if (count === 0) return "Nenhuma categoria";
  if (count === 1) return "1 categoria";
  return `${count} categorias`;
}

function CategoryRow({
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
      style={({ pressed }) => [styles.categoryRow, pressed && styles.categoryRowPressed, deleting && styles.categoryRowDisabled]}
      accessibilityRole="button"
      accessibilityLabel={`Gerenciar categoria ${category.name}`}
    >
      <View style={styles.categoryIcon}>
        <Ionicons name={icon} size={17} color={OB.primary} />
      </View>
      <Text style={styles.categoryName} numberOfLines={1}>{category.name}</Text>
      {deleting ? (
        <ActivityIndicator size="small" color={OB.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={OB.support} />
      )}
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
  const [actionCategory, setActionCategory] = useState<Category | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

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
    setPendingDelete(null);
    setActionCategory(category);
  }

  function openRenameCategory(category: Category) {
    setActionCategory(null);
    router.push({
      pathname: "/(app)/new-category",
      params: {
        categoryId: category.id,
        categoryName: category.name,
        flow: category.flow,
        kind: category.kind,
      },
    });
  }

  function openDeleteConfirm(category: Category) {
    if (!householdId || deletingId) return;
    setActionCategory(null);
    setPendingDelete(category);
  }

  async function performDelete(category: Category) {
    if (!householdId || deletingId) return;

    try {
      setDeletingId(category.id);
      await deleteCategory(category.id, householdId);
      setCategories((current) => current.filter((item) => item.id !== category.id));
      setPendingDelete(null);
    } catch (error: any) {
      Alert.alert("Categorias", error?.message ?? "Não foi possível excluir a categoria.");
    } finally {
      setDeletingId(null);
    }
  }

  const loading = busy || householdLoading;

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <ScreenHeaderCard
            onBack={() => router.replace("/(app)/journey")}
            eyebrow="Controle financeiro"
            title="Categorias"
            subtitle="Organize seus lançamentos em grupos claros e fáceis de gerenciar."
          />

          <Pressable
            onPress={() => setDestinationOpen(true)}
            disabled={!householdId || loading}
            style={({ pressed }) => [
              styles.createButton,
              pressed && styles.createButtonPressed,
              (!householdId || loading) && styles.createButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Nova categoria"
          >
            <View style={styles.createIcon}>
              {loading ? (
                <ActivityIndicator size="small" color={OB.primary} />
              ) : (
                <Ionicons name="add" size={18} color={OB.primary} />
              )}
            </View>
            <View style={styles.createCopy}>
              <Text style={styles.createTitle}>Nova categoria</Text>
              <Text style={styles.createSubtitle}>{categoryCountLabel(categories.length)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={OB.support} />
          </Pressable>

          {!householdId && !householdLoading ? (
            <View style={styles.messageCard}>
              <Text style={styles.messageText}>Crie uma casa antes de adicionar categorias.</Text>
            </View>
          ) : loading ? (
            <View style={styles.messageCard}>
              <Text style={styles.messageText}>Carregando...</Text>
            </View>
          ) : (
            GROUPS.map((group) => {
              const items = grouped[group.key];
              return (
                <View key={group.key} style={styles.groupCard}>
                  <View style={styles.groupHeader}>
                    <View style={[styles.groupIcon, { backgroundColor: `${group.color}22` }]}>
                      <Ionicons name={group.icon} size={18} color={group.color} />
                    </View>
                    <Text style={styles.groupTitle}>{group.title}</Text>
                    <View style={[styles.countBadge, { backgroundColor: `${group.color}18` }]}>
                      <Text style={[styles.countBadgeText, { color: group.color }]}>{items.length}</Text>
                    </View>
                  </View>

                  {items.length ? (
                    <View style={styles.groupList}>
                      {items.map((category, index) => (
                        <View key={category.id}>
                          {index > 0 ? <View style={styles.rowDivider} /> : null}
                          <CategoryRow
                            category={category}
                            deleting={deletingId === category.id}
                            onPress={openCategoryActions}
                          />
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.groupEmpty}>Nenhuma categoria neste grupo.</Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        <ScreenScrimModal visible={destinationOpen} onClose={() => setDestinationOpen(false)}>
          <View style={styles.overlayCard}>
            <View style={styles.destinationHeading}>
              <View style={styles.destinationHeadingIcon}>
                <Ionicons name="pricetag-outline" size={20} color={OB.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.destinationTitle}>Nova categoria</Text>
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
                  <View style={[styles.destinationOptionIcon, { backgroundColor: `${group.color}22` }]}>
                    <Ionicons name={group.icon} size={18} color={group.color} />
                  </View>
                  <Text style={styles.destinationOptionText}>{group.title}</Text>
                  <Ionicons name="chevron-forward" size={18} color={OB.support} />
                </Pressable>
              ))}
            </View>
          </View>
        </ScreenScrimModal>

        <ScreenScrimModal visible={Boolean(actionCategory)} onClose={() => setActionCategory(null)}>
          {actionCategory ? (
            <View style={styles.overlayCard}>
              <View style={styles.destinationHeading}>
                <View style={styles.destinationHeadingIcon}>
                  <Ionicons name={(actionCategory.icon || "pricetag-outline") as keyof typeof Ionicons.glyphMap} size={20} color={OB.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.destinationTitle}>{actionCategory.name}</Text>
                  <Text style={styles.destinationText}>O que você deseja fazer com esta categoria?</Text>
                </View>
                <Pressable onPress={() => setActionCategory(null)} style={styles.destinationClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fechar">
                  <Ionicons name="close" size={20} color={OB.support} />
                </Pressable>
              </View>

              <View style={styles.destinationList}>
                <Pressable
                  onPress={() => openRenameCategory(actionCategory)}
                  style={({ pressed }) => [styles.destinationOption, pressed && styles.destinationOptionPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Alterar nome"
                >
                  <View style={styles.destinationHeadingIcon}>
                    <Ionicons name="pencil-outline" size={18} color={OB.primary} />
                  </View>
                  <Text style={styles.destinationOptionText}>Alterar nome</Text>
                  <Ionicons name="chevron-forward" size={18} color={OB.support} />
                </Pressable>
                <Pressable
                  onPress={() => openDeleteConfirm(actionCategory)}
                  style={({ pressed }) => [styles.destinationOption, pressed && styles.destinationOptionPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Excluir categoria"
                >
                  <View style={[styles.destinationOptionIcon, { backgroundColor: "rgba(154,107,115,0.16)" }]}>
                    <Ionicons name="trash-outline" size={18} color="#9A6B73" />
                  </View>
                  <Text style={[styles.destinationOptionText, styles.destructiveText]}>Excluir</Text>
                  <Ionicons name="chevron-forward" size={18} color="#9A6B73" />
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScreenScrimModal>

        <ScreenScrimModal visible={Boolean(pendingDelete)} onClose={() => !deletingId && setPendingDelete(null)}>
          {pendingDelete ? (
            <View style={styles.overlayCard}>
              <View style={styles.destinationHeading}>
                <View style={[styles.destinationHeadingIcon, { backgroundColor: "rgba(154,107,115,0.16)" }]}>
                  <Ionicons name="trash-outline" size={20} color="#9A6B73" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.destinationTitle}>Excluir categoria</Text>
                </View>
              </View>
              <Text style={styles.confirmBody}>
                {`Deseja remover "${pendingDelete.name}"? Os lançamentos antigos continuam salvos, mas ficam sem essa categoria.`}
              </Text>

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setPendingDelete(null)}
                  disabled={Boolean(deletingId)}
                  style={({ pressed }) => [styles.confirmSecondary, pressed && styles.destinationOptionPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                >
                  <Text style={styles.confirmSecondaryText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  onPress={() => void performDelete(pendingDelete)}
                  disabled={Boolean(deletingId)}
                  style={({ pressed }) => [styles.confirmDanger, pressed && styles.createButtonPressed, deletingId && styles.createButtonDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar exclusão"
                >
                  {deletingId ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.confirmDangerText}>Excluir</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScreenScrimModal>
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
    gap: 14,
    paddingBottom: 36,
  },
  createButton: {
    minHeight: 72,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    shadowColor: OB.primary,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  createButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  createButtonDisabled: {
    opacity: 0.55,
  },
  createIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  createCopy: {
    flex: 1,
    minWidth: 0,
  },
  createTitle: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  createSubtitle: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  messageCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  messageText: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  groupCard: {
    borderRadius: 20,
    padding: 14,
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    shadowColor: OB.primary,
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 2,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  groupTitle: {
    flex: 1,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  countBadge: {
    minWidth: 28,
    height: 26,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: "800",
  },
  groupList: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: OB.offWhite,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: OB.supportSoft,
    marginLeft: 54,
  },
  categoryRow: {
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  categoryRowPressed: {
    backgroundColor: "rgba(123,160,200,0.10)",
  },
  categoryRowDisabled: {
    opacity: 0.6,
  },
  categoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  categoryName: {
    flex: 1,
    color: OB.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  groupEmpty: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  scrimRoot: {
    flex: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OB.modalScrim,
  },
  scrimStage: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },
  overlayCard: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: 22,
    padding: 18,
    gap: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    shadowColor: OB.primary,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  destructiveText: {
    color: "#9A6B73",
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
  },
  confirmBody: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  confirmSecondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  confirmSecondaryText: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  confirmDanger: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9A6B73",
  },
  confirmDangerText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
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
