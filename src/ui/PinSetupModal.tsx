import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import React, { forwardRef, useEffect, useRef, useState } from "react";
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

const PIN_LENGTH = 6;

function onlyPinDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

export type PinDotsInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  accessibilityLabel: string;
  editable?: boolean;
  autoFocus?: boolean;
  error?: boolean;
  tone?: "light" | "dark";
};

export const PinDotsInput = forwardRef<TextInput, PinDotsInputProps>(function PinDotsInput(
  {
    value,
    onChangeText,
    accessibilityLabel,
    editable = true,
    autoFocus = false,
    error = false,
    tone = "light",
  },
  ref,
) {
  const digitCount = value.length;

  return (
    <View style={styles.pinInputBlock}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.pinCells}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = index < digitCount;
          const current = index === digitCount && digitCount < PIN_LENGTH;

          return (
            <View
              key={index}
              style={[
                styles.pinCell,
                tone === "dark" && styles.pinCellDark,
                current && styles.pinCellCurrent,
                current && tone === "dark" && styles.pinCellCurrentDark,
                error && styles.pinCellError,
                error && tone === "dark" && styles.pinCellErrorDark,
              ]}
            >
              <Text style={[styles.pinDot, tone === "dark" && styles.pinDotDark]}>{filled ? "●" : ""}</Text>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={ref}
        value={value}
        onChangeText={(nextValue) => onChangeText(onlyPinDigits(nextValue))}
        editable={editable}
        autoFocus={autoFocus}
        maxLength={PIN_LENGTH}
        keyboardType="number-pad"
        inputMode="numeric"
        secureTextEntry
        caretHidden
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Digite seis números. O PIN não será exibido."
        accessibilityValue={{ text: `${digitCount} de ${PIN_LENGTH} dígitos preenchidos` }}
        style={styles.hiddenPinInput}
      />

      <Text
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        style={[styles.pinProgress, tone === "dark" && styles.pinProgressDark]}
      >
        {digitCount} de {PIN_LENGTH} dígitos preenchidos
      </Text>
    </View>
  );
});

export type PinSetupModalProps = {
  visible: boolean;
  onCancel: () => void;
  onComplete: (pin: string) => void | Promise<void>;
  title?: string;
  description?: string;
  loading?: boolean;
  errorMessage?: string | null;
  embedded?: boolean;
};

type PinStep = "create" | "confirm";

