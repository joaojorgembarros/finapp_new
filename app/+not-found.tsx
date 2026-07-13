// app/+not-found.tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { OB, OnboardingShell } from "../src/ui/OnboardingKit";

export default function NotFound() {
  return (
    <OnboardingShell>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Ops</Text>
          <Text style={styles.text}>Essa tela não existe.</Text>
          <Pressable style={styles.button} onPress={() => router.replace("/")}>
            <Text style={styles.buttonText}>Voltar para o início</Text>
          </Pressable>
        </View>
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", padding: 24 },
  card: { gap: 14, padding: 24, borderRadius: 22, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  title: { color: OB.primary, fontSize: 28, fontWeight: "900" },
  text: { color: OB.support, fontSize: 15, fontWeight: "700" },
  button: { minHeight: 52, marginTop: 6, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: OB.primary },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
});
