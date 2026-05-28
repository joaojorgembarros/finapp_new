// app/(auth)/login.tsx
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
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: any;
}) {
  return (
    <View>
      <Text style={{ color: theme.colors.text, fontWeight: "800", marginBottom: 8 }}>{label}</Text>
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
    </View>
  );
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const canSubmit = useMemo(() => isValidEmail(email) && pass.trim().length >= 6 && !loading, [email, pass, loading]);

  async function onLogin() {
    if (!canSubmit) return;
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      });
      if (error) throw error;
      router.replace("/(tabs)/home");
    } catch (err: any) {
      Alert.alert("Erro ao entrar", err?.message ?? "Não foi possível entrar agora.");
    } finally {
      setLoading(false);
    }
  }

  async function onForgot() {
    const e = email.trim().toLowerCase();
    if (!isValidEmail(e)) return Alert.alert("Recuperar senha", "Digite seu e-mail primeiro.");
    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(e);
      if (error) throw error;
      Alert.alert("Enviado", "Te mandei um e-mail para redefinir sua senha.");
    } catch (err: any) {
      Alert.alert("Erro", err?.message ?? "Não foi possível enviar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <LinearGradient colors={theme.gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={authRoot}>
        <View style={{ alignItems: "center", marginBottom: 28 }}>
          <View style={logoBox}>
            <Ionicons name="wallet-outline" size={42} color="#fff" />
          </View>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 40, marginTop: 16 }}>FinApp</Text>
          <Text style={{ color: "rgba(255,255,255,0.82)", fontWeight: "800", marginTop: 4 }}>Suas finanças sob controle</Text>
        </View>

        <BlurView intensity={28} tint="light" style={authCard}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 24, marginBottom: 20 }}>Bem-vindo de volta</Text>

          <View style={{ gap: 16 }}>
            <Field label="E-mail" icon="mail-outline" value={email} onChangeText={setEmail} placeholder="seu@email.com" keyboardType="email-address" />
            <Field label="Senha" icon="lock-closed-outline" value={pass} onChangeText={setPass} placeholder="••••••••" secureTextEntry />

            <Pressable onPress={onForgot} style={{ alignSelf: "flex-end" }}>
              <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>Esqueceu a senha?</Text>
            </Pressable>

            <Pressable onPress={onLogin} disabled={!canSubmit} style={{ borderRadius: 18, overflow: "hidden", opacity: canSubmit ? 1 : 0.58 }}>
              <LinearGradient colors={["#2563eb", "#9333ea"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={primaryBtn}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={primaryBtnText}>Entrar</Text>}
              </LinearGradient>
            </Pressable>
          </View>

          <Pressable onPress={() => router.push("/(auth)/signup")} style={{ marginTop: 22, alignItems: "center" }}>
            <Text style={{ color: theme.colors.muted, fontWeight: "700" }}>
              Não tem uma conta? <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>Criar conta</Text>
            </Text>
          </Pressable>
        </BlurView>

        <Text style={{ color: "rgba(255,255,255,0.80)", fontWeight: "700", marginTop: 22, textAlign: "center" }}>
          Seguro, confiável e feito para você
        </Text>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const authRoot = { flex: 1, paddingHorizontal: 18, justifyContent: "center" } as const;
const logoBox = { width: 82, height: 82, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.24)" } as const;
const authCard = { borderRadius: 28, overflow: "hidden", padding: 24, backgroundColor: "rgba(255,255,255,0.94)", ...theme.shadow } as const;
const fieldWrap = { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "#f8fafc", paddingHorizontal: 14, paddingVertical: 12 } as const;
const primaryBtn = { paddingVertical: 15, alignItems: "center", justifyContent: "center" } as const;
const primaryBtnText = { color: "#fff", fontWeight: "900", fontSize: 16 } as const;
