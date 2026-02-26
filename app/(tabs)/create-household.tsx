// app/(tabs)/create-household.tsx
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { createHousehold, PlanType, getMyHouseholdId } from "../../src/lib/household";
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
        backgroundColor: active ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.03)",
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

  // ⚠️ ajuste caso seu PlanType não tenha "shared"
  const PLAN_FAMILY_VALUE = ("shared" as unknown) as PlanType;

  async function onCreate() {
    if (busy) return;
    if (!userId) return Alert.alert("Sessão", "Você precisa estar logado.");

    const n = name.trim();
    if (!n) return Alert.alert("Atenção", "Digite um nome (ex: João & Júlia).");

    try {
      setBusy(true);

      await createHousehold({ name: n, type });

      const householdId = await (getMyHouseholdId as any)(userId);
      if (!householdId) throw new Error("Não foi possível identificar o household criado.");

      await setPaySchedule({
        householdId,
        userId,
        mode: payMode,
        settings: {
          start_ymd: ymd(new Date()), // ✅ daqui pra frente que conta pendência
        },
      });

      router.replace("/(tabs)/home");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Erro ao criar household.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: theme.colors.bg0 }}>
      <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 22 }}>Criar Household</Text>

      <Text style={{ color: theme.colors.muted, marginTop: 6, fontWeight: "700" }}>
        Escolha o tipo de plano e como vocês recebem para definir os ciclos.
      </Text>

      <View style={{ height: 16 }} />

      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Nome</Text>
      <View style={{ height: 8 }} />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Ex: João & Júlia"
        placeholderTextColor={theme.colors.muted}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 12,
          color: theme.colors.text,
          backgroundColor: "rgba(255,255,255,0.03)",
        }}
      />

      <View style={{ height: 16 }} />

      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Plano</Text>
      <View style={{ height: 8 }} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Chip label="Individual" active={type === "individual"} onPress={() => setType("individual")} />
        <Chip label="Casal/Família" active={type === PLAN_FAMILY_VALUE} onPress={() => setType(PLAN_FAMILY_VALUE)} />
      </View>

      <View style={{ height: 16 }} />

      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Como você recebe?</Text>
      <Text style={{ color: theme.colors.muted, marginTop: 6, fontWeight: "700" }}>
        Isso define o botão “Fechar ciclo” das metas.
      </Text>

      <View style={{ height: 8 }} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Chip label="Mês calendário" active={payMode === "month"} onPress={() => setPayMode("month")} />
        <Chip
          label="2x/mês (15 + último útil)"
          active={payMode === "twice_month"}
          onPress={() => setPayMode("twice_month")}
        />
      </View>

      <View style={{ height: 18 }} />

      <Pressable
        onPress={onCreate}
        style={{
          paddingVertical: 14,
          borderRadius: 16,
          backgroundColor: theme.colors.primary,
          opacity: busy ? 0.7 : 1,
        }}
        disabled={busy}
      >
        <Text style={{ textAlign: "center", fontWeight: "900", color: "#001018" }}>
          {busy ? "Criando..." : "Criar"}
        </Text>
      </Pressable>
    </View>
  );
}
