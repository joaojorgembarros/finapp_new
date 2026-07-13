import React, { useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useSession } from "../src/providers/SessionProvider";
import { supabase } from "../src/lib/supabase";
import { theme } from "../src/ui/theme";

export default function ResetPasswordScreen() {
  const { session, loading } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = useMemo(() => password.length >= 8 && password === confirm, [confirm, password]);

  if (!loading && !session) return <Redirect href="/(auth)/login" />;

  async function save() {
    if (!valid || busy) return;
    try {
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      Alert.alert("Senha atualizada", "Sua nova senha já pode ser usada.", [
        { text: "Continuar", onPress: () => router.replace("/") },
      ]);
    } catch (error: any) {
      Alert.alert("Erro", error?.message ?? "Não foi possível atualizar sua senha.");
    } finally {
      setBusy(false);
    }
  }

  return <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 14, backgroundColor: theme.colors.bg0 }}>
    <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "900" }}>Criar nova senha</Text>
    <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>Use pelo menos 8 caracteres.</Text>
    <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Nova senha" style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14 }} />
    <TextInput value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Confirmar nova senha" style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14 }} />
    <Pressable disabled={!valid || busy} onPress={save} style={{ borderRadius: 14, padding: 15, alignItems: "center", backgroundColor: valid ? theme.colors.primary : theme.colors.border }}>
      <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Salvando..." : "Salvar senha"}</Text>
    </Pressable>
  </View>;
}