export function PinSetupModal({
  visible,
  onCancel,
  onComplete,
  title = "Configurar PIN",
  description = "Crie um PIN de 6 dígitos para acessar o Sonhar+.",
  loading = false,
  errorMessage,
  embedded = false,
}: PinSetupModalProps) {
  const inputRef = useRef<TextInput>(null);
  const [step, setStep] = useState<PinStep>("create");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatchMessage, setMismatchMessage] = useState<string | null>(null);
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = loading || submitting;
  const currentValue = step === "create" ? pin : confirmation;
  const currentError = mismatchMessage ?? errorMessage ?? submissionMessage;
  const canContinue = currentValue.length === PIN_LENGTH && !busy;

  function reset() {
    setStep("create");
    setPin("");
    setConfirmation("");
    setMismatchMessage(null);
    setSubmissionMessage(null);
    setSubmitting(false);
  }

  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [step, visible]);

  function changeCurrentValue(nextValue: string) {
    setMismatchMessage(null);
    setSubmissionMessage(null);
    if (step === "create") setPin(nextValue);
    else setConfirmation(nextValue);
  }

  function cancel() {
    if (busy) return;
    reset();
    onCancel();
  }

  function goBack() {
    if (busy) return;
    setStep("create");
    setConfirmation("");
    setMismatchMessage(null);
    setSubmissionMessage(null);
  }

  async function continueFlow() {
    if (!canContinue) return;

    if (step === "create") {
      setStep("confirm");
      setConfirmation("");
      return;
    }

    if (confirmation !== pin) {
      setConfirmation("");
      setMismatchMessage("Os PINs não coincidem.");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    setSubmitting(true);
    setSubmissionMessage(null);
    try {
      await onComplete(pin);
      setPin("");
      setConfirmation("");
    } catch {
      setSubmissionMessage("Não foi possível salvar o PIN. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) return null;

  const content = (
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
              <Text style={styles.eyebrow}>SEGURANÇA</Text>
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            </View>
            <Pressable
              onPress={cancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancelar configuração do PIN"
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
            <View style={styles.iconCircle} accessible={false}>
              <Ionicons name="keypad-outline" size={30} color={OB.primary} accessible={false} />
            </View>

            <View style={styles.copyBlock}>
              <Text style={styles.stepLabel}>
                {step === "create" ? "CRIAR PIN" : "CONFIRMAR PIN"}
              </Text>
              <Text style={styles.heading}>
                {step === "create" ? "Digite seu PIN de 6 dígitos" : "Confirme seu PIN"}
              </Text>
              <Text style={styles.description}>
                {step === "create"
                  ? description
                  : "Digite novamente o mesmo PIN para confirmar."}
              </Text>
            </View>

            <PinDotsInput
              ref={inputRef}
              value={currentValue}
              onChangeText={changeCurrentValue}
              editable={!busy}
              accessibilityLabel={step === "create" ? "Novo PIN de acesso" : "Confirmação do PIN de acesso"}
              error={Boolean(currentError)}
            />

            {currentError ? (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color="#A33B3B" accessible={false} />
                <Text style={styles.errorText}>{currentError}</Text>
              </View>
            ) : (
              <View style={styles.securityNote}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#526F91" accessible={false} />
                <Text style={styles.securityNoteText}>Seu PIN não será exibido na tela.</Text>
              </View>
            )}

            <View style={styles.actions}>
              <Pressable
                onPress={() => void continueFlow()}
                disabled={!canContinue}
                accessibilityRole="button"
                accessibilityLabel={step === "create" ? "Continuar para confirmação" : "Salvar PIN"}
                accessibilityState={{ disabled: !canContinue, busy }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !canContinue && styles.primaryButtonDisabled,
                  pressed && canContinue && styles.buttonPressed,
                ]}
              >
                {busy ? <ActivityIndicator color={OB.white} /> : null}
                <Text style={styles.primaryButtonText}>
                  {busy ? "Salvando..." : step === "create" ? "Continuar" : "Salvar PIN"}
                </Text>
              </Pressable>

              <Pressable
                onPress={step === "confirm" ? goBack : cancel}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={step === "confirm" ? "Voltar e alterar o PIN" : "Cancelar"}
                accessibilityState={{ disabled: busy }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && !busy && styles.buttonPressed,
                  busy && styles.controlDisabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>
                  {step === "confirm" ? "Voltar e alterar" : "Cancelar"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
  );

  if (embedded) {
    return (
      <View
        accessibilityViewIsModal
        importantForAccessibility="yes"
        style={styles.embeddedModal}
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
      onRequestClose={cancel}
      onShow={() => inputRef.current?.focus()}
      statusBarTranslucent={false}
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  embeddedModal: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: OB.offWhite,
  },
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
    letterSpacing: 1.3,
  },
  title: {
    color: OB.primary,
    fontSize: 22,
    lineHeight: 28,
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
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 28,
    alignItems: "center",
  },
  iconCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E9EFF6",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  copyBlock: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    marginTop: 20,
  },
  stepLabel: {
    color: "#526F91",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  heading: {
    color: OB.primary,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 5,
  },
  description: {
    color: "#526F91",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 7,
  },
  pinInputBlock: {
    width: "100%",
    maxWidth: 390,
    marginTop: 26,
    position: "relative",
  },
  pinCells: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
  },
  pinCell: {
    flex: 1,
    maxWidth: 54,
    minWidth: 32,
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.white,
    alignItems: "center",
    justifyContent: "center",
  },
  pinCellCurrent: {
    borderColor: OB.support,
  },
  pinCellDark: {
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pinCellCurrentDark: {
    borderColor: "rgba(218,231,244,0.78)",
  },
  pinCellError: {
    borderColor: "#D88A8A",
    backgroundColor: "#FFF7F7",
  },
  pinCellErrorDark: {
    borderColor: "rgba(255,208,208,0.72)",
    backgroundColor: "rgba(138,48,48,0.28)",
  },
  pinDot: {
    color: OB.primary,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
  },
  pinDotDark: {
    color: OB.white,
  },
  hiddenPinInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 58,
    color: "transparent",
    backgroundColor: "transparent",
    padding: 0,
  },
  pinProgress: {
    color: "#526F91",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
  pinProgressDark: {
    color: "rgba(218,231,244,0.88)",
  },
  errorBox: {
    width: "100%",
    maxWidth: 390,
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 16,
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
  securityNote: {
    width: "100%",
    maxWidth: 390,
    minHeight: 42,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  securityNoteText: {
    color: "#526F91",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  actions: {
    width: "100%",
    maxWidth: 390,
    marginTop: "auto",
    paddingTop: 26,
    gap: 10,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: OB.primary,
  },
  primaryButtonDisabled: {
    backgroundColor: "#AAB9CA",
  },
  primaryButtonText: {
    color: OB.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.white,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  secondaryButtonText: {
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
