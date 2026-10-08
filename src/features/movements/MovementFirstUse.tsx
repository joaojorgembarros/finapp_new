import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ADD_MOVEMENT_HREF,
  IMPORT_STATEMENT_HREF,
} from "../../lib/movementHistoryPresentation";
import { OB } from "../../ui/OnboardingKit";

export function MovementFirstUse() {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Comece pelas suas movimentações</Text>
      <Text style={styles.text}>Registre um lançamento ou importe o extrato do banco.</Text>
      <Pressable
        onPress={() => router.push(ADD_MOVEMENT_HREF)}
        accessibilityRole="button"
        accessibilityLabel="Adicionar movimentação"
        accessibilityHint="Abre o formulário para registrar uma entrada ou um gasto"
        style={({ pressed }) => [styles.action, styles.primary, pressed && styles.pressed]}
      >
        <View style={styles.primaryIcon}>
          <Ionicons name="add" size={22} color="#fff" />
        </View>
        <View style={styles.actionText}>
          <Text style={styles.primaryTitle}>Adicionar movimentação</Text>
          <Text style={styles.primarySubtitle}>Registre uma entrada ou um gasto</Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </Pressable>
      <Pressable
        onPress={() => router.push(IMPORT_STATEMENT_HREF)}
        accessibilityRole="button"
        accessibilityLabel="Importar extrato"
        accessibilityHint="Abre o fluxo para importar um arquivo CSV do banco"
        style={({ pressed }) => [styles.action, styles.secondary, pressed && styles.pressed]}
      >
        <View style={styles.secondaryIcon}>
          <Ionicons name="document-text-outline" size={20} color={OB.primary} />
        </View>
        <View style={styles.actionText}>
          <Text style={styles.secondaryTitle}>Importar extrato</Text>
          <Text style={styles.secondarySubtitle}>Envie o CSV do seu banco</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={OB.support} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 20,
    padding: 16,
    gap: 10,
    backgroundColor: "rgba(123,160,200,0.12)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  title: { color: OB.primary, fontSize: 18, fontWeight: "900" },
  text: { color: OB.support, fontSize: 13, lineHeight: 18, fontWeight: "700", marginBottom: 4 },
  action: {
    minHeight: 74,
    borderRadius: 17,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  primary: { backgroundColor: OB.primary },
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  primaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  secondaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  actionText: { flex: 1, minWidth: 0 },
  primaryTitle: { color: "#fff", fontSize: 13, lineHeight: 18, fontWeight: "900" },
  primarySubtitle: { color: "rgba(255,255,255,0.78)", fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 2 },
  secondaryTitle: { color: OB.primary, fontSize: 13, lineHeight: 18, fontWeight: "900" },
  secondarySubtitle: { color: OB.support, fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 2 },
  pressed: { opacity: 0.84 },
});
