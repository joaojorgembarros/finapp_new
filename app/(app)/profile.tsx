import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";
import { useSession } from "../../src/providers/SessionProvider";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { expectedMonthlyIncomeCents, EmploymentType, getProfile, upsertProfile } from "../../src/lib/profile";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";
import { deleteOwnAccount, requestPasswordReset } from "../../src/lib/auth";
import { LEGAL_URLS, openLegalUrl } from "../../src/lib/legal";

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
  const { session, userId, signOut } = useSession();
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
  const cleanEmail = accountEmail.trim().toLowerCase();
  const cleanPhone = phone.trim();

  function isValidEmail(value: string) {
    const normalized = value.trim();
    return normalized.includes("@") && normalized.includes(".");
  }

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
      if (cleanEmail !== email.toLowerCase()) {
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
        cleanEmail !== email.toLowerCase()
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
    } catch (error: any) {
      Alert.alert("Erro", error?.message ?? "Não foi possível enviar o link agora.");
    }
  }

  async function logout() {
    await signOut();
    router.replace("/(auth)/login");
  }

  function openLegalDocument(url: string) {
    openLegalUrl(url).catch((error: any) => {
      Alert.alert("Não foi possível abrir", error?.message ?? "Confira a URL configurada para esta versão.");
    });
  }

  function confirmAccountDeletion() {
    Alert.alert(
      "Excluir conta definitivamente?",
      "Seus dados pessoais serão removidos. Esta ação não pode ser desfeita.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir conta",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteOwnAccount();
              router.replace("/(auth)/login");
            } catch (error: any) {
              Alert.alert("Erro ao excluir conta", error?.message ?? "Não foi possível excluir sua conta agora.");
            }
          },
        },
      ],
    );
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
                <Text style={styles.settingSubtitle}>Consulte as regras do FinApp</Text>
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
          </View>

          <Pressable onPress={saveProfile} disabled={busy} style={[styles.primaryButton, busy && styles.buttonDisabled]}>
            <Text style={styles.primaryText}>{busy ? "Salvando..." : "Salvar alterações"}</Text>
          </Pressable>
          <Pressable onPress={logout} style={styles.dangerButton}>
            <Ionicons name="log-out-outline" size={20} color="#B94A4A" />
            <Text style={styles.dangerText}>Sair da conta</Text>
          </Pressable>
          <Pressable onPress={confirmAccountDeletion} style={styles.deleteButton}>
            <Ionicons name="trash-outline" size={20} color="#B94A4A" />
            <Text style={styles.dangerText}>Excluir minha conta</Text>
          </Pressable>
        </ScrollView>
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
  deleteButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E8A2A2",
    backgroundColor: "transparent",
  },
});
