// app/(auth)/login.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  useWindowDimensions,
  View,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { supabase } from "../../src/lib/supabase";
import { requestPasswordReset } from "../../src/lib/auth";
import { LEGAL_URLS, openLegalUrl } from "../../src/lib/legal";

const T = {
  primary: "#0C2348",
  primaryShadow: "rgba(12,35,72,0.38)",
  primaryGlow: "rgba(12,35,72,0.10)",
  primaryFaint: "rgba(12,35,72,0.18)",
  support: "#7BA0C8",
  supportFaint: "rgba(123,160,200,0.35)",
  offWhite: "#F6F7F9",
  textPrimary: "#0C2348",
  textMuted: "#7BA0C8",
  textOnDark: "rgba(255,255,255,0.92)",
  textOnDarkMid: "rgba(160,200,235,0.72)",
} as const;

type FocusKey = "email" | "password" | null;

function isValidEmail(s: string) {
  const x = s.trim();
  return x.includes("@") && x.includes(".");
}

function AbstractBackground() {
  return (
    <Svg pointerEvents="none" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgLinearGradient id="bgMain" x1="0" y1="0" x2="390" y2="844" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#06152e" />
          <Stop offset="35%" stopColor="#0c2348" />
          <Stop offset="65%" stopColor="#0f3060" />
          <Stop offset="100%" stopColor="#163870" />
        </SvgLinearGradient>
        <RadialGradient id="orbTop" cx="75%" cy="18%" rx="48%" ry="40%">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.30" />
          <Stop offset="55%" stopColor="#1a4d9e" stopOpacity="0.14" />
          <Stop offset="100%" stopColor="#0c2348" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="orbBottom" cx="20%" cy="88%" rx="48%" ry="44%">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.22" />
          <Stop offset="60%" stopColor="#0f3d7a" stopOpacity="0.10" />
          <Stop offset="100%" stopColor="#06152e" stopOpacity="0" />
        </RadialGradient>
        <SvgLinearGradient id="wave1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.16" />
          <Stop offset="100%" stopColor="#0c2348" stopOpacity="0.04" />
        </SvgLinearGradient>
        <SvgLinearGradient id="wave2" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.10" />
          <Stop offset="100%" stopColor="#0c2348" stopOpacity="0" />
        </SvgLinearGradient>
        <SvgLinearGradient id="ridge" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#0c2348" stopOpacity="0.38" />
          <Stop offset="100%" stopColor="#0c2348" stopOpacity="0.10" />
        </SvgLinearGradient>
        <SvgLinearGradient id="ridge2" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.18" />
          <Stop offset="100%" stopColor="#0c2348" stopOpacity="0.04" />
        </SvgLinearGradient>
      </Defs>

      <Rect width="390" height="844" fill="url(#bgMain)" />
      <Rect width="390" height="844" fill="url(#orbTop)" />
      <Rect width="390" height="844" fill="url(#orbBottom)" />

      <Path d="M-20 480 L50 340 L110 390 L175 270 L240 330 L300 220 L355 295 L410 250 L410 844 L-20 844Z" fill="#0d2a52" opacity="0.6" />
      <Path d="M-20 530 L40 410 L100 450 L155 340 L210 390 L270 300 L330 360 L390 320 L410 844 L-20 844Z" fill="#0f3160" opacity="0.5" />

      <Ellipse cx="340" cy="110" rx="220" ry="185" fill="url(#wave1)" opacity="0.76" />
      <Ellipse cx="55" cy="690" rx="240" ry="205" fill="url(#wave2)" opacity="0.72" />

      <Path d="M-30 420 Q60 380 130 410 Q200 440 270 390 Q330 350 420 380 L420 500 Q330 465 260 500 Q190 535 120 505 Q55 478 -30 510Z" fill="url(#wave1)" opacity="0.55" />
      <Path d="M-30 460 Q80 430 160 460 Q240 490 310 450 Q360 425 420 445 L420 560 Q360 545 300 565 Q220 590 140 558 Q65 528 -30 555Z" fill="url(#wave2)" opacity="0.45" />

      <Path d="M-20 560 Q30 510 80 535 Q130 558 175 510 Q215 468 260 500 Q300 528 350 488 Q375 470 420 480 L420 630 Q370 615 320 635 Q270 655 220 628 Q170 600 120 622 Q70 643 -20 620Z" fill="url(#ridge)" opacity="0.42" />
      <Path d="M-20 600 Q50 570 110 590 Q170 610 230 572 Q280 540 340 565 Q375 580 420 560 L420 700 Q370 680 310 695 Q245 712 185 690 Q125 668 65 688 Q20 702 -20 688Z" fill="url(#ridge2)" opacity="0.32" />

      {[32, 78, 145, 195, 255, 310, 365, 55, 175, 290, 342, 108].map((x, i) => (
        <Circle key={`s${i}`} cx={x} cy={[45, 22, 55, 18, 42, 28, 58, 88, 78, 95, 72, 105][i]} r={i % 3 === 0 ? 1.4 : 0.9} fill="#ffffff" opacity={0.28 + (i % 4) * 0.08} />
      ))}
      {[
        [60, 135, 1.2],
        [120, 160, 0.9],
        [200, 148, 1.5],
        [270, 125, 1.1],
        [330, 155, 0.8],
        [85, 190, 1],
        [240, 178, 0.7],
        [355, 170, 1.3],
      ].map(([x, y, r], i) => (
        <Circle key={`p${i}`} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.16 + i * 0.013} />
      ))}
    </Svg>
  );
}

