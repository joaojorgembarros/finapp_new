import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  APP_LOCK_TIMEOUT_OPTIONS,
  type AppLockTimeoutMs,
} from "../lib/appLockPolicy";
import { useAppLock } from "../providers/AppLockProvider";
import { OB } from "./OnboardingKit";
import { PinSetupModal } from "./PinSetupModal";
import { SecurityConfirmationModal } from "./SecurityConfirmationModal";

type ConfirmationAction =
  | "disable-lock"
  | "disable-biometric"
  | "configure-pin"
  | "replace-pin"
  | "remove-pin";

type PinSetupAction = "enable-lock" | "configure-pin" | "replace-pin";

const CONFIRMATION_COPY: Record<
  ConfirmationAction,
  { title: string; description: string }
> = {
  "disable-lock": {
    title: "Desativar bloqueio?",
    description: "Confirme sua identidade antes de desativar a proteção do Sonhar+.",
  },
  "disable-biometric": {
    title: "Desativar biometria?",
    description: "Confirme sua identidade antes de remover a biometria como forma de acesso.",
  },
  "configure-pin": {
    title: "Configurar PIN?",
    description: "Confirme sua identidade antes de adicionar um novo método de acesso.",
  },
  "replace-pin": {
    title: "Alterar PIN?",
    description: "Confirme sua identidade antes de criar um novo PIN de acesso.",
  },
  "remove-pin": {
    title: "Remover PIN?",
    description: "Confirme sua identidade antes de remover o PIN deste aparelho.",
  },
};

const PIN_SETUP_COPY: Record<
  PinSetupAction,
  { title: string; description: string }
> = {
  "enable-lock": {
    title: "Criar PIN de acesso",
    description: "Crie um PIN de 6 dígitos para ativar o bloqueio do Sonhar+.",
  },
  "configure-pin": {
    title: "Configurar PIN",
    description: "Crie um PIN de 6 dígitos para usar como alternativa à biometria.",
  },
  "replace-pin": {
    title: "Criar novo PIN",
    description: "O novo PIN substituirá o PIN configurado neste aparelho.",
  },
};

function showFriendlyFailure(message: string) {
  Alert.alert("Não foi possível concluir", message);
}

