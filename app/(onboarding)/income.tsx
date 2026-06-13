// app/(onboarding)/income.tsx
import React, { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, Input, Label, P, Pill, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { parseBRLToCents, formatBRLFromCents, formatBRLInputFromDigits } from "../../src/lib/format";
import { upsertProfile, EmploymentType } from "../../src/lib/profile";

const TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];

// ✅ aceita ponto no teclado e converte pra vírgula (pt-BR)
// ✅ mantém só 1 separador e no máximo 2 casas decimais
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
    <Screen contentTopOffset={28}>
      <View style={{ alignItems: "center", marginBottom: 6 }}>
        <H1 style={{ textAlign: "center" }}>
          <Text style={{ color: theme.colors.primary }}>Va</Text>
          <Text style={{ color: theme.colors.secondary }}>mo</Text>
          <Text style={{ color: theme.colors.pink }}>s</Text>
          <Text> configurar</Text>
        </H1>
        <P muted style={{ textAlign: "center", marginTop: 8 }}>
          Separando renda fixa e renda variável, a estimativa fica muito mais realista.
        </P>
      </View>

      <Card>
        <Label>Renda fixa mensal (R$)</Label>
        <Input
          value={fixed}
          onChangeText={(t) => setFixed(formatBRLInputFromDigits(t))}
          placeholder="Ex: 2400,00 (pode ser 0)"
          keyboardType="number-pad"
        />
        <P muted>Prévia: {formatBRLFromCents(fixedCents)}</P>

        <View style={{ height: 10 }} />

        <Label>Média de renda extra por mês (R$)</Label>
        <Input
          value={variableAvg}
          onChangeText={(t) => setVariableAvg(formatBRLInputFromDigits(t))}
          placeholder="Ex: 300,00 (opcional)"
          keyboardType="number-pad"
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
                  backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
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
