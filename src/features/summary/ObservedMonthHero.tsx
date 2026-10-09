import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import {
  OBSERVED_SUMMARY_COPY,
  formatObservedSignedCents,
  type ObservedMonthHeroPresentation,
} from "../../lib/observedSummaryPresentation";
import { OB } from "../../ui/OnboardingKit";
import { ObservedResultPanel } from "./ObservedResultPanel";

export function ObservedMonthHero({
  presentation,
  onAddMovement,
  comparisonLine,
}: {
  presentation: ObservedMonthHeroPresentation;
  onAddMovement: () => void;
  comparisonLine?: string | null;
}) {
  if (presentation.kind === "empty") {
    return (
      <ObservedResultPanel eyebrow={presentation.title} caption={presentation.caption}>
        <Text style={styles.emptyMessage}>{presentation.message}</Text>
        {presentation.historyNote ? (
          <Text style={styles.historyNote}>{presentation.historyNote}</Text>
        ) : null}
        <Pressable
          onPress={onAddMovement}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>{OBSERVED_SUMMARY_COPY.addMovement}</Text>
        </Pressable>
      </ObservedResultPanel>
    );
  }

  return (
    <ObservedResultPanel
      eyebrow={presentation.title}
      caption={presentation.caption}
      narrative={comparisonLine ? null : presentation.narrative}
      glance={comparisonLine}
      result={formatObservedSignedCents(presentation.netCents)}
      negative={presentation.netCents < 0}
      inflowLabel={OBSERVED_SUMMARY_COPY.heroInflow}
      inflow={formatBRLFromCents(presentation.inflowCents)}
      outflowLabel={OBSERVED_SUMMARY_COPY.heroOutflow}
      outflow={formatBRLFromCents(presentation.outflowCents)}
    />
  );
}

const styles = StyleSheet.create({
  emptyMessage: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    marginTop: 10,
    maxWidth: 280,
  },
  historyNote: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    marginTop: 10,
  },
  primaryButtonText: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  pressed: { opacity: 0.82 },
});
