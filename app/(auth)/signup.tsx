// app/(auth)/signup.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
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
import { getPostAuthHref } from "../../src/lib/postAuthHref";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { OB, OnboardingBackground } from "../../src/ui/OnboardingKit";
import { supabase } from "../../src/lib/supabase";
import {
  getEmailDomainSuggestion,
  getSignupErrorMessage,
  isValidEmail,
  normalizeEmail,
  validateSignupCredentials,
} from "../../src/lib/authValidation";
import { PasswordSecurityGuide } from "../../src/ui/PasswordSecurityGuide";

type FocusKey = "name" | "email" | "password" | "confirm" | null;

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
  autoComplete,
  returnKeyType,
  onSubmitEditing,
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
  autoComplete?: TextInputProps["autoComplete"];
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
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
          autoCapitalize={keyboardType === "email-address" || typeof secureTextEntry === "boolean" ? "none" : "words"}
          autoComplete={autoComplete}
          autoCorrect={false}
          accessibilityLabel={label}
          onFocus={onFocus}
          onBlur={onBlur}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
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
  const pendingScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualScrollRef = useRef(false);
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
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const credentialsValidation = useMemo(
    () => validateSignupCredentials({ email, password, confirmPassword: confirm }),
    [confirm, email, password]
  );
  const passwordValidation = credentialsValidation.password;
  const emailSuggestion = useMemo(() => getEmailDomainSuggestion(email), [email]);
  const formValid = useMemo(
    () => name.trim().length >= 2 && credentialsValidation.isValid,
    [credentialsValidation.isValid, name]
  );
  const canSubmit = formValid && !loading;
  const showEmailError = emailTouched && !isValidEmail(email);
  const passwordsMismatch = confirm.length > 0 && password !== confirm;

  const clearPendingScroll = useCallback(() => {
    if (pendingScrollRef.current === null) return;
    clearTimeout(pendingScrollRef.current);
    pendingScrollRef.current = null;
  }, []);

  const cancelPendingScroll = useCallback(() => {
    manualScrollRef.current = true;
    clearPendingScroll();
  }, [clearPendingScroll]);

  const scrollToField = useCallback((key: FocusKey, delay = 40) => {
    clearPendingScroll();
    if (manualScrollRef.current) return;
    if (!key) return;
    const y = fieldY.current[key];
    if (typeof y !== "number") return;
    const fieldTopOnPage = cardY.current + formY.current + y;
    const targetTop = key === "confirm" ? 150 : key === "password" ? 80 : 18;

    pendingScrollRef.current = setTimeout(() => {
      pendingScrollRef.current = null;
      scrollRef.current?.scrollTo({ y: Math.max(fieldTopOnPage - targetTop, 0), animated: true });
    }, delay);
  }, [clearPendingScroll]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardVisible(true);

      const applyInset = (inset: number) => {
        setKeyboardInset(inset);
        if (!manualScrollRef.current && focusedRef.current) {
          scrollToField(focusedRef.current, 90);
        }
      };

      if (Platform.OS === "ios") {
        applyInset(event.endCoordinates.height);
        return;
      }

      const scrollView = scrollRef.current?.getNativeScrollRef();
      if (!scrollView) {
        applyInset(0);
        return;
      }

      scrollView.measureInWindow((_x, y, _width, height) => {
        const overlap = Math.max(
          0,
          Math.min(event.endCoordinates.height, y + height - event.endCoordinates.screenY)
        );
        applyInset(overlap);
      });
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
      setKeyboardInset(0);
      focusedRef.current = null;
      manualScrollRef.current = false;
      clearPendingScroll();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      clearPendingScroll();
    };
  }, [clearPendingScroll, scrollToField]);

  function focusField(key: FocusKey) {
    manualScrollRef.current = false;
    focusedRef.current = key;
    setFocused(key);

    scrollToField(key, keyboardVisible ? 40 : 220);
  }

  function blurField(key: FocusKey) {
    setFocused((current) => (current === key ? null : current));
    if (focusedRef.current === key) focusedRef.current = null;
  }

  async function onSignup() {
    if (loading) return;

    const finalValidation = validateSignupCredentials({ email, password, confirmPassword: confirm });
    if (name.trim().length < 2) {
      Alert.alert("Confira seu nome", "Informe seu nome para criar a conta.");
      return;
    }
    if (!finalValidation.emailValid) {
      setEmailTouched(true);
      Alert.alert("E-mail inválido", "Digite um e-mail válido.");
      return;
    }
    if (!finalValidation.password.isValid) {
      Alert.alert("Senha insegura", "Sua senha ainda não atende aos requisitos de segurança.");
      return;
    }
    if (!finalValidation.passwordsMatch) {
      Alert.alert("Confira as senhas", "As senhas não coincidem.");
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email: finalValidation.normalizedEmail,
        password,
        options: { data: { full_name: name.trim() } },
      });

      if (error) throw error;

      if (data.session) {
        router.replace(getPostAuthHref(data.session));
        return;
      }

      Alert.alert(
        "Confirme seu e-mail",
        "Enviamos um link de confirmação para seu e-mail. Depois de confirmar, volte ao app para entrar."
      );
      router.replace("/(auth)/login");
    } catch (error: unknown) {
      Alert.alert("Não foi possível criar a conta", getSignupErrorMessage(error));
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
              { paddingBottom: 28 + (keyboardInset ? keyboardInset + 24 : 0) },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            onScrollBeginDrag={cancelPendingScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topBar}>
              <Pressable
                onPress={() => router.replace("/(auth)/login")}
                style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="Voltar para entrar"
              >
                <Ionicons name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"} size={20} color="#fff" />
              </Pressable>
              <Text style={styles.brandName}>Sonho+</Text>
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
                  autoComplete="name"
                  focused={focused === "name"}
                  onFocus={() => focusField("name")}
                  onBlur={() => blurField("name")}
                  onLayout={(y) => {
                    fieldY.current.name = y;
                  }}
                />
                <View onLayout={(event) => { fieldY.current.email = event.nativeEvent.layout.y; }}>
                  <AuthField
                    icon="mail-outline"
                    label="E-mail"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="seu@email.com"
                    keyboardType="email-address"
                    autoComplete="email"
                    focused={focused === "email"}
                    onFocus={() => focusField("email")}
                    onBlur={() => {
                      setEmail(normalizeEmail(email));
                      setEmailTouched(true);
                      blurField("email");
                    }}
                  />
                  {emailSuggestion ? (
                    <Pressable
                      onPress={() => {
                        setEmail(emailSuggestion);
                        setEmailTouched(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Corrigir e-mail para ${emailSuggestion}`}
                      style={({ pressed }) => [styles.emailSuggestion, pressed && styles.helperPressed]}
                    >
                      <Ionicons name="bulb-outline" size={14} color={OB.primary} />
                      <Text style={styles.emailSuggestionText}>Você quis dizer <Text style={styles.emailSuggestionStrong}>{emailSuggestion}</Text>?</Text>
                    </Pressable>
                  ) : null}
                  {showEmailError ? (
                    <Text style={styles.fieldError} accessibilityLiveRegion="polite">Digite um e-mail válido.</Text>
                  ) : null}
                </View>
                <View onLayout={(event) => { fieldY.current.password = event.nativeEvent.layout.y; }}>
                  <AuthField
                    icon="lock-closed-outline"
                    label="Senha"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Crie uma senha forte"
                    secureTextEntry={!showPassword}
                    autoComplete="new-password"
                    focused={focused === "password"}
                    onFocus={() => focusField("password")}
                    onBlur={() => blurField("password")}
                    right={
                      <Pressable
                        onPress={() => setShowPassword((value) => !value)}
                        style={styles.eyeButton}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      >
                        <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={19} color={showPassword ? OB.primary : OB.support} />
                      </Pressable>
                    }
                  />
                  {focused === "password" || password.length > 0 ? (
                    <PasswordSecurityGuide validation={passwordValidation} />
                  ) : null}
                </View>
                <View onLayout={(event) => { fieldY.current.confirm = event.nativeEvent.layout.y; }}>
                  <AuthField
                    icon="shield-checkmark-outline"
                    label="Confirmar senha"
                    value={confirm}
                    onChangeText={setConfirm}
                    placeholder="Repita sua senha"
                    secureTextEntry={!showConfirm}
                    autoComplete="new-password"
                    focused={focused === "confirm"}
                    onFocus={() => focusField("confirm")}
                    onBlur={() => blurField("confirm")}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      Keyboard.dismiss();
                      if (canSubmit) void onSignup();
                    }}
                    right={
                      <Pressable
                        onPress={() => setShowConfirm((value) => !value)}
                        style={styles.eyeButton}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={showConfirm ? "Ocultar confirmação da senha" : "Mostrar confirmação da senha"}
                      >
                        <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={19} color={showConfirm ? OB.primary : OB.support} />
                      </Pressable>
                    }
                  />
                  {passwordsMismatch ? (
                    <Text style={styles.fieldError} accessibilityLiveRegion="polite">As senhas não coincidem.</Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                onPress={onSignup}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit, busy: loading }}
                style={[styles.primaryTouch, !formValid && styles.disabled]}
              >
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
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonPressed: {
    opacity: 0.72,
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
  emailSuggestion: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 3,
  },
  helperPressed: { opacity: 0.7 },
  emailSuggestionText: { flex: 1, color: OB.support, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  emailSuggestionStrong: { color: OB.primary, fontWeight: "900" },
  fieldError: { color: "#A33A3A", fontSize: 11, lineHeight: 16, fontWeight: "800", marginTop: 6, paddingHorizontal: 3 },
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
