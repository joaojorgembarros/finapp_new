import React, { useEffect, useRef, useState } from "react";
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
import { router } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { getPostAuthHref } from "../../src/lib/postAuthHref";
import { supabase } from "../../src/lib/supabase";
import { requestPasswordReset } from "../../src/lib/auth";
import {
  getLoginErrorMessage,
  getPasswordResetRequestErrorMessage,
  isValidEmail,
  normalizeEmail,
} from "../../src/lib/authValidation";

const NAVY = "#06152E";
const CREAM = "#FDECD6";
const SECONDARY = "#8C9AAE";
const BORDER = "rgba(253, 236, 214, 0.28)";
const SYMBOL = require("../../assets/splash-brand-symbol.png");

type FocusKey = "email" | "password" | null;

function AuthField({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoComplete,
  focused,
  keyboardVisible,
  disabled,
  onFocus,
  onBlur,
  right,
  inputRef,
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
  autoComplete?: TextInputProps["autoComplete"];
  focused: boolean;
  keyboardVisible: boolean;
  disabled: boolean;
  onFocus: () => void;
  onBlur: () => void;
  right?: React.ReactNode;
  inputRef?: React.RefObject<TextInput | null>;
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
}) {
  const localInputRef = useRef<TextInput>(null);
  const refocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = inputRef ?? localInputRef;

  useEffect(() => () => {
    if (refocusTimer.current) clearTimeout(refocusTimer.current);
  }, []);

  function focusInput() {
    if (disabled) return;
    if (refocusTimer.current) clearTimeout(refocusTimer.current);

    if (Platform.OS === "android" && !keyboardVisible) {
      ref.current?.blur();
      refocusTimer.current = setTimeout(() => {
        ref.current?.focus();
        refocusTimer.current = null;
      }, 30);
      return;
    }

    ref.current?.focus();
  }

  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={focusInput}
        style={[styles.field, focused && styles.fieldFocused, disabled && styles.disabledField]}
      >
        <Ionicons name={icon} size={19} color={focused ? CREAM : SECONDARY} />
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          autoCapitalize="none"
          autoComplete={autoComplete}
          autoCorrect={false}
          editable={!disabled}
          keyboardAppearance="dark"
          keyboardType={keyboardType}
          onBlur={onBlur}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onPressIn={focusInput}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={SECONDARY}
          returnKeyType={returnKeyType}
          secureTextEntry={secureTextEntry}
          selectionColor={CREAM}
          style={styles.fieldInput}
          value={value}
        />
        {right}
      </Pressable>
    </View>
  );
}

