// app/(auth)/login.tsx
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../../src/ui/theme";
import { supabase } from "../../src/lib/supabase";

type FocusKey = "email" | "password" | null;

function isValidEmail(s: string) {
  const x = s.trim();
  return x.includes("@") && x.includes(".");
}

function AuthField({
  icon,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  focused,
  onFocus,
  onBlur,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: TextInputProps["keyboardType"];
  secureTextEntry?: boolean;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={[field, focused && fieldActive]}>
      <Ionicons name={icon} size={21} color={focused ? theme.colors.primary : "#6b7280"} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6b7280"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={onFocus}
        onBlur={onBlur}
        style={fieldInput}
      />
      {right}
    </View>
  );
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<FocusKey>(null);
  const [showPass, setShowPass] = useState(false);
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
      Alert.alert("Erro ao entrar", err?.message ?? "Nao foi possivel entrar agora.");
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
      Alert.alert("Erro", err?.message ?? "Nao foi possivel enviar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={keyboard}>
        <View style={root}>
          <View style={brandBlock}>
            <Text style={brand}>FinApp</Text>
            <Text style={headline}>Entre para organizar seu mes</Text>
            <Text style={subhead}>Acompanhe gastos, metas e saldo em um lugar simples.</Text>
          </View>

          <View style={form}>
            <AuthField
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="E-mail"
              keyboardType="email-address"
              focused={focused === "email"}
              onFocus={() => setFocused("email")}
              onBlur={() => setFocused(null)}
            />

            <AuthField
              icon="lock-closed-outline"
              value={pass}
              onChangeText={setPass}
              placeholder="Senha"
              secureTextEntry={!showPass}
              focused={focused === "password"}
              onFocus={() => setFocused("password")}
              onBlur={() => setFocused(null)}
              right={
                <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10} style={eyeButton}>
                  <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={21} color="#52605a" />
                </Pressable>
              }
            />

            <Pressable onPress={onForgot} style={forgotLink} hitSlop={10}>
              <Text style={forgotText}>Esqueci minha senha</Text>
            </Pressable>

            <Pressable onPress={onLogin} disabled={!canSubmit} style={{ opacity: canSubmit ? 1 : 0.48 }}>
              <LinearGradient
                colors={["#2563eb", "#9333ea"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={primaryButton}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={primaryText}>Entrar</Text>}
              </LinearGradient>
            </Pressable>
          </View>

          <Pressable onPress={() => router.push("/(auth)/signup")} style={bottomLink}>
            <Text style={bottomText}>Ainda nao tem uma conta?</Text>
            <Text style={bottomStrong}>Criar conta</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const screen = { flex: 1, backgroundColor: "#f7faf7" } as const;
const keyboard = { flex: 1 } as const;
const root = { flex: 1, paddingHorizontal: 28, paddingTop: 64, paddingBottom: Platform.OS === "android" ? 54 : 30 } as const;
const brandBlock = { alignItems: "center", marginBottom: 46 } as const;
const brand = { color: "#1f2937", fontWeight: "900", fontSize: 42, letterSpacing: 0 } as const;
const headline = { color: "#26352d", fontWeight: "900", fontSize: 23, textAlign: "center", marginTop: 24, letterSpacing: 0 } as const;
const subhead = { color: "#66736d", fontWeight: "700", fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8 } as const;
const form = { gap: 14 } as const;
const field = { minHeight: 64, borderRadius: 20, backgroundColor: "#e5ebe4", flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: "transparent" } as const;
const fieldActive = { backgroundColor: "#fff", borderColor: "rgba(37,99,235,0.36)" } as const;
const fieldInput = { flex: 1, color: "#1f2937", fontWeight: "800", fontSize: 16, paddingVertical: 2 } as const;
const eyeButton = { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" } as const;
const forgotLink = { alignSelf: "flex-end", paddingVertical: 4 } as const;
const forgotText = { color: theme.colors.primary, fontWeight: "900", fontSize: 14 } as const;
const primaryButton = { minHeight: 60, borderRadius: 24, alignItems: "center", justifyContent: "center", marginTop: 10 } as const;
const primaryText = { color: "#fff", fontWeight: "900", fontSize: 17 } as const;
const bottomLink = { marginTop: "auto", minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 } as const;
const bottomText = { color: "#53615b", fontWeight: "800", fontSize: 15 } as const;
const bottomStrong = { color: "#1f2937", fontWeight: "900", fontSize: 15 } as const;
