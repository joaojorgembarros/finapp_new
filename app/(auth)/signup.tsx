// app/(auth)/signup.tsx
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../../src/ui/theme";
import { supabase } from "../../src/lib/supabase";

function isValidEmail(s: string) {
  const x = s.trim();
  return x.includes("@") && x.includes(".");
}

function Field({
  icon,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: any;
}) {
  return (
    <View style={fieldWrap}>
      <Ionicons name={icon} size={20} color={theme.colors.muted2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted2}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, color: theme.colors.text, fontWeight: "800", paddingVertical: 2 }}
      />
    </View>
  );
}

export default function SignupScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(
    () => name.trim().length >= 2 && isValidEmail(email) && pass.trim().length >= 6 && pass === confirm && !loading,
    [name, email, pass, confirm, loading]
  );

  async function onSignup() {
    if (!canSubmit) return;
    try {
      setLoading(true);
      const { error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: pass,
        options: { data: { full_name: name.trim() } },
      });
      if (error) throw error;
      Alert.alert("Conta criada", "Agora entre com seu e-mail e senha.");
      router.replace("/(auth)/login");
    } catch (err: any) {
      Alert.alert("Erro ao criar conta", err?.message ?? "Não foi possível criar sua conta agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <LinearGradient colors={theme.gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={authRoot}>
        <View style={{ alignItems: "center", marginBottom: 22 }}>
          <View style={logoBox}>
            <Ionicons name="person-add-outline" size={40} color="#fff" />
          </View>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 36, marginTop: 14 }}>Criar conta</Text>
          <Text style={{ color: "rgba(255,255,255,0.82)", fontWeight: "800", marginTop: 4 }}>Comece seu controle financeiro</Text>
        </View>

        <BlurView intensity={28} tint="light" style={authCard}>
          <View style={{ gap: 13 }}>
            <Field icon="person-outline" value={name} onChangeText={setName} placeholder="Nome completo" />
            <Field icon="mail-outline" value={email} onChangeText={setEmail} placeholder="seu@email.com" keyboardType="email-address" />
            <Field icon="lock-closed-outline" value={pass} onChangeText={setPass} placeholder="Senha com 6+ caracteres" secureTextEntry />
            <Field icon="shield-checkmark-outline" value={confirm} onChangeText={setConfirm} placeholder="Confirmar senha" secureTextEntry />

            <Pressable onPress={onSignup} disabled={!canSubmit} style={{ borderRadius: 18, overflow: "hidden", opacity: canSubmit ? 1 : 0.58 }}>
              <LinearGradient colors={["#2563eb", "#9333ea"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={primaryBtn}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={primaryBtnText}>Criar conta</Text>}
              </LinearGradient>
            </Pressable>
          </View>

          <Pressable onPress={() => router.replace("/(auth)/login")} style={{ marginTop: 20, alignItems: "center" }}>
            <Text style={{ color: theme.colors.muted, fontWeight: "700" }}>
              Já tem uma conta? <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>Entrar</Text>
            </Text>
          </Pressable>
        </BlurView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const authRoot = { flex: 1, paddingHorizontal: 18, justifyContent: "center" } as const;
const logoBox = { width: 78, height: 78, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.24)" } as const;
const authCard = { borderRadius: 28, overflow: "hidden", padding: 22, backgroundColor: "rgba(255,255,255,0.94)", ...theme.shadow } as const;
const fieldWrap = { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "#f8fafc", paddingHorizontal: 14, paddingVertical: 12 } as const;
const primaryBtn = { paddingVertical: 15, alignItems: "center", justifyContent: "center" } as const;
const primaryBtnText = { color: "#fff", fontWeight: "900", fontSize: 16 } as const;
