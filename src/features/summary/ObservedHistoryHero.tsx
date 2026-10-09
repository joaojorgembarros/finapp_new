import React from "react";
import { StyleSheet, Text } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import {
  formatObservedHistoryNet,
  type ObservedHistoryPeriodPresentation,
} from "../../lib/observedHistoryPresentation";
import { ObservedResultPanel } from "./ObservedResultPanel";

export function ObservedHistoryHero({
  presentation,
}: {
  presentation: ObservedHistoryPeriodPresentation;
}) {
  if (presentation.kind === "empty") {
    return (
      <ObservedResultPanel eyebrow={presentation.title} caption={presentation.caption}>
        <Text style={styles.emptyMessage}>{presentation.message}</Text>
      </ObservedResultPanel>
    );
  }

  return (
    <ObservedResultPanel
      eyebrow={presentation.title}
      caption={presentation.caption}
      result={formatObservedHistoryNet(presentation.netCents)}
      negative={presentation.netCents < 0}
      inflowLabel={presentation.inflowLabel}
      inflow={formatBRLFromCents(presentation.inflowCents)}
      outflowLabel={presentation.outflowLabel}
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
});
