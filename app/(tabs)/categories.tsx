// app/(tabs)/categories.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row, SoftIcon } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { createCategory, listCategories, Flow, Kind, Category } from "../../src/lib/categories";

type CategoryGroup = `${Flow}/${Kind}`;

const ICON_OPTIONS: Array<{
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { label: "Mercado", icon: "cart-outline" },
  { label: "Casa", icon: "home-outline" },
  { label: "Transporte", icon: "car-outline" },
  { label: "Saúde", icon: "medkit-outline" },
  { label: "Lazer", icon: "game-controller-outline" },
  { label: "Educação", icon: "school-outline" },
  { label: "Renda", icon: "cash-outline" },
  { label: "Outros", icon: "pricetag-outline" },
];

const GROUPS: Array<{ key: CategoryGroup; title: string; tone: "primary" | "good" | "bad" | "warn" | "pink" }> = [
  { key: "expense/fixed", title: "Saídas fixas", tone: "bad" },
  { key: "expense/variable", title: "Saídas variáveis", tone: "warn" },
  { key: "income/fixed", title: "Entradas fixas", tone: "good" },
  { key: "income/variable", title: "Entradas variáveis", tone: "primary" },
];

function OptionButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionButton,
        active && styles.optionButtonActive,
        pressed && { opacity: 0.86 },
      ]}
    >
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CategoryChip({ category }: { category: Category }) {
  const icon = (category.icon || "pricetag-outline") as keyof typeof Ionicons.glyphMap;

  return (
    <View style={styles.categoryChip}>
      <Ionicons name={icon} size={16} color={theme.colors.primary} />
      <Text style={styles.categoryChipText} numberOfLines={1}>{category.name}</Text>
    </View>
  );
}

export default function Categories() {
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);

  const [flow, setFlow] = useState<Flow>("expense");
  const [kind, setKind] = useState<Kind>("variable");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<keyof typeof Ionicons.glyphMap>("cart-outline");

  async function load() {
    if (!householdId) return;
    try {
      setBusy(true);
      setCats(await listCategories(householdId));
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar categorias.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const grouped = useMemo(() => {
    const g: Record<CategoryGroup, Category[]> = {
      "income/fixed": [],
      "income/variable": [],
      "expense/fixed": [],
      "expense/variable": [],
    };

    for (const category of cats) {
      g[`${category.flow}/${category.kind}` as CategoryGroup].push(category);
    }

    return g;
  }, [cats]);

  const duplicate = useMemo(() => {
    const normalized = name.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return false;

    return cats.some(
      (category) =>
        category.flow === flow &&
        category.kind === kind &&
        category.name.trim().toLocaleLowerCase("pt-BR") === normalized
    );
  }, [cats, flow, kind, name]);

  async function onAdd() {
    if (!householdId || saving) return;

    const cleanName = name.trim();
    if (!cleanName) return Alert.alert("Categoria", "Digite um nome para a categoria.");
    if (duplicate) return Alert.alert("Categoria", "Essa categoria já existe neste grupo.");

    try {
      setSaving(true);
      await createCategory({ householdId, flow, kind, name: cleanName, icon });
      setName("");
      await load();
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao adicionar categoria.");
    } finally {
      setSaving(false);
    }
  }

  const loading = busy || householdLoading;

  return (
    <Screen>
      <AppHeader title="Categorias" subtitle="Crie categorias do seu jeito para organizar seus lançamentos" />

      <Card intensity={16}>
        <Row style={{ gap: 12, alignItems: "flex-start" }}>
          <SoftIcon name="pricetags-outline" tone="primary" />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Nova categoria</Text>
            <P muted>Escolha onde ela aparece e personalize com um ícone.</P>
          </View>
        </Row>

        <Label>Tipo</Label>
        <View style={styles.optionRow}>
          <OptionButton label="Saída" active={flow === "expense"} onPress={() => setFlow("expense")} />
          <OptionButton label="Entrada" active={flow === "income"} onPress={() => setFlow("income")} />
        </View>

        <Label>Frequência</Label>
        <View style={styles.optionRow}>
          <OptionButton label="Variável" active={kind === "variable"} onPress={() => setKind("variable")} />
          <OptionButton label="Fixa" active={kind === "fixed"} onPress={() => setKind("fixed")} />
        </View>

        <Label>Nome</Label>
        <Input value={name} onChangeText={setName} placeholder="Ex: Mercado, pets, academia..." />
        {duplicate ? <Text style={styles.duplicateText}>Essa categoria já existe neste grupo.</Text> : null}

        <Label>Ícone</Label>
        <View style={styles.iconGrid}>
          {ICON_OPTIONS.map((item) => {
            const active = icon === item.icon;
            return (
              <Pressable
                key={item.icon}
                onPress={() => setIcon(item.icon)}
                style={({ pressed }) => [
                  styles.iconOption,
                  active && styles.iconOptionActive,
                  pressed && { opacity: 0.86 },
                ]}
              >
                <Ionicons name={item.icon} size={18} color={active ? "#fff" : theme.colors.primary} />
                <Text style={[styles.iconLabel, active && styles.iconLabelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Button title={saving ? "Adicionando..." : "Adicionar categoria"} onPress={onAdd} disabled={saving || !name.trim() || duplicate} />
      </Card>

      <Card intensity={14}>
        <Row style={{ justifyContent: "space-between" }}>
          <View>
            <Text style={styles.cardTitle}>Suas categorias</Text>
            <P muted>{cats.length} categoria(s) cadastrada(s)</P>
          </View>
          {loading ? <ActivityIndicator /> : null}
        </Row>

        {!householdId && !householdLoading ? (
          <P muted>Crie uma casa antes de adicionar categorias.</P>
        ) : loading ? (
          <P muted>Carregando...</P>
        ) : (
          GROUPS.map((group) => {
            const items = grouped[group.key];
            return (
              <View key={group.key} style={styles.groupBlock}>
                <Row style={{ gap: 10 }}>
                  <SoftIcon name="folder-open-outline" tone={group.tone} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.groupTitle}>{group.title}</Text>
                    <Text style={styles.groupCount}>{items.length} item(ns)</Text>
                  </View>
                </Row>

                <View style={styles.chipWrap}>
                  {items.length ? (
                    items.map((category) => <CategoryChip key={category.id} category={category} />)
                  ) : (
                    <Text style={styles.emptyText}>Nenhuma categoria neste grupo.</Text>
                  )}
                </View>
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  optionRow: {
    flexDirection: "row",
    gap: 10,
  },
  optionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  optionButtonActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  optionText: {
    color: theme.colors.text,
    fontWeight: "900",
  },
  optionTextActive: {
    color: "#fff",
  },
  duplicateText: {
    color: theme.colors.bad,
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.72)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
  },
  iconOptionActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  iconLabel: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  iconLabelActive: {
    color: "#fff",
  },
  groupBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 14,
    marginTop: 4,
    gap: 10,
  },
  groupTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  groupCount: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    maxWidth: "100%",
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.78)",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
  },
  categoryChipText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  emptyText: {
    color: theme.colors.muted2,
    fontSize: 12,
    fontWeight: "800",
  },
});
