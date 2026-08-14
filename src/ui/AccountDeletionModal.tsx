import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
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
import {
  ACCOUNT_DELETION_CONFIRMATION,
  isAccountDeletionConfirmation,
} from "../lib/accountDeletion";
import { OB } from "./OnboardingKit";

type AccountDeletionStep = "warning" | "confirmation";

export type AccountDeletionModalProps = {
  visible: boolean;
  loading?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onDismiss?: () => void;
  onRequestDeletion: () => void;
};

const DATA_REMOVED = [
  "movimentações e categorias financeiras",
  "sonhos, contribuições e fotos",
  "planejamento e configurações financeiras",
  "perfil, importações e conexões vinculadas",
] as const;

export function AccountDeletionModal({
  visible,
  loading = false,
  errorMessage,
  onCancel,
  onDismiss,
  onRequestDeletion,
}: AccountDeletionModalProps) {
  const confirmationInputRef = useRef<TextInput>(null);
  const [step, setStep] = useState<AccountDeletionStep>("warning");
  const [confirmation, setConfirmation] = useState("");
  const confirmationMatches = isAccountDeletionConfirmation(confirmation);

  useEffect(() => {
    if (!visible || step !== "confirmation" || loading) return;
    const timer = setTimeout(() => confirmationInputRef.current?.focus(), 180);
    return () => clearTimeout(timer);
  }, [loading, step, visible]);

  function cancel() {
    if (loading) return;
    Keyboard.dismiss();
    setStep("warning");
    setConfirmation("");
    onCancel();
  }

  function continueToConfirmation() {
    if (loading) return;
    setStep("confirmation");
  }

  function returnToWarning() {
    if (loading) return;
    Keyboard.dismiss();
    setConfirmation("");
    setStep("warning");
  }

  function requestDeletion() {
    if (!confirmationMatches || loading) return;
    Keyboard.dismiss();
    onRequestDeletion();
  }

  const confirming = step === "confirmation";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={cancel}
      onDismiss={onDismiss}
      statusBarTranslucent={false}
    >
      <SafeAreaView
        accessibilityViewIsModal
        edges={["top", "bottom"]}
        style={styles.safeArea}
      >
        <StatusBar style="dark" backgroundColor={OB.offWhite} translucent={false} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>CONTA</Text>
              <Text accessibilityRole="header" style={styles.headerTitle}>
                Excluir minha conta
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Cancelar exclusão da conta"
              accessibilityRole="button"
              accessibilityState={{ disabled: loading }}
              disabled={loading}
              hitSlop={8}
              onPress={cancel}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && !loading && styles.buttonPressed,
                loading && styles.controlDisabled,
              ]}
            >
              <Ionicons name="close" size={23} color={OB.primary} accessible={false} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.dangerIcon} accessible={false}>
              <Ionicons name="warning-outline" size={32} color="#A33B3B" accessible={false} />
            </View>

            {confirming ? (
              <ConfirmationStep
                confirmation={confirmation}
                confirmationInputRef={confirmationInputRef}
                confirmationMatches={confirmationMatches}
                errorMessage={errorMessage}
                loading={loading}
                onChangeConfirmation={setConfirmation}
                onRequestDeletion={requestDeletion}
                onReturn={returnToWarning}
              />
            ) : (
              <WarningStep
                onCancel={cancel}
                onContinue={continueToConfirmation}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

type WarningStepProps = {
  onCancel: () => void;
  onContinue: () => void;
};

function WarningStep({ onCancel, onContinue }: WarningStepProps) {
  return (
    <View style={styles.stepContent}>
      <Text accessibilityRole="header" style={styles.title}>Excluir sua conta?</Text>
      <Text style={styles.description}>
        Ao excluir sua conta, os dados do Sonhar+ associados a ela serão removidos permanentemente.
      </Text>

      <View
        accessible
        accessibilityLabel={`A exclusão inclui: ${DATA_REMOVED.join(", ")}.`}
        style={styles.dataCard}
      >
        <Text style={styles.dataCardTitle}>A exclusão inclui</Text>
        {DATA_REMOVED.map((item) => (
          <View key={item} style={styles.dataRow}>
            <View style={styles.bullet} accessible={false} />
            <Text style={styles.dataText}>{item}</Text>
          </View>
        ))}
      </View>

      <View accessibilityRole="alert" style={styles.permanentWarning}>
        <Ionicons name="alert-circle-outline" size={19} color="#8A3030" accessible={false} />
        <Text style={styles.permanentWarningText}>Esta ação não poderá ser desfeita.</Text>
      </View>

      <Pressable
        accessibilityLabel="Continuar exclusão da conta"
        accessibilityRole="button"
        onPress={onContinue}
        style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}
      >
        <Text style={styles.dangerButtonText}>Continuar exclusão</Text>
        <Ionicons name="arrow-forward" size={19} color={OB.white} accessible={false} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
      >
        <Text style={styles.secondaryButtonText}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

type ConfirmationStepProps = {
  confirmation: string;
  confirmationInputRef: React.RefObject<TextInput | null>;
  confirmationMatches: boolean;
  errorMessage?: string | null;
  loading: boolean;
  onChangeConfirmation: (value: string) => void;
  onRequestDeletion: () => void;
  onReturn: () => void;
};

function ConfirmationStep({
  confirmation,
  confirmationInputRef,
  confirmationMatches,
  errorMessage,
  loading,
  onChangeConfirmation,
  onRequestDeletion,
  onReturn,
}: ConfirmationStepProps) {
  return (
    <View style={styles.stepContent}>
      <Text accessibilityRole="header" style={styles.title}>Confirmação final</Text>
      <Text style={styles.description}>
        Para confirmar, digite <Text style={styles.confirmationWord}>{ACCOUNT_DELETION_CONFIRMATION}</Text> exatamente como aparece abaixo.
      </Text>

      <View style={styles.inputBlock}>
        <Text nativeID="account-deletion-confirmation-label" style={styles.inputLabel}>
          Digite {ACCOUNT_DELETION_CONFIRMATION}
        </Text>
        <TextInput
          ref={confirmationInputRef}
          accessibilityLabel={`Digite ${ACCOUNT_DELETION_CONFIRMATION} para confirmar a exclusão da conta`}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          editable={!loading}
          inputMode="text"
          maxLength={ACCOUNT_DELETION_CONFIRMATION.length + 8}
          onChangeText={onChangeConfirmation}
          onSubmitEditing={requestSubmitIfAllowed}
          placeholder={ACCOUNT_DELETION_CONFIRMATION}
          placeholderTextColor="#9AA9B8"
          returnKeyType="done"
          selectTextOnFocus
          spellCheck={false}
          style={[
            styles.input,
            confirmation.length > 0 && !confirmationMatches && styles.inputInvalid,
            confirmationMatches && styles.inputValid,
            loading && styles.controlDisabled,
          ]}
          textContentType="none"
          value={confirmation}
        />
        <Text accessibilityLiveRegion="polite" style={styles.inputHint}>
          O botão será liberado somente quando o texto corresponder exatamente.
        </Text>
      </View>

      {errorMessage ? (
        <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={19} color="#8A3030" accessible={false} />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="Excluir conta permanentemente"
        accessibilityRole="button"
        accessibilityState={{ disabled: !confirmationMatches || loading, busy: loading }}
        disabled={!confirmationMatches || loading}
        onPress={onRequestDeletion}
        style={({ pressed }) => [
          styles.dangerButton,
          (!confirmationMatches || loading) && styles.dangerButtonDisabled,
          pressed && confirmationMatches && !loading && styles.buttonPressed,
        ]}
      >
        {loading ? <ActivityIndicator color={OB.white} size="small" /> : null}
        <Text style={styles.dangerButtonText} accessibilityLiveRegion="polite">
          {loading ? "Excluindo sua conta..." : "Excluir conta permanentemente"}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: loading }}
        disabled={loading}
        onPress={onReturn}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed && !loading && styles.buttonPressed,
          loading && styles.controlDisabled,
        ]}
      >
        <Ionicons name="arrow-back" size={18} color={OB.primary} accessible={false} />
        <Text style={styles.secondaryButtonText}>Voltar</Text>
      </Pressable>
    </View>
  );

  function requestSubmitIfAllowed() {
    if (confirmationMatches && !loading) onRequestDeletion();
  }
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
  headerTitle: {
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
  dangerIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FDECEC",
    borderWidth: 1,
    borderColor: "#F1C2C2",
  },
  stepContent: {
    width: "100%",
    alignItems: "center",
  },
  title: {
    color: OB.primary,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 16,
  },
  description: {
    maxWidth: 390,
    color: "#526F91",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 9,
  },
  confirmationWord: {
    color: OB.primary,
    fontWeight: "900",
  },
  dataCard: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 18,
    padding: 16,
    marginTop: 20,
    backgroundColor: OB.white,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  dataCardTitle: {
    color: OB.primary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
    marginBottom: 8,
  },
  dataRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 4,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: "#B94A4A",
  },
  dataText: {
    flex: 1,
    color: "#526F91",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  permanentWarning: {
    width: "100%",
    maxWidth: 390,
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
  permanentWarningText: {
    flex: 1,
    color: "#8A3030",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  inputBlock: {
    width: "100%",
    maxWidth: 390,
    marginTop: 24,
  },
  inputLabel: {
    color: OB.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    minHeight: 54,
    borderRadius: 15,
    paddingHorizontal: 16,
    color: OB.primary,
    backgroundColor: OB.white,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  inputInvalid: {
    borderColor: "#D89A9A",
  },
  inputValid: {
    borderColor: "#5E9A72",
  },
  inputHint: {
    color: "#6E8196",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 7,
  },
  errorBox: {
    width: "100%",
    maxWidth: 390,
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
  dangerButton: {
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
    backgroundColor: "#A33B3B",
  },
  dangerButtonDisabled: {
    backgroundColor: "#B7A5A5",
  },
  dangerButtonText: {
    color: OB.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  secondaryButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 50,
    borderRadius: 16,
    marginTop: 10,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
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
