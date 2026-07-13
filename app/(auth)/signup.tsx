// app/(auth)/signup.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { OB, OnboardingBackground } from "../../src/ui/OnboardingKit";
import { supabase } from "../../src/lib/supabase";

type FocusKey = "name" | "email" | "password" | "confirm" | null;

function isValidEmail(value: string) {
  const email = value.trim();
  return email.includes("@") && email.includes(".");
}

function AuthField({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  focused,
  onFocus,
  onBlur,
  onLayout,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: TextInputProps["keyboardType"];
  secureTextEntry?: boolean;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onLayout?: (y: number) => void;
  right?: React.ReactNode;
}) {
  return (
    <View onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.field, focused && styles.fieldActive]}>
        <Ionicons name={icon} size={18} color={focused ? OB.primary : OB.support} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={OB.support}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
          autoCorrect={false}
          onFocus={onFocus}
          onBlur={onBlur}
          style={styles.fieldInput}
        />
        {right}
      </View>
    </View>
  );
}

export default function SignupScreen() {
  const background = useMemo(() => <OnboardingBackground />, []);
  const scrollRef = useRef<ScrollView>(null);
  const focusedRef = useRef<FocusKey>(null);
  const fieldY = useRef<Record<string, number>>({});
  const cardY = useRef(0);
  const formY = useRef(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<FocusKey>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const canSubmit = useMemo(
    () => name.trim().length >= 2 && isValidEmail(email) && password.length >= 6 && password === confirm && !loading,
    [confirm, email, loading, name, password]
  );
  const passwordKeyboardLocked = keyboardHeight > 0 && (focused === "password" || focused === "confirm");

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      if (focusedRef.current === "password" || focusedRef.current === "confirm") {
        scrollToField(focusedRef.current, 90);
      }
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
      focusedRef.current = null;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  function scrollToField(key: FocusKey, delay = 40) {
    if (!key) return;
    const y = fieldY.current[key];
    if (typeof y !== "number") return;
    const fieldTopOnPage = cardY.current + formY.current + y;
    const targetTop = key === "confirm" ? 248 : key === "password" ? 260 : 18;

    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(fieldTopOnPage - targetTop, 0), animated: true });
    }, delay);
  }

  function focusField(key: FocusKey) {
    focusedRef.current = key;
    setFocused(key);

    if (key === "password" || key === "confirm") {
      scrollToField(key, keyboardHeight ? 40 : 220);
    }
  }

  function blurField(key: FocusKey) {
    setFocused((current) => (current === key ? null : current));
    if (focusedRef.current === key) focusedRef.current = null;
  }

  async function onSignup() {
    if (!canSubmit) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: name.trim() } },
      });

      if (error) throw error;

      if (data.session) {
        router.replace("/");
        return;
      }

      Alert.alert("Conta criada", "Agora entre com seu e-mail e senha para começar.");
      router.replace("/(auth)/login");
    } catch (error: any) {
      Alert.alert("Erro ao criar conta", error?.message ?? "Não foi possível criar sua conta agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" backgroundColor="transparent" translucent />
      {background}
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: 28 + (keyboardHeight ? keyboardHeight + 24 : 0) },
            ]}
            scrollEnabled={!passwordKeyboardLocked}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topBar}>
              <Pressable onPress={() => router.replace("/(auth)/login")} style={styles.backButton} hitSlop={12}>
                <Ionicons name="arrow-back" size={18} color="#fff" />
              </Pressable>
              <Text style={styles.brandName}>FinApp</Text>
            </View>

            <View style={styles.copyBlock}>
              <Text style={styles.eyebrow}>Novo começo</Text>
              <Text style={styles.headline}>Crie sua conta e monte seu plano financeiro.</Text>
              <Text style={styles.subhead}>Vamos começar pelo que importa: seus sonhos, sua rotina e seu controle.</Text>
            </View>

            <View
              style={styles.card}
              onLayout={(event) => {
                cardY.current = event.nativeEvent.layout.y;
              }}
            >
              <Text style={styles.cardTitle}>Criar conta</Text>
              <Text style={styles.cardText}>Use seus dados para acessar o novo fluxo do app.</Text>

              <View
                style={styles.form}
                onLayout={(event) => {
                  formY.current = event.nativeEvent.layout.y;
                }}
              >
                <AuthField
                  icon="person-outline"
                  label="Nome"
                  value={name}
                  onChangeText={setName}
                  placeholder="Seu nome completo"
                  focused={focused === "name"}
                  onFocus={() => focusField("name")}
                  onBlur={() => blurField("name")}
                  onLayout={(y) => {
                    fieldY.current.name = y;
                  }}
                />
                <AuthField
                  icon="mail-outline"
                  label="E-mail"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="seu@email.com"
                  keyboardType="email-address"
                  focused={focused === "email"}
                  onFocus={() => focusField("email")}
                  onBlur={() => blurField("email")}
                  onLayout={(y) => {
                    fieldY.current.email = y;
                  }}
                />
                <AuthField
                  icon="lock-closed-outline"
                  label="Senha"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Mínimo de 6 caracteres"
                  secureTextEntry={!showPassword}
                  focused={focused === "password"}
                  onFocus={() => focusField("password")}
                  onBlur={() => blurField("password")}
                  onLayout={(y) => {
                    fieldY.current.password = y;
                  }}
                  right={
                    <Pressable onPress={() => setShowPassword((value) => !value)} style={styles.eyeButton} hitSlop={10}>
                      <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={19} color={showPassword ? OB.primary : OB.support} />
                    </Pressable>
                  }
                />
                <AuthField
                  icon="shield-checkmark-outline"
                  label="Confirmar senha"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Repita sua senha"
                  secureTextEntry={!showConfirm}
                  focused={focused === "confirm"}
                  onFocus={() => focusField("confirm")}
                  onBlur={() => blurField("confirm")}
                  onLayout={(y) => {
                    fieldY.current.confirm = y;
                  }}
                  right={
                    <Pressable onPress={() => setShowConfirm((value) => !value)} style={styles.eyeButton} hitSlop={10}>
                      <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={19} color={showConfirm ? OB.primary : OB.support} />
                    </Pressable>
                  }
                />
              </View>

              <Pressable onPress={onSignup} disabled={!canSubmit} style={[styles.primaryTouch, !canSubmit && styles.disabled]}>
                <LinearGradient colors={["#06152e", OB.primary, "#163870"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
                  {loading ? (
                    <View style={styles.loadingContent}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.primaryText}>Criando...</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryText}>Criar conta</Text>
                  )}
                </LinearGradient>
              </Pressable>

              <Pressable onPress={() => router.replace("/(auth)/login")} style={styles.loginLink}>
                <Text style={styles.loginText}>Já tem uma conta?</Text>
                <Text style={styles.loginStrong}>Entrar</Text>
              </Pressable>
            </View>
          </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: OB.primaryDeep,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  brandName: {
    color: OB.textOnDark,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2.3,
    textTransform: "uppercase",
  },
  copyBlock: {
    paddingTop: 42,
    paddingBottom: 26,
  },
  eyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  headline: {
    color: OB.textOnDark,
    fontSize: 29,
    fontWeight: "900",
    lineHeight: 35,
    marginTop: 12,
  },
  subhead: {
    color: OB.textOnDarkMid,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.97)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.78)",
    shadowColor: OB.primary,
    shadowOpacity: 0.32,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
  },
  cardTitle: {
    color: OB.primary,
    fontSize: 22,
    fontWeight: "900",
  },
  cardText: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 4,
  },
  form: {
    gap: 11,
    marginTop: 18,
  },
  fieldLabel: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  field: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: OB.offWhite,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 15,
  },
  fieldActive: {
    backgroundColor: "#fff",
    borderColor: OB.primary,
  },
  fieldInput: {
    flex: 1,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "800",
    paddingVertical: 1,
  },
  eyeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryTouch: {
    borderRadius: 16,
    marginTop: 18,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.48,
  },
  loadingContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  primaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  loginLink: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
  },
  loginText: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "800",
  },
  loginStrong: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
});
