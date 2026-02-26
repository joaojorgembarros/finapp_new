// app/(tabs)/profile.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, Input, Label, P } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { getProfile, upsertProfile, EmploymentType, expectedMonthlyIncomeCents } from "../../src/lib/profile";
import { formatBRLFromCents, parseBRLToCents } from "../../src/lib/format";

const TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];

// ✅ mesmo normalizador (ponto -> vírgula, 2 casas)
function normalizeMoneyBR(text: string) {
  if (!text) return "";

  let s = text.replace(/[^\d.,]/g, "");
  s = s.replace(/\./g, ",");

  const idx = s.indexOf(",");
  if (idx >= 0) {
    const intPart = s.slice(0, idx).replace(/[^\d]/g, "");
    const decPart = s.slice(idx + 1).replace(/[^\d]/g, "").slice(0, 2);
    return decPart.length ? `${intPart},${decPart}` : `${intPart},`;
  }

  return s.replace(/[^\d]/g, "");
}

function centsToBRInput(cents: number) {
  const v = (Number(cents || 0) / 100).toFixed(2);
  return v.replace(".", ",");
}

export default function Profile() {
  const { userId, signOut } = useSession();
  const [busy, setBusy] = useState(true);

  const [fixed, setFixed] = useState("");
  const [variableAvg, setVariableAvg] = useState("");
  const [emp, setEmp] = useState<EmploymentType>("CLT");

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!userId) return;
      try {
        setBusy(true);
        const p = await getProfile(userId);
        if (alive && p) {
          setFixed(centsToBRInput(p.income_fixed_cents || 0));
          setVariableAvg(centsToBRInput(p.income_variable_avg_cents || 0));
          setEmp((p.employment_type as EmploymentType) || "CLT");
        }
      } finally {
        if (alive) setBusy(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [userId]);

  const fixedCents = useMemo(() => parseBRLToCents(fixed), [fixed]);
  const varCents = useMemo(() => parseBRLToCents(variableAvg), [variableAvg]);
  const total = expectedMonthlyIncomeCents({ income_fixed_cents: fixedCents, income_variable_avg_cents: varCents });

  async function onSave() {
    if (!userId) return;

    if (fixedCents <= 0 && varCents <= 0) {
      return Alert.alert("Atenção", "Informe pelo menos a renda fixa ou uma média de renda extra.");
    }

    try {
      setBusy(true);
      await upsertProfile(userId, {
        income_fixed_cents: fixedCents,
        income_variable_avg_cents: varCents,
        employment_type: emp,
      });
      Alert.alert("Ok", "Perfil atualizado.");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={{ padding: 6 }}>
        <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>Voltar</Text>
      </Pressable>

      <H1>Perfil</H1>
      <P muted>Isso impacta as estimativas de metas.</P>

      <Card>
        <Label>Renda fixa mensal (R$)</Label>
        <Input
          value={fixed}
          onChangeText={(t) => setFixed(normalizeMoneyBR(t))}
          placeholder="Ex: 2400,00"
          keyboardType="decimal-pad"
        />
        <P muted>Prévia: {formatBRLFromCents(fixedCents)}</P>

        <View style={{ height: 10 }} />

        <Label>Média de renda extra (R$)</Label>
        <Input
          value={variableAvg}
          onChangeText={(t) => setVariableAvg(normalizeMoneyBR(t))}
          placeholder="Ex: 300,00"
          keyboardType="decimal-pad"
        />
        <P muted>Prévia: {formatBRLFromCents(varCents)}</P>

        <View style={{ height: 10 }} />
        <P muted>Renda prevista do mês: <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{formatBRLFromCents(total)}</Text></P>

        <View style={{ height: 10 }} />
        <Label>Tipo de trabalho</Label>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {TYPES.map((t) => {
            const active = emp === t;
            return (
              <Pressable
                key={t}
                onPress={() => setEmp(t)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.03)",
                }}
              >
                <Text style={{ color: active ? theme.colors.primary : theme.colors.text, fontWeight: "900" }}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 12 }} />
        <Button title={busy ? "Salvando..." : "Salvar"} onPress={onSave} disabled={busy} />

        <Button
          title="Refazer onboarding (metas)"
          variant="ghost"
          onPress={async () => {
            if (!userId) return;
            try {
              await upsertProfile(userId, { onboarding_done: false });
              router.replace("/(onboarding)/income");
            } catch (e: any) {
              Alert.alert("Erro", e?.message ?? "Falha.");
            }
          }}
        />

        <Button
          title="Sair"
          variant="danger"
          onPress={async () => {
            await signOut();
            router.replace("/(auth)/login");
          }}
        />
      </Card>
    </Screen>
  );
}
