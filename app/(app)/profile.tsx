import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";
import { SecuritySettingsCard } from "../../src/ui/SecuritySettingsCard";
import { SecurityConfirmationModal } from "../../src/ui/SecurityConfirmationModal";
import { AccountDeletionModal } from "../../src/ui/AccountDeletionModal";
import { useSession } from "../../src/providers/SessionProvider";
import { useAppLock } from "../../src/providers/AppLockProvider";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { expectedMonthlyIncomeCents, EmploymentType, getProfile, upsertProfile } from "../../src/lib/profile";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";
import { requestPasswordReset } from "../../src/lib/auth";
import {
  AccountDeletionError,
  createSupabaseAccountDeletionRunner,
  getAccountDeletionMessage,
  shouldRequireAccountDeletionLocalIdentity,
} from "../../src/lib/accountDeletion";
import { LEGAL_URLS, openLegalUrl } from "../../src/lib/legal";
import { getPasswordResetRequestErrorMessage, isValidEmail, normalizeEmail } from "../../src/lib/authValidation";

const TYPES: EmploymentType[] = ["CLT", "PJ", "Autônomo", "Estudante", "Outro"];

function initialsFrom(nameOrEmail: string) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  if (s.includes("@")) return (s.split("@")[0]?.slice(0, 2) || "U").toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return (parts[0].slice(0, 2) || "U").toUpperCase();
  return `${parts[0]?.[0] ?? "U"}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function moneyInputFromCents(cents: number) {
  return cents > 0 ? formatBRLFromCents(cents) : "";
}

function base64ToBytes(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean[i] ?? "A");
    const b = chars.indexOf(clean[i + 1] ?? "A");
    const c = clean[i + 2] === "=" ? -1 : chars.indexOf(clean[i + 2] ?? "A");
    const d = clean[i + 3] === "=" ? -1 : chars.indexOf(clean[i + 3] ?? "A");
    const chunk = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);

    bytes.push((chunk >> 16) & 255);
    if (c >= 0) bytes.push((chunk >> 8) & 255);
    if (d >= 0) bytes.push(chunk & 255);
  }

  return bytes;
}

function extensionFromMime(mimeType?: string | null) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export default function OnboardingProfileScreen() {
  const {
    session,
    userId,
    signOut,
    clearExpiredSessionLocally,
    finalizeDeletedAccountLocally,
  } = useSession();
  const appLock = useAppLock();
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<"personal" | "financial">();
  const userMeta = session?.user?.user_metadata as Record<string, any> | undefined;
  const email = session?.user?.email || "";

  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [name, setName] = useState(
    userMeta?.full_name ||
      userMeta?.name ||
      email.split("@")[0] ||
      ""
  );
  const [avatarUrl, setAvatarUrl] = useState(userMeta?.avatar_url || userMeta?.picture || "");
  const [accountEmail, setAccountEmail] = useState(email);
  const [phone, setPhone] = useState(userMeta?.phone || userMeta?.phone_number || "");
  const [fixed, setFixed] = useState("");
  const [variableAvg, setVariableAvg] = useState("");
  const [employment, setEmployment] = useState<EmploymentType>("CLT");
  const [accountDeletionVisible, setAccountDeletionVisible] = useState(false);
  const [accountDeletionSecurityVisible, setAccountDeletionSecurityVisible] = useState(false);
  const [accountDeletionLoading, setAccountDeletionLoading] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState<string | null>(null);
  const [accountDeletionSecurityError, setAccountDeletionSecurityError] = useState<string | null>(null);
  const accountDeletionRunnerRef = useRef<ReturnType<typeof createSupabaseAccountDeletionRunner> | null>(null);
  const accountDeletionOperationRef = useRef<Promise<void> | null>(null);
  const accountDeletionExpectedUserIdRef = useRef<string | null>(null);
  const accountDeletionSecurityHandoffRef = useRef(false);
  const accountDeletionModalHandoffRef = useRef(false);

  if (!accountDeletionRunnerRef.current && userId) {
    accountDeletionRunnerRef.current = createSupabaseAccountDeletionRunner(
      userId,
      finalizeDeletedAccountLocally,
    );
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!userId) return;
      try {
        setBusy(true);
        const profile = await getProfile(userId);
        if (!alive || !profile) return;
        setFixed(moneyInputFromCents(profile.income_fixed_cents || 0));
        setVariableAvg(moneyInputFromCents(profile.income_variable_avg_cents || 0));
        setEmployment((profile.employment_type as EmploymentType) || "CLT");
      } catch (error: any) {
        Alert.alert("Perfil", error?.message ?? "Não foi possível carregar seus dados.");
      } finally {
        if (alive) setBusy(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [userId]);

  const fixedCents = useMemo(() => parseBRLToCents(fixed), [fixed]);
  const variableCents = useMemo(() => parseBRLToCents(variableAvg), [variableAvg]);
  const totalCents = expectedMonthlyIncomeCents({
    income_fixed_cents: fixedCents,
    income_variable_avg_cents: variableCents,
  });
  const previewName = name.trim() || email || "Usuário";
  const cleanAvatarUrl = avatarUrl.trim();
  const cleanEmail = normalizeEmail(accountEmail);
  const emailChanged = cleanEmail.toLowerCase() !== normalizeEmail(email).toLowerCase();
  const cleanPhone = phone.trim();

  async function saveProfile() {
    if (!userId) return;
    if (!name.trim()) {
      return Alert.alert("Perfil", "Informe seu nome.");
    }
    if (!isValidEmail(cleanEmail)) {
      return Alert.alert("Perfil", "Informe um e-mail válido.");
    }

    try {
      setBusy(true);
      if (emailChanged) {
        await supabase.auth.updateUser({ email: cleanEmail });
      }

      await supabase.auth.updateUser({
        data: {
          full_name: name.trim(),
          name: name.trim(),
          avatar_url: cleanAvatarUrl || null,
          phone: cleanPhone || null,
        },
      });
      await upsertProfile(userId, {
        income_fixed_cents: fixedCents,
        income_variable_avg_cents: variableCents,
        employment_type: employment,
      });
      Alert.alert(
        "Perfil",
        emailChanged
          ? "Dados atualizados. Confirme o novo e-mail pelo link enviado para concluir a alteração."
          : "Dados atualizados."
      );
    } catch (error: any) {
      Alert.alert("Erro", error?.message ?? "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function pickAvatar() {
    if (!userId || uploadingAvatar) return;

    const result = await DocumentPicker.getDocumentAsync({
      type: "image/*",
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    try {
      setUploadingAvatar(true);
      const mimeType = asset.mimeType || "image/jpeg";
      const extension = extensionFromMime(mimeType);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = new Uint8Array(base64ToBytes(base64));
      const path = `${userId}/avatar-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, bytes.buffer, {
        contentType: mimeType,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = data.publicUrl;

      await supabase.auth.updateUser({
        data: {
          full_name: name.trim(),
          name: name.trim(),
          avatar_url: publicUrl,
          phone: cleanPhone || null,
        },
      });

      setAvatarUrl(publicUrl);
      Alert.alert("Foto de perfil", "Foto atualizada.");
    } catch (error: any) {
      Alert.alert("Erro ao enviar foto", error?.message ?? "Não foi possível atualizar sua foto agora.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function resetPassword() {
    if (!email) return Alert.alert("Senha", "Não encontramos um e-mail para esta conta.");
    try {
      await requestPasswordReset(email);
      Alert.alert("Senha", "Enviamos um link de recuperação para seu e-mail.");
    } catch (error: unknown) {
      Alert.alert("Não foi possível enviar", getPasswordResetRequestErrorMessage(error));
    }
  }

  async function logout() {
    const result = await signOut();
    if (result.activeAccountChanged) return;
    router.replace("/(auth)/welcome");
    if (!result.remoteSignOutCompleted) {
      Alert.alert(
        "Sessão encerrada neste aparelho",
        "Não foi possível confirmar a saída dos outros dispositivos. Tente novamente quando estiver conectado.",
      );
    }
  }

  function openLegalDocument(url: string) {
    openLegalUrl(url).catch((error: any) => {
      Alert.alert("Não foi possível abrir", error?.message ?? "Confira a URL configurada para esta versão.");
    });
  }

  const requiresLocalIdentity = shouldRequireAccountDeletionLocalIdentity({
    platform: Platform.OS,
    appLockSupported: appLock.supported,
    appLockEnabled: appLock.config.enabled,
    hasPin: appLock.hasPin,
    biometricEnabled: appLock.config.biometricEnabled,
    biometricAvailable: appLock.biometricCapabilities.available,
  });

  function openAccountDeletion() {
    if (!userId || busy || uploadingAvatar) return;
    accountDeletionRunnerRef.current = createSupabaseAccountDeletionRunner(
      userId,
      finalizeDeletedAccountLocally,
    );
    accountDeletionExpectedUserIdRef.current = userId;
    setAccountDeletionError(null);
    setAccountDeletionSecurityError(null);
    setAccountDeletionVisible(true);
  }

  function showPendingAccountDeletionSecurity() {
    if (!accountDeletionSecurityHandoffRef.current) return;
    accountDeletionSecurityHandoffRef.current = false;
    setAccountDeletionSecurityVisible(true);
  }

  function showPendingAccountDeletionModal() {
    if (!accountDeletionModalHandoffRef.current) return;
    accountDeletionModalHandoffRef.current = false;
    setAccountDeletionVisible(true);
  }

  function returnFromDeletionSecurity() {
    accountDeletionModalHandoffRef.current = true;
    setAccountDeletionSecurityVisible(false);
    if (Platform.OS !== "ios") setTimeout(showPendingAccountDeletionModal, 0);
  }

  function executeAccountDeletion(): Promise<void> {
    if (accountDeletionOperationRef.current) return accountDeletionOperationRef.current;
    if (!accountDeletionRunnerRef.current) return Promise.resolve();

    const operation = (async () => {
      setAccountDeletionLoading(true);
      setAccountDeletionError(null);
      try {
        const result = await accountDeletionRunnerRef.current?.();
        setAccountDeletionVisible(false);
        setAccountDeletionSecurityVisible(false);
        if (result?.localCleanup === "different-user") return;
        router.replace("/(auth)/welcome");
        Alert.alert("Conta excluída", "Sua conta foi excluída.");
      } catch (error: unknown) {
        if (error instanceof AccountDeletionError && error.code === "session-expired") {
          const expectedUserId = accountDeletionExpectedUserIdRef.current;
          setAccountDeletionVisible(false);
          setAccountDeletionSecurityVisible(false);
          const cleanupResult = expectedUserId
            ? await clearExpiredSessionLocally(expectedUserId)
            : "failed";
          if (cleanupResult === "cleared") {
            router.replace("/(auth)/welcome");
            Alert.alert("Sessão expirada", getAccountDeletionMessage(error));
          } else if (cleanupResult === "different-user") {
            Alert.alert(
              "Conta ativa alterada",
              "A conta ativa mudou. Abra novamente a exclusão no perfil da conta correta.",
            );
          } else {
            router.replace("/(auth)/welcome");
            Alert.alert(
              "Sessão expirada",
              "Entre novamente para continuar. Se esta sessão reaparecer, feche e abra o app antes de tentar de novo.",
            );
          }
          return;
        }
        const message = getAccountDeletionMessage(error);
        if (requiresLocalIdentity) {
          setAccountDeletionSecurityError(message);
          setAccountDeletionSecurityVisible(true);
          setAccountDeletionVisible(false);
        } else {
          setAccountDeletionError(message);
          setAccountDeletionVisible(true);
          setAccountDeletionSecurityVisible(false);
        }
      } finally {
        setAccountDeletionLoading(false);
      }
    })().finally(() => {
      accountDeletionOperationRef.current = null;
    });

    accountDeletionOperationRef.current = operation;
    return operation;
  }

  function requestAccountDeletion() {
    if (accountDeletionLoading) return;
    setAccountDeletionError(null);
    if (requiresLocalIdentity) {
      accountDeletionSecurityHandoffRef.current = true;
      setAccountDeletionVisible(false);
      // iOS presents the next native Modal only after onDismiss. Other
      // platforms use the guarded next-tick handoff because onDismiss is iOS-only.
      if (Platform.OS !== "ios") setTimeout(showPendingAccountDeletionSecurity, 0);
      return;
    }
    void executeAccountDeletion();
  }

  async function confirmDeletionWithBiometrics() {
    setAccountDeletionSecurityError(null);
    const result = await appLock.verifyIdentityWithBiometrics();
    if (!result.success) {
      if (result.status === "cancelled") return;
      setAccountDeletionSecurityError(
        result.message ?? "Não foi possível confirmar sua identidade.",
      );
      return;
    }
    await executeAccountDeletion();
  }

  async function confirmDeletionWithPin(pin: string) {
    setAccountDeletionSecurityError(null);
    const result = await appLock.verifyIdentityWithPin(pin);
    if (!result.success) {
      setAccountDeletionSecurityError(result.message ?? "PIN incorreto. Tente novamente.");
      return;
    }
    await executeAccountDeletion();
  }

  return (
    <OnboardingShell light>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.root}>
        <ScreenHeaderCard
          eyebrow="Perfil"
          title="Editar perfil"
          subtitle="Atualize seus dados, contato e preferências da sua jornada."
          onBack={() => router.replace("/(app)/journey")}
          backAccessibilityLabel="Voltar"
          style={styles.profileHeader}
        />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: 28 + keyboardInset }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          onScrollBeginDrag={cancelPendingScroll}
        >
          <View style={styles.profileCard}>
            <Pressable onPress={pickAvatar} disabled={uploadingAvatar} style={styles.avatarWrap}>
              {cleanAvatarUrl ? (
                <Image source={{ uri: cleanAvatarUrl }} style={styles.avatarImage} resizeMode="contain" />
              ) : (
                <Text style={styles.avatarText}>{initialsFrom(previewName)}</Text>
              )}
              <View style={styles.avatarBadge}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
            </Pressable>
            <Text style={styles.profileName} numberOfLines={1}>{previewName}</Text>
            {cleanEmail ? <Text style={styles.email} numberOfLines={1}>{cleanEmail}</Text> : null}
            <Pressable onPress={pickAvatar} disabled={uploadingAvatar} style={styles.photoButton}>
              <Ionicons name="image-outline" size={16} color={OB.primary} />
              <Text style={styles.photoButtonText}>{uploadingAvatar ? "Enviando..." : "Alterar foto"}</Text>
            </Pressable>
          </View>

          <View style={styles.card} onLayout={registerField("personal")}>
            <Text style={styles.cardTitle}>Dados pessoais</Text>
            <Text style={styles.label}>Nome</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Seu nome" placeholderTextColor={OB.support} returnKeyType="done" onFocus={() => focusField("personal")} onPressIn={() => focusField("personal")} onSubmitEditing={Keyboard.dismiss} style={styles.input} />

            <Text style={styles.label}>E-mail</Text>
            <TextInput
              value={accountEmail}
              onChangeText={setAccountEmail}
              placeholder="seu@email.com"
              placeholderTextColor={OB.support}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onFocus={() => focusField("personal")}
              onPressIn={() => focusField("personal")}
              onSubmitEditing={Keyboard.dismiss}
              style={styles.input}
            />

            <Text style={styles.label}>Celular</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="(00) 00000-0000"
              placeholderTextColor={OB.support}
              keyboardType="phone-pad"
              returnKeyType="done"
              onFocus={() => focusField("personal")}
              onPressIn={() => focusField("personal")}
              onSubmitEditing={Keyboard.dismiss}
              style={styles.input}
            />
          </View>

          <View style={styles.card} onLayout={registerField("financial")}>
            <Text style={styles.cardTitle}>Informações financeiras</Text>
            <Text style={styles.label}>Renda fixa mensal</Text>
            <TextInput
              value={fixed}
              onChangeText={(text) => setFixed(formatBRLInputFromDigits(text))}
              placeholder="Ex: 2400,00"
              placeholderTextColor={OB.support}
              keyboardType="number-pad"
              returnKeyType="done"
              selectTextOnFocus
              onFocus={() => focusField("financial")}
              onPressIn={() => focusField("financial")}
              onSubmitEditing={Keyboard.dismiss}
              style={styles.input}
            />

            <Text style={styles.label}>Média de renda extra</Text>
            <TextInput
              value={variableAvg}
              onChangeText={(text) => setVariableAvg(formatBRLInputFromDigits(text))}
              placeholder="Ex: 300,00"
              placeholderTextColor={OB.support}
              keyboardType="number-pad"
              returnKeyType="done"
              selectTextOnFocus
              onFocus={() => focusField("financial")}
              onPressIn={() => focusField("financial")}
              onSubmitEditing={Keyboard.dismiss}
              style={styles.input}
            />

            <View style={styles.totalBox}>
              <Ionicons name="cash-outline" size={22} color="#22a96b" />
              <View>
                <Text style={styles.totalLabel}>Renda total mensal</Text>
                <Text style={styles.totalValue}>{formatBRLFromCents(totalCents)}</Text>
              </View>
            </View>

            <Text style={styles.label}>Tipo de trabalho</Text>
            <View style={styles.chips}>
              {TYPES.map((item) => {
                const active = employment === item;
                return (
                  <Pressable key={item} onPress={() => setEmployment(item)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <SecuritySettingsCard />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conta</Text>
            <Pressable onPress={resetPassword} style={styles.settingRow}>
              <Ionicons name="lock-closed-outline" size={20} color={OB.primary} />
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Alterar senha</Text>
                <Text style={styles.settingSubtitle}>Receba um link seguro no e-mail</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={OB.support} />
            </Pressable>
            <Pressable onPress={() => openLegalDocument(LEGAL_URLS.terms)} style={styles.settingRow}>
              <Ionicons name="document-text-outline" size={20} color={OB.primary} />
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Termos de uso</Text>
                <Text style={styles.settingSubtitle}>Consulte as regras do Sonho+</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={OB.support} />
            </Pressable>
            <Pressable onPress={() => openLegalDocument(LEGAL_URLS.privacy)} style={styles.settingRow}>
              <Ionicons name="shield-checkmark-outline" size={20} color={OB.primary} />
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Política de privacidade</Text>
                <Text style={styles.settingSubtitle}>Saiba como seus dados são tratados</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={OB.support} />
            </Pressable>
            <Pressable
              onPress={openAccountDeletion}
              disabled={busy || uploadingAvatar}
              accessibilityRole="button"
              accessibilityLabel="Excluir minha conta"
              accessibilityState={{ disabled: busy || uploadingAvatar }}
              style={[styles.deleteSettingRow, (busy || uploadingAvatar) && styles.buttonDisabled]}
            >
              <Ionicons name="trash-outline" size={20} color="#A33B3B" />
              <View style={styles.settingInfo}>
                <Text style={styles.deleteSettingTitle}>Excluir minha conta</Text>
                <Text style={styles.settingSubtitle}>Remova permanentemente sua conta e os dados associados</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A33B3B" />
            </Pressable>
          </View>

          <Pressable onPress={saveProfile} disabled={busy} style={[styles.primaryButton, busy && styles.buttonDisabled]}>
            <Text style={styles.primaryText}>{busy ? "Salvando..." : "Salvar alterações"}</Text>
          </Pressable>
          <Pressable onPress={logout} style={styles.dangerButton}>
            <Ionicons name="log-out-outline" size={20} color="#B94A4A" />
            <Text style={styles.dangerText}>Sair da conta</Text>
          </Pressable>
        </ScrollView>
        <AccountDeletionModal
          visible={accountDeletionVisible}
          loading={accountDeletionLoading}
          errorMessage={accountDeletionError}
          onCancel={() => {
            if (accountDeletionLoading) return;
            setAccountDeletionVisible(false);
            setAccountDeletionError(null);
          }}
          onDismiss={showPendingAccountDeletionSecurity}
          onRequestDeletion={requestAccountDeletion}
        />
        <SecurityConfirmationModal
          visible={accountDeletionSecurityVisible}
          title="Confirme sua identidade"
          description="Use a proteção local do Sonho+ antes de excluir sua conta permanentemente."
          onCancel={() => {
            if (accountDeletionLoading) return;
            setAccountDeletionSecurityError(null);
            returnFromDeletionSecurity();
          }}
          onDismiss={showPendingAccountDeletionModal}
          showBiometric={appLock.config.biometricEnabled}
          biometricAvailable={appLock.biometricCapabilities.available}
          biometricLabel={appLock.biometricCapabilities.actionLabel}
          onBiometric={confirmDeletionWithBiometrics}
          pinEnabled={appLock.hasPin}
          onConfirmPin={confirmDeletionWithPin}
          loading={accountDeletionLoading || appLock.busy}
          message={accountDeletionLoading ? "Excluindo sua conta..." : null}
          errorMessage={accountDeletionSecurityError}
          cooldownSeconds={Math.ceil(appLock.cooldownRemainingMs / 1_000)}
          cooldownKey={appLock.attempts.cooldownUntilMs ?? appLock.attempts.failedAttempts}
        />
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  profileHeader: {
    borderRadius: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
  },
  scroll: {
    padding: 16,
    paddingTop: 20,
    gap: 14,
    paddingBottom: 28,
  },
  profileCard: {
    alignItems: "center",
    borderRadius: 22,
    padding: 18,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    marginTop: 0,
  },
  avatarWrap: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
    borderWidth: 3,
    borderColor: "#fff",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 43,
  },
  avatarText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
  },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.support,
    borderWidth: 2,
    borderColor: "#fff",
  },
  profileName: {
    color: OB.primary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 12,
    maxWidth: "92%",
  },
  email: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  photoButton: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  photoButtonText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  card: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    gap: 10,
  },
  cardTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 2,
  },
  label: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
  },
  input: {
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 15,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  totalBox: {
    minHeight: 72,
    borderRadius: 17,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  totalLabel: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
  totalValue: {
    color: OB.primary,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 2,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  chipActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  chipText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "900",
  },
  chipTextActive: {
    color: "#fff",
  },
  settingRow: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  settingSubtitle: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  buttonDisabled: {
    opacity: 0.62,
  },
  primaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  dangerButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#FDE7E7",
    borderWidth: 1,
    borderColor: "#F5B9B9",
  },
  dangerText: {
    color: "#B94A4A",
    fontSize: 14,
    fontWeight: "900",
  },
  deleteSettingRow: {
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#F1C2C2",
    backgroundColor: "#FFF7F7",
  },
  deleteSettingTitle: {
    color: "#A33B3B",
    fontSize: 14,
    fontWeight: "900",
  },
});