function LogoMark() {
  return (
    <View style={styles.logoMark}>
      <Svg width={20} height={20} viewBox="0 0 20 20">
        <Path d="M10 3L17 15H3L10 3Z" fill="#ffffff" fillOpacity="0.80" />
        <Path d="M10 3L13.5 9H6.5L10 3Z" fill="#ffffff" />
        <Rect x="9" y="13" width="2" height="3" rx="1" fill="#ffffff" fillOpacity="0.45" />
      </Svg>
    </View>
  );
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
  keyboardVisible,
  onFocus,
  onBlur,
  right,
  inputRef,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: TextInputProps["keyboardType"];
  secureTextEntry?: boolean;
  focused: boolean;
  keyboardVisible: boolean;
  onFocus: () => void;
  onBlur: () => void;
  right?: React.ReactNode;
  inputRef?: React.RefObject<TextInput | null>;
}) {
  const localInputRef = React.useRef<TextInput>(null);
  const refocusTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = inputRef ?? localInputRef;

  React.useEffect(() => {
    return () => {
      if (refocusTimer.current) clearTimeout(refocusTimer.current);
    };
  }, []);

  function focusInput() {
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
      <Pressable onPress={focusInput} style={[styles.field, focused && styles.fieldActive]}>
        <Ionicons name={icon} size={18} color={focused ? T.primary : T.support} />
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={T.textMuted}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize="none"
          autoCorrect={false}
          onPressIn={focusInput}
          onFocus={onFocus}
          onBlur={onBlur}
          style={styles.fieldInput}
        />
        {right}
      </Pressable>
    </View>
  );
}

