import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import { OB } from "../../ui/OnboardingKit";

export function PlannedIncomeNote({ cents }: { cents: number }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>Renda planejada</Text>
      <Text
        style={styles.amount}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {formatBRLFromCents(cents)}
      </Text>
      <Text style={styles.caption}>Intenção deste ciclo. Não é o que já entrou na conta.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4, paddingHorizontal: 2 },
  eyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  amount: { color: OB.primary, fontSize: 26, fontWeight: "900" },
  caption: { color: OB.support, fontSize: 12, fontWeight: "700", lineHeight: 17 },
});
