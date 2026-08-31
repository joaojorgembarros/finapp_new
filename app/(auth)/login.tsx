import React, { useEffect } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

const NAVY = "#06152E";
const CREAM = "#FDECD6";
const SECONDARY = "#8C9AAE";
const BORDER = "rgba(253, 236, 214, 0.28)";
const SYMBOL = require("../../assets/splash-brand-symbol.png");
const GOOGLE_G_LOGO = require("../../assets/google-g-logo.png");

export default function LoginMethodScreen() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setBackgroundColorAsync(NAVY).catch(() => {});
    NavigationBar.setButtonStyleAsync("light").catch(() => {});
    return () => {
      NavigationBar.setBackgroundColorAsync("#f8fafc").catch(() => {});
      NavigationBar.setButtonStyleAsync("dark").catch(() => {});
    };
  }, []);

  function handleGooglePress() {
    Alert.alert("Login com Google", "Login com Google em breve.");
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" backgroundColor={NAVY} />
      <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
        <View style={styles.topBar} />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.hero}>
            <Image
              accessible={false}
              resizeMode="contain"
              source={SYMBOL}
              style={styles.symbol}
              tintColor={CREAM}
            />
            <Text style={styles.title}>Acesse o Sonho+</Text>
            <Text style={styles.subtitle}>Escolha como deseja continuar.</Text>
          </View>

          <View style={styles.methods}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continuar com Google"
              accessibilityHint="Integração disponível em breve"
              onPress={handleGooglePress}
              style={({ pressed }) => [styles.methodButton, pressed && styles.methodPressed]}
            >
              <View style={styles.iconSlot}>
                <Image
                  accessible={false}
                  resizeMode="contain"
                  source={GOOGLE_G_LOGO}
                  style={styles.googleLogo}
                />
              </View>
              <View style={styles.verticalDivider} />
              <Text style={styles.methodText}>Continuar com Google</Text>
            </Pressable>

            <View style={styles.orRow} accessibilityElementsHidden>
              <View style={styles.orLine} />
              <Text style={styles.orText}>ou</Text>
              <View style={styles.orLine} />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continuar com e-mail"
              onPress={() => router.push("/(auth)/email-login")}
              style={({ pressed }) => [styles.methodButton, pressed && styles.methodPressed]}
            >
              <View style={styles.iconSlot}>
                <Ionicons name="mail-outline" size={31} color={CREAM} />
              </View>
              <View style={styles.verticalDivider} />
              <Text style={styles.methodText}>Continuar com e-mail</Text>
            </Pressable>
          </View>

          <View style={styles.signupArea}>
            <Text style={styles.signupPrompt}>Ainda não tem uma conta?</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Criar conta"
              onPress={() => router.push("/(auth)/signup")}
              style={({ pressed }) => [styles.signupButton, pressed && styles.pressed]}
            >
              <Text style={styles.signupText}>Criar conta</Text>
              <Ionicons name="chevron-forward" size={20} color={CREAM} />
            </Pressable>
          </View>
        </ScrollView>
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
  },
  topBar: {
    height: 58,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
  },
  hero: {
    flex: 1,
    minHeight: 270,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 44,
  },
  symbol: {
    width: 64,
    height: 68,
    marginBottom: 28,
  },
  title: {
    color: CREAM,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: 0.1,
    lineHeight: 36,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 13,
    color: SECONDARY,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 22,
    textAlign: "center",
  },
  methods: {
    width: "100%",
  },
  methodButton: {
    minHeight: 66,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.01)",
  },
  methodPressed: {
    backgroundColor: "rgba(253,236,214,0.06)",
    borderColor: "rgba(253,236,214,0.48)",
  },
  iconSlot: {
    width: 74,
    alignItems: "center",
    justifyContent: "center",
  },
  googleLogo: {
    width: 29,
    height: 29,
  },
  verticalDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: BORDER,
  },
  methodText: {
    flex: 1,
    paddingHorizontal: 18,
    color: CREAM,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
  },
  orRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 10,
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(140,154,174,0.42)",
  },
  orText: {
    color: SECONDARY,
    fontSize: 14,
    fontWeight: "600",
  },
  signupArea: {
    flex: 0.85,
    minHeight: 164,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 24,
    paddingBottom: 18,
  },
  signupPrompt: {
    color: SECONDARY,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  signupButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 14,
    marginTop: 6,
  },
  signupText: {
    color: CREAM,
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
