import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { PASSWORD_REQUIREMENTS } from "../lib/authValidation";
import type { PasswordValidation } from "../lib/authValidation";
import { OB } from "./OnboardingKit";

export function PasswordSecurityGuide({ validation }: { validation: PasswordValidation }) {
  const strengthStyle = validation.strength === "Forte"
    ? styles.strengthStrong
    : validation.strength === "Média"
      ? styles.strengthMedium
      : styles.strengthWeak;
  const strengthTextStyle = validation.strength === "Forte"
    ? styles.strengthTextStrong
    : validation.strength === "Média"
      ? styles.strengthTextMedium
      : styles.strengthTextWeak;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Sua senha deve conter:</Text>
        <View
          style={[styles.strength, strengthStyle]}
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Força da senha: ${validation.strength}. ${validation.metCount} de 5 requisitos atendidos.`}
        >
          <Text style={[styles.strengthText, strengthTextStyle]}>{validation.strength} · {validation.metCount}/5</Text>
        </View>
      </View>
      <View style={styles.requirements}>
        {PASSWORD_REQUIREMENTS.map((requirement) => {
          const met = validation.requirements[requirement.key];
          return (
            <View
              key={requirement.key}
              style={styles.requirement}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${requirement.label}: ${met ? "atendido" : "pendente"}`}
            >
              <Ionicons
                name={met ? "checkmark-circle" : "ellipse-outline"}
                size={14}
                color={met ? "#126B45" : OB.support}
                accessible={false}
              />
              <Text style={[styles.requirementText, met && styles.requirementTextMet]}>{requirement.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 7,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  header: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    flex: 1,
    color: OB.primary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  strength: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  strengthWeak: { backgroundColor: "rgba(163,58,58,0.10)" },
  strengthMedium: { backgroundColor: "rgba(138,90,0,0.11)" },
  strengthStrong: { backgroundColor: "rgba(18,107,69,0.10)" },
  strengthText: { fontSize: 10, lineHeight: 13, fontWeight: "900" },
  strengthTextWeak: { color: "#A33A3A" },
  strengthTextMedium: { color: "#8A5A00" },
  strengthTextStrong: { color: "#126B45" },
  requirements: { gap: 2 },
  requirement: { minHeight: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  requirementText: { color: "#526F91", fontSize: 10.5, lineHeight: 15, fontWeight: "700" },
  requirementTextMet: { color: "#126B45" },
});
