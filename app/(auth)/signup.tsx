// app/(auth)/signup.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
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

type FocusKey = "name" | "email" | "password" | "confirm" | null;

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
      <Ionicons name={icon} size={20} color={focused ? theme.colors.primary : "#6b7280"} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6b7280"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
        autoCorrect={false}
        onFocus={onFocus}
        onBlur={onBlur}
        style={fieldInput}
      />
      {right}
    </View>
  );
}

export default function SignupScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<FocusKey>(null);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const lift = useRef(new Animated.Value(0)).current;
  const lastFocused = useRef<FocusKey>(null);
  const liftTarget = Platform.OS === "android" ? (focused === "confirm" ? -86 : focused === "password" ? -64 : 0) : 0;

  const canSubmit = useMemo(
    () => name.trim().length >= 2 && isValidEmail(email) && pass.trim().length >= 6 && pass === confirm && !loading,
    [name, email, pass, confirm, loading]
  );

  useEffect(() => {
    Animated.timing(lift, {
      toValue: liftTarget,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [lift, liftTarget]);

  useEffect(() => {
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setFocused(null));
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      if (lastFocused.current) setFocused(lastFocused.current);
    });
    return () => {
      hideSub.remove();
      showSub.remove();
    };
  }, []);

  function focusField(key: FocusKey) {
    lastFocused.current = key;
    setFocused(key);
  }

  function blurField(key: FocusKey) {
    setFocused((current) => (current === key ? null : current));
    if (lastFocused.current === key) lastFocused.current = null;
  }

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
      Alert.alert("Erro ao criar conta", err?.message ?? "Nao foi possivel criar sua conta agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={keyboard}>
        <Animated.View style={[root, { transform: [{ translateY: lift }] }]}>
          <Pressable onPress={() => router.replace("/(auth)/login")} hitSlop={12} style={backButton}>
            <Ionicons name="chevron-back" size={24} color="#26352d" />
          </Pressable>

          <View style={brandBlock}>
            <Text style={brand}>FinApp</Text>
            <Text style={headline}>Comece seu plano</Text>
            <Text style={subhead}>Crie sua conta para montar metas e acompanhar seu dinheiro.</Text>
          </View>

          <View style={form}>
            <AuthField
              icon="person-outline"
              value={name}
              onChangeText={setName}
              placeholder="Nome completo"
              focused={focused === "name"}
              onFocus={() => focusField("name")}
              onBlur={() => blurField("name")}
            />
            <AuthField
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="E-mail"
              keyboardType="email-address"
              focused={focused === "email"}
              onFocus={() => focusField("email")}
              onBlur={() => blurField("email")}
            />
            <AuthField
              icon="lock-closed-outline"
              value={pass}
              onChangeText={setPass}
              placeholder="Senha"
              secureTextEntry={!showPass}
              focused={focused === "password"}
              onFocus={() => focusField("password")}
              onBlur={() => blurField("password")}
              right={
                <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10} style={eyeButton}>
                  <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={20} color="#52605a" />
                </Pressable>
              }
            />
            <AuthField
              icon="shield-checkmark-outline"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Confirmar senha"
              secureTextEntry={!showConfirm}
              focused={focused === "confirm"}
              onFocus={() => focusField("confirm")}
              onBlur={() => blurField("confirm")}
              right={
                <Pressable onPress={() => setShowConfirm((v) => !v)} hitSlop={10} style={eyeButton}>
                  <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={20} color="#52605a" />
                </Pressable>
              }
            />

            <Pressable onPress={onSignup} disabled={!canSubmit} style={{ opacity: canSubmit ? 1 : 0.48 }}>
              <LinearGradient
                colors={["#2563eb", "#9333ea"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={primaryButton}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={primaryText}>Criar conta</Text>}
              </LinearGradient>
            </Pressable>
          </View>

          <Pressable onPress={() => router.replace("/(auth)/login")} style={bottomLink}>
            <Text style={bottomText}>Ja tem uma conta?</Text>
            <Text style={bottomStrong}>Entrar</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const screen = { flex: 1, backgroundColor: "#f7faf7" } as const;
const keyboard = { flex: 1 } as const;
const root = { flex: 1, paddingHorizontal: 28, paddingTop: 18, paddingBottom: Platform.OS === "android" ? 54 : 30 } as const;
const backButton = { width: 44, height: 44, borderRadius: 18, alignItems: "center", justifyContent: "center", marginLeft: -10 } as const;
const brandBlock = { alignItems: "center", marginTop: 10, marginBottom: 34 } as const;
const brand = { color: "#1f2937", fontWeight: "900", fontSize: 38, letterSpacing: 0 } as const;
const headline = { color: "#26352d", fontWeight: "900", fontSize: 23, textAlign: "center", marginTop: 20, letterSpacing: 0 } as const;
const subhead = { color: "#66736d", fontWeight: "700", fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8 } as const;
const form = { gap: 12 } as const;
const field = { minHeight: 58, borderRadius: 19, backgroundColor: "#e5ebe4", flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 17, borderWidth: 1, borderColor: "transparent" } as const;
const fieldActive = { backgroundColor: "#fff", borderColor: "rgba(37,99,235,0.36)" } as const;
const fieldInput = { flex: 1, color: "#1f2937", fontWeight: "800", fontSize: 15, paddingVertical: 1 } as const;
const eyeButton = { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" } as const;
const primaryButton = { minHeight: 58, borderRadius: 24, alignItems: "center", justifyContent: "center", marginTop: 10 } as const;
const primaryText = { color: "#fff", fontWeight: "900", fontSize: 17 } as const;
const bottomLink = { marginTop: "auto", minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 } as const;
const bottomText = { color: "#53615b", fontWeight: "800", fontSize: 15 } as const;
const bottomStrong = { color: "#1f2937", fontWeight: "900", fontSize: 15 } as const;
