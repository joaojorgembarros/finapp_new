// app/(tabs)/create-household.tsx
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row } from "../../src/ui/components";
import { createHousehold, PlanType } from "../../src/lib/household";
import { setPaySchedule, PayScheduleMode } from "../../src/lib/paySchedule";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { ymd } from "../../src/lib/date";

function Chip({
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
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: active ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.72)",
        flex: 1,
      }}
    >
      <Text style={{ color: theme.colors.text, fontWeight: "900", textAlign: "center" }}>
        {active ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

export default function CreateHousehold() {
  const { userId } = useSession();

  const [name, setName] = useState("");
  const [type, setType] = useState<PlanType>("individual");
  const [payMode, setPayMode] = useState<PayScheduleMode>("month");
  const [busy, setBusy] = useState(false);

  const PLAN_FAMILY_VALUE: PlanType = "couple";

  async function onCreate() {
    if (busy) return;
    if (!userId) return Alert.alert("Sessão", "Você precisa estar logado.");

    const n = name.trim();
    if (!n) return Alert.alert("Atenção", "Digite um nome (ex: João & Júlia).");

    try {
      setBusy(true);

      const householdId = await createHousehold({ name: n, type, userId });

      await setPaySchedule({
        householdId,
        userId,
        mode: payMode,
        settings: {
          start_ymd: ymd(new Date()), // ✅ daqui pra frente que conta pendência
        },
      });

      router.replace("/(onboarding)/income");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Erro ao criar household.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <AppHeader title="Criar plano" subtitle="Configure sua casa financeira antes de começar" />

      <Card>
        <Label>Nome do plano</Label>
        <Input value={name} onChangeText={setName} placeholder="Ex: João & Júlia" />
        <P muted>Use algo fácil de reconhecer. Pode ser seu nome, casal, família ou projeto.</P>

        <View style={{ height: 10 }} />
        <Label>Tipo</Label>
        <Row style={{ gap: 10 }}>
          <Chip label="Individual" active={type === "individual"} onPress={() => setType("individual")} />
          <Chip label="Casal/Família" active={type === PLAN_FAMILY_VALUE} onPress={() => setType(PLAN_FAMILY_VALUE)} />
        </Row>

        <View style={{ height: 10 }} />
        <Label>Como você recebe?</Label>
        <P muted>Isso define quando o app sugere fechar ciclos e distribuir sobras nas metas.</P>
        <Row style={{ gap: 10 }}>
          <Chip label="Mês calendário" active={payMode === "month"} onPress={() => setPayMode("month")} />
          <Chip
            label="2x/mês"
            active={payMode === "twice_month"}
            onPress={() => setPayMode("twice_month")}
          />
        </Row>

        <View style={{ height: 12 }} />
        <Button title={busy ? "Criando..." : "Criar plano"} onPress={onCreate} disabled={busy} />
      </Card>
    </Screen>
  );
}