export function SecuritySettingsCard() {
  const appLock = useAppLock();
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null);
  const [pinSetupAction, setPinSetupAction] = useState<PinSetupAction | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const refreshBiometricCapabilities = appLock.refreshBiometricCapabilities;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "web") void refreshBiometricCapabilities();
    }, [refreshBiometricCapabilities]),
  );

  if (Platform.OS === "web") return null;

  const config = appLock.config;
  const biometric = appLock.biometricCapabilities;
  const busy = working || appLock.busy;
  const pinConfigured = appLock.hasPin;
  const confirmationCopy = confirmationAction
    ? CONFIRMATION_COPY[confirmationAction]
    : CONFIRMATION_COPY["disable-lock"];
  const setupCopy = pinSetupAction
    ? PIN_SETUP_COPY[pinSetupAction]
    : PIN_SETUP_COPY["configure-pin"];

  function beginConfirmation(action: ConfirmationAction) {
    if (busy) return;
    setStatusMessage(null);
    setConfirmationError(null);
    setConfirmationAction(action);
  }

  function closeConfirmation() {
    if (busy) return;
    setConfirmationAction(null);
    setConfirmationError(null);
  }

  async function run(action: () => Promise<void>, failureMessage: string) {
    if (busy) return false;
    setWorking(true);
    setStatusMessage(null);
    try {
      await action();
      return true;
    } catch {
      showFriendlyFailure(failureMessage);
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function requestLockChange(nextEnabled: boolean) {
    if (!nextEnabled) {
      beginConfirmation("disable-lock");
      return;
    }

    if (!pinConfigured && !config.biometricEnabled) {
      setPinSetupAction("enable-lock");
      return;
    }

    const changed = await run(
      () => appLock.setLockEnabled(true),
      "Não foi possível ativar o bloqueio do Sonhar+. Tente novamente.",
    );
    if (changed) setStatusMessage("Bloqueio do Sonhar+ ativado.");
  }

  async function requestBiometricChange(nextEnabled: boolean) {
    if (!nextEnabled) {
      if (config.enabled && !pinConfigured) {
        Alert.alert(
          "Biometria necessária",
          "Configure um PIN ou desative o bloqueio do Sonhar+ antes de remover seu único método de acesso.",
        );
        return;
      }
      beginConfirmation("disable-biometric");
      return;
    }

    if (!biometric.available) {
      Alert.alert(
        "Biometria indisponível",
        biometric.message ?? "Configure uma biometria no seu aparelho para usar este recurso.",
      );
      return;
    }

    if (busy) return;
    setWorking(true);
    setStatusMessage(null);
    try {
      const result = await appLock.enableBiometrics();
      if (result.success) {
        setStatusMessage("Biometria ativada para proteger o Sonhar+.");
      } else if (result.status !== "cancelled") {
        Alert.alert(
          "Não foi possível confirmar",
          result.message ?? "Não foi possível confirmar sua biometria. Tente novamente.",
        );
      }
    } catch {
      showFriendlyFailure("Não foi possível confirmar sua biometria. Tente novamente.");
    } finally {
      setWorking(false);
    }
  }

  function requestPinAction() {
    if (pinConfigured) {
      beginConfirmation("replace-pin");
    } else if (config.enabled || config.biometricEnabled) {
      beginConfirmation("configure-pin");
    } else {
      setPinSetupAction("configure-pin");
    }
  }

  function requestPinRemoval() {
    if (config.enabled && !config.biometricEnabled) {
      Alert.alert(
        "PIN necessário",
        "Ative a biometria ou desative o bloqueio do Sonhar+ antes de remover seu único método de acesso.",
      );
      return;
    }
    beginConfirmation("remove-pin");
  }

  async function completePinSetup(pin: string) {
    if (!pinSetupAction) return;
    const action = pinSetupAction;
    setWorking(true);
    setStatusMessage(null);
    try {
      await appLock.setPin(pin);
      if (action === "enable-lock") await appLock.setLockEnabled(true);
      setPinSetupAction(null);
      setStatusMessage(
        action === "enable-lock"
          ? "PIN criado e bloqueio do Sonhar+ ativado."
          : action === "replace-pin"
            ? "PIN alterado com segurança."
            : "PIN configurado como alternativa de acesso.",
      );
    } catch {
      throw new Error("pin-setup-failed");
    } finally {
      setWorking(false);
    }
  }

  async function completeSensitiveAction() {
    if (!confirmationAction) return;

    const action = confirmationAction;
    if (action === "disable-lock") {
      await appLock.setLockEnabled(false);
      setStatusMessage("Bloqueio do Sonhar+ desativado.");
    } else if (action === "disable-biometric") {
      await appLock.disableBiometrics();
      setStatusMessage("Biometria desativada.");
    } else if (action === "remove-pin") {
      await appLock.removePin();
      setStatusMessage("PIN removido deste aparelho.");
    }

    setConfirmationAction(null);
    setConfirmationError(null);
    if (action === "replace-pin") setPinSetupAction("replace-pin");
    if (action === "configure-pin") setPinSetupAction("configure-pin");
  }

  async function confirmWithBiometrics() {
    if (!confirmationAction || busy) return;
    setWorking(true);
    setConfirmationError(null);
    try {
      const result = await appLock.confirmWithBiometrics(confirmationAction);
      if (!result.success) {
        if (result.status !== "cancelled") {
          setConfirmationError(result.message ?? "Não foi possível confirmar sua identidade.");
        }
        return;
      }
      await completeSensitiveAction();
    } catch {
      setConfirmationError("Não foi possível confirmar sua identidade. Tente novamente.");
    } finally {
      setWorking(false);
    }
  }

  async function confirmWithPin(pin: string) {
    if (!confirmationAction || busy) return;
    setWorking(true);
    setConfirmationError(null);
    try {
      const result = await appLock.confirmWithPin(pin, confirmationAction);
      if (!result.success) {
        setConfirmationError(result.message ?? "PIN incorreto. Tente novamente.");
        return;
      }
      await completeSensitiveAction();
    } catch {
      setConfirmationError("Não foi possível confirmar sua identidade. Tente novamente.");
    } finally {
      setWorking(false);
    }
  }

  async function selectTimeout(timeoutMs: AppLockTimeoutMs) {
    if (timeoutMs === config.timeoutMs || busy) return;
    const changed = await run(
      () => appLock.setTimeout(timeoutMs),
      "Não foi possível alterar o bloqueio automático. Tente novamente.",
    );
    if (changed) setStatusMessage("Tempo de bloqueio automático atualizado.");
  }

  return (
    <>
      <View style={styles.card} accessibilityLabel="Configurações de segurança">
        <View style={styles.headingRow}>
          <View style={styles.headingIcon} accessible={false}>
            <Ionicons name="shield-checkmark-outline" size={22} color={OB.primary} accessible={false} />
          </View>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={styles.cardTitle}>Segurança</Text>
            <Text style={styles.cardSubtitle}>Proteja seus dados ao sair ou reabrir o aplicativo.</Text>
          </View>
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingIcon} accessible={false}>
            <Ionicons name="lock-closed-outline" size={19} color={OB.primary} accessible={false} />
          </View>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>Bloquear o Sonhar+</Text>
            <Text style={styles.settingSubtitle}>Exige biometria ou PIN para acessar seus dados.</Text>
          </View>
          <Switch
            value={config.enabled}
            onValueChange={(value) => void requestLockChange(value)}
            disabled={busy}
            accessibilityLabel="Bloquear o Sonhar+"
            accessibilityHint="Ativa ou desativa a proteção local do aplicativo"
            accessibilityState={{ checked: config.enabled, disabled: busy }}
            hitSlop={8}
            trackColor={{ false: "#CBD5E1", true: OB.support }}
            thumbColor={config.enabled ? OB.primary : "#FFFFFF"}
            ios_backgroundColor="#CBD5E1"
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={styles.settingIcon} accessible={false}>
            <Ionicons name="finger-print-outline" size={21} color={OB.primary} accessible={false} />
          </View>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>{biometric.actionLabel}</Text>
            <Text style={styles.settingSubtitle}>
              {biometric.available
                ? "Use a biometria cadastrada neste aparelho."
                : biometric.message ?? "Biometria indisponível neste aparelho."}
            </Text>
          </View>
          <Switch
            value={config.biometricEnabled}
            onValueChange={(value) => void requestBiometricChange(value)}
            disabled={busy || (!biometric.available && !config.biometricEnabled)}
            accessibilityLabel={biometric.actionLabel}
            accessibilityHint="Ativa ou desativa a biometria para proteger o aplicativo"
            accessibilityState={{
              checked: config.biometricEnabled,
              disabled: busy || (!biometric.available && !config.biometricEnabled),
            }}
            hitSlop={8}
            trackColor={{ false: "#CBD5E1", true: OB.support }}
            thumbColor={config.biometricEnabled ? OB.primary : "#FFFFFF"}
            ios_backgroundColor="#CBD5E1"
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.pinRow}>
          <Pressable
            onPress={requestPinAction}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={pinConfigured ? "Alterar PIN de acesso" : "Configurar PIN de acesso"}
            accessibilityHint="Abre a configuração de um PIN de seis dígitos"
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.pinMainAction, pressed && !busy && styles.pressed, busy && styles.disabled]}
          >
            <View style={styles.settingIcon} accessible={false}>
              <Ionicons name="keypad-outline" size={20} color={OB.primary} accessible={false} />
            </View>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>PIN de acesso</Text>
              <Text style={styles.settingSubtitle}>
                {pinConfigured ? "PIN de 6 dígitos configurado." : "Use como alternativa à biometria."}
              </Text>
            </View>
            <Text style={styles.actionText}>{pinConfigured ? "Alterar" : "Configurar"}</Text>
          </Pressable>
          {pinConfigured ? (
            <Pressable
              onPress={requestPinRemoval}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Remover PIN de acesso"
              accessibilityState={{ disabled: busy }}
              hitSlop={4}
              style={({ pressed }) => [styles.removeButton, pressed && !busy && styles.pressed, busy && styles.disabled]}
            >
              <Text style={styles.removeText}>Remover</Text>
            </Pressable>
          ) : null}
        </View>

        {config.enabled ? (
          <View style={styles.timeoutBlock}>
            <View style={styles.timeoutHeading}>
              <Ionicons name="time-outline" size={18} color={OB.primary} accessible={false} />
              <View style={styles.timeoutCopy}>
                <Text style={styles.settingTitle}>Bloqueio automático</Text>
                <Text style={styles.settingSubtitle}>Ao voltar depois de sair do aplicativo.</Text>
              </View>
            </View>
            <View style={styles.timeoutOptions} accessibilityRole="radiogroup">
              {APP_LOCK_TIMEOUT_OPTIONS.map((option) => {
                const selected = config.timeoutMs === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => void selectTimeout(option.value)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: selected, disabled: busy }}
                    style={({ pressed }) => [
                      styles.timeoutOption,
                      selected && styles.timeoutOptionSelected,
                      pressed && !busy && styles.pressed,
                      busy && styles.disabled,
                    ]}
                  >
                    <Text style={[styles.timeoutOptionText, selected && styles.timeoutOptionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {statusMessage ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.statusBox}>
            <Ionicons name="checkmark-circle-outline" size={18} color="#126B45" accessible={false} />
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        ) : null}
      </View>

      <PinSetupModal
        visible={pinSetupAction !== null}
        title={setupCopy.title}
        description={setupCopy.description}
        loading={working}
        onCancel={() => {
          if (!working) setPinSetupAction(null);
        }}
        onComplete={completePinSetup}
      />

      <SecurityConfirmationModal
        visible={confirmationAction !== null}
        title={confirmationCopy.title}
        description={confirmationCopy.description}
        onCancel={closeConfirmation}
        showBiometric={config.biometricEnabled}
        biometricAvailable={biometric.available}
        biometricLabel={biometric.actionLabel}
        biometricHint="Confirme sua identidade para continuar."
        onBiometric={config.biometricEnabled ? confirmWithBiometrics : undefined}
        pinEnabled={pinConfigured}
        onConfirmPin={pinConfigured ? confirmWithPin : undefined}
        loading={working}
        errorMessage={confirmationError}
        cooldownSeconds={Math.ceil(appLock.cooldownRemainingMs / 1_000)}
        cooldownKey={appLock.attempts.failedAttempts}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: OB.white,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  headingIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E9EFF6",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  headingCopy: {
    flex: 1,
  },
  cardTitle: {
    color: OB.primary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: "#526F91",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  settingRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 9,
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  settingCopy: {
    flex: 1,
    minWidth: 0,
  },
  settingTitle: {
    color: OB.primary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  settingSubtitle: {
    color: "#526F91",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: OB.supportSoft,
    marginLeft: 47,
  },
  pinRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.supportSoft,
    paddingTop: 5,
    paddingBottom: 7,
  },
  pinMainAction: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 14,
    paddingVertical: 6,
  },
  actionText: {
    minHeight: 44,
    color: OB.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    textAlignVertical: "center",
    paddingHorizontal: 5,
  },
  removeButton: {
    alignSelf: "flex-end",
    minHeight: 44,
    minWidth: 72,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    marginTop: -4,
  },
  removeText: {
    color: "#A33B3B",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  timeoutBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.supportSoft,
    paddingTop: 14,
    paddingBottom: 4,
  },
  timeoutHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  timeoutCopy: {
    flex: 1,
  },
  timeoutOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  timeoutOption: {
    minHeight: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  timeoutOptionSelected: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  timeoutOptionText: {
    color: "#526F91",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  timeoutOptionTextSelected: {
    color: OB.white,
  },
  statusBox: {
    minHeight: 44,
    borderRadius: 13,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ECF8F2",
    borderWidth: 1,
    borderColor: "#BEE3D1",
  },
  statusText: {
    flex: 1,
    color: "#126B45",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.76,
  },
  disabled: {
    opacity: 0.52,
  },
});
