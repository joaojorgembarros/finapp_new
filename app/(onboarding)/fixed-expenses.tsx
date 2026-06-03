// app/(onboarding)/fixed-expenses.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, Input, Label, P, Pill, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { getMyHouseholdId } from "../../src/lib/household";
import { Category, listCategories } from "../../src/lib/categories";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { upsertBudget } from "../../src/lib/budgets";

function monthKeyNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export default function FixedExpensesOnboarding() {
  const { userId } = useSession();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const totalCents = useMemo(
    () => Object.values(values).reduce((sum, value) => sum + parseBRLToCents(value), 0),
    [values]
  );

  useEffect(() => {
    async function load() {
      if (!userId) return;

      try {
        setLoading(true);
        const hh = await getMyHouseholdId(userId);
        setHouseholdId(hh);
        if (!hh) return;

        const cats = await listCategories(hh, "expense");
        setCategories(cats.filter((cat) => cat.kind === "fixed"));
      } catch (e: any) {
        Alert.alert("Erro", e?.message ?? "Falha ao carregar gastos fixos.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [userId]);

  async function onNext(skip = false) {
    if (!householdId) return Alert.alert("Ops", "Crie um plano antes.");

    try {
      setBusy(true);

      if (!skip) {
        const monthKey = monthKeyNow();
        for (const cat of categories) {
          const cents = parseBRLToCents(values[cat.id] || "");
          if (cents > 0) {
            await upsertBudget({
              householdId,
              categoryId: cat.id,
              monthKey,
              plannedCents: cents,
            });
          }
        }
      }

      router.push("/(onboarding)/goals");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar gastos fixos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Gastos fixos</H1>
      <P muted>
        Aqui entram as contas que aparecem quase todo mês. Não precisa ser perfeito: uma estimativa já ajuda o app a calcular quanto da renda já nasce comprometida.
      </P>

      <Card>
        <Row style={{ justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Label>Contas mensais</Label>
            <P muted>Preencha só o que fizer sentido agora.</P>
          </View>
          <Pill text={formatBRLFromCents(totalCents)} />
        </Row>

        {loading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando...</P>
          </Row>
        ) : !categories.length ? (
          <P muted>Sem categorias fixas por enquanto. Você pode criar depois no menu Categorias.</P>
        ) : (
          categories.map((cat) => (
            <View key={cat.id} style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{cat.name}</Text>
              <Input
                value={values[cat.id] || ""}
                onChangeText={(t) => setValues((prev) => ({ ...prev, [cat.id]: formatBRLInputFromDigits(t) }))}
                placeholder="R$ 0,00"
                keyboardType="numeric"
              />
            </View>
          ))
        )}

        <Row style={{ gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title={busy ? "Salvando..." : "Próximo"} onPress={() => onNext(false)} disabled={busy || loading} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Pular" variant="ghost" onPress={() => onNext(true)} disabled={busy} />
          </View>
        </Row>
      </Card>

      <Card intensity={18}>
        <P muted>
          Esses valores entram como limites iniciais do orçamento deste mês. Depois dá para ajustar tudo com calma.
        </P>
      </Card>
    </Screen>
  );
}
