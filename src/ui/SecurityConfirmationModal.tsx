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
import { OB } from "./OnboardingKit";
import { PinDotsInput } from "./PinSetupModal";

const PIN_LENGTH = 6;

export type SecurityConfirmationModalProps = {
  visible: boolean;
  title: string;
  description: string;
  onCancel: () => void;
  onDismiss?: () => void;
  showBiometric?: boolean;
  biometricAvailable?: boolean;
  biometricLabel?: string;
  biometricHint?: string;
  onBiometric?: () => void | Promise<void>;
  pinEnabled?: boolean;
  pinLabel?: string;
  onConfirmPin?: (pin: string) => void | Promise<void>;
  loading?: boolean;
  message?: string | null;
  errorMessage?: string | null;
  cooldownSeconds?: number;
  cooldownKey?: string | number;
  cooldownMessage?: string | null;
};

type ActiveMethod = "biometric" | "pin" | null;

export function SecurityConfirmationModal({
  visible,
  title,
  description,
  onCancel,
  onDismiss,
  showBiometric,
  biometricAvailable = true,
  biometricLabel = "Usar biometria",
  biometricHint,
  onBiometric,
  pinEnabled = true,
  pinLabel = "Digite seu PIN de 6 dígitos",
  onConfirmPin,
  loading = false,
  message,
  errorMessage,
  cooldownSeconds = 0,
  cooldownKey,
  cooldownMessage,
}: SecurityConfirmationModalProps) {
  const inputRef = useRef<TextInput>(null);
  const [pin, setPin] = useState("");
  const [activeMethod, setActiveMethod] = useState<ActiveMethod>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const biometricVisible = showBiometric ?? Boolean(onBiometric);
  const pinVisible = pinEnabled && Boolean(onConfirmPin);
  const cooldownDeadlineRef = useRef(0);
  const [remainingCooldownSeconds, setRemainingCooldownSeconds] = useState(0);
  const normalizedCooldown = Math.max(0, remainingCooldownSeconds);
  const pinBlocked = normalizedCooldown > 0 || Boolean(cooldownMessage);
  const busy = loading || activeMethod !== null;
  const biometricBusy = activeMethod === "biometric";
  const pinBusy = activeMethod === "pin";
  const effectiveError = errorMessage ?? localError;
  const effectiveCooldownMessage = cooldownMessage
    ?? (normalizedCooldown > 0
      ? `Muitas tentativas incorretas. Tente novamente em ${normalizedCooldown} ${normalizedCooldown === 1 ? "segundo" : "segundos"}.`
      : null);
  const canSubmitPin = pinVisible && pin.length === PIN_LENGTH && !pinBlocked && !busy;

  useEffect(() => {
    if (!visible) {
      setPin("");
      setActiveMethod(null);
      setLocalError(null);
    }
  }, [visible]);

  useEffect(() => {
    const nextSeconds = Math.max(0, Math.ceil(cooldownSeconds));
    cooldownDeadlineRef.current = Date.now() + nextSeconds * 1_000;
    setRemainingCooldownSeconds(nextSeconds);
  }, [cooldownKey, cooldownSeconds]);

  useEffect(() => {
    if (!visible || remainingCooldownSeconds <= 0) return;
    const timer = setTimeout(() => {
      setRemainingCooldownSeconds(Math.max(
        0,
        Math.ceil((cooldownDeadlineRef.current - Date.now()) / 1_000),
      ));
    }, 1_000);
    return () => clearTimeout(timer);
  }, [remainingCooldownSeconds, visible]);

  useEffect(() => {
    if (pinBlocked) setPin("");
  }, [pinBlocked]);

  function cancel() {
    if (busy) return;
    setPin("");
    setLocalError(null);
    onCancel();
  }

  async function confirmBiometric() {
    if (!onBiometric || !biometricAvailable || busy) return;
    setActiveMethod("biometric");
    setLocalError(null);
    try {
      await onBiometric();
    } catch {
      setLocalError("Não foi possível confirmar sua identidade.");
    } finally {
      setActiveMethod(null);
    }
  }

  async function confirmPin() {
    if (!onConfirmPin || !canSubmitPin) return;
    const submittedPin = pin;
    setActiveMethod("pin");
    setLocalError(null);
    try {
      await onConfirmPin(submittedPin);
    } catch {
      setLocalError("Não foi possível confirmar sua identidade.");
    } finally {
      setPin("");
      setActiveMethod(null);
    }
  }

  function changePin(nextPin: string) {
    setLocalError(null);
    setPin(nextPin);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={cancel}
      onDismiss={onDismiss}
      onShow={() => {
        if (!biometricVisible && pinVisible && !pinBlocked) inputRef.current?.focus();
      }}
      statusBarTranslucent={false}
    >
      <SafeAreaView
        accessibilityViewIsModal
        style={styles.safeArea}
        edges={["top", "bottom"]}
      >
        <StatusBar style="dark" backgroundColor={OB.offWhite} translucent={false} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>CONFIRMAÇÃO DE SEGURANÇA</Text>
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            </View>
            <Pressable
              onPress={cancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancelar confirmação de segurança"
              accessibilityState={{ disabled: busy }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && !busy && styles.buttonPressed,
                busy && styles.controlDisabled,
              ]}
            >
              <Ionicons name="close" size={23} color={OB.primary} accessible={false} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.lockIcon} accessible={false}>
              <Ionicons name="shield-checkmark-outline" size={32} color={OB.primary} accessible={false} />
            </View>

            <Text style={styles.description}>{description}</Text>

            {message ? (
              <View accessibilityRole="text" style={styles.messageBox}>
                <Ionicons name="information-circle-outline" size={18} color="#526F91" accessible={false} />
                <Text style={styles.messageText}>{message}</Text>
              </View>
            ) : null}

            {biometricVisible ? (
              <Pressable
                onPress={() => void confirmBiometric()}
                disabled={!biometricAvailable || busy}
                accessibilityRole="button"
                accessibilityLabel={biometricLabel}
                accessibilityHint={biometricHint}
                accessibilityState={{ disabled: !biometricAvailable || busy, busy: biometricBusy }}
                style={({ pressed }) => [
                  styles.biometricButton,
                  (!biometricAvailable || busy) && styles.controlDisabled,
                  pressed && biometricAvailable && !busy && styles.buttonPressed,
                ]}
              >
                {biometricBusy ? (
                  <ActivityIndicator color={OB.white} />
                ) : (
                  <Ionicons name="finger-print-outline" size={22} color={OB.white} accessible={false} />
                )}
                <Text style={styles.biometricButtonText}>
                  {biometricBusy ? "Confirmando..." : biometricLabel}
                </Text>
              </Pressable>
            ) : null}

            {biometricVisible && pinVisible ? (
              <View accessible={false} style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>OU USE SEU PIN</Text>
                <View style={styles.divider} />
              </View>
            ) : null}

            {pinVisible ? (
              <View style={styles.pinSection}>
                <Text style={styles.pinLabel}>{pinLabel}</Text>
                <PinDotsInput
                  ref={inputRef}
                  value={pin}
                  onChangeText={changePin}
                  editable={!busy && !pinBlocked}
                  accessibilityLabel="PIN para confirmação de segurança"
                  error={Boolean(effectiveError)}
                />

                {effectiveCooldownMessage ? (
                  <View accessibilityRole="alert" style={styles.cooldownBox}>
                    <Ionicons name="time-outline" size={18} color="#8A5B14" accessible={false} />
                    <Text style={styles.cooldownText}>{effectiveCooldownMessage}</Text>
                  </View>
                ) : null}

                {effectiveError ? (
                  <View accessibilityRole="alert" style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={18} color="#A33B3B" accessible={false} />
                    <Text style={styles.errorText}>{effectiveError}</Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={() => void confirmPin()}
                  disabled={!canSubmitPin}
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar com PIN"
                  accessibilityState={{ disabled: !canSubmitPin, busy: pinBusy }}
                  style={({ pressed }) => [
                    styles.pinButton,
                    !canSubmitPin && styles.pinButtonDisabled,
                    pressed && canSubmitPin && styles.buttonPressed,
                  ]}
                >
                  {pinBusy ? <ActivityIndicator color={OB.white} /> : null}
                  <Text style={styles.pinButtonText}>{pinBusy ? "Confirmando..." : "Confirmar com PIN"}</Text>
                </Pressable>
              </View>
            ) : null}

            <Pressable
              onPress={cancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && !busy && styles.buttonPressed,
                busy && styles.controlDisabled,
              ]}
            >
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    minHeight: 82,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
    backgroundColor: OB.white,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: "#526F91",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  title: {
    color: OB.primary,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "900",
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 28,
  },
  lockIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E9EFF6",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  description: {
    maxWidth: 390,
    color: "#526F91",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 16,
  },
  messageBox: {
    width: "100%",
    maxWidth: 390,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#EEF3F8",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  messageText: {
    flex: 1,
    color: "#526F91",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  biometricButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 18,
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: OB.primary,
  },
  biometricButtonText: {
    color: OB.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  dividerRow: {
    width: "100%",
    maxWidth: 390,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 24,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: OB.supportSoft,
  },
  dividerText: {
    color: "#526F91",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pinSection: {
    width: "100%",
    maxWidth: 390,
    alignItems: "center",
    marginTop: 18,
  },
  pinLabel: {
    color: OB.primary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  cooldownBox: {
    width: "100%",
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#FFF5E5",
    borderWidth: 1,
    borderColor: "#E9C98F",
  },
  cooldownText: {
    flex: 1,
    color: "#754A0D",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  errorBox: {
    width: "100%",
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#FDECEC",
    borderWidth: 1,
    borderColor: "#F1C2C2",
  },
  errorText: {
    flex: 1,
    color: "#8A3030",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  pinButton: {
    width: "100%",
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 18,
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: OB.primary,
  },
  pinButtonDisabled: {
    backgroundColor: "#AAB9CA",
  },
  pinButtonText: {
    color: OB.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  cancelButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: "auto",
    paddingTop: 14,
  },
  cancelButtonText: {
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
    opacity: 0.52,
  },
});
