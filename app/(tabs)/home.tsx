// app/(tabs)/home.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/ui/Screen";
import ProfileAvatarMenu from "../../src/ui/ProfileAvatarMenu";
import { AppHeader, GradientCard, Row } from "../../src/ui/components";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { formatBRLFromCents } from "../../src/lib/format";
import { getMonthlyNet } from "../../src/lib/transactions";
import { onTxChanged } from "../../src/lib/bus";
import { theme } from "../../src/ui/theme";

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.24)",
        backgroundColor: "rgba(255,255,255,0.20)",
        flex: 1,
      }}
    >
      <Text style={{ color: "rgba(255,255,255,0.86)", fontWeight: "800", fontSize: 12 }}>{label}</Text>
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15, marginTop: 4 }}>{value}</Text>
    </View>
  );
}

function greetingFromDisplayName(displayName: string) {
  const raw = String(displayName || "").trim();
  if (!raw) return "pessoa";
  if (raw.includes("@")) return "pessoa";

  const spaced = raw.replace(/[._-]+/g, " ").trim();
  const firstTwoNames = spaced.split(/\s+/).filter(Boolean).slice(0, 2).join(" ") || spaced;

  if (firstTwoNames.length <= 22) return firstTwoNames;
  return `${firstTwoNames.slice(0, 20)}...`;
}

export default function HomeTab() {
  const { session, userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);
  const [net, setNet] = useState({ income: 0, expense: 0, net: 0 });
  const displayName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    "";
  const greetingName = greetingFromDisplayName(displayName);

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      setNet(await getMonthlyNet(householdId));
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar dados.");
    }
  }, [householdId]);

  useEffect(() => {
    if (!hhLoading && householdId) load();
  }, [hhLoading, householdId, load]);

  useEffect(() => {
    const off = onTxChanged(() => load());
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [load]);

  return (
    <Screen>
      <AppHeader title="Início" subtitle="Visão rápida do mês" right={<ProfileAvatarMenu />} />

      <View style={{ marginTop: 8, marginBottom: 2, paddingHorizontal: 8 }}>
        <Text style={{ color: "#0f2a4a", fontWeight: "400", fontSize: 16 }}>Olá,</Text>
        <Row style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={{ color: "#0f2a4a", fontWeight: "900", fontSize: 30, flex: 1 }}
          >
            {greetingName}
          </Text>
          <Text style={{ fontSize: 28 }}>👋</Text>
        </Row>
      </View>

      <GradientCard
        icon="wallet-outline"
        eyebrow="Saldo Atual"
        value={formatBRLFromCents(net.net)}
        style={{ marginTop: 10 }}
      >
        <Row style={{ gap: 10 }}>
          <StatPill label="Receitas" value={formatBRLFromCents(net.income)} />
          <StatPill label="Despesas" value={formatBRLFromCents(net.expense)} />
        </Row>
      </GradientCard>

      <Pressable
        onPress={() => router.push("/(tabs)/history")}
        style={{
          borderRadius: 16,
          backgroundColor: "#fff",
          paddingVertical: 18,
          paddingHorizontal: 16,
          shadowColor: "#0f172a",
          shadowOpacity: 0.14,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 5,
        }}
      >
        <Row style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#475569", fontWeight: "500", fontSize: 13 }}>Resultado do Mês</Text>
            <Text style={{ color: theme.colors.good, fontWeight: "900", fontSize: 23, marginTop: 8 }}>
              +{formatBRLFromCents(net.net)}
            </Text>
          </View>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: "#dcfce7",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="trending-up-outline" size={26} color={theme.colors.good} />
          </View>
        </Row>
      </Pressable>
    </Screen>
  );
}
