import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import {
  OBSERVED_SUMMARY_COPY,
  type ObservedMonthHeroPresentation,
} from "../../lib/observedSummaryPresentation";
import { OB } from "../../ui/OnboardingKit";

export function ObservedMonthHero({
  presentation,
  onAddMovement,
}: {
  presentation: ObservedMonthHeroPresentation;
  onAddMovement: () => void;
}) {
  if (presentation.kind === "empty") {
    return (
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>{presentation.title}</Text>
        <Text style={styles.caption}>{presentation.caption}</Text>
        <Text style={styles.emptyMessage}>{presentation.message}</Text>
        {presentation.historyNote ? (
          <Text style={styles.historyNote}>{presentation.historyNote}</Text>
        ) : null}
        <View style={styles.emptyActions}>
          <Pressable
            onPress={onAddMovement}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>{OBSERVED_SUMMARY_COPY.addMovement}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.heroCard}>
      <Text style={styles.eyebrow}>{presentation.title}</Text>
      <Text style={styles.caption}>{presentation.caption}</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>{OBSERVED_SUMMARY_COPY.heroInflow}</Text>
          <Text style={styles.metricValue}>{formatBRLFromCents(presentation.inflowCents)}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>{OBSERVED_SUMMARY_COPY.heroOutflow}</Text>
          <Text style={styles.metricValue}>{formatBRLFromCents(presentation.outflowCents)}</Text>
        </View>
      </View>
      <View style={styles.result}>
        <Text style={styles.resultLabel}>{presentation.resultLabel}</Text>
        <Text
          style={[styles.resultValue, presentation.netCents < 0 && styles.resultNegative]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.55}
        >
          {formatBRLFromCents(presentation.netCents)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    borderRadius: 28,
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: OB.primary,
  },
  eyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  caption: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
  },
  metrics: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  },
  metric: {
    flex: 1,
    gap: 4,
  },
  metricLabel: {
    color: OB.textOnDarkMid,
    fontSize: 12,
    fontWeight: "800",
  },
  metricValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
  },
  result: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    gap: 4,
  },
  resultLabel: {
    color: OB.textOnDarkMid,
    fontSize: 12,
    fontWeight: "800",
  },
  resultValue: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "900",
  },
  resultNegative: {
    color: "#F4C7C7",
  },
  emptyMessage: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    marginTop: 8,
  },
  historyNote: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
  },
  emptyActions: {
    gap: 8,
    marginTop: 8,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  primaryButtonText: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  pressed: { opacity: 0.82 },
});
