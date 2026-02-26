// app/(auth)/login.tsx
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "../../src/ui/theme";
import { supabase } from "../../src/lib/supabase";

function isValidEmail(s: string) {
  const x = s.trim();
  return x.includes("@") && x.includes(".");
}

function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: any;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: theme.colors.muted, fontWeight: "900", marginBottom: 8 }}>
        {label}
      </Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: "rgba(255,255,255,0.03)",
        }}
      >
        <Ionicons name={icon} size={18} color={theme.colors.muted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.muted2}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          style={{
            flex: 1,
            color: theme.colors.text,
            fontWeight: "800",
            paddingVertical: 2,
          }}
        />
      </View>
    </View>
  );
}

function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = !!disabled || !!loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={{
        marginTop: 16,
        borderRadius: 18,
        overflow: "hidden",
        opacity: isDisabled ? 0.7 : 1,
      }}
    >
      <LinearGradient
        colors={["rgba(0,240,255,0.95)", "rgba(0,240,255,0.60)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingVertical: 14,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 18,
        }}
      >
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Text style={{ color: "#001018", fontWeight: "900", fontSize: 16 }}>{title}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

function SecondaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        marginTop: 10,
        paddingVertical: 13,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: "rgba(255,255,255,0.02)",
        alignItems: "center",
      }}
    >
      <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    return isValidEmail(email) && pass.trim().length >= 6 && !loading;
  }, [email, pass, loading]);

  async function onLogin() {
    if (loading) return;

    const e = email.trim().toLowerCase();
    const p = pass;

    if (!isValidEmail(e)) return Alert.alert("Atenção", "Digite um e-mail válido.");
    if (p.trim().length < 6) return Alert.alert("Atenção", "Sua senha deve ter pelo menos 6 caracteres.");

    try {
      setLoading(true);

      const { error } = await supabase.auth.signInWithPassword({
        email: e,
        password: p,
      });

      if (error) throw error;

      router.replace("/(tabs)/home");
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
      const { error } = await supabase.auth.resetPasswordForEmail(e);
      if (error) throw error;

      Alert.alert("Enviado!", "Te mandei um e-mail para redefinir sua senha.");
    } catch (err: any) {
      Alert.alert("Erro", err?.message ?? "Não foi possível enviar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg0 }}>
      <LinearGradient
        colors={[theme.colors.bg0, theme.colors.bg1]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      {/* brilho sutil no topo */}
      <View
        style={{
          position: "absolute",
          top: -120,
          left: -80,
          width: 260,
          height: 260,
          borderRadius: 260,
          backgroundColor: "rgba(0,240,255,0.10)",
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          paddingHorizontal: 18,
          paddingTop: 90, // ✅ mais baixo
        }}
      >
        {/* Header */}
        <View style={{ marginBottom: 22 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 34 }}>FinApp</Text>
          <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 6 }}>
            Controle rápido + metas com estimativa.
          </Text>
        </View>

        {/* ✅ empurra o card um pouco mais pra baixo */}
        <View style={{ height: 18 }} />

        {/* Card */}
        <BlurView
          intensity={18}
          tint="dark"
          style={{
            borderRadius: 26,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            overflow: "hidden",
          }}
        >
          <View style={{ padding: 16 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 18 }}>Entrar</Text>

            <Field
              label="E-mail"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="seuemail@exemplo.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={{ marginTop: 12 }}>
              <Text style={{ color: theme.colors.muted, fontWeight: "900", marginBottom: 8 }}>Senha</Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: "rgba(255,255,255,0.03)",
                }}
              >
                <Ionicons name="lock-closed-outline" size={18} color={theme.colors.muted} />

                <TextInput
                  value={pass}
                  onChangeText={setPass}
                  placeholder="••••••••"
                  placeholderTextColor={theme.colors.muted2}
                  secureTextEntry={!showPass}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    flex: 1,
                    color: theme.colors.text,
                    fontWeight: "800",
                    paddingVertical: 2,
                  }}
                />

                <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10}>
                  <Ionicons
                    name={showPass ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={theme.colors.muted}
                  />
                </Pressable>
              </View>

              <Pressable onPress={onForgot} style={{ alignSelf: "flex-end", paddingVertical: 10 }}>
                <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>Esqueci minha senha</Text>
              </Pressable>
            </View>

            <PrimaryButton title="Entrar" onPress={onLogin} loading={loading} disabled={!canSubmit} />
            <SecondaryButton title="Criar conta" onPress={() => router.push("/(auth)/signup")} />
          </View>
        </BlurView>

                {/* Dica */}
        <View style={{ height: 34 }} /> {/* ✅ desce a dica sem ir pro rodapé */}

        <View style={{ paddingHorizontal: 4 }}>
          <Text style={{ color: theme.colors.muted2, fontWeight: "800", textAlign: "center" }}>
            Dica: registre suas entradas/saídas por 30 dias pra melhorar a estimativa.
          </Text>
        </View>
        <View style={{ flex: 1 }} />
      </KeyboardAvoidingView>
    </View>
  );
}
