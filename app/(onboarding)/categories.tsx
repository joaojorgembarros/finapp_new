// app/(onboarding)/categories.tsx
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, Input, Label, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { getMyHouseholdId } from "../../src/lib/household";
import { Category, createCategoryIfMissing, listCategories, seedDefaultCategories } from "../../src/lib/categories";

const QUICK_EXTRAS = ["Delivery", "Pets", "Farmácia", "Academia", "Presentes", "Impostos"];

export default function CategoriesOnboarding() {
  const { userId } = useSession();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [custom, setCustom] = useState("");
  const [selectedExtras, setSelectedExtras] = useState<string[]>(["Delivery"]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!userId) return;

    try {
      setLoading(true);
      const hh = await getMyHouseholdId(userId);
      setHouseholdId(hh);
      if (!hh) return;

      await seedDefaultCategories(hh);
      const cats = await listCategories(hh, "expense");
      setCategories(cats);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar categorias.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function toggleExtra(name: string) {
    setSelectedExtras((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  }

  async function onNext() {
    if (!householdId) return Alert.alert("Ops", "Crie um plano antes.");

    const typed = custom
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const extras = Array.from(new Set([...selectedExtras, ...typed]));

    try {
      setBusy(true);
      for (let i = 0; i < extras.length; i++) {
        await createCategoryIfMissing({
          householdId,
          flow: "expense",
          kind: "variable",
          name: extras[i],
          icon: "pricetag-outline",
          sort: 300 + i,
        });
      }
      router.push("/(onboarding)/fixed-expenses");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar categorias.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={hero}>
        <View style={stepBadge}>
          <Text style={stepBadgeText}>2 de 4</Text>
        </View>
        <Text style={heroTitle}>Categorias iniciais</Text>
        <Text style={heroText}>
          Categorias são as caixinhas onde seus gastos vão morar: mercado, transporte, lazer, delivery. Assim o FinApp entende para onde o dinheiro está indo.
        </Text>
      </View>

      <Card>
        <Row style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Label>Já deixei algumas prontas</Label>
            <P muted>Use como ponto de partida. Depois você pode apagar, renomear ou criar outras no menu Categorias.</P>
          </View>
        </Row>

        {loading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando...</P>
          </Row>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {categories.slice(0, 12).map((cat) => (
              <View key={cat.id} style={chip}>
                <Ionicons name={(cat.icon || "wallet-outline") as any} size={15} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{cat.name}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <Label>Quer adicionar alguma agora?</Label>
        <P muted>Toque nas sugestões ou escreva outras separadas por vírgula.</P>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {QUICK_EXTRAS.map((name) => {
            const active = selectedExtras.includes(name);
            return (
              <Pressable
                key={name}
                onPress={() => toggleExtra(name)}
                style={[chip, active ? { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft } : null]}
              >
                <Ionicons
                  name={active ? "checkmark-circle" : "add-circle-outline"}
                  size={15}
                  color={active ? theme.colors.primary : theme.colors.muted}
                />
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{name}</Text>
              </Pressable>
            );
          })}
        </View>

        <Input value={custom} onChangeText={setCustom} placeholder="Ex: Uber, curso, barbeiro" />

        <Row style={{ gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title={busy ? "Salvando..." : "Próximo"} onPress={onNext} disabled={busy || loading} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Pular" variant="ghost" onPress={() => router.push("/(onboarding)/fixed-expenses")} disabled={busy} />
          </View>
        </Row>
      </Card>
    </Screen>
  );
}

const hero = {
  alignItems: "center",
  gap: 10,
  paddingHorizontal: 6,
  marginBottom: 2,
} as const;

const heroText = {
  color: theme.colors.muted,
  fontWeight: "800",
  textAlign: "center",
  lineHeight: 22,
} as const;

const heroTitle = {
  ...theme.text.h1,
  color: theme.colors.text,
  textAlign: "center",
  letterSpacing: 0,
} as const;

const stepBadge = {
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.primarySoft,
  borderWidth: 1,
  borderColor: theme.colors.border,
} as const;

const stepBadgeText = {
  color: theme.colors.primary,
  fontWeight: "900",
  fontSize: 12,
} as const;

const chip = {
  minHeight: 36,
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: "rgba(255,255,255,0.74)",
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
} as const;