export default function EmailLoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<FocusKey>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (Platform.OS === "android") {
      NavigationBar.setBackgroundColorAsync(NAVY).catch(() => {});
      NavigationBar.setButtonStyleAsync("light").catch(() => {});
    }

    const keyboardShowEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const keyboardHideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(keyboardShowEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(keyboardHideEvent, () => {
      setKeyboardVisible(false);
      setFocused(null);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      if (Platform.OS === "android") {
        NavigationBar.setBackgroundColorAsync("#f8fafc").catch(() => {});
        NavigationBar.setButtonStyleAsync("dark").catch(() => {});
      }
    };
  }, []);

  async function onLogin() {
    if (loading) return;
    if (!isValidEmail(email)) {
      Alert.alert("E-mail inválido", "Digite um e-mail válido para continuar.");
      return;
    }
    if (password.trim().length < 6) {
      Alert.alert("Senha incompleta", "Digite sua senha com pelo menos 6 caracteres.");
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
      if (error) throw error;
      if (!data.user?.id) throw new Error("Não foi possível identificar sua conta.");
      router.replace(getPostAuthHref(data.session));
    } catch (error: unknown) {
      Alert.alert("Não foi possível entrar", getLoginErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function onForgotPassword() {
    if (loading) return;
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      Alert.alert("Recuperar senha", "Digite seu e-mail primeiro.");
      return;
    }

    try {
      setLoading(true);
      await requestPasswordReset(normalizedEmail);
      Alert.alert("Enviado", "Te mandei um e-mail para redefinir sua senha.");
    } catch (error: unknown) {
      Alert.alert("Não foi possível enviar", getPasswordResetRequestErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" backgroundColor={NAVY} />
      <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboard}
        >
          <ScrollView
            contentContainerStyle={[styles.content, keyboardVisible && styles.contentWithKeyboard]}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Voltar para escolher outra forma de acesso"
                hitSlop={8}
                onPress={() => router.replace("/(auth)/login")}
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              >
                <Ionicons
                  name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
                  size={28}
                  color={CREAM}
                />
              </Pressable>
            </View>

            <View style={styles.body}>
              <View style={styles.heading}>
                <Image
                  accessible={false}
                  resizeMode="contain"
                  source={SYMBOL}
                  style={styles.symbol}
                  tintColor={CREAM}
                />
                <Text style={styles.title}>Entre na sua conta</Text>
                <Text style={styles.subtitle}>Acesse com seu e-mail e senha.</Text>
              </View>

              <View style={styles.form}>
                <AuthField
                  icon="mail-outline"
                  label="E-mail"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="seu@email.com"
                  keyboardType="email-address"
                  autoComplete="email"
                  focused={focused === "email"}
                  keyboardVisible={keyboardVisible}
                  disabled={loading}
                  onFocus={() => setFocused("email")}
                  onBlur={() => {
                    setEmail(normalizeEmail(email));
                    setFocused(null);
                  }}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />

                <AuthField
                  icon="lock-closed-outline"
                  label="Senha"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Sua senha"
                  secureTextEntry={!showPassword}
                  autoComplete="current-password"
                  focused={focused === "password"}
                  keyboardVisible={keyboardVisible}
                  disabled={loading}
                  inputRef={passwordInputRef}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    Keyboard.dismiss();
                    void onLogin();
                  }}
                  right={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      disabled={loading}
                      hitSlop={10}
                      onPress={() => setShowPassword((visible) => !visible)}
                      style={styles.eyeButton}
                    >
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={20}
                        color={showPassword ? CREAM : SECONDARY}
                      />
                    </Pressable>
                  }
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Recuperar senha"
                  disabled={loading}
                  hitSlop={8}
                  onPress={onForgotPassword}
                  style={({ pressed }) => [styles.forgotButton, pressed && styles.pressed]}
                >
                  <Text style={styles.forgotText}>Esqueci minha senha</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Entrar"
                  accessibilityState={{ busy: loading, disabled: loading }}
                  disabled={loading}
                  onPress={onLogin}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && !loading && styles.primaryPressed,
                    loading && styles.primaryDisabled,
                  ]}
                >
                  {loading ? (
                    <View style={styles.loadingContent}>
                      <ActivityIndicator color={NAVY} size="small" />
                      <Text style={styles.primaryText}>Entrando...</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryText}>Entrar</Text>
                  )}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Criar conta"
                  disabled={loading}
                  onPress={() => router.push("/(auth)/signup")}
                  style={({ pressed }) => [styles.createAccountButton, pressed && styles.pressed]}
                >
                  <Text style={styles.createAccountText}>Criar conta</Text>
                </Pressable>
              </View>
            </View>
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
  safe: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  contentWithKeyboard: {
    paddingBottom: 40,
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
    marginLeft: -6,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingTop: 18,
    paddingBottom: 30,
  },
  heading: {
    alignItems: "center",
    marginBottom: 40,
  },
  symbol: {
    width: 48,
    height: 52,
    marginBottom: 24,
  },
  title: {
    color: CREAM,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 10,
    color: SECONDARY,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 21,
    textAlign: "center",
  },
  form: {
    gap: 18,
  },
  fieldLabel: {
    marginBottom: 8,
    color: "rgba(253,236,214,0.72)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  field: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  fieldFocused: {
    borderColor: "rgba(253,236,214,0.72)",
    backgroundColor: "rgba(253,236,214,0.04)",
  },
  disabledField: {
    opacity: 0.58,
  },
  fieldInput: {
    flex: 1,
    color: CREAM,
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: 1,
  },
  eyeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotButton: {
    minHeight: 36,
    alignSelf: "flex-end",
    justifyContent: "center",
    marginTop: -10,
  },
  forgotText: {
    color: "rgba(253,236,214,0.74)",
    fontSize: 13,
    fontWeight: "600",
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CREAM,
  },
  primaryPressed: {
    opacity: 0.86,
  },
  primaryDisabled: {
    opacity: 0.68,
  },
  primaryText: {
    color: NAVY,
    fontSize: 16,
    fontWeight: "700",
  },
  loadingContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  createAccountButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -2,
  },
  createAccountText: {
    color: "rgba(253,236,214,0.78)",
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
