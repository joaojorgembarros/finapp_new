import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppLock } from "../providers/AppLockProvider";
import { useSession } from "../providers/SessionProvider";
import { OB } from "./OnboardingKit";
import { PinDotsInput, PinSetupModal } from "./PinSetupModal";

const PIN_LENGTH = 6;

function secondsFromMilliseconds(value: number) {
  return Math.max(0, Math.ceil(value / 1_000));
}

function accountConfirmationMessage(message: string | null) {
  return message === "E-mail ou senha incorretos."
    ? "Senha incorreta. Tente novamente."
    : message ?? "Não foi possível confirmar sua identidade. Tente novamente.";
}

export function AppLockScreen({
  windowOverlayHost = false,
}: {
  windowOverlayHost?: boolean;
}) {
  const { signOut } = useSession();
  const {
    config,
    hasPin,
    recoveryRequired,
    busy: appLockBusy,
    biometricCapabilities,
    cooldownRemainingMs,
    unlockWithBiometrics,
    confirmWithBiometrics,
    unlockWithPin,
    setPin: savePin,
    reauthenticateWithPassword,
  } = useAppLock();
  const inputRef = useRef<TextInput>(null);
  const cooldownUntilRef = useRef(Date.now() + cooldownRemainingMs);
  const [showPin, setShowPin] = useState(!config.biometricEnabled);
  const [pin, setPin] = useState("");
  const [busyMethod, setBusyMethod] = useState<"biometric" | "pin" | "logout" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoveryModalVisible, setRecoveryModalVisible] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [pinSetupVisible, setPinSetupVisible] = useState(false);
  const [pinSetupLoading, setPinSetupLoading] = useState(false);
  const [pinSetupError, setPinSetupError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(
    secondsFromMilliseconds(cooldownRemainingMs),
  );
  const busy = appLockBusy || busyMethod !== null || recoveryBusy || pinSetupLoading;
  const pinBlocked = cooldownSeconds > 0;
  const canUseBiometric = config.biometricEnabled && biometricCapabilities.available;
  const biometricLabel = biometricCapabilities.actionLabel || "Usar biometria";
  const canSubmitPin = hasPin && pin.length === PIN_LENGTH && !pinBlocked && !busy;
  const recoveryAction = hasPin || recoveryRequired ? "replace-pin" : "configure-pin";
  const embeddedSurfaceVisible = windowOverlayHost && (
    recoveryModalVisible || pinSetupVisible
  );

  useEffect(() => {
    cooldownUntilRef.current = Date.now() + cooldownRemainingMs;
    setCooldownSeconds(secondsFromMilliseconds(cooldownRemainingMs));
  }, [cooldownRemainingMs]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setTimeout(() => {
      setCooldownSeconds(secondsFromMilliseconds(cooldownUntilRef.current - Date.now()));
    }, 1_000);
    return () => clearTimeout(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (!showPin || pinBlocked || busy) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [busy, pinBlocked, showPin]);

  async function authenticateBiometrically(
    forRecovery = false,
  ): Promise<"success" | "cancelled" | "failed"> {
    if (!canUseBiometric || busy) return "failed";
    setBusyMethod("biometric");
    setErrorMessage(null);
    try {
      const result = forRecovery
        ? await confirmWithBiometrics(recoveryAction)
        : await unlockWithBiometrics({ unlock: true });
      if (result.success) return "success";
      if (result.status !== "cancelled") {
        setErrorMessage(result.message ?? "Não foi possível confirmar sua identidade.");
      }
      return result.status === "cancelled" ? "cancelled" : "failed";
    } catch {
      setErrorMessage("Não foi possível confirmar sua identidade.");
      return "failed";
    } finally {
      setBusyMethod(null);
    }
  }

  async function unlockWithLocalPin() {
    if (!canSubmitPin) return;
    const submittedPin = pin;
    setBusyMethod("pin");
    setPin("");
    setErrorMessage(null);
    try {
      const result = await unlockWithPin(submittedPin);
      if (!result.success) {
        const nextCooldown = secondsFromMilliseconds(result.cooldownRemainingMs ?? 0);
        cooldownUntilRef.current = Date.now() + (result.cooldownRemainingMs ?? 0);
        setCooldownSeconds(nextCooldown);
        setErrorMessage(
          nextCooldown > 0
            ? null
            : result.message ?? "PIN incorreto. Tente novamente.",
        );
      }
    } catch {
      setErrorMessage("Não foi possível confirmar seu PIN. Tente novamente.");
    } finally {
      setBusyMethod(null);
    }
  }

  async function startPinRecovery() {
    if (busy) return;
    setErrorMessage(null);

    if (canUseBiometric) {
      const result = await authenticateBiometrically(true);
      if (result === "success") {
        setPinSetupError(null);
        setPinSetupVisible(true);
      } else if (result === "failed") {
        setRecoveryPassword("");
        setRecoveryError(null);
        setPasswordVisible(false);
        setRecoveryModalVisible(true);
      }
      return;
    }

    setRecoveryPassword("");
    setRecoveryError(null);
    setPasswordVisible(false);
    setRecoveryModalVisible(true);
  }

  async function confirmAccountPassword() {
    if (!recoveryPassword || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      const result = await reauthenticateWithPassword(recoveryPassword, recoveryAction);
      if (!result.success) {
        setRecoveryError(accountConfirmationMessage(result.message));
        return;
      }

      setRecoveryPassword("");
      setRecoveryModalVisible(false);
      setPinSetupError(null);
      setPinSetupVisible(true);
    } catch {
      setRecoveryError("Não foi possível confirmar sua identidade. Tente novamente.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function saveRecoveredPin(nextPin: string) {
    if (pinSetupLoading) return;
    setPinSetupLoading(true);
    setPinSetupError(null);
    try {
      await savePin(nextPin);
      setPinSetupVisible(false);
    } catch {
      setPinSetupError("Não foi possível salvar o novo PIN. Tente novamente.");
      setPinSetupLoading(false);
      throw new Error("PIN replacement failed");
    }

    try {
      const result = await unlockWithPin(nextPin);
      if (!result.success) {
        setShowPin(true);
        setErrorMessage(
          result.message
            ?? "Seu novo PIN foi salvo. Digite-o para desbloquear o Sonhar+.",
        );
      }
    } catch {
      setShowPin(true);
      setErrorMessage("Seu novo PIN foi salvo. Digite-o para desbloquear o Sonhar+.");
    } finally {
      setPinSetupLoading(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusyMethod("logout");
    setErrorMessage(null);
    try {
      await signOut();
    } catch {
      setErrorMessage("Não foi possível sair da conta agora. Tente novamente.");
      setBusyMethod(null);
    }
  }

  const cooldownMessage = pinBlocked
    ? `Muitas tentativas incorretas. Tente novamente em ${cooldownSeconds} ${cooldownSeconds === 1 ? "segundo" : "segundos"}.`
    : null;

  return (
    <SafeAreaView
      accessibilityViewIsModal
      edges={["top", "bottom"]}
      style={styles.screen}
    >
      <View
        accessibilityElementsHidden={embeddedSurfaceVisible}
        importantForAccessibility={
          embeddedSurfaceVisible ? "no-hide-descendants" : "auto"
        }
        pointerEvents={embeddedSurfaceVisible ? "none" : "auto"}
        style={styles.lockBase}
      >
        <StatusBar style="light" backgroundColor={OB.primaryDeep} translucent={false} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.lockKeyboard}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>Sonhar+</Text>
          <View accessible={false} style={styles.lockIcon}>
            <Ionicons name="lock-closed" size={32} color={OB.white} accessible={false} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>Sonhar+ está bloqueado</Text>
          <Text style={styles.subtitle}>
            {canUseBiometric && hasPin
              ? "Confirme sua identidade com biometria ou PIN para continuar."
              : canUseBiometric
                ? "Confirme sua identidade com biometria para continuar."
                : hasPin
                  ? "Digite seu PIN para continuar com segurança."
                  : "Confirme sua conta para recuperar o acesso com segurança."}
          </Text>
        </View>

        <View style={styles.unlockCard}>
          {canUseBiometric ? (
            <Pressable
              onPress={() => void authenticateBiometrically(false)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={biometricLabel}
              accessibilityHint="Confirma sua identidade e desbloqueia o Sonhar+."
              accessibilityState={{ disabled: busy, busy: busyMethod === "biometric" }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !busy && styles.buttonPressed,
                busy && styles.controlDisabled,
              ]}
            >
              {busyMethod === "biometric" ? (
                <ActivityIndicator color={OB.primary} />
              ) : (
                <Ionicons name="finger-print-outline" size={23} color={OB.primary} accessible={false} />
              )}
              <Text style={styles.primaryButtonText}>
                {busyMethod === "biometric" ? "Confirmando..." : biometricLabel}
              </Text>
            </Pressable>
          ) : null}

          {hasPin && !showPin ? (
            <Pressable
              onPress={() => {
                setErrorMessage(null);
                setShowPin(true);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Usar PIN"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && !busy && styles.buttonPressed,
                busy && styles.controlDisabled,
              ]}
            >
              <Ionicons name="keypad-outline" size={21} color={OB.white} accessible={false} />
              <Text style={styles.secondaryButtonText}>Usar PIN</Text>
            </Pressable>
          ) : null}

          {hasPin && showPin ? (
            <View style={styles.pinBlock}>
              <Text style={styles.pinTitle}>Digite seu PIN de 6 dígitos</Text>
              <PinDotsInput
                ref={inputRef}
                value={pin}
                onChangeText={(nextPin) => {
                  setPin(nextPin);
                  setErrorMessage(null);
                }}
                editable={!busy && !pinBlocked}
                accessibilityLabel="PIN para desbloquear o Sonhar+"
                error={Boolean(errorMessage)}
                tone="dark"
              />

              {cooldownMessage ? (
                <View
                  accessible
                  accessibilityRole="alert"
                  accessibilityLabel="Muitas tentativas incorretas. Aguarde antes de tentar novamente."
                  style={styles.cooldownBox}
                >
                  <Ionicons name="time-outline" size={18} color="#FFE0A6" accessible={false} />
                  <Text accessible={false} style={styles.cooldownText}>{cooldownMessage}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={() => void unlockWithLocalPin()}
                disabled={!canSubmitPin}
                accessibilityRole="button"
                accessibilityLabel="Desbloquear com PIN"
                accessibilityState={{ disabled: !canSubmitPin, busy: busyMethod === "pin" }}
                style={({ pressed }) => [
                  styles.pinButton,
                  !canSubmitPin && styles.pinButtonDisabled,
                  pressed && canSubmitPin && styles.buttonPressed,
                ]}
              >
                {busyMethod === "pin" ? <ActivityIndicator color={OB.primary} /> : null}
                <Text style={styles.pinButtonText}>
                  {busyMethod === "pin" ? "Confirmando..." : "Desbloquear"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {errorMessage ? (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color="#FFD0D0" accessible={false} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void startPinRecovery()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={hasPin ? "Esqueci meu PIN" : "Recuperar acesso"}
            accessibilityHint="Confirme sua conta para configurar um novo PIN."
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [
              styles.textButton,
              pressed && !busy && styles.buttonPressed,
              busy && styles.controlDisabled,
            ]}
          >
            <Text style={styles.textButtonText}>{hasPin ? "Esqueci meu PIN" : "Recuperar acesso"}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => void logout()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Sair da conta"
          accessibilityState={{ disabled: busy, busy: busyMethod === "logout" }}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && !busy && styles.buttonPressed,
            busy && styles.controlDisabled,
          ]}
        >
          {busyMethod === "logout" ? (
            <ActivityIndicator color="#FFD0D0" />
          ) : (
            <Ionicons name="log-out-outline" size={20} color="#FFD0D0" accessible={false} />
          )}
          <Text style={styles.logoutText}>{busyMethod === "logout" ? "Saindo..." : "Sair da conta"}</Text>
        </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <PasswordRecoveryModal
        visible={recoveryModalVisible}
        embedded={windowOverlayHost}
        password={recoveryPassword}
        passwordVisible={passwordVisible}
        loading={recoveryBusy}
        errorMessage={recoveryError}
        onPasswordChange={(value) => {
          setRecoveryPassword(value);
          setRecoveryError(null);
        }}
        onTogglePassword={() => setPasswordVisible((current) => !current)}
        onCancel={() => {
          if (recoveryBusy) return;
          setRecoveryPassword("");
          setRecoveryError(null);
          setRecoveryModalVisible(false);
        }}
        onConfirm={() => void confirmAccountPassword()}
      />

      <PinSetupModal
        visible={pinSetupVisible}
        embedded={windowOverlayHost}
        title="Criar novo PIN"
        description="Crie um novo PIN de 6 dígitos. O PIN anterior não será recuperado."
        loading={pinSetupLoading}
        errorMessage={pinSetupError}
        onComplete={saveRecoveredPin}
        onCancel={() => {
          if (pinSetupLoading) return;
          setPinSetupError(null);
          setPinSetupVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

type PasswordRecoveryModalProps = {
  visible: boolean;
  embedded: boolean;
  password: string;
  passwordVisible: boolean;
  loading: boolean;
  errorMessage: string | null;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onCancel: () => void;
  onConfirm: () => void;
};

function PasswordRecoveryModal({
  visible,
  embedded,
  password,
  passwordVisible,
  loading,
  errorMessage,
  onPasswordChange,
  onTogglePassword,
  onCancel,
  onConfirm,
}: PasswordRecoveryModalProps) {
  if (!visible) return null;

  const content = (
      <SafeAreaView accessibilityViewIsModal edges={["top", "bottom"]} style={styles.recoveryScreen}>
        <StatusBar style="dark" backgroundColor={OB.offWhite} translucent={false} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.recoveryKeyboard}>
          <ScrollView
            contentContainerStyle={styles.recoveryContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View accessible={false} style={styles.recoveryIcon}>
              <Ionicons name="shield-checkmark-outline" size={31} color={OB.primary} accessible={false} />
            </View>
            <Text accessibilityRole="header" style={styles.recoveryTitle}>Confirme sua conta</Text>
            <Text style={styles.recoveryDescription}>
              Digite a senha da sua conta Sonhar+ para criar um novo PIN. O PIN antigo nunca será exibido.
            </Text>

            <Text style={styles.inputLabel}>SENHA DA CONTA</Text>
            <View style={[styles.passwordField, errorMessage && styles.passwordFieldError]}>
              <TextInput
                value={password}
                onChangeText={onPasswordChange}
                editable={!loading}
                autoFocus
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="done"
                onSubmitEditing={onConfirm}
                accessibilityLabel="Senha da conta"
                style={styles.passwordInput}
              />
              <Pressable
                onPress={onTogglePassword}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
                accessibilityState={{ disabled: loading }}
                hitSlop={6}
                style={styles.passwordToggle}
              >
                <Ionicons
                  name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                  size={21}
                  color="#526F91"
                  accessible={false}
                />
              </Pressable>
            </View>

            {errorMessage ? (
              <View accessibilityRole="alert" style={styles.recoveryErrorBox}>
                <Ionicons name="alert-circle-outline" size={18} color="#A33B3B" accessible={false} />
                <Text style={styles.recoveryErrorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={onConfirm}
              disabled={!password || loading}
              accessibilityRole="button"
              accessibilityLabel="Confirmar senha da conta"
              accessibilityState={{ disabled: !password || loading, busy: loading }}
              style={({ pressed }) => [
                styles.recoveryPrimaryButton,
                (!password || loading) && styles.recoveryPrimaryButtonDisabled,
                pressed && password && !loading && styles.buttonPressed,
              ]}
            >
              {loading ? <ActivityIndicator color={OB.white} /> : null}
              <Text style={styles.recoveryPrimaryText}>{loading ? "Confirmando..." : "Confirmar identidade"}</Text>
            </Pressable>

            <Pressable
              onPress={onCancel}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Cancelar recuperação do PIN"
              accessibilityState={{ disabled: loading }}
              style={({ pressed }) => [
                styles.recoveryCancelButton,
                pressed && !loading && styles.buttonPressed,
                loading && styles.controlDisabled,
              ]}
            >
              <Text style={styles.recoveryCancelText}>Cancelar</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
  );

  if (embedded) {
    return (
      <View
        accessibilityViewIsModal
        importantForAccessibility="yes"
        style={styles.embeddedRecoveryModal}
      >
        {content}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onCancel}
      statusBarTranslucent={false}
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  embeddedRecoveryModal: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
    backgroundColor: OB.offWhite,
  },
  screen: {
    flex: 1,
    backgroundColor: OB.primaryDeep,
  },
  lockBase: {
    flex: 1,
  },
  lockKeyboard: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 34,
    paddingBottom: 28,
  },
  brandBlock: {
    alignItems: "center",
  },
  brand: {
    color: OB.white,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },
  lockIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
    backgroundColor: "rgba(123,160,200,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  title: {
    color: OB.textOnDark,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 18,
  },
  subtitle: {
    maxWidth: 370,
    color: "rgba(218,231,244,0.88)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 7,
  },
  unlockCard: {
    width: "100%",
    marginTop: 28,
    padding: 16,
    borderRadius: 22,
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.09)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: OB.white,
  },
  primaryButtonText: {
    color: OB.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  secondaryButtonText: {
    color: OB.white,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
  },
  pinBlock: {
    alignItems: "center",
  },
  pinTitle: {
    color: OB.textOnDark,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  pinButton: {
    width: "100%",
    minHeight: 52,
    borderRadius: 16,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: OB.white,
  },
  pinButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  pinButtonText: {
    color: OB.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  cooldownBox: {
    width: "100%",
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(117,74,13,0.32)",
    borderWidth: 1,
    borderColor: "rgba(255,224,166,0.42)",
  },
  cooldownText: {
    flex: 1,
    color: "#FFF0D4",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  errorBox: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(138,48,48,0.32)",
    borderWidth: 1,
    borderColor: "rgba(255,208,208,0.36)",
  },
  errorText: {
    flex: 1,
    color: "#FFE4E4",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  textButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  textButtonText: {
    color: "#DDEAF7",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  logoutButton: {
    minHeight: 48,
    marginTop: 18,
    alignSelf: "center",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  logoutText: {
    color: "#FFD0D0",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
  },
  recoveryScreen: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  recoveryKeyboard: {
    flex: 1,
  },
  recoveryContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  recoveryIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E9EFF6",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  recoveryTitle: {
    color: OB.primary,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 18,
  },
  recoveryDescription: {
    color: "#526F91",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 7,
  },
  inputLabel: {
    color: "#526F91",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 26,
    marginBottom: 7,
  },
  passwordField: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.white,
    paddingLeft: 15,
    flexDirection: "row",
    alignItems: "center",
  },
  passwordFieldError: {
    borderColor: "#D88A8A",
  },
  passwordInput: {
    flex: 1,
    minHeight: 52,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  passwordToggle: {
    width: 48,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  recoveryErrorBox: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#FDECEC",
    borderWidth: 1,
    borderColor: "#F1C2C2",
  },
  recoveryErrorText: {
    flex: 1,
    color: "#8A3030",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  recoveryPrimaryButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 18,
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: OB.primary,
  },
  recoveryPrimaryButtonDisabled: {
    backgroundColor: "#AAB9CA",
  },
  recoveryPrimaryText: {
    color: OB.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  recoveryCancelButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  recoveryCancelText: {
    color: OB.primary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
  },
  buttonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  controlDisabled: {
    opacity: 0.5,
  },
});
