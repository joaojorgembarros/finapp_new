// app/(tabs)/profile.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row, SoftIcon } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { getProfile, upsertProfile, EmploymentType, expectedMonthlyIncomeCents } from "../../src/lib/profile";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";

const TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];

function initialsFrom(nameOrEmail: string) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  if (s.includes("@")) return (s.split("@")[0] || "U").slice(0, 2).toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={settingRow}>
      <View style={settingIcon}>
        <Ionicons name={icon} size={20} color={theme.colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{title}</Text>
        <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 12, marginTop: 3 }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted2} />
    </Pressable>
  );
}

function centsToBRInput(cents: number) {
  if (!cents) return "";
  return formatBRLFromCents(cents);
}

export default function Profile() {
  const { session, userId, signOut } = useSession();
  const [busy, setBusy] = useState(true);
  const [fixed, setFixed] = useState("");
  const [variableAvg, setVariableAvg] = useState("");
  const [emp, setEmp] = useState<EmploymentType>("CLT");
  const displayName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split("@")[0] ||
    "Usuário";
  const email = session?.user?.email || "";
  const initials = initialsFrom(displayName || email);

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

  function showComingSoon(title: string) {
    Alert.alert(title, "Essa opção será configurada aqui no perfil em breve.");
  }

  async function onPasswordReset() {
    if (!email) return Alert.alert("Senha", "Não encontramos um e-mail para esta conta.");
    try {
      await supabase.auth.resetPasswordForEmail(email);
      Alert.alert("Senha", "Enviamos um link de recuperação para seu e-mail.");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Não foi possível enviar o link agora.");
    }
  }

  return (
    <Screen>
      <AppHeader title="Perfil" subtitle="Conta e configurações" />

      <LinearGradient colors={theme.gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={hero}>
        <View style={avatar}>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 30 }}>{initials}</Text>
        </View>
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 24, marginTop: 14 }}>{displayName}</Text>
        {email ? (
          <Text style={{ color: "rgba(255,255,255,0.78)", fontWeight: "700", marginTop: 4 }}>{email}</Text>
        ) : null}
      </LinearGradient>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 18 }}>Preferências do app</Text>
        <SettingsRow
          icon="notifications-outline"
          title="Lembretes"
          subtitle="Alertas de metas, faturas e ciclos"
          onPress={() => showComingSoon("Lembretes")}
        />
        <SettingsRow
          icon="moon-outline"
          title="Aparência"
          subtitle="Tema, visual e modo de exibição"
          onPress={() => showComingSoon("Aparência")}
        />
      </Card>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 18 }}>Conta e suporte</Text>
        <SettingsRow
          icon="lock-closed-outline"
          title="Alterar senha"
          subtitle="Receba um link seguro no e-mail"
          onPress={onPasswordReset}
        />
        <SettingsRow
          icon="help-circle-outline"
          title="Ajuda e suporte"
          subtitle="Dúvidas, contato e informações do app"
          onPress={() => showComingSoon("Ajuda e suporte")}
        />
      </Card>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 18 }}>Informações financeiras</Text>

        <Label>Renda fixa mensal (R$)</Label>
        <Input value={fixed} onChangeText={(t) => setFixed(formatBRLInputFromDigits(t))} placeholder="Ex: 2400,00" keyboardType="number-pad" />
        <P muted>Prévia: {formatBRLFromCents(fixedCents)}</P>

        <Label>Média de renda extra (R$)</Label>
        <Input value={variableAvg} onChangeText={(t) => setVariableAvg(formatBRLInputFromDigits(t))} placeholder="Ex: 300,00" keyboardType="number-pad" />
        <P muted>Prévia: {formatBRLFromCents(varCents)}</P>

        <Card intensity={10} style={{ shadowOpacity: 0, elevation: 0 }}>
          <Row style={{ gap: 12 }}>
            <SoftIcon name="cash-outline" tone="good" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Renda total mensal</Text>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 22, marginTop: 2 }}>
                {formatBRLFromCents(total)}
              </Text>
            </View>
          </Row>
        </Card>

        <Label>Tipo de trabalho</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
          {TYPES.map((t) => {
            const active = emp === t;
            return (
              <Pressable
                key={t}
                onPress={() => setEmp(t)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primary : "rgba(255,255,255,0.72)",
                }}
              >
                <Text style={{ color: active ? "#fff" : theme.colors.text, fontWeight: "900" }}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 4 }} />
        <Button title={busy ? "Salvando..." : "Salvar"} onPress={onSave} disabled={busy} />
        <Button
          title="Refazer onboarding"
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

const hero = {
  borderRadius: 28,
  padding: 24,
  alignItems: "center",
  overflow: "hidden",
  ...theme.shadow,
} as const;

const avatar = {
  width: 96,
  height: 96,
  borderRadius: 48,
  backgroundColor: "rgba(255,255,255,0.20)",
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.28)",
} as const;

const settingRow = {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  paddingVertical: 12,
  paddingHorizontal: 12,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: "rgba(248,250,252,0.86)",
} as const;

const settingIcon = {
  width: 42,
  height: 42,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: "rgba(255,255,255,0.86)",
  alignItems: "center",
  justifyContent: "center",
} as const;
