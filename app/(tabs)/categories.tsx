// app/(tabs)/categories.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { createCategory, listCategories, Flow, Kind, Category } from "../../src/lib/categories";

export default function Categories() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [cats, setCats] = useState<Category[]>([]);

  const [flow, setFlow] = useState<Flow>("expense");
  const [kind, setKind] = useState<Kind>("variable");
  const [name, setName] = useState("");

  async function load() {
    if (!householdId) return;
    try {
      setBusy(true);
      setCats(await listCategories(householdId));
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [householdId]);

  const grouped = useMemo(() => {
    const g: Record<string, Category[]> = {
      "income/fixed": [],
      "income/variable": [],
      "expense/fixed": [],
      "expense/variable": [],
    };
    for (const c of cats) g[`${c.flow}/${c.kind}`].push(c);
    return g;
  }, [cats]);

  async function onAdd() {
    if (!householdId) return;
    const n = name.trim();
    if (!n) return Alert.alert("Atenção", "Digite o nome da categoria.");

    try {
      await createCategory({ householdId, flow, kind, name: n });
      setName("");
      load();
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao adicionar.");
    }
  }

  return (
    <Screen>
      <AppHeader title="Categorias" subtitle="Crie os grupos que você realmente usa" />

      <Card>
        <Label>Nova categoria</Label>
        <P muted>Essas categorias aparecem nos lançamentos e no orçamento mensal.</P>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
          {(["expense", "income"] as Flow[]).map((f) => {
            const active = flow === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFlow(f)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: active ? theme.colors.primary : theme.colors.text, fontWeight: "900" }}>
                  {f === "income" ? "Entrada" : "Saída"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          {(["fixed", "variable"] as Kind[]).map((k) => {
            const active = kind === k;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: active ? theme.colors.primary : theme.colors.text, fontWeight: "900" }}>
                  {k === "fixed" ? "Fixa" : "Variável"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 10 }} />
        <Input value={name} onChangeText={setName} placeholder="Ex: Lazer, Mercado, Transporte..." />
        <Button title="Adicionar" onPress={onAdd} />
      </Card>

      <Card>
        <Label>Lista</Label>
        {busy ? (
          <P muted>Carregando…</P>
        ) : (
          <>
            {(["expense/fixed", "expense/variable", "income/fixed", "income/variable"] as const).map((k) => (
              <View key={k} style={{ marginTop: 14 }}>
                <Text style={{ color: theme.colors.muted, fontWeight: "900" }}>
                  {k === "expense/fixed"
                    ? "Saídas • Fixas"
                    : k === "expense/variable"
                    ? "Saídas • Variáveis"
                    : k === "income/fixed"
                    ? "Entradas • Fixas"
                    : "Entradas • Variáveis"}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {grouped[k].length ? (
                    grouped[k].map((c) => (
                      <View
                        key={c.id}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: "rgba(255,255,255,0.72)",
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{c.name}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={{ color: theme.colors.muted2, fontWeight: "700" }}>—</Text>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
      </Card>
    </Screen>
  );
}
