import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ADD_MOVEMENT_HREF,
  IMPORT_STATEMENT_HREF,
} from "../../lib/movementHistoryPresentation";
import { OB } from "../../ui/OnboardingKit";

export function MovementQuickActions() {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => router.push(ADD_MOVEMENT_HREF)}
        accessibilityRole="button"
        accessibilityLabel="Adicionar movimentação"
        accessibilityHint="Abre o formulário para registrar uma entrada ou um gasto"
        style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.primaryText}>Adicionar</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push(IMPORT_STATEMENT_HREF)}
        accessibilityRole="button"
        accessibilityLabel="Importar extrato"
        accessibilityHint="Abre o fluxo para importar um arquivo CSV do banco"
        style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
      >
        <Ionicons name="document-text-outline" size={16} color={OB.primary} />
        <Text style={styles.secondaryText}>Importar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primary: { backgroundColor: OB.primary },
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  primaryText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  secondaryText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.84 },
});
