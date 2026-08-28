import React, { useEffect } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { LEGAL_URLS, openLegalUrl } from "../../src/lib/legal";

const NAVY = "#06152e";
const CREAM = "#FDECD6";
const CREAM_MUTED = "rgba(253, 236, 214, 0.62)";
const CREAM_FAINT = "rgba(253, 236, 214, 0.38)";
const SYMBOL = require("../../assets/splash-brand-symbol.png");

export default function WelcomeScreen() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setBackgroundColorAsync(NAVY).catch(() => {});
    NavigationBar.setButtonStyleAsync("light").catch(() => {});
    return () => {
      NavigationBar.setBackgroundColorAsync("#f8fafc").catch(() => {});
      NavigationBar.setButtonStyleAsync("dark").catch(() => {});
    };
  }, []);

  function openLegal(kind: "terms" | "privacy") {
    const url = LEGAL_URLS[kind];
    const title = kind === "terms" ? "Termos" : "Privacidade";
    openLegalUrl(url).catch((error: { message?: string }) => {
      Alert.alert(title, error?.message ?? "URL ainda não configurada para esta versão.");
    });
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" backgroundColor={NAVY} />
      <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
        <View style={styles.hero}>
          <Image
            accessible={false}
            resizeMode="contain"
            source={SYMBOL}
            style={styles.symbol}
            tintColor={CREAM}
          />
          <Text style={styles.title}>Bem-vindo ao Sonho+</Text>
          <Text style={styles.tagline}>Organize hoje. Conquiste amanhã.</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continuar com e-mail"
            onPress={() => router.push("/(auth)/login")}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Continuar com e-mail</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Criar conta"
            onPress={() => router.push("/(auth)/signup")}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Criar conta</Text>
          </Pressable>

          <Text style={styles.terms}>
            Ao continuar, você concorda com nossos{" "}
            <Text onPress={() => openLegal("terms")} style={styles.termLink}>
              Termos
            </Text>
            {" "}e{" "}
            <Text onPress={() => openLegal("privacy")} style={styles.termLink}>
              Privacidade
            </Text>
            .
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: NAVY,
  },
  safe: {
    flex: 1,
    paddingHorizontal: 28,
  },
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 24,
  },
  symbol: {
    width: 72,
    height: 76,
    marginBottom: 36,
  },
  title: {
    color: CREAM,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: 0.2,
    textAlign: "center",
    lineHeight: 34,
  },
  tagline: {
    marginTop: 12,
    color: CREAM_MUTED,
    fontSize: 16,
    fontWeight: "400",
    letterSpacing: 0.2,
    textAlign: "center",
    lineHeight: 22,
  },
  actions: {
    paddingBottom: Platform.OS === "ios" ? 12 : 8,
    gap: 8,
  },
  primary: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CREAM,
  },
  primaryText: {
    color: NAVY,
    fontSize: 16,
    fontWeight: "700",
  },
  secondary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: CREAM_MUTED,
    fontSize: 15,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.82,
  },
  terms: {
    marginTop: 18,
    marginBottom: 8,
    color: CREAM_FAINT,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 17,
  },
  termLink: {
    color: CREAM_MUTED,
    fontWeight: "700",
  },
});
