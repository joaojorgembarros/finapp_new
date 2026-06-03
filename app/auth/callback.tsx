// app/auth/callback.tsx
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, P } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { supabase } from "../../src/lib/supabase";

function readAuthParams(url: string) {
  const raw = url.replace("#", "?");
  const parsed = Linking.parse(raw);
  const params = (parsed.queryParams ?? {}) as Record<string, string | string[]>;

  function one(key: string) {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  }

  return {
    code: one("code"),
    accessToken: one("access_token"),
    refreshToken: one("refresh_token"),
    error: one("error"),
    errorDescription: one("error_description"),
  };
}

export default function AuthCallback() {
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function confirm() {
      try {
        const url = await Linking.getInitialURL();
        if (!url) throw new Error("Link de confirmação inválido.");

        const params = readAuthParams(url);
        if (params.error) {
          throw new Error(params.errorDescription || params.error);
        }

        if (params.code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
          if (exchangeError) throw exchangeError;
        } else if (params.accessToken && params.refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          });
          if (sessionError) throw sessionError;
        }

        if (!alive) return;
        router.replace("/");
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Não foi possível confirmar seu e-mail.");
      }
    }

    confirm();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Screen>
      <Card>
        {!error ? (
          <View style={{ alignItems: "center", gap: 12 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <H1>Confirmando e-mail</H1>
            <P muted>So um instante. Estamos liberando seu acesso ao FinApp.</P>
          </View>
        ) : (
          <>
            <H1>Link não confirmado</H1>
            <P muted>{error}</P>
            <Button title="Voltar para entrar" onPress={() => router.replace("/(auth)/login")} />
          </>
        )}
      </Card>
    </Screen>
  );
}
