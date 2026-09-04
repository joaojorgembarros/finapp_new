import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { PASSWORD_REQUIREMENTS } from "../lib/authValidation";
import type { PasswordValidation } from "../lib/authValidation";
import { OB } from "./OnboardingKit";

export function PasswordSecurityGuide({
  validation,
  tone = "light",
}: {
  validation: PasswordValidation;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const strengthStyle = validation.strength === "Forte"
    ? (dark ? styles.strengthStrongDark : styles.strengthStrong)
    : validation.strength === "Média"
      ? (dark ? styles.strengthMediumDark : styles.strengthMedium)
      : (dark ? styles.strengthWeakDark : styles.strengthWeak);
  const strengthTextStyle = validation.strength === "Forte"
    ? (dark ? styles.strengthTextStrongDark : styles.strengthTextStrong)
    : validation.strength === "Média"
      ? (dark ? styles.strengthTextMediumDark : styles.strengthTextMedium)
      : (dark ? styles.strengthTextWeakDark : styles.strengthTextWeak);

  return (
    <View style={[styles.container, dark && styles.containerDark]}>
      <View style={styles.header}>
        <Text style={[styles.title, dark && styles.titleDark]}>Sua senha deve conter:</Text>
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
                color={met ? (dark ? "#6FD1A5" : "#126B45") : (dark ? "#8C9AAE" : OB.support)}
                accessible={false}
              />
              <Text style={[
                styles.requirementText,
                dark && styles.requirementTextDark,
                met && styles.requirementTextMet,
                met && dark && styles.requirementTextMetDark,
              ]}>{requirement.label}</Text>
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
  containerDark: {
    backgroundColor: "rgba(255,255,255,0.025)",
    borderColor: "rgba(140,154,174,0.30)",
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
  titleDark: { color: "#FFFFFF" },
  strength: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  strengthWeak: { backgroundColor: "rgba(163,58,58,0.10)" },
  strengthMedium: { backgroundColor: "rgba(138,90,0,0.11)" },
  strengthStrong: { backgroundColor: "rgba(18,107,69,0.10)" },
  strengthWeakDark: { backgroundColor: "rgba(242,167,167,0.12)" },
  strengthMediumDark: { backgroundColor: "rgba(242,200,121,0.12)" },
  strengthStrongDark: { backgroundColor: "rgba(111,209,165,0.12)" },
  strengthText: { fontSize: 10, lineHeight: 13, fontWeight: "900" },
  strengthTextWeak: { color: "#A33A3A" },
  strengthTextMedium: { color: "#8A5A00" },
  strengthTextStrong: { color: "#126B45" },
  strengthTextWeakDark: { color: "#F2A7A7" },
  strengthTextMediumDark: { color: "#F2C879" },
  strengthTextStrongDark: { color: "#6FD1A5" },
  requirements: { gap: 2 },
  requirement: { minHeight: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  requirementText: { color: "#526F91", fontSize: 10.5, lineHeight: 15, fontWeight: "700" },
  requirementTextDark: { color: "#8C9AAE" },
  requirementTextMet: { color: "#126B45" },
  requirementTextMetDark: { color: "#6FD1A5" },
});