export default function LoginScreen() {
  const { height } = useWindowDimensions();
  const compact = height < 790;
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<FocusKey>(null);
  const [showPass, setShowPass] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);
  // Password AutoFill can briefly blur the input on iOS while the keyboard
  // remains open. The compact layout must follow the keyboard itself so the
  // header never gets pushed behind the status bar.
  const inputKeyboardActive = keyboardVisible;

  useEffect(() => {
    if (Platform.OS === "android") {
      NavigationBar.setBackgroundColorAsync("#163870").catch(() => {});
      NavigationBar.setButtonStyleAsync("light").catch(() => {});
    }

    const keyboardShowEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const keyboardHideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(keyboardShowEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(keyboardHideEvent, () => {
      setKeyboardVisible(false);
      setFocused(null);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      if (Platform.OS === "android") {
        NavigationBar.setBackgroundColorAsync(T.offWhite).catch(() => {});
        NavigationBar.setButtonStyleAsync("dark").catch(() => {});
      }
    };
  }, []);

  async function onLogin() {
    if (loading) return;
    if (!isValidEmail(email)) return Alert.alert("E-mail inválido", "Digite um e-mail válido para continuar.");
    if (pass.trim().length < 6) return Alert.alert("Senha incompleta", "Digite sua senha com pelo menos 6 caracteres.");

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      });
      if (error) throw error;
      if (!data.user?.id) throw new Error("Não foi possível identificar sua conta.");
      router.replace("/");
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
      await requestPasswordReset(e);
      Alert.alert("Enviado", "Te mandei um e-mail para redefinir sua senha.");
    } catch (err: any) {
      Alert.alert("Erro", err?.message ?? "Não foi possível enviar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" backgroundColor="transparent" translucent />
      <AbstractBackground />
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.keyboard}>
        <View style={[styles.root, compact && styles.rootCompact, inputKeyboardActive && styles.rootKeyboardActive]}>
          <View style={[styles.brandRow, inputKeyboardActive && styles.keyboardHidden]}>
            <LogoMark />
            <Text style={styles.brandName}>FinApp</Text>
          </View>

          <View style={[styles.copyBlock, compact && styles.copyBlockCompact, inputKeyboardActive && styles.keyboardHidden]}>
            <Text style={styles.eyebrow}>Bem-vindo de volta</Text>
            <Text style={[styles.headline, compact && styles.headlineCompact]}>Assuma o controle do seu dinheiro sem complicação.</Text>
            <Text style={styles.subhead}>Organize sua vida financeira com leveza e transforme objetivos em conquistas.</Text>
          </View>

          <View style={[styles.card, inputKeyboardActive && styles.cardKeyboardActive]}>
            <View style={[styles.form, compact && styles.formCompact, inputKeyboardActive && styles.formKeyboardActive]}>
                <AuthField
                  icon="mail-outline"
                  label="E-mail"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="seu@email.com"
                  keyboardType="email-address"
                  focused={focused === "email"}
                  keyboardVisible={keyboardVisible}
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                />

                <AuthField
                  icon="lock-closed-outline"
                  label="Senha"
                  value={pass}
                  onChangeText={setPass}
                  placeholder="Sua senha"
                  secureTextEntry={!showPass}
                  focused={focused === "password"}
                  keyboardVisible={keyboardVisible}
                  inputRef={passwordInputRef}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  right={
                    <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10} style={styles.eyeButton}>
                      <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={19} color={showPass ? T.primary : T.support} />
                    </Pressable>
                  }
                />

                <Pressable onPress={onForgot} style={styles.forgotLink} hitSlop={10}>
                  <Text style={styles.forgotText}>Esqueci minha senha</Text>
                </Pressable>

              <Pressable onPress={onLogin} disabled={loading} style={styles.primaryTouch}>
                  <LinearGradient colors={["#06152e", T.primary, "#163870"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
                    {loading ? (
                      <View style={styles.loadingContent}>
                        <ActivityIndicator color="#ffffff" size="small" />
                        <Text style={styles.primaryText}>Entrando...</Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryText}>Continuar</Text>
                    )}
                  </LinearGradient>
                </Pressable>

                <View style={styles.dividerRow}>
                  <View style={styles.divider} />
                  <Text style={styles.dividerText}>ou</Text>
                  <View style={styles.divider} />
                </View>

                <Pressable onPress={() => router.push("/(auth)/signup")} style={styles.secondaryButton}>
                  <Text style={styles.secondaryText}>Criar conta</Text>
                </Pressable>

                <Text style={styles.terms}>
                Ao continuar, você concorda com nossos <Text onPress={() => openLegalUrl(LEGAL_URLS.terms).catch((error) => Alert.alert("Termos", error.message))} style={styles.termLink}>Termos</Text> e <Text onPress={() => openLegalUrl(LEGAL_URLS.privacy).catch((error) => Alert.alert("Privacidade", error.message))} style={styles.termLink}>Privacidade</Text>.
                </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#163870",
  },
  safeArea: {
    flex: 1,
    overflow: "hidden",
  },
  keyboard: {
    flex: 1,
  },
  root: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "android" ? 12 : 8,
    paddingBottom: Platform.OS === "ios" ? 48 : 10,
  },
  rootCompact: {
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 38 : 8,
  },
  rootKeyboardActive: {
    justifyContent: "flex-start",
    paddingTop: Platform.OS === "android" ? 18 : 8,
  },
  keyboardHidden: {
    display: "none",
  },
  hiddenPasswordInput: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 1,
    height: 1,
    opacity: 0,
  },
  brandRow: {
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.11)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  brandName: {
    color: T.textOnDark,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2.3,
    textTransform: "uppercase",
  },
  copyBlock: {
    zIndex: 1,
    marginTop: 46,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  copyBlockCompact: {
    marginTop: 28,
    paddingBottom: 12,
  },
  eyebrow: {
    color: T.textOnDarkMid,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.6,
    marginBottom: 14,
    textTransform: "uppercase",
  },
  headline: {
    color: T.textOnDark,
    fontSize: 27,
    fontWeight: "800",
    lineHeight: 33,
    letterSpacing: 0,
    marginBottom: 10,
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 18,
  },
  headlineCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
  subhead: {
    color: T.textOnDarkMid,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 22,
  },
  card: {
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.97)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.82)",
    shadowColor: T.primary,
    shadowOpacity: 0.32,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 20 },
    elevation: 10,
    marginBottom: 0,
  },
  cardKeyboardActive: {
    marginTop: 8,
  },
  form: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  formCompact: {
    gap: 8,
    paddingTop: 16,
    paddingBottom: 18,
  },
  formKeyboardActive: {
    gap: 10,
    paddingTop: 18,
    paddingBottom: 18,
  },
  fieldLabel: {
    color: T.support,
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 7,
    textTransform: "uppercase",
  },
  field: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: T.offWhite,
    borderWidth: 1.5,
    borderColor: T.primaryFaint,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  fieldActive: {
    backgroundColor: "#ffffff",
    borderColor: T.primary,
    shadowColor: T.primary,
    shadowOpacity: 0.12,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  fieldInput: {
    flex: 1,
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    paddingVertical: 1,
  },
  fakeInput: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  fakeInputText: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  fakePlaceholder: {
    color: T.textMuted,
  },
  fakeCaret: {
    width: 2,
    height: 22,
    marginLeft: 2,
    borderRadius: 1,
    backgroundColor: "#1f9a93",
  },
  floatingPasswordWrap: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 20,
  },
  floatingPasswordField: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: T.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    shadowColor: T.primary,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  eyeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: -3,
    paddingVertical: 2,
  },
  forgotText: {
    color: T.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: T.primary,
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  primaryTouch: {
    borderRadius: 14,
  },
  loadingContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: T.supportFaint,
  },
  dividerText: {
    color: T.support,
    fontSize: 11,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.offWhite,
    borderWidth: 1.5,
    borderColor: T.primaryFaint,
    shadowColor: T.primary,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  secondaryText: {
    color: T.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  terms: {
    color: T.support,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 17,
  },
  termLink: {
    color: T.primary,
    fontWeight: "800",
  },
});
