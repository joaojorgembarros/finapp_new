// app/(onboarding)/income.tsx
import React, { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, Input, Label, P, Pill, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { parseBRLToCents, formatBRLFromCents } from "../../src/lib/format";
import { upsertProfile, EmploymentType } from "../../src/lib/profile";

const TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];

// ✅ aceita ponto no teclado e converte pra vírgula (pt-BR)
// ✅ mantém só 1 separador e no máximo 2 casas decimais
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

export default function Income() {
  const { userId } = useSession();

  const [fixed, setFixed] = useState("");
  const [variableAvg, setVariableAvg] = useState("");
  const [emp, setEmp] = useState<EmploymentType>("CLT");
  const [busy, setBusy] = useState(false);

  const fixedCents = useMemo(() => parseBRLToCents(fixed), [fixed]);
  const varCents = useMemo(() => parseBRLToCents(variableAvg), [variableAvg]);
  const totalCents = fixedCents + varCents;

  async function onNext() {
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
        onboarding_done: false,
      });
      router.push("/(onboarding)/goals");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar renda.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Vamos configurar</H1>
      <P muted>Separando renda fixa e renda variável, a estimativa fica muito mais realista.</P>

      <Card>
        <Label>Renda fixa mensal (R$)</Label>
        <Input
          value={fixed}
          onChangeText={(t) => setFixed(normalizeMoneyBR(t))}
          placeholder="Ex: 2400,00 (pode ser 0)"
          keyboardType="decimal-pad"
        />
        <P muted>Prévia: {formatBRLFromCents(fixedCents)}</P>

        <View style={{ height: 10 }} />

        <Label>Média de renda extra por mês (R$)</Label>
        <Input
          value={variableAvg}
          onChangeText={(t) => setVariableAvg(normalizeMoneyBR(t))}
          placeholder="Ex: 300,00 (opcional)"
          keyboardType="decimal-pad"
        />
        <P muted>Prévia: {formatBRLFromCents(varCents)}</P>

        <View style={{ height: 10 }} />

        <Card intensity={16}>
          <Row style={{ justifyContent: "space-between" }}>
            <P muted>Renda prevista do mês</P>
            <Pill text="Fixa + Média" />
          </Row>
          <P style={{ fontWeight: "900" }}>{formatBRLFromCents(totalCents)}</P>
        </Card>

        <View style={{ height: 10 }} />
        <Label>Tipo de trabalho</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
        <Button title={busy ? "Salvando..." : "Próximo"} onPress={onNext} disabled={busy} />
      </Card>

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between" }}>
          <P muted>Como isso ajuda?</P>
          <Pill text="precisão" />
        </Row>
        <P muted>
          Se sua renda varia, o app usa uma média pra estimar. Conforme você registrar entradas/saídas, as previsões ficam cada vez melhores.
        </P>
      </Card>
    </Screen>
  );
}
