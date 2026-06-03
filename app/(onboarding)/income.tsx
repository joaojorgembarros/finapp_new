// app/(onboarding)/income.tsx
import React, { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, Input, Label, P, Pill, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { parseBRLToCents, formatBRLFromCents, formatBRLInputFromDigits } from "../../src/lib/format";
import { upsertProfile, EmploymentType } from "../../src/lib/profile";
import { getMyHouseholdId } from "../../src/lib/household";
import { getPayScheduleInfo, setPaySchedule } from "../../src/lib/paySchedule";

const TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

export default function Income() {
  const { userId } = useSession();

  const [fixed, setFixed] = useState("");
  const [variableAvg, setVariableAvg] = useState("");
  const [payDay, setPayDay] = useState("");
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

    const day = Number(payDay || "0");
    if (payDay && (day < 1 || day > 31)) {
      return Alert.alert("Atenção", "Informe um dia de recebimento entre 1 e 31.");
    }

    try {
      setBusy(true);
      await upsertProfile(userId, {
        income_fixed_cents: fixedCents,
        income_variable_avg_cents: varCents,
        employment_type: emp,
        onboarding_done: false,
      });

      const householdId = await getMyHouseholdId(userId);
      if (householdId && day >= 1 && day <= 31) {
        const current = await getPayScheduleInfo(householdId);
        await setPaySchedule({
          householdId,
          userId,
          mode: current.mode,
          settings: {
            start_ymd: current.startYMD,
            pay_day: day,
          },
        });
      }

      router.push("/(onboarding)/categories");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar renda.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={hero}>
        <View style={stepBadge}>
          <Text style={stepBadgeText}>1 de 4</Text>
        </View>
        <Text style={heroTitle}>Vamos preparar seu plano</Text>
        <Text style={heroText}>
          Passe a base da sua renda para o FinApp calcular metas, limites e sobras com mais realidade.
        </Text>
      </View>

      <Card>
        <Row style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Label>Entrada de dinheiro</Label>
            <P muted>Não precisa ser perfeito. Você pode ajustar tudo depois no perfil.</P>
          </View>
          <Pill text="base" />
        </Row>

        <View style={{ height: 6 }} />

        <Label>Renda fixa mensal (R$)</Label>
        <Input
          value={fixed}
          onChangeText={(t) => setFixed(formatBRLInputFromDigits(t))}
          placeholder="R$ 0,00"
          keyboardType="numeric"
        />
        <P muted>Prévia: {formatBRLFromCents(fixedCents)}</P>

        <View style={{ height: 10 }} />

        <Label>Média de renda extra por mês (R$)</Label>
        <Input
          value={variableAvg}
          onChangeText={(t) => setVariableAvg(formatBRLInputFromDigits(t))}
          placeholder="R$ 0,00"
          keyboardType="numeric"
        />
        <P muted>Prévia: {formatBRLFromCents(varCents)}</P>

        <View style={{ height: 10 }} />

        <Label>Dia que costuma receber</Label>
        <Input
          value={payDay}
          onChangeText={(t) => setPayDay(onlyDigits(t).slice(0, 2))}
          placeholder="Ex: 5 (opcional)"
          keyboardType="number-pad"
        />
        <P muted>Isso ajuda o app a entender seu mês financeiro, não só o calendário.</P>

        <View style={{ height: 10 }} />

        <Card intensity={16}>
          <Row style={{ justifyContent: "space-between" }}>
            <P muted>Renda prevista do mês</P>
            <Pill text="Fixa + média" />
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
          <Pill text="cálculos" />
        </Row>
        <P muted>
          Com a renda cadastrada, o app calcula sobra estimada, limites, progresso de metas e o quanto já está comprometido.
        </P>
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

const heroTitle = {
  ...theme.text.h1,
  color: theme.colors.text,
  textAlign: "center",
  letterSpacing: 0,
} as const;

const heroText = {
  color: theme.colors.muted,
  fontWeight: "800",
  textAlign: "center",
  lineHeight: 22,
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
