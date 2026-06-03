import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
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

function loginErrorMessage(err: any) {
  const message = String(err?.message ?? "");
  const lower = message.toLowerCase();
  if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
    return "Confirme seu e-mail antes de entrar. Enviamos um link para o endereço usado no cadastro.";
  }
  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return "Não encontramos uma conta com esse e-mail ou a senha está incorreta. Confira os dados ou crie uma conta nova.";
  }
  return message || "Não foi possível entrar agora.";
}

function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  inputRef,
  returnKeyType,
  onSubmitEditing,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: any;
  inputRef?: React.RefObject<TextInput | null>;
  returnKeyType?: "done" | "go" | "next";
  onSubmitEditing?: () => void;
}) {
  return (
    <View>
      <Text style={{ color: theme.colors.text, fontWeight: "800", marginBottom: 8 }}>{label}</Text>
      <View style={fieldWrap}>
        <Ionicons name={icon} size={20} color={theme.colors.muted2} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.muted2}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, color: theme.colors.text, fontWeight: "800", paddingVertical: 2 }}
        />
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const passRef = useRef<TextInput | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const canSubmit = useMemo(() => isValidEmail(email) && pass.trim().length >= 6 && !loading, [email, pass, loading]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  async function onLogin() {
    if (!canSubmit) return;
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      });
      if (error) throw error;
      router.replace("/");
    } catch (err: any) {
      Alert.alert("Não foi possível entrar", loginErrorMessage(err));
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          enabled={Platform.OS === "ios"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={authRoot}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={{ alignItems: "center", marginBottom: 28 }}>
              <View style={logoBox}>
                <Ionicons name="wallet-outline" size={42} color="#fff" />
              </View>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 40, marginTop: 16 }}>FinApp</Text>
              <Text style={{ color: "rgba(255,255,255,0.82)", fontWeight: "800", marginTop: 4 }}>
                Suas finanças sob controle
              </Text>
            </View>

            <BlurView intensity={28} tint="light" style={authCard}>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 24, marginBottom: 20 }}>
                Bem-vindo de volta
              </Text>

              <View style={{ gap: 16 }}>
                <Field
                  label="E-mail"
                  icon="mail-outline"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="seu@email.com"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => passRef.current?.focus()}
                />
                <Field
                  label="Senha"
                  icon="lock-closed-outline"
                  value={pass}
                  onChangeText={setPass}
                  placeholder="••••••••"
                  secureTextEntry
                  inputRef={passRef}
                  returnKeyType="go"
                  onSubmitEditing={onLogin}
                />

                <Pressable onPress={onForgot} style={{ alignSelf: "flex-end" }}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>Esqueceu a senha?</Text>
                </Pressable>

                <Pressable
                  onPress={onLogin}
                  disabled={!canSubmit}
                  style={{ borderRadius: 18, overflow: "hidden", opacity: canSubmit ? 1 : 0.58 }}
                >
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
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      {Platform.OS === "android" && !keyboardVisible ? <View pointerEvents="none" style={androidNavGuard} /> : null}
    </LinearGradient>
  );
}

const authRoot = { flexGrow: 1, paddingHorizontal: 18, paddingVertical: 24, justifyContent: "center" } as const;
const logoBox = { width: 82, height: 82, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.24)" } as const;
const authCard = { borderRadius: 28, overflow: "hidden", padding: 24, backgroundColor: "rgba(255,255,255,0.94)", ...theme.shadow } as const;
const fieldWrap = { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "#f8fafc", paddingHorizontal: 14, paddingVertical: 12 } as const;
const primaryBtn = { paddingVertical: 15, alignItems: "center", justifyContent: "center" } as const;
const primaryBtnText = { color: "#fff", fontWeight: "900", fontSize: 16 } as const;
const androidNavGuard = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: 48,
  backgroundColor: theme.colors.bg2,
  zIndex: 20,
  elevation: 20,
} as const;
