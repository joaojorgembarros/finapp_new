import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useSession } from "../src/providers/SessionProvider";
import { supabase } from "../src/lib/supabase";
import { getPasswordUpdateErrorMessage } from "../src/lib/authValidation";
import { passwordRecoveryUrlFromRouterParams, updatePasswordDuringRecovery } from "../src/lib/passwordRecovery";
import { theme } from "../src/ui/theme";
import { useKeyboardAwareScroll } from "../src/hooks/useKeyboardAwareScroll";

export default function ResetPasswordScreen() {
  const {
    session,
    loading,
    passwordRecoveryPending,
    passwordRecoveryActive,
    passwordRecoveryError,
    passwordRecoveryOpen,
    consumePasswordRecoveryUrl,
    endPasswordRecovery,
  } = useSession();
  const params = useLocalSearchParams();
  const recoveryParamUrl = passwordRecoveryUrlFromRouterParams(
    params as Record<string, string | string[] | undefined>,
  );
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<"password" | "confirm">();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<TextInput>(null);
  const valid = useMemo(() => password.length >= 8 && password === confirm, [confirm, password]);
  const waitingForLink = loading || passwordRecoveryPending;
  const canSetPassword = Boolean(session) && (passwordRecoveryActive || passwordRecoveryOpen) && !passwordRecoveryError && !waitingForLink;

  useEffect(() => {
    void consumePasswordRecoveryUrl(recoveryParamUrl);
  }, [consumePasswordRecoveryUrl, recoveryParamUrl]);

  if (waitingForLink) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg0, padding: 24, gap: 12 }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={{ color: theme.colors.muted, fontWeight: "600", textAlign: "center" }}>Validando o link de recuperação...</Text>
      </View>
    );
  }

  if (passwordRecoveryError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.colors.bg0, padding: 24, gap: 16 }}>
        <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "900" }}>Link inválido</Text>
        <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>{passwordRecoveryError}</Text>
        <Pressable
          onPress={() => {
            endPasswordRecovery();
            router.replace("/(auth)/login");
          }}
          style={{ borderRadius: 14, padding: 15, alignItems: "center", backgroundColor: theme.colors.primary }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Voltar ao login</Text>
        </Pressable>
      </View>
    );
  }

  if (!canSetPassword) {
    if (passwordRecoveryOpen) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg0, padding: 24, gap: 12 }}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={{ color: theme.colors.muted, fontWeight: "600", textAlign: "center" }}>Preparando a troca de senha...</Text>
        </View>
      );
    }
    return <Redirect href="/(auth)/login" />;
  }

  async function save() {
    if (!valid || busy) return;
    try {
      setBusy(true);
      await updatePasswordDuringRecovery(session, supabase.auth, password);
      endPasswordRecovery();
      Alert.alert("Senha atualizada", "Sua nova senha já pode ser usada.", [
        { text: "Continuar", onPress: () => router.replace("/") },
      ]);
    } catch (error: unknown) {
      Alert.alert("Erro", getPasswordUpdateErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={{ flex: 1, backgroundColor: theme.colors.bg0 }}>
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 14 }, { paddingBottom: 24 + keyboardInset }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      onScrollBeginDrag={cancelPendingScroll}
    >
      <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "900" }}>Criar nova senha</Text>
      <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>Use pelo menos 8 caracteres.</Text>
      <View onLayout={registerField("password")}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Nova senha"
          returnKeyType="next"
          onFocus={() => focusField("password")}
          onPressIn={() => focusField("password")}
          onSubmitEditing={() => confirmRef.current?.focus()}
          style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14 }}
        />
      </View>
      <View onLayout={registerField("confirm")}>
        <TextInput
          ref={confirmRef}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          placeholder="Confirmar nova senha"
          returnKeyType="done"
          onFocus={() => focusField("confirm")}
          onPressIn={() => focusField("confirm")}
          onSubmitEditing={() => {
            Keyboard.dismiss();
            if (valid) void save();
          }}
          style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14 }}
        />
      </View>
      <Pressable disabled={!valid || busy} onPress={save} style={{ borderRadius: 14, padding: 15, alignItems: "center", backgroundColor: valid ? theme.colors.primary : theme.colors.border }}>
        <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Salvando..." : "Salvar senha"}</Text>
      </Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}
