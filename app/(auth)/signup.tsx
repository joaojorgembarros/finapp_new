// app/(auth)/signup.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import * as NavigationBar from "expo-navigation-bar";
import { router } from "expo-router";
import { getPostAuthHref } from "../../src/lib/postAuthHref";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../src/lib/supabase";
import {
  getEmailDomainSuggestion,
  getSignupErrorMessage,
  isValidEmail,
  normalizeEmail,
  validateSignupCredentials,
} from "../../src/lib/authValidation";
import { PasswordSecurityGuide } from "../../src/ui/PasswordSecurityGuide";

const NAVY = "#06152E";
const WHITE = "#FFFFFF";
const SECONDARY = "#8C9AAE";
const BORDER = "rgba(140, 154, 174, 0.38)";
const SYMBOL = require("../../assets/splash-brand-symbol.png");

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
        <Ionicons name={icon} size={22} color={WHITE} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={SECONDARY}
          keyboardType={keyboardType}
          keyboardAppearance="dark"
          secureTextEntry={secureTextEntry}
          autoCapitalize={keyboardType === "email-address" || typeof secureTextEntry === "boolean" ? "none" : "words"}
          autoComplete={autoComplete}
          autoCorrect={false}
          accessibilityLabel={label}
          onFocus={onFocus}
          onBlur={onBlur}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          selectionColor={WHITE}
          style={styles.fieldInput}
        />
        {right}
      </View>
    </View>
  );
}

export default function SignupScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const pendingScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualScrollRef = useRef(false);
  const focusedRef = useRef<FocusKey>(null);
  const fieldY = useRef<Record<string, number>>({});
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
    const fieldTopOnPage = formY.current + y;
    const targetTop = key === "confirm" ? 150 : key === "password" ? 80 : 18;

    pendingScrollRef.current = setTimeout(() => {
      pendingScrollRef.current = null;
      scrollRef.current?.scrollTo({ y: Math.max(fieldTopOnPage - targetTop, 0), animated: true });
    }, delay);
  }, [clearPendingScroll]);

  useEffect(() => {
    if (Platform.OS === "android") {
      NavigationBar.setBackgroundColorAsync(NAVY).catch(() => {});
      NavigationBar.setButtonStyleAsync("light").catch(() => {});
    }

    const showSub = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardVisible(true);

      const applyInset = (inset: number) => {
        setKeyboardInset(inset);
        if (!manualScrollRef.current && focusedRef.current) {
          scrollToField(focusedRef.current, 90);
        }
      };

      if (Platform.OS === "ios") {
        applyInset(0);
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
      if (Platform.OS === "android") {
        NavigationBar.setBackgroundColorAsync("#f8fafc").catch(() => {});
        NavigationBar.setButtonStyleAsync("dark").catch(() => {});
      }
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
      router.replace("/(auth)/email-login");
    } catch (error: unknown) {
      Alert.alert("Não foi possível criar a conta", getSignupErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" backgroundColor={NAVY} />
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardAvoiding}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: 18 + (keyboardInset ? keyboardInset + 24 : 0) },
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
                hitSlop={8}
              >
                <Ionicons
                  name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
                  size={28}
                  color={WHITE}
                />
              </Pressable>
            </View>

            <View style={styles.heading}>
              <Image
                accessible={false}
                resizeMode="contain"
                source={SYMBOL}
                style={styles.symbol}
                tintColor={WHITE}
              />
              <Text style={styles.title}>Crie sua conta</Text>
              <Text style={styles.subtitle}>Comece hoje a organizar seus sonhos.</Text>
            </View>

            <View
              style={styles.form}
              onLayout={(event) => {
                formY.current = event.nativeEvent.layout.y;
              }}
            >
              <AuthField
                icon="person-outline"
                label="Nome completo"
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
                    <Ionicons name="bulb-outline" size={14} color={WHITE} />
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
                      <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={WHITE} />
                    </Pressable>
                  }
                />
                {focused === "password" || password.length > 0 ? (
                  <PasswordSecurityGuide validation={passwordValidation} tone="dark" />
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
                      <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={22} color={WHITE} />
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
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && canSubmit && styles.primaryPressed,
                !formValid && styles.disabled,
              ]}
            >
              {loading ? (
                <View style={styles.loadingContent}>
                  <ActivityIndicator color={NAVY} size="small" />
                  <Text style={styles.primaryText}>Criando...</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.primaryText}>Criar conta</Text>
                  <Ionicons name="arrow-forward" size={27} color={NAVY} style={styles.primaryArrow} />
                </>
              )}
            </Pressable>

            <Pressable
              onPress={() => router.replace("/(auth)/login")}
              style={({ pressed }) => [styles.loginLink, pressed && styles.helperPressed]}
              accessibilityRole="button"
              accessibilityLabel="Entrar em uma conta existente"
            >
              <Text style={styles.loginText}>Já tem uma conta?</Text>
              <Text style={styles.loginStrong}>Entrar</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: NAVY,
  },
  safeArea: {
    flex: 1,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 18,
  },
  topBar: {
    height: 58,
    justifyContent: "center",
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
  backButtonPressed: {
    opacity: 0.72,
  },
  heading: {
    alignItems: "center",
    marginTop: -18,
    marginBottom: 42,
  },
  symbol: {
    width: 76,
    height: 88,
    marginBottom: 20,
  },
  title: {
    color: WHITE,
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 38,
    textAlign: "center",
  },
  subtitle: {
    maxWidth: 240,
    marginTop: 8,
    color: SECONDARY,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
    textAlign: "center",
  },
  form: {
    gap: 12,
  },
  fieldLabel: {
    color: SECONDARY,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  field: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
  },
  fieldActive: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.72)",
  },
  fieldInput: {
    flex: 1,
    color: WHITE,
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: 1,
  },
  eyeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -6,
  },
  emailSuggestion: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 3,
  },
  helperPressed: { opacity: 0.7 },
  emailSuggestionText: { flex: 1, color: SECONDARY, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  emailSuggestionStrong: { color: WHITE, fontWeight: "900" },
  fieldError: { color: "#F2A7A7", fontSize: 11, lineHeight: 16, fontWeight: "800", marginTop: 6, paddingHorizontal: 3 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    backgroundColor: WHITE,
  },
  primaryPressed: {
    opacity: 0.86,
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
    color: NAVY,
    fontSize: 16,
    fontWeight: "700",
  },
  primaryArrow: {
    position: "absolute",
    right: 24,
  },
  loginLink: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  loginText: {
    color: SECONDARY,
    fontSize: 14,
    fontWeight: "500",
  },
  loginStrong: {
    color: WHITE,
    fontSize: 14,
    fontWeight: "700",
  },
});
