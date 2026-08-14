import React, { useMemo, useRef, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useSession } from "../src/providers/SessionProvider";
import { supabase } from "../src/lib/supabase";
import { theme } from "../src/ui/theme";
import { useKeyboardAwareScroll } from "../src/hooks/useKeyboardAwareScroll";
import { getPasswordUpdateErrorMessage, validatePassword } from "../src/lib/authValidation";
import { PasswordSecurityGuide } from "../src/ui/PasswordSecurityGuide";

export default function ResetPasswordScreen() {
  const { session, loading } = useSession();
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<"password" | "confirm">();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<TextInput>(null);
  const passwordValidation = useMemo(() => validatePassword(password), [password]);
  const passwordsMismatch = confirm.length > 0 && password !== confirm;
  const valid = passwordValidation.isValid && password === confirm;

  if (!loading && !session) return <Redirect href="/(auth)/login" />;

  async function save() {
    if (busy) return;
    const finalPasswordValidation = validatePassword(password);
    if (!finalPasswordValidation.isValid) {
      Alert.alert("Senha insegura", "Sua senha ainda não atende aos requisitos de segurança.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Confira as senhas", "As senhas não coincidem.");
      return;
    }
    try {
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      Alert.alert("Senha atualizada", "Sua nova senha já pode ser usada.", [
        { text: "Continuar", onPress: () => router.replace("/") },
      ]);
    } catch (error: unknown) {
      Alert.alert("Não foi possível atualizar", getPasswordUpdateErrorMessage(error));
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
      <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>Crie uma senha segura para proteger sua conta.</Text>
      <View onLayout={registerField("password")}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          accessibilityLabel="Nova senha"
          placeholder="Nova senha"
          returnKeyType="next"
          onFocus={() => focusField("password")}
          onPressIn={() => focusField("password")}
          onSubmitEditing={() => confirmRef.current?.focus()}
          style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14 }}
        />
      </View>
      <PasswordSecurityGuide validation={passwordValidation} />
      <View onLayout={registerField("confirm")}>
        <TextInput
          ref={confirmRef}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          accessibilityLabel="Confirmar nova senha"
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
      {passwordsMismatch ? (
        <Text style={{ color: theme.colors.bad, fontSize: 12, fontWeight: "800" }} accessibilityLiveRegion="polite">
          As senhas não coincidem.
        </Text>
      ) : null}
      <Pressable
        disabled={!valid || busy}
        onPress={save}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy, busy }}
        style={{ borderRadius: 14, padding: 15, alignItems: "center", backgroundColor: valid ? theme.colors.primary : theme.colors.border }}
      >
        <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Salvando..." : "Salvar senha"}</Text>
      </Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}
